/**
 * Module de génération d'itinéraires IA
 *
 * Approche simplifiée:
 * 1. Calculer les créneaux disponibles (arrivée → départ)
 * 2. Remplir avec les attractions prioritaires de l'utilisateur
 * 3. Insérer les repas aux bons moments
 */

import {
  TripPreferences,
  Trip,
  TripDay,
  TripItem,
  TripItemType,
  Flight,
  ParkingOption,
  BudgetLevel,
  TransportOptionSummary,
  Accommodation,
  BudgetStrategy,
} from './types';
import { findNearbyAirports, findNearbyAirportsAsync, calculateDistance, AirportInfo, getCityCenterCoords, getCityCenterCoordsAsync, geocodeAddress } from './services/geocoding';
import { searchFlights, formatFlightDuration } from './services/flights';
import { selectBestParking, calculateParkingTime } from './services/parking';
import { searchRestaurants, selectBestRestaurant, estimateMealPrice } from './services/restaurants';
import { Attraction, estimateTravelTime, hasAttractionData } from './services/attractions';
import { selectAttractionsAsync } from './services/attractionsServer';
import { getDirections, generateGoogleMapsUrl, generateGoogleMapsSearchUrl, DirectionsResult } from './services/directions';
import { calculateTripCarbon } from './services/carbon';
import { compareTransportOptions, TransportOption, getTrainBookingUrl } from './services/transport';
import { DayScheduler, formatTime as formatScheduleTime, parseTime } from './services/scheduler';
import { searchHotels, selectBestHotel } from './services/hotels';
import { validateAndFixTrip } from './services/coherenceValidator';
import { validateTripGeography } from './services/geoValidator';
import { searchLuggageStorage, selectBestStorage, needsLuggageStorage, LuggageStorage } from './services/luggageStorage';
import { calculateFlightScore, EARLY_MORNING_PENALTY } from './services/flightScoring';
import { createLocationTracker, TravelerLocation } from './services/locationTracker';
import { generateFlightLink, generateHotelLink, formatDateForUrl } from './services/linkGenerator';
import { searchAttractionsMultiQuery, searchMustSeeAttractions, searchGroceryStores, type GroceryStore } from './services/serpApiPlaces';
import { resolveAttractionByName } from './services/overpassAttractions';
import { generateClaudeItinerary, summarizeAttractions, mapItineraryToAttractions } from './services/claudeItinerary';
import { generateTravelTips } from './services/travelTips';
import { resolveBudget, generateBudgetStrategy } from './services/budgetResolver';
import { searchAirbnbListings, isAirbnbApiConfigured } from './services/airbnb';
import { BudgetTracker } from './services/budgetTracker';
import { enrichRestaurantsWithGemini } from './services/geminiSearch';

/**
 * Génère l'URL de réservation pour un hébergement.
 * Préserve le bookingUrl natif (ex: Airbnb) s'il existe, sinon génère un lien Booking.com.
 */
function getAccommodationBookingUrl(
  accom: Accommodation | null | undefined,
  destination: string,
  checkIn: string | Date,
  checkOut: string | Date,
): string | undefined {
  if (!accom?.name) return undefined;
  // Préserver le lien Airbnb natif s'il existe
  if (accom.bookingUrl && (accom.bookingUrl.includes('airbnb') || accom.type === 'apartment')) {
    return accom.bookingUrl;
  }
  return generateHotelLink(
    { name: accom.name, city: destination },
    { checkIn: formatDateForUrl(checkIn), checkOut: formatDateForUrl(checkOut) },
  );
}

/**
 * Choisit le mode de direction Google Maps en fonction de la distance
 * Walking si < 1.5km, transit si < 15km, driving sinon
 */
function pickDirectionMode(from: { lat: number; lng: number }, to: { lat: number; lng: number }): 'walking' | 'transit' | 'driving' {
  const R = 6371; // km
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (dist < 1.5) return 'walking';
  if (dist < 15) return 'transit';
  return 'driving';
}

// Génère un ID unique
function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Normalise une date pour éviter les problèmes de timezone
 * Convertit une date ISO (potentiellement en UTC) en date locale à midi
 * Ex: "2026-01-27T23:00:00.000Z" (UTC) → 27 janvier 12:00 local (pas le 28!)
 */
function normalizeToLocalDate(dateInput: Date | string): Date {
  let dateStr: string;

  if (typeof dateInput === 'string') {
    // Si c'est une string ISO, extraire YYYY-MM-DD
    dateStr = dateInput.split('T')[0];
  } else {
    // Si c'est un objet Date, utiliser toISOString pour avoir YYYY-MM-DD
    // MAIS on veut la date LOCALE, pas UTC
    const year = dateInput.getFullYear();
    const month = String(dateInput.getMonth() + 1).padStart(2, '0');
    const day = String(dateInput.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
  }

  // Créer une date locale à midi pour éviter les problèmes de timezone
  const [year, month, day] = dateStr.split('-').map(Number);
  const localDate = new Date(year, month - 1, day, 12, 0, 0, 0);

  return localDate;
}

// Types internes
interface TimeSlot {
  start: Date;
  end: Date;
  type: 'available' | 'meal' | 'logistics';
}

interface DayContext {
  dayNumber: number;
  date: Date;
  availableFrom: Date;
  availableUntil: Date;
  cityCenter: { lat: number; lng: number };
}

/**
 * Post-traitement: corrige les durées irréalistes que Claude assigne
 */
function fixAttractionDuration(attraction: Attraction): Attraction {
  const name = attraction.name.toLowerCase();
  const d = attraction.duration;

  // Places et squares: max 30min
  if (/\b(place|square|piazza|platz)\b/.test(name)) {
    if (d > 30) return { ...attraction, duration: 25 };
  }
  // Jardins et parcs: max 60min
  if (/\b(jardin|parc|park|garden)\b/.test(name)) {
    if (d > 60) return { ...attraction, duration: 60 };
  }
  // Petites églises: max 30min (pas les cathédrales/basiliques)
  if (/\b(église|eglise|church|chapelle|chapel)\b/.test(name) && !/\b(cathédrale|cathedrale|cathedral|basilique|basilica|notre-dame|sacré|sacre|sainte-chapelle)\b/.test(name)) {
    if (d > 30) return { ...attraction, duration: 20 };
  }
  // Cathédrales, basiliques: max 60min
  if (/\b(cathédrale|cathedral|basilique|basilica)\b/.test(name)) {
    if (d > 60) return { ...attraction, duration: 50 };
  }
  // Vignes, petits vignobles urbains: max 20min
  if (/\b(vigne|vignoble|vineyard)\b/.test(name) && !/\b(domaine|château|cave|cellar|dégustation|tasting)\b/.test(name)) {
    if (d > 20) return { ...attraction, duration: 15 };
  }
  // Monuments, arcs, statues: max 45min
  if (/\b(arc de|monument|statue|fontaine|fountain|colonne|column|obélisque|obelisk|tower|tour)\b/.test(name) && !/\bmusée\b/.test(name)) {
    if (d > 45) return { ...attraction, duration: 40 };
  }
  // Champ-de-Mars, esplanade: max 30min
  if (/\b(champ|esplanade|promenade|boulevard)\b/.test(name)) {
    if (d > 45) return { ...attraction, duration: 30 };
  }
  // Ancient/old buildings without museum: max 30min (facades, palaces without exhibit)
  if (/\b(ancien|old|palais|palazzo|palace|hôtel de ville|town hall|mairie)\b/.test(name) && !/\b(musée|museum|exposition|exhibit|galerie|gallery)\b/.test(name)) {
    if (d > 45) return { ...attraction, duration: 30 };
  }
  // Quartiers à explorer: 60-90min
  if (/\b(quartier|neighborhood|district|marché|market)\b/.test(name)) {
    if (d > 120) return { ...attraction, duration: 90 };
  }
  // Grands musées: 150-180min OK, ne pas toucher
  // Musées moyens: max 120min si pas un "grand"
  if (/\b(musée|museum)\b/.test(name)) {
    const isGrand = /\b(louvre|orsay|british|prado|hermitage|metropolitan|smithsonian|uffizi)\b/.test(name);
    if (!isGrand && d > 120) return { ...attraction, duration: 120 };
  }

  return attraction;
}

/**
 * Post-traitement: corrige les coûts irréalistes (tout à 30€)
 */
function fixAttractionCost(attraction: Attraction): Attraction {
  const name = attraction.name.toLowerCase();
  const cost = attraction.estimatedCost;

  // Gratuit: parcs, jardins, places, extérieurs, quartiers, vignes urbaines, plages, portes, escaliers, vieille ville, ports
  if (/\b(jardin|parc|park|garden|place|square|piazza|champ|esplanade|promenade|quartier|neighborhood|district|boulevard|rue|street|vigne|vignoble|beach|plage|playa|spiaggia|gate|porte|porta|puerta|stairs|escalier|old town|vieille ville|centro storico|altstadt|harbour|harbor|port|marina|waterfront|pier|quai|boardwalk)\b/i.test(name)) {
    if (cost > 0) return { ...attraction, estimatedCost: 0 };
  }
  // Églises et cathédrales: généralement gratuit (sauf tours/cryptes)
  if (/\b(église|eglise|cathédrale|cathedrale|basilique|church|cathedral|basilica|mosquée|mosque|temple|synagogue|chapel|chapelle)\b/i.test(name)) {
    if (cost > 0 && !/\b(tour|tower|crypte|crypt|sainte-chapelle)\b/i.test(name)) {
      return { ...attraction, estimatedCost: 0 };
    }
  }
  // Sainte-Chapelle: 13€
  if (/sainte-chapelle/.test(name)) {
    return { ...attraction, estimatedCost: 13 };
  }
  // Grands musées avec prix connus
  if (/\blouvre\b/.test(name) && /\bmusée\b/.test(name)) {
    return { ...attraction, estimatedCost: 22 };
  }
  if (/\borsay\b/.test(name)) {
    return { ...attraction, estimatedCost: 16 };
  }
  // Arc de Triomphe du Carrousel: gratuit (en plein air)
  if (/\barc de triomphe\b/.test(name) && /\bcarrousel\b/i.test(name)) {
    return { ...attraction, estimatedCost: 0 };
  }
  if (/\barc de triomphe\b/.test(name)) {
    return { ...attraction, estimatedCost: 16 };
  }
  if (/\btour eiffel\b/.test(name) || /\beiffel tower\b/.test(name)) {
    return { ...attraction, estimatedCost: 29 };
  }
  if (/\bnotre-dame\b/.test(name) || /\bnotre dame\b/.test(name)) {
    return { ...attraction, estimatedCost: 0 };
  }
  // Versailles: 21€
  if (/\bversailles\b/.test(name)) {
    return { ...attraction, estimatedCost: 21 };
  }
  // Panthéon: 11€
  if (/\bpanthéon\b/.test(name) || /\bpantheon\b/.test(name)) {
    return { ...attraction, estimatedCost: 11 };
  }
  // Conciergerie: 11.50€
  if (/\bconciergerie\b/.test(name)) {
    return { ...attraction, estimatedCost: 12 };
  }

  // Règles génériques pour toutes les villes:
  // Monuments/arcs/statues en plein air → gratuit (Arc de Triomphe Barcelone, etc.)
  if (/\b(arc de|arco|monument|statue|fontaine|fountain|colonne|column|obélisque|obelisk)\b/.test(name)) {
    if (cost > 0 && !/\b(musée|museum|tour|tower|observation|mirador|deck)\b/.test(name)) {
      return { ...attraction, estimatedCost: 0 };
    }
  }

  // Miradors/viewpoints/observation points gratuits (sauf si observatoire payant avec "deck"/"tower")
  if (/\b(mirador|viewpoint|lookout|panoramic|observation point|vidikovac|belvedere|belvédère)\b/i.test(name)) {
    if (cost > 0 && !/\b(observatory|deck|tower|tour|ticket)\b/i.test(name)) {
      return { ...attraction, estimatedCost: 0 };
    }
  }

  // Street food / food markets / marchés → cap à 15€/pers max
  if (/\b(street food|food market|marché|mercado|market hall|food hall)\b/i.test(name)) {
    if (cost > 15) return { ...attraction, estimatedCost: 15 };
  }

  // Cap générique: si coût >= 30€/pers et pas bookable → probablement faux, cap à 15€
  if (cost >= 30 && !attraction.bookingUrl) {
    return { ...attraction, estimatedCost: 15 };
  }

  return attraction;
}

/**
 * Génère un voyage complet avec toute la logistique
 */
export async function generateTripWithAI(preferences: TripPreferences): Promise<Trip> {
  console.log('Generating trip with preferences:', preferences);

  // RESET: Nettoyer les trackers de la session précédente pour éviter les doublons inter-voyages
  usedRestaurantIds.clear();

  // 1. Trouver les coordonnées et aéroports (avec fallback Nominatim async)
  const [originCityCenter, destCityCenter, originAirports, destAirports] = await Promise.all([
    getCityCenterCoordsAsync(preferences.origin),
    getCityCenterCoordsAsync(preferences.destination),
    findNearbyAirportsAsync(preferences.origin),
    findNearbyAirportsAsync(preferences.destination),
  ]);

  const originCoords = preferences.originCoords || originCityCenter || (originAirports[0] ? {
    lat: originAirports[0].latitude,
    lng: originAirports[0].longitude,
  } : { lat: 48.8566, lng: 2.3522 }); // Paris par défaut

  const destCoords = preferences.destinationCoords || destCityCenter || (destAirports[0] ? {
    lat: destAirports[0].latitude,
    lng: destAirports[0].longitude,
  } : null);

  if (!destCoords) {
    console.error(`[AI] ❌ Impossible de géocoder "${preferences.destination}" — aucune coordonnée trouvée`);
    throw new Error(`Destination inconnue: "${preferences.destination}". Impossible de trouver les coordonnées.`);
  }

  console.log(`[AI] Centre-ville destination: ${preferences.destination} → ${destCoords.lat.toFixed(4)}, ${destCoords.lng.toFixed(4)}`);
  if (destCityCenter) {
    console.log(`[AI] ✓ Utilisation des coords centre-ville`);
  } else {
    console.warn(`[AI] ⚠ Coords via fallback aéroport pour "${preferences.destination}"`);
  }

  // 2. Comparer les options de transport (lancé en parallèle avec attractions + hôtels)
  console.time('[AI] Transport');
  const transportPromise = compareTransportOptions({
    origin: preferences.origin,
    originCoords,
    destination: preferences.destination,
    destCoords,
    date: new Date(preferences.startDate),
    passengers: preferences.groupSize,
    preferences: {
      prioritize: preferences.budgetLevel === 'economic' ? 'price' :
                  preferences.budgetLevel === 'luxury' ? 'time' : 'balanced',
      forceIncludeMode: preferences.transport === 'optimal' ? undefined : preferences.transport,
    },
  });

  // 3. Dates du voyage (calculées tôt pour paralléliser hôtels)
  const startDate = normalizeToLocalDate(preferences.startDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + preferences.durationDays - 1);
  console.log(`[AI] Date de départ normalisée: ${startDate.toDateString()} (input: ${preferences.startDate})`);

  // Résoudre le budget et générer la stratégie
  console.time('[AI] BudgetStrategy');
  const resolvedBudget = resolveBudget(preferences);
  console.log(`[AI] Budget résolu: ${resolvedBudget.totalBudget}€ total, ${resolvedBudget.perPersonPerDay.toFixed(0)}€/pers/jour, niveau=${resolvedBudget.budgetLevel}`);

  const budgetStrategyPromise = generateBudgetStrategy(
    resolvedBudget,
    preferences.destination,
    preferences.durationDays,
    preferences.groupSize,
    preferences.activities,
    preferences.mealPreference,
  );

  // Lancer attractions + hôtels en parallèle avec le transport
  console.time('[AI] Attractions pool');
  const attractionsPromise = searchAttractionsMultiQuery(
    preferences.destination,
    destCoords,
    { types: preferences.activities, limit: preferences.durationDays >= 5 ? 80 : 50 }
  );

  console.time('[AI] Hotels');
  // Estimer le plafond prix/nuit avant d'avoir la stratégie complète
  const estimatedMaxPricePerNight = resolvedBudget.budgetLevel === 'economic' ? 80 :
    resolvedBudget.budgetLevel === 'moderate' ? 120 : undefined;
  const hotelsPromise = searchHotels(preferences.destination, {
    budgetLevel: (resolvedBudget.budgetLevel || preferences.budgetLevel) as 'economic' | 'moderate' | 'luxury',
    cityCenter: destCoords,
    checkInDate: startDate,
    checkOutDate: endDate,
    guests: preferences.groupSize,
    maxPricePerNight: estimatedMaxPricePerNight,
  });

  // Lancer les travel tips en parallèle aussi
  console.time('[AI] TravelTips');
  const travelTipsPromise = generateTravelTips(
    preferences.origin,
    preferences.destination,
    startDate,
    preferences.durationDays,
  );

  // Attendre les 5 en parallèle (inclut stratégie budget)
  const [transportOptions, attractionPoolRaw, accommodationOptions, travelTipsData, budgetStrategy] = await Promise.all([
    transportPromise,
    attractionsPromise,
    hotelsPromise,
    travelTipsPromise,
    budgetStrategyPromise,
  ]);
  console.timeEnd('[AI] Transport');
  console.timeEnd('[AI] Attractions pool');
  console.timeEnd('[AI] Hotels');
  console.timeEnd('[AI] TravelTips');
  console.timeEnd('[AI] BudgetStrategy');
  console.log(`[AI] Stratégie budget: ${budgetStrategy.accommodationType}, courses=${budgetStrategy.groceryShoppingNeeded}, activités=${budgetStrategy.activitiesLevel}`);

  // Si la stratégie recommande Airbnb, lancer une recherche en parallèle
  let airbnbOptions: Accommodation[] = [];
  if (budgetStrategy.accommodationType.includes('airbnb') && isAirbnbApiConfigured()) {
    // API Airbnb disponible → recherche directe
    console.time('[AI] Airbnb');
    try {
      const checkInStr = startDate.toISOString().split('T')[0];
      const checkOutStr = endDate.toISOString().split('T')[0];
      airbnbOptions = await searchAirbnbListings(
        preferences.destination,
        checkInStr,
        checkOutStr,
        {
          maxPricePerNight: budgetStrategy.accommodationBudgetPerNight,
          guests: preferences.groupSize,
          requireKitchen: budgetStrategy.accommodationType === 'airbnb_with_kitchen',
          cityCenter: destCoords,
        },
      );
      console.log(`[AI] ✅ ${airbnbOptions.length} Airbnb trouvés`);
    } catch (error) {
      console.warn('[AI] Recherche Airbnb échouée, fallback hôtels:', error);
    }
    console.timeEnd('[AI] Airbnb');
  } else if (budgetStrategy.accommodationType.includes('airbnb') && !isAirbnbApiConfigured()) {
    // Pas d'API Airbnb → filtrer les appartements/flats dans les résultats hôtel existants
    console.log('[AI] Pas d\'API Airbnb configurée, recherche d\'apartments dans les résultats Booking...');
    const apartmentKeywords = /\b(apartment|flat|appart|résidence|studio|loft|suite.*kitchen|self.?catering)\b/i;
    const apartmentResults = accommodationOptions.filter(h =>
      apartmentKeywords.test(h.name) || apartmentKeywords.test(h.description || '') ||
      (h.amenities && h.amenities.some((a: string) => /kitchen|cuisine|kitchenette/i.test(a)))
    );
    if (apartmentResults.length > 0) {
      console.log(`[AI] ✅ ${apartmentResults.length} apartments trouvés dans les résultats hôtel`);
      // Prioriser les apartments en les mettant en premier
      airbnbOptions = apartmentResults;
    } else {
      console.log('[AI] Aucun apartment trouvé, génération lien de recherche Airbnb...');
      const checkInStr = startDate.toISOString().split('T')[0];
      const checkOutStr = endDate.toISOString().split('T')[0];
      airbnbOptions = await searchAirbnbListings(
        preferences.destination, checkInStr, checkOutStr,
        { maxPricePerNight: budgetStrategy.accommodationBudgetPerNight, guests: preferences.groupSize, cityCenter: destCoords },
      );
    }
  }

  // Combiner les options d'hébergement (hôtels + Airbnb)
  const allAccommodationOptions = [...accommodationOptions, ...airbnbOptions];

  // Convertir en format pour l'interface
  const transportOptionsSummary: TransportOptionSummary[] = transportOptions.map(opt => ({
    id: opt.id,
    mode: opt.mode,
    totalDuration: opt.totalDuration,
    totalPrice: opt.totalPrice,
    totalCO2: opt.totalCO2,
    score: opt.score,
    scoreDetails: opt.scoreDetails,
    segments: opt.segments.map(seg => ({
      mode: seg.mode,
      from: seg.from,
      to: seg.to,
      duration: seg.duration,
      price: seg.price,
      operator: seg.operator,
    })),
    bookingUrl: opt.bookingUrl,
    recommended: opt.recommended,
    recommendationReason: opt.recommendationReason,
    dataSource: opt.dataSource,
  }));

  // Sélectionner la meilleure option (ou celle choisie par l'utilisateur via preferences.transport)
  let selectedTransport = transportOptions.find(t => t.recommended) || transportOptions[0];

  // Si l'utilisateur a spécifié un mode de transport (pas 'optimal'), RESPECTER son choix
  if (preferences.transport && preferences.transport !== 'optimal') {
    const userPreferred = transportOptions.find(t => t.mode === preferences.transport);
    if (userPreferred) {
      selectedTransport = userPreferred;
      console.log(`Mode de transport choisi par l'utilisateur: ${preferences.transport}`);
    } else {
      console.warn(`Mode de transport "${preferences.transport}" demandé mais non disponible pour cette destination`);
      console.warn(`Options disponibles: ${transportOptions.map(t => t.mode).join(', ')}`);
    }
  } else {
    console.log(`Mode optimal: meilleure option sélectionnée automatiquement`);
  }

  console.log(`Transport sélectionné: ${selectedTransport?.mode} (score: ${selectedTransport?.score}/10)`);

  // 4. Si avion, rechercher les vols détaillés
  let outboundFlight: Flight | null = null;
  let outboundFlightAlternatives: Flight[] = [];
  let returnFlight: Flight | null = null;
  let returnFlightAlternatives: Flight[] = [];
  let originAirport = originAirports[0];
  let destAirport = destAirports[0];

  if (selectedTransport?.mode === 'plane' || selectedTransport?.mode === 'combined') {
    if (originAirports.length === 0 || destAirports.length === 0) {
      console.warn('Pas d\'aéroports trouvés, utilisation du transport alternatif');
      selectedTransport = transportOptions.find(t => t.mode !== 'plane') || selectedTransport;
    } else {
      console.log(`Aéroports origine: ${originAirports.map(a => a.code).join(', ')}`);
      console.log(`Aéroports destination: ${destAirports.map(a => a.code).join(', ')}`);

      const flightResult = await findBestFlights(
        originAirports,
        destAirports,
        startDate,
        endDate,
        preferences,
        originCoords,
        destCoords
      );

      outboundFlight = flightResult.outboundFlight;
      outboundFlightAlternatives = flightResult.outboundFlightAlternatives;
      returnFlight = flightResult.returnFlight;
      returnFlightAlternatives = flightResult.returnFlightAlternatives;
      originAirport = flightResult.originAirport;
      destAirport = flightResult.destAirport;

      console.log(`Sélection finale: ${originAirport.code} → ${destAirport.code}`);
    }
  }

  // 4b. Initialiser le tracker de localisation pour la cohérence géographique
  // CRITIQUE: Empêche les activités à Barcelona avant d'avoir atterri
  const locationTracker = createLocationTracker(preferences.origin, preferences.origin);
  console.log(`[LocationTracker] Initialisé à ${preferences.origin}`);

  // 5. Centre-ville de destination
  // IMPORTANT: Utiliser destCoords (le vrai centre-ville) et NON l'aéroport
  // L'aéroport peut être à 20-30km du centre (ex: Madrid Barajas est au NE de la ville)
  const cityCenter = destCoords;

  // 6. Parking si nécessaire (pour avion ou voiture)
  let parking: ParkingOption | null = null;
  if ((preferences.needsParking === true || preferences.transport === 'car') && selectedTransport?.mode === 'plane' && originAirport) {
    parking = selectBestParking(originAirport.code, preferences.durationDays, preferences.budgetLevel || 'moderate');
  }

  // 7. Pool d'attractions (déjà récupéré en parallèle ci-dessus)
  let attractionPool = attractionPoolRaw;

  // Recherche spécifique des mustSee
  if (preferences.mustSee?.trim()) {
    console.log('[AI] Recherche des mustSee spécifiques...');
    const mustSeeAttractions = await searchMustSeeAttractions(
      preferences.mustSee,
      preferences.destination,
      cityCenter
    );
    const poolNames = new Set(attractionPool.map(a => a.name.toLowerCase()));
    for (const msAttr of mustSeeAttractions) {
      if (!poolNames.has(msAttr.name.toLowerCase())) {
        attractionPool.unshift(msAttr);
        poolNames.add(msAttr.name.toLowerCase());
      }
    }
  }

  console.log(`[AI] Pool SerpAPI: ${attractionPool.length} attractions`);

  // Fallback: Si SerpAPI échoue, utiliser l'ancien système
  if (attractionPool.length < 5) {
    console.warn('[AI] Pool SerpAPI insuffisant, fallback sur selectAttractionsAsync...');
    const totalAvailableMinutes = estimateTotalAvailableTime(preferences.durationDays, outboundFlight, returnFlight);
    attractionPool = await selectAttractionsAsync(preferences.destination, totalAvailableMinutes, {
      types: preferences.activities,
      mustSeeQuery: preferences.mustSee,
      prioritizeMustSee: true,
      maxPerDay: Math.min(preferences.durationDays * 5, 35),
      cityCenter,
    });
  }

  let selectedAttractions = attractionPool;

  // Protection finale: s'assurer que groupSize est valide pour eviter NaN
  if (!preferences.groupSize || preferences.groupSize < 1) {
    console.warn('[AI] groupSize invalide, utilisation de 1 par defaut');
    preferences.groupSize = 1;
  }

  // Étape 2: Claude organise l'itinéraire intelligemment
  console.log('[AI] Étape 2: Curation Claude Sonnet...');
  let claudeItinerary: Awaited<ReturnType<typeof generateClaudeItinerary>> = null;
  let attractionsByDay: Attraction[][];
  let dayMetadata: { theme?: string; dayNarrative?: string; isDayTrip?: boolean; dayTripDestination?: string }[] = [];

  try {
    claudeItinerary = await generateClaudeItinerary({
      destination: preferences.destination,
      durationDays: preferences.durationDays,
      startDate: typeof preferences.startDate === 'string'
        ? (preferences.startDate as string).split('T')[0]
        : new Date(preferences.startDate).toISOString().split('T')[0],
      activities: preferences.activities,
      budgetLevel: resolvedBudget.budgetLevel,
      mustSee: preferences.mustSee,
      groupType: preferences.groupType,
      groupSize: preferences.groupSize || 2,
      attractionPool: summarizeAttractions(attractionPool),
      budgetStrategy,
    });
  } catch (error) {
    console.error('[AI] Claude curation error:', error);
  }

  if (claudeItinerary) {
    console.log('[AI] ✅ Itinéraire Claude reçu, mapping des attractions...');
    attractionsByDay = mapItineraryToAttractions(claudeItinerary, attractionPool, cityCenter);

    // Stocker les métadonnées par jour
    dayMetadata = claudeItinerary.days.map(d => ({
      theme: d.theme,
      dayNarrative: d.dayNarrative,
      isDayTrip: d.isDayTrip,
      dayTripDestination: d.dayTripDestination || undefined,
    }));

    // Resolve additional suggestions: use Travel Places API (free) first, SerpAPI fallback
    for (let i = 0; i < claudeItinerary.days.length; i++) {
      const day = claudeItinerary.days[i];
      // For day trips, use dayTripDestination as geocoding context
      const geoContext = day.isDayTrip && day.dayTripDestination ? day.dayTripDestination : preferences.destination;
      const geoCenter = day.isDayTrip && day.dayTripDestination ? undefined : cityCenter; // undefined = let API figure it out

      // For day trips, resolve destination center coords for better geocoding
      let dayTripCenter: { lat: number; lng: number } | undefined;
      if (day.isDayTrip && day.dayTripDestination) {
        const dtCoords = await getCityCenterCoordsAsync(day.dayTripDestination);
        if (dtCoords) {
          dayTripCenter = dtCoords;
          console.log(`[AI] Day trip center for "${day.dayTripDestination}": (${dtCoords.lat}, ${dtCoords.lng})`);
        }
      }

      for (const suggestion of day.additionalSuggestions) {
        const genIndex = attractionsByDay[i].findIndex(a => a.id.startsWith('claude-') && a.name === suggestion.name);
        if (genIndex < 0) continue;

        // For day trips, try Nominatim first (better for named places outside city center radius)
        if (day.isDayTrip && day.dayTripDestination) {
          try {
            const geo = await geocodeAddress(`${suggestion.name}, ${day.dayTripDestination}`);
            if (geo && geo.lat && geo.lng) {
              attractionsByDay[i][genIndex] = {
                ...attractionsByDay[i][genIndex],
                latitude: geo.lat,
                longitude: geo.lng,
                mustSee: true,
                dataReliability: 'verified',
                googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(suggestion.name + ', ' + day.dayTripDestination)}`,
              };
              console.log(`[AI]   Résolu day trip via Nominatim: "${suggestion.name}" → (${geo.lat}, ${geo.lng})`);
              continue;
            }
          } catch (e) {
            console.warn(`[AI]   Nominatim day trip error for "${suggestion.name}":`, e);
          }
        }

        // Try Travel Places API first (free, via RapidAPI)
        const resolved = await resolveAttractionByName(suggestion.name, dayTripCenter || geoCenter || cityCenter);
        if (resolved) {
          attractionsByDay[i][genIndex] = {
            ...attractionsByDay[i][genIndex],
            latitude: resolved.lat,
            longitude: resolved.lng,
            name: resolved.name || suggestion.name,
            mustSee: true,
            dataReliability: 'verified',
          };
          console.log(`[AI]   Résolu via Travel Places: "${suggestion.name}" → (${resolved.lat}, ${resolved.lng})`);
          continue;
        }

        // Fallback 2: SerpAPI
        const found = await searchMustSeeAttractions(
          suggestion.name,
          geoContext,
          geoCenter || cityCenter
        );
        if (found.length > 0) {
          attractionsByDay[i][genIndex] = { ...found[0], mustSee: true };
          console.log(`[AI]   Résolu via SerpAPI: "${suggestion.name}" → coordonnées vérifiées`);
          continue;
        }

        // Fallback 3: Nominatim geocoding (free, reliable for named places)
        try {
          const geo = await geocodeAddress(`${suggestion.name}, ${geoContext}`);
          if (geo && geo.lat && geo.lng) {
            attractionsByDay[i][genIndex] = {
              ...attractionsByDay[i][genIndex],
              latitude: geo.lat,
              longitude: geo.lng,
              mustSee: true,
              dataReliability: 'verified',
              googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(suggestion.name + ', ' + geoContext)}`,
            };
            console.log(`[AI]   Résolu via Nominatim: "${suggestion.name}" → (${geo.lat}, ${geo.lng})`);
            continue;
          }
        } catch (e) {
          console.warn(`[AI]   Nominatim error for "${suggestion.name}":`, e);
        }
      }
    }

    // Last resort: any attraction still at city center or (0,0) gets coords and Google Maps URL
    for (let i = 0; i < attractionsByDay.length; i++) {
      const day = claudeItinerary.days[i];
      const isDayTripDay = day?.isDayTrip && day?.dayTripDestination;
      const geoContextCity = isDayTripDay ? day.dayTripDestination! : preferences.destination;

      // For day trip days, get the day trip center for fallback coords
      let fallbackCenter = cityCenter;
      if (isDayTripDay) {
        const dtCoords = await getCityCenterCoordsAsync(day.dayTripDestination!);
        if (dtCoords) fallbackCenter = dtCoords;
      }

      const dayAttrs = attractionsByDay[i];
      for (let j = 0; j < dayAttrs.length; j++) {
        const a = dayAttrs[j];
        if (a.latitude === 0 && a.longitude === 0) {
          console.log(`[AI] Coords fallback pour "${a.name}" → ${geoContextCity} (${fallbackCenter.lat}, ${fallbackCenter.lng})`);
          dayAttrs[j] = { ...a, latitude: fallbackCenter.lat, longitude: fallbackCenter.lng };
        }
        // Ensure all attractions have a Google Maps URL for the user
        if (!a.googleMapsUrl && a.id.startsWith('claude-')) {
          dayAttrs[j] = {
            ...dayAttrs[j],
            googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.name + ', ' + geoContextCity)}`,
          };
        }
      }

      // Day trip validation: filter out attractions that are in the base city (not near day trip destination)
      if (isDayTripDay && fallbackCenter.lat !== cityCenter.lat) {
        const MAX_DIST_FROM_DAY_TRIP_KM = 30; // attractions must be within 30km of day trip destination
        const beforeCount = dayAttrs.length;
        attractionsByDay[i] = dayAttrs.filter(a => {
          const distFromDayTrip = calculateDistance(a.latitude, a.longitude, fallbackCenter.lat, fallbackCenter.lng);
          const distFromBase = calculateDistance(a.latitude, a.longitude, cityCenter.lat, cityCenter.lng);
          // Keep if closer to day trip destination than to base city, or within range of day trip
          if (distFromDayTrip <= MAX_DIST_FROM_DAY_TRIP_KM) return true;
          if (distFromDayTrip < distFromBase) return true;
          console.log(`[AI] Day trip filter: "${a.name}" removed (${Math.round(distFromDayTrip)}km from ${day.dayTripDestination}, ${Math.round(distFromBase)}km from ${preferences.destination})`);
          return false;
        });
        if (attractionsByDay[i].length < beforeCount) {
          console.log(`[AI] Day trip filter: ${beforeCount - attractionsByDay[i].length} attractions removed for day ${i + 1} (too far from ${day.dayTripDestination})`);
        }
      }
    }
  } else {
    // Fallback: pré-allocation simple par rating
    console.log('[AI] Fallback: pré-allocation par rating...');
    attractionsByDay = preAllocateAttractions(
      selectedAttractions,
      preferences.durationDays,
      cityCenter
    );
  }

  // Post-traitement: corriger durées et coûts irréalistes, filtrer attractions non pertinentes
  const irrelevantPatterns = /\b(temple ganesh|temple hindou|hindu temple|salle de sport|gym|fitness|cinéma|cinema|arcade|bowling|landmark architecture|local architecture|architecture locale|city sightseeing|sightseeing tour|photo spot|photo opportunity|scenic view point|generic|unnamed)\b/i;
  // Restaurants/bars/cafes should not be in the attraction pool - they belong in the meal system
  const restaurantPatterns = /\b(restaurant|ristorante|restaurante|bistrot|bistro|brasserie|trattoria|osteria|taverna|pizzeria|crêperie|creperie|bar à|wine bar|pub |café restaurant|grill|steakhouse)\b/i;
  for (let i = 0; i < attractionsByDay.length; i++) {
    const before = attractionsByDay[i].length;
    attractionsByDay[i] = attractionsByDay[i]
      .filter(a => {
        if (a.mustSee) return true;
        if (irrelevantPatterns.test(a.name)) {
          console.log(`[AI] Filtré attraction non pertinente: "${a.name}"`);
          return false;
        }
        if (restaurantPatterns.test(a.name)) {
          console.log(`[AI] Filtré restaurant dans le pool d'attractions: "${a.name}"`);
          return false;
        }
        // Filtrer les noms trop génériques (pas un vrai lieu)
        const nameLower = a.name.toLowerCase().trim();
        if (nameLower.split(/\s+/).length <= 2 && /^(landmark|architecture|culture|history|nature|scenic|local|traditional|ancient|modern|famous|popular|beautiful)\s/i.test(nameLower)) {
          console.log(`[AI] Filtré attraction générique: "${a.name}"`);
          return false;
        }
        return true;
      })
      .map(a => fixAttractionCost(fixAttractionDuration(a)));
    if (attractionsByDay[i].length < before) {
      console.log(`[AI] Jour ${i + 1}: ${before - attractionsByDay[i].length} attraction(s) filtrée(s)`);
    }
  }
  console.log('[AI] ✅ Post-traitement durées/coûts/filtrage appliqué');

  // 7.5 Sélectionner le meilleur hébergement (hôtels + Airbnb si disponible)
  const accommodation = selectBestHotel(allAccommodationOptions, {
    budgetLevel: resolvedBudget.budgetLevel as 'economic' | 'moderate' | 'luxury',
    attractions: selectedAttractions,
    preferApartment: budgetStrategy.accommodationType.includes('airbnb'),
  });
  console.log(`Hébergement sélectionné: ${accommodation?.name || 'Aucun'} (type: ${accommodation?.type || 'N/A'})`);

  // 7.6 Initialiser le BudgetTracker et rebalancer le budget
  const budgetTracker = new BudgetTracker(resolvedBudget.totalBudget, preferences.groupSize, preferences.durationDays);

  // Pré-remplir les coûts fixes connus
  const flightsCost = ((outboundFlight?.price || 0) + (returnFlight?.price || 0));
  const accommodationCost = (accommodation?.pricePerNight || 0) * (preferences.durationDays - 1);
  const parkingCost = parking?.totalPrice || 0;
  budgetTracker.setFixedCosts(flightsCost, accommodationCost);
  if (parkingCost > 0) budgetTracker.spend('transport', parkingCost);

  // Rebalancer : redistribuer les économies ou réduire si dépassement
  const actualFixedCosts = flightsCost + accommodationCost + parkingCost;
  const estimatedFixedCosts = (budgetStrategy.accommodationBudgetPerNight * (preferences.durationDays - 1))
    + (resolvedBudget.perPersonPerDay * preferences.durationDays * 0.3 * preferences.groupSize); // ~30% transport estimé
  const savings = estimatedFixedCosts - actualFixedCosts;

  if (savings > 0) {
    // Économies : redistribuer vers food et activités
    const perDay = savings / preferences.durationDays;
    budgetStrategy.dailyActivityBudget += Math.round(perDay * 0.4);
    console.log(`[Budget] ✅ Économies de ${Math.round(savings)}€ → activités +${Math.round(perDay * 0.4)}€/jour`);
  } else if (savings < -50) {
    // Dépassement : réduire food et activités
    const cutPerDay = Math.abs(savings) / preferences.durationDays;
    budgetStrategy.dailyActivityBudget = Math.max(0, budgetStrategy.dailyActivityBudget - Math.round(cutPerDay * 0.4));
    console.log(`[Budget] ⚠️ Dépassement de ${Math.round(Math.abs(savings))}€ → activités -${Math.round(cutPerDay * 0.4)}€/jour`);
  }

  console.log(`[Budget] ${budgetTracker.getSummary()}`);

  // 8. Recherche supermarché si nécessaire (courses pour self-catering)
  let groceryStore: GroceryStore | null = null;
  const groceryDays = new Set<number>(); // numéros de jours où ajouter les courses
  if (budgetStrategy?.groceryShoppingNeeded) {
    const accommodationCoords = accommodation
      ? { lat: accommodation.latitude, lng: accommodation.longitude }
      : cityCenter;
    try {
      const stores = await searchGroceryStores(accommodationCoords, preferences.destination);
      if (stores.length > 0) {
        groceryStore = stores[0];
        console.log(`[AI] Supermarché trouvé: ${groceryStore.name} (${groceryStore.walkingTime}min à pied)`);
      }
    } catch (error) {
      console.warn('[AI] Erreur recherche supermarché:', error);
    }

    // Déterminer les jours de courses:
    // - Jour 1 ou 2 (selon heure d'arrivée)
    // - Si séjour > 4 jours, ajouter un 2e créneau au milieu
    const firstGroceryDay = preferences.durationDays > 2 ? 2 : 1; // Jour 2 si possible (Jour 1 = arrivée)
    groceryDays.add(firstGroceryDay);
    if (preferences.durationDays > 4) {
      const midDay = Math.ceil(preferences.durationDays / 2) + 1;
      groceryDays.add(midDay);
    }
    console.log(`[AI] Courses prévues aux jours: ${[...groceryDays].join(', ')}`);
  }

  // 9. Générer les jours avec le SCHEDULER (évite les chevauchements)
  const days: TripDay[] = [];

  // ANTI-DOUBLON: Set partagé entre tous les jours pour éviter de répéter une attraction
  const tripUsedAttractionIds = new Set<string>();

  // Variable pour propager les vols tardifs au jour suivant
  let pendingLateFlightData: LateFlightArrivalData | undefined;

  // Tracker: on ne peut pas cuisiner tant qu'on n'a pas fait les courses
  // Si groceryShoppingNeeded=false, on considère que les courses ne sont pas nécessaires (pas de self-catering)
  let groceriesDoneByDay = !budgetStrategy?.groceryShoppingNeeded; // true si pas besoin de courses

  for (let i = 0; i < preferences.durationDays; i++) {
    // Créer la date du jour (startDate est déjà normalisé à midi local)
    const dayDate = new Date(startDate);
    dayDate.setDate(startDate.getDate() + i);
    // Remettre à midi pour cohérence
    dayDate.setHours(12, 0, 0, 0);

    const isFirstDay = i === 0;
    const isLastDay = i === preferences.durationDays - 1;
    const dayNumber = i + 1;

    console.log(`[AI] Jour ${dayNumber}: ${dayDate.toDateString()}`);

    // Récupérer les attractions pré-allouées pour ce jour
    const dayAttractions = attractionsByDay[i] || [];

    console.log(`\n=== Génération Jour ${dayNumber} ===`);

    // Générer le jour complet avec le scheduler
    const dayResult = await generateDayWithScheduler({
      dayNumber,
      date: dayDate,
      isFirstDay,
      isLastDay,
      attractions: dayAttractions,
      allAttractions: selectedAttractions, // TOUTES les attractions pour remplissage des trous
      preferences,
      cityCenter,
      outboundFlight: isFirstDay ? outboundFlight : null,
      returnFlight: isLastDay ? returnFlight : null,
      groundTransport: selectedTransport,
      originAirport,
      destAirport,
      parking,
      accommodation,
      tripUsedAttractionIds, // ANTI-DOUBLON: Set partagé
      locationTracker, // LOCATION TRACKING: Validation géographique
      budgetStrategy, // Stratégie budget pour repas self_catered vs restaurant
      budgetTracker, // Suivi budget en temps réel
      lateFlightArrivalData: pendingLateFlightData, // Données du vol tardif du jour précédent
      isDayTrip: (dayMetadata[i] || {} as any).isDayTrip,
      dayTripDestination: (dayMetadata[i] || {} as any).dayTripDestination,
      groceriesDone: groceriesDoneByDay || groceryDays.has(dayNumber), // If groceries planned today, dinner can be self-catered
    });

    // Injecter les courses si ce jour est un jour de courses
    const dayItems = [...dayResult.items];
    if (groceryDays.has(dayNumber) && groceryStore) {
      // Trouver un bon créneau: après le check-in (jour 1) ou en fin d'après-midi
      // On cherche le dernier item avant 18h pour insérer les courses juste après
      const groceryDuration = 40; // minutes
      let insertTime = '17:30'; // défaut: fin d'après-midi

      if (isFirstDay) {
        // Jour d'arrivée: courses après le check-in hôtel
        const checkinItem = dayItems.find(item => item.type === 'checkin' || (item.type === 'hotel' && item.title.includes('Check-in')));
        if (checkinItem && checkinItem.endTime) {
          const checkinEnd = new Date(checkinItem.endTime);
          insertTime = `${checkinEnd.getHours().toString().padStart(2, '0')}:${checkinEnd.getMinutes().toString().padStart(2, '0')}`;
        }
      } else {
        // Jour intermédiaire: après la dernière activité de l'après-midi ou avant le dîner
        const dinnerItem = dayItems.find(item => item.type === 'restaurant' && (item.title.includes('Dîner') || item.title.includes('dîner')));
        if (dinnerItem && dinnerItem.startTime) {
          // 50 min avant le dîner (40min courses + 10min trajet)
          const dinnerStart = parseTime(dayDate, dinnerItem.startTime);
          const groceryStart = new Date(dinnerStart.getTime() - 50 * 60 * 1000);
          insertTime = `${groceryStart.getHours().toString().padStart(2, '0')}:${groceryStart.getMinutes().toString().padStart(2, '0')}`;
        }
      }

      const groceryEnd = parseTime(dayDate, insertTime);
      const groceryEndTime = new Date(groceryEnd.getTime() + groceryDuration * 60 * 1000);

      const groceryItem: TripItem = {
        id: Math.random().toString(36).substring(2, 15),
        dayNumber,
        startTime: insertTime,
        endTime: `${groceryEndTime.getHours().toString().padStart(2, '0')}:${groceryEndTime.getMinutes().toString().padStart(2, '0')}`,
        type: 'activity',
        title: `Courses au ${groceryStore.name}`,
        description: `Supermarché à ${groceryStore.walkingTime || 5}min à pied du logement | Provisions pour les repas self-catering`,
        locationName: `${groceryStore.name}, ${groceryStore.address}`,
        latitude: groceryStore.latitude,
        longitude: groceryStore.longitude,
        estimatedCost: 25 * (preferences.groupSize || 1), // ~25€/pers pour quelques jours
        duration: groceryDuration,
        orderIndex: 0,
        googleMapsPlaceUrl: groceryStore.googleMapsUrl,
      };

      dayItems.push(groceryItem);
      // Re-trier par heure
      dayItems.sort((a, b) => {
        const aTime = a.startTime ? parseTime(dayDate, a.startTime).getTime() : 0;
        const bTime = b.startTime ? parseTime(dayDate, b.startTime).getTime() : 0;
        return aTime - bTime;
      });
      // Re-indexer
      dayItems.forEach((item, idx) => { item.orderIndex = idx; });

      if (budgetTracker) budgetTracker.spend('food', 25 * (preferences.groupSize || 1));
      console.log(`[Jour ${dayNumber}] 🛒 Courses ajoutées: ${groceryStore.name} à ${insertTime}`);
      // Les courses sont faites → on peut cuisiner à partir de maintenant
      groceriesDoneByDay = true;
    }

    const meta = dayMetadata[i] || {};
    days.push({
      dayNumber,
      date: dayDate,
      items: dayItems,
      theme: meta.theme,
      dayNarrative: meta.dayNarrative,
      isDayTrip: meta.isDayTrip,
      dayTripDestination: meta.dayTripDestination,
    });

    // Si ce jour a un vol tardif, le stocker pour le jour suivant
    // ET redistribuer les attractions non utilisées aux jours suivants
    pendingLateFlightData = dayResult.lateFlightForNextDay;
    if (pendingLateFlightData && i < preferences.durationDays - 1) {
      console.log(`[AI] Vol tardif détecté au Jour ${dayNumber}, les activités d'arrivée seront au Jour ${dayNumber + 1}`);

      // Redistribuer les attractions du Jour 1 aux jours suivants
      // Car le Jour 1 est un jour de voyage et ne peut pas faire d'activités à destination
      const unusedAttractions = dayAttractions.filter(a => !tripUsedAttractionIds.has(a.id));
      if (unusedAttractions.length > 0) {
        console.log(`[AI] ${unusedAttractions.length} attraction(s) non utilisée(s) au Jour ${dayNumber}, redistribution aux jours suivants`);

        // Répartir équitablement sur les jours restants
        const remainingDays = preferences.durationDays - 1 - i;
        for (let j = 0; j < unusedAttractions.length; j++) {
          const targetDayIndex = i + 1 + (j % remainingDays);
          if (targetDayIndex < preferences.durationDays) {
            attractionsByDay[targetDayIndex].push(unusedAttractions[j]);
            console.log(`[AI]   "${unusedAttractions[j].name}" → Jour ${targetDayIndex + 1}`);
          }
        }
      }
    }
  }

  // Enrichir les restaurants avec descriptions et spécialités (batch par voyage)
  try {
    const allRestaurantItems = days.flatMap(day =>
      day.items.filter(item => item.type === 'restaurant' && item.title && !item.title.includes('Petit-déjeuner à l') && !item.title.includes('Pique-nique') && !item.title.includes('Dîner à l\'appartement'))
    );
    if (allRestaurantItems.length > 0) {
      const toEnrich = allRestaurantItems.map(item => ({
        name: item.title,
        address: item.locationName || '',
        cuisineTypes: item.description?.split(' | ')[0]?.split(', ') || ['local'],
        mealType: item.title.includes('Déjeuner') ? 'lunch' : item.title.includes('Dîner') ? 'dinner' : 'breakfast',
      }));

      const enriched = await enrichRestaurantsWithGemini(toEnrich, preferences.destination);

      for (const item of allRestaurantItems) {
        const data = enriched.get(item.title);
        if (data) {
          // Build rich description
          const parts: string[] = [];
          if (data.description) parts.push(data.description);
          if (data.specialties?.length) parts.push(`🍽️ ${data.specialties.join(', ')}`);
          if (data.tips) parts.push(`💡 ${data.tips}`);
          // Keep existing rating info
          const ratingPart = item.description?.match(/⭐.*$/)?.[0];
          if (ratingPart) parts.push(ratingPart);
          item.description = parts.join(' | ');
        }
      }
      console.log(`[AI] ✅ ${enriched.size} restaurants enrichis avec descriptions et spécialités`);
    }
  } catch (error) {
    console.warn('[AI] Enrichissement restaurants échoué (non bloquant):', error);
  }

  // Attacher les vols alternatifs et liens Aviasales aux TripItems de vol
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'flight' && item.flight) {
        // Générer le lien Aviasales affilié
        const isOutbound = item.flight.id === outboundFlight?.id;
        const isReturn = item.flight.id === returnFlight?.id;
        const aviasalesUrl = generateFlightLink(
          { origin: item.flight.departureAirportCode, destination: item.flight.arrivalAirportCode },
          { date: item.flight.departureTime.split('T')[0], passengers: preferences.groupSize }
        );
        item.aviasalesUrl = aviasalesUrl;

        // Attacher les alternatives
        if (isOutbound && outboundFlightAlternatives.length > 0) {
          item.flightAlternatives = outboundFlightAlternatives;
        } else if (isReturn && returnFlightAlternatives.length > 0) {
          item.flightAlternatives = returnFlightAlternatives;
        }
      }
    }
  }

  // Calculer le coût total
  const costBreakdown = calculateCostBreakdown(days, outboundFlight, returnFlight, parking, preferences, accommodation);

  // Calculer l'empreinte carbone basée sur le transport sélectionné
  const travelDistance = originAirport && destAirport
    ? calculateDistance(originAirport.latitude, originAirport.longitude, destAirport.latitude, destAirport.longitude)
    : calculateDistance(originCoords.lat, originCoords.lng, destCoords.lat, destCoords.lng);

  // Utiliser les données CO2 du transport sélectionné si disponible
  const transportCO2 = selectedTransport
    ? selectedTransport.totalCO2 * (returnFlight || selectedTransport.mode !== 'plane' ? 2 : 1)
    : 0;

  const carbonData = calculateTripCarbon({
    flightDistanceKm: selectedTransport?.mode === 'plane' ? travelDistance : 0,
    returnFlight: true,
    passengers: preferences.groupSize,
    cabinClass: outboundFlight?.cabinClass || 'economy',
    nights: preferences.durationDays - 1,
    accommodationType: 'hotel',
    accommodationStars: preferences.budgetLevel === 'luxury' ? 5 : preferences.budgetLevel === 'comfort' ? 4 : 3,
    localTransportKm: preferences.durationDays * 15, // ~15km/jour
  });

  // Ajuster le CO2 si transport non-avion
  if (selectedTransport && selectedTransport.mode !== 'plane') {
    // Remplacer le CO2 des vols par celui du transport sélectionné
    carbonData.flights = transportCO2;
    carbonData.total = carbonData.flights + carbonData.accommodation + carbonData.localTransport;
    // Recalculer la note
    if (carbonData.total < 100) carbonData.rating = 'A';
    else if (carbonData.total < 250) carbonData.rating = 'B';
    else if (carbonData.total < 500) carbonData.rating = 'C';
    else if (carbonData.total < 1000) carbonData.rating = 'D';
    else carbonData.rating = 'E';
    // Recalculer les équivalents
    carbonData.equivalents.treesNeeded = Math.ceil(carbonData.total / 25);
    carbonData.equivalents.carKmEquivalent = Math.round(carbonData.total / 0.21);
  }

  // Sélectionner le transport summary correspondant
  const selectedTransportSummary = transportOptionsSummary.find(t => t.id === selectedTransport?.id);

  // Construire le voyage initial
  const initialTrip: Trip = {
    id: generateId(),
    createdAt: new Date(),
    updatedAt: new Date(),
    preferences,
    days,
    // Options de transport comparées
    transportOptions: transportOptionsSummary,
    selectedTransport: selectedTransportSummary,
    // Vols (si avion sélectionné)
    outboundFlight: outboundFlight || undefined,
    returnFlight: returnFlight || undefined,
    parking: parking || undefined,
    // Hébergement
    accommodation: accommodation || undefined,
    accommodationOptions: allAccommodationOptions.length > 0 ? allAccommodationOptions : undefined,
    totalEstimatedCost: Object.values(costBreakdown).reduce((a, b) => a + b, 0),
    costBreakdown,
    budgetStrategy,
    budgetStatus: resolvedBudget.totalBudget > 0 ? (() => {
      const estimated = Object.values(costBreakdown).reduce((a, b) => a + b, 0);
      return {
        target: resolvedBudget.totalBudget,
        estimated,
        difference: resolvedBudget.totalBudget - estimated,
        isOverBudget: estimated > resolvedBudget.totalBudget,
      };
    })() : undefined,
    carbonFootprint: {
      total: carbonData.total,
      flights: carbonData.flights,
      accommodation: carbonData.accommodation,
      localTransport: carbonData.localTransport,
      rating: carbonData.rating,
      equivalents: {
        treesNeeded: carbonData.equivalents.treesNeeded,
        carKmEquivalent: carbonData.equivalents.carKmEquivalent,
      },
      tips: carbonData.tips,
    },
    travelTips: travelTipsData || undefined,
  };

  // VALIDATION ET CORRECTION AUTOMATIQUE
  // 1. Vérifie la cohérence logique (vol -> transfert -> hotel -> activités)
  const coherenceValidatedTrip = validateAndFixTrip(initialTrip);

  // 2. Vérifie la cohérence géographique (toutes les activités dans la destination)
  // Supprime automatiquement les lieux trop loin de la destination
  validateTripGeography(coherenceValidatedTrip, cityCenter, true);

  return coherenceValidatedTrip;
}

/**
 * Recherche les meilleurs vols parmi tous les aéroports
 */
async function findBestFlights(
  originAirports: AirportInfo[],
  destAirports: AirportInfo[],
  startDate: Date,
  endDate: Date,
  preferences: TripPreferences,
  originCityCoords?: { lat: number; lng: number },
  destCityCoords?: { lat: number; lng: number }
): Promise<{
  outboundFlight: Flight | null;
  outboundFlightAlternatives: Flight[];
  returnFlight: Flight | null;
  returnFlightAlternatives: Flight[];
  originAirport: AirportInfo;
  destAirport: AirportInfo;
}> {
  let bestOutboundFlight: Flight | null = null;
  let bestOutboundAlternatives: Flight[] = [];
  let bestReturnFlight: Flight | null = null;
  let bestReturnAlternatives: Flight[] = [];
  let bestOriginAirport: AirportInfo = originAirports[0];
  let bestDestAirport: AirportInfo = destAirports[0];
  let bestScore = Infinity; // Lower is better (price + distance penalty)

  // Distance penalty: 0.30€/km for distance from city to airport
  // This prevents selecting a cheap flight from an airport 450km away
  const DISTANCE_PENALTY_PER_KM = 0.30;

  for (const originAirport of originAirports) {
    for (const destAirport of destAirports) {
      try {
        console.log(`Recherche vols ${originAirport.code} → ${destAirport.code}...`);

        const flightResults = await searchFlights({
          originCode: originAirport.code,
          destinationCode: destAirport.code,
          departureDate: formatDate(startDate),
          returnDate: formatDate(endDate),
          adults: preferences.groupSize,
          cabinClass: getBudgetCabinClass(preferences.budgetLevel),
        });

        if (flightResults.outboundFlights.length > 0) {
          const outbound = selectFlightByBudget(flightResults.outboundFlights, preferences.budgetLevel, 'outbound');
          const returnFlight = selectFlightByBudget(flightResults.returnFlights, preferences.budgetLevel, 'return');

          if (outbound) {
            const totalPrice = (outbound?.price || 0) + (returnFlight?.price || 0);

            // Calculate distance penalty for origin airport
            let originDistancePenalty = 0;
            if (originCityCoords) {
              const distKm = calculateDistance(
                originCityCoords.lat, originCityCoords.lng,
                originAirport.latitude, originAirport.longitude
              );
              originDistancePenalty = distKm * DISTANCE_PENALTY_PER_KM;
            }

            // Calculate distance penalty for destination airport
            let destDistancePenalty = 0;
            if (destCityCoords) {
              const distKm = calculateDistance(
                destCityCoords.lat, destCityCoords.lng,
                destAirport.latitude, destAirport.longitude
              );
              destDistancePenalty = distKm * DISTANCE_PENALTY_PER_KM;
            }

            const score = totalPrice + originDistancePenalty + destDistancePenalty;

            if (score < bestScore || bestOutboundFlight === null) {
              bestScore = score;
              bestOutboundFlight = outbound;
              bestOutboundAlternatives = flightResults.outboundFlights.filter(f => f.id !== outbound.id);
              bestReturnFlight = returnFlight;
              bestReturnAlternatives = returnFlight ? flightResults.returnFlights.filter(f => f.id !== returnFlight.id) : [];
              bestOriginAirport = originAirport;
              bestDestAirport = destAirport;
              const penaltyInfo = (originDistancePenalty + destDistancePenalty) > 10
                ? ` (prix: ${totalPrice}€, pénalité distance: +${Math.round(originDistancePenalty + destDistancePenalty)}€)`
                : '';
              console.log(`→ Meilleure option: ${originAirport.code}→${destAirport.code} score=${Math.round(score)}€${penaltyInfo}`);
            }
          }
        }
      } catch (error) {
        console.warn(`Pas de vols ${originAirport.code} → ${destAirport.code}`);
      }
    }
  }

  return {
    outboundFlight: bestOutboundFlight,
    outboundFlightAlternatives: bestOutboundAlternatives,
    returnFlight: bestReturnFlight,
    returnFlightAlternatives: bestReturnAlternatives,
    originAirport: bestOriginAirport,
    destAirport: bestDestAirport,
  };
}

/**
 * Estime le temps total disponible pour les activités
 */
function estimateTotalAvailableTime(
  durationDays: number,
  outboundFlight: Flight | null,
  returnFlight: Flight | null
): number {
  // Base: 10h par jour complet
  let totalMinutes = durationDays * 10 * 60;

  // Soustraire temps perdu le premier jour (arrivée + transfert)
  if (outboundFlight) {
    const arrivalHour = new Date(outboundFlight.arrivalTime).getHours();
    // Si on arrive après 14h, on perd la matinée
    if (arrivalHour >= 14) {
      totalMinutes -= 4 * 60;
    } else if (arrivalHour >= 12) {
      totalMinutes -= 2 * 60;
    }
  }

  // Soustraire temps perdu le dernier jour (départ)
  if (returnFlight) {
    const departureHour = new Date(returnFlight.departureTime).getHours();
    // Si on part avant 14h, on perd l'après-midi
    if (departureHour <= 12) {
      totalMinutes -= 6 * 60;
    } else if (departureHour <= 16) {
      totalMinutes -= 3 * 60;
    }
  }

  return Math.max(totalMinutes, 120); // Minimum 2h
}

/**
 * Calcule le contexte d'une journée (heures disponibles)
 */
function getDayContext(
  dayNumber: number,
  date: Date,
  isFirstDay: boolean,
  isLastDay: boolean,
  outboundFlight: Flight | null,
  returnFlight: Flight | null,
  cityCenter: { lat: number; lng: number },
  groundTransport?: TransportOption | null
): DayContext {
  // Par défaut: 9h - 22h
  let availableFrom = new Date(date);
  availableFrom.setHours(9, 0, 0, 0);

  let availableUntil = new Date(date);
  availableUntil.setHours(22, 0, 0, 0);

  // Premier jour: disponible après arrivée + transfert
  if (isFirstDay) {
    if (outboundFlight) {
      const arrivalTime = new Date(outboundFlight.arrivalTime);
      // +1h30 pour bagages + transfert + check-in hôtel
      availableFrom = new Date(arrivalTime.getTime() + 90 * 60 * 1000);
    } else if (groundTransport) {
      // Transport terrestre: départ à 8h + durée du trajet + 30min check-in
      const departureTime = new Date(date);
      departureTime.setHours(8, 0, 0, 0);
      const arrivalTime = new Date(departureTime.getTime() + groundTransport.totalDuration * 60 * 1000);
      availableFrom = new Date(arrivalTime.getTime() + 50 * 60 * 1000); // +50min pour arriver à l'hôtel et s'installer
    }
  }

  // Dernier jour: disponible jusqu'au check-out / départ
  if (isLastDay) {
    if (returnFlight) {
      const departureTime = new Date(returnFlight.departureTime);
      // -3h30 pour check-out + transfert + enregistrement
      availableUntil = new Date(departureTime.getTime() - 210 * 60 * 1000);
    } else if (groundTransport) {
      // Transport terrestre: départ à 14h, donc disponible jusqu'à 10h (check-out + dernières activités)
      availableUntil = new Date(date);
      availableUntil.setHours(12, 0, 0, 0); // Disponible jusqu'à midi avant check-out
    }
  }

  return {
    dayNumber,
    date,
    availableFrom,
    availableUntil,
    cityCenter,
  };
}

/**
 * Pré-alloue les attractions à tous les jours du voyage
 * GARANTIT qu'aucune attraction ne sera répétée
 * Retourne un tableau indexé par jour (0-indexed)
 */
function preAllocateAttractions(
  allAttractions: Attraction[],
  totalDays: number,
  cityCenter: { lat: number; lng: number }
): Attraction[][] {
  const minPerDay = 4; // Minimum 4 attractions par jour (2 matin + 2 après-midi) pour éviter les trous
  const maxPerDay = 5; // Maximum 5 attractions par jour
  const result: Attraction[][] = [];

  // Initialiser le tableau pour chaque jour
  for (let d = 0; d < totalDays; d++) {
    result.push([]);
  }

  if (allAttractions.length === 0) {
    return result;
  }

  // Créer une copie pour ne pas modifier l'original
  const availableAttractions = [...allAttractions];
  const usedIds = new Set<string>();

  // PHASE 1: Assurer le minimum (2 attractions par jour)
  // Distribution en round-robin pour équilibrer
  let currentDayIndex = 0;

  // Premier passage: 1 attraction par jour
  for (const attraction of availableAttractions) {
    if (usedIds.has(attraction.id)) continue;
    if (result[currentDayIndex].length >= 1) {
      // Passer au jour suivant qui n'a pas encore 1 attraction
      let found = false;
      for (let i = 0; i < totalDays; i++) {
        const idx = (currentDayIndex + i) % totalDays;
        if (result[idx].length < 1) {
          currentDayIndex = idx;
          found = true;
          break;
        }
      }
      if (!found) break; // Tous les jours ont au moins 1
    }

    result[currentDayIndex].push(attraction);
    usedIds.add(attraction.id);
    currentDayIndex = (currentDayIndex + 1) % totalDays;
  }

  // Deuxième passage: 2ème attraction par jour (si disponible)
  currentDayIndex = 0;
  for (const attraction of availableAttractions) {
    if (usedIds.has(attraction.id)) continue;
    if (result[currentDayIndex].length >= 2) {
      // Trouver un jour avec moins de 2 attractions
      let found = false;
      for (let i = 0; i < totalDays; i++) {
        const idx = (currentDayIndex + i) % totalDays;
        if (result[idx].length < 2) {
          currentDayIndex = idx;
          found = true;
          break;
        }
      }
      if (!found) break; // Tous les jours ont au moins 2
    }

    result[currentDayIndex].push(attraction);
    usedIds.add(attraction.id);
    currentDayIndex = (currentDayIndex + 1) % totalDays;
  }

  // Troisième passage: 3ème attraction par jour (pour éviter les trous)
  currentDayIndex = 0;
  for (const attraction of availableAttractions) {
    if (usedIds.has(attraction.id)) continue;
    if (result[currentDayIndex].length >= 3) {
      let found = false;
      for (let i = 0; i < totalDays; i++) {
        const idx = (currentDayIndex + i) % totalDays;
        if (result[idx].length < 3) {
          currentDayIndex = idx;
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    result[currentDayIndex].push(attraction);
    usedIds.add(attraction.id);
    currentDayIndex = (currentDayIndex + 1) % totalDays;
  }

  // Quatrième passage: 4ème attraction par jour (minimum souhaité)
  currentDayIndex = 0;
  for (const attraction of availableAttractions) {
    if (usedIds.has(attraction.id)) continue;
    if (result[currentDayIndex].length >= 4) {
      let found = false;
      for (let i = 0; i < totalDays; i++) {
        const idx = (currentDayIndex + i) % totalDays;
        if (result[idx].length < 4) {
          currentDayIndex = idx;
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    result[currentDayIndex].push(attraction);
    usedIds.add(attraction.id);
    currentDayIndex = (currentDayIndex + 1) % totalDays;
  }

  // PHASE 2: Distribuer le reste (jusqu'à maxPerDay)
  for (const attraction of availableAttractions) {
    if (usedIds.has(attraction.id)) continue;

    // Trouver le jour avec le moins d'attractions (qui n'a pas atteint le max)
    let minCount = maxPerDay + 1;
    let bestDay = -1;
    for (let d = 0; d < totalDays; d++) {
      if (result[d].length < maxPerDay && result[d].length < minCount) {
        minCount = result[d].length;
        bestDay = d;
      }
    }

    if (bestDay === -1) break; // Tous les jours sont pleins

    result[bestDay].push(attraction);
    usedIds.add(attraction.id);
  }

  console.log(`[Pre-allocation] ${usedIds.size} attractions uniques réparties sur ${totalDays} jours`);
  for (let d = 0; d < totalDays; d++) {
    const count = result[d].length;
    const status = count < minPerDay ? '⚠️ SOUS-MINIMUM' : count >= minPerDay ? '✓' : '';
    console.log(`  Jour ${d + 1}: ${result[d].map(a => a.name).join(', ') || 'aucune'} ${status}`);
  }

  return result;
}

/**
 * NOUVELLE ARCHITECTURE: Génère un jour complet avec le scheduler
 * Garantit qu'il n'y a AUCUN chevauchement d'horaires
 */
// Type pour les données de vol tardif à reporter au jour suivant
interface LateFlightArrivalData {
  flight: Flight;
  destAirport: AirportInfo;
  accommodation: import('./types').Accommodation | null;
}

/**
 * Détermine si un repas doit être self_catered (courses/cuisine) ou restaurant
 *
 * Logique "mixed" intelligente:
 * - Jour 1 (arrivée): toujours restaurant (on découvre la destination)
 * - Dernier soir complet: toujours restaurant (soirée spéciale)
 * - Jours intermédiaires: alterner restaurant/cuisine
 * - Day trips: toujours restaurant (pas d'accès à la cuisine)
 */
function shouldSelfCater(
  mealType: 'breakfast' | 'lunch' | 'dinner',
  dayNumber: number,
  budgetStrategy?: BudgetStrategy,
  hotelHasBreakfast?: boolean,
  totalDays?: number,
  isDayTrip?: boolean,
  groceriesDone?: boolean,
): boolean {
  if (!budgetStrategy) return false;
  if (mealType === 'breakfast' && hotelHasBreakfast) return false;
  // On ne peut pas cuisiner pendant un day trip
  if (isDayTrip) return false;
  // On ne peut pas cuisiner si les courses n'ont pas encore été faites
  if (groceriesDone === false) return false;

  const strategy = budgetStrategy.mealsStrategy[mealType];
  if (strategy === 'self_catered') return true;
  if (strategy === 'restaurant') return false;

  // Logique "mixed": décision intelligente par jour
  if (strategy === 'mixed') {
    const lastFullDay = (totalDays || 999) - 1; // avant-dernier jour = dernier soir complet
    // Jour 1: restaurant (découverte)
    if (dayNumber === 1) return false;
    // Dernier soir complet: restaurant (soirée spéciale)
    if (dayNumber === lastFullDay && mealType === 'dinner') return false;
    // Jours intermédiaires: alterner (pairs = restaurant, impairs = cuisine)
    return dayNumber % 2 === 1;
  }
  return false;
}

async function generateDayWithScheduler(params: {
  dayNumber: number;
  date: Date;
  isFirstDay: boolean;
  isLastDay: boolean;
  attractions: Attraction[];
  allAttractions?: Attraction[]; // TOUTES les attractions du voyage pour remplissage des trous
  preferences: TripPreferences;
  cityCenter: { lat: number; lng: number };
  outboundFlight: Flight | null;
  returnFlight: Flight | null;
  groundTransport: TransportOption | null;
  originAirport: AirportInfo;
  destAirport: AirportInfo;
  parking: ParkingOption | null;
  accommodation: import('./types').Accommodation | null;
  tripUsedAttractionIds: Set<string>; // ANTI-DOUBLON: Set partagé entre tous les jours
  locationTracker: ReturnType<typeof createLocationTracker>; // LOCATION TRACKING: Validation géographique
  budgetStrategy?: BudgetStrategy; // Stratégie budget pour repas self_catered vs restaurant
  budgetTracker?: BudgetTracker; // Suivi budget en temps réel
  lateFlightArrivalData?: LateFlightArrivalData | null; // Vol tardif du jour précédent à traiter
  isDayTrip?: boolean; // Day trip: relax city validation
  dayTripDestination?: string; // Day trip destination city name
  groceriesDone?: boolean; // true si les courses ont déjà été faites (on peut cuisiner)
}): Promise<{ items: TripItem[]; lateFlightForNextDay?: LateFlightArrivalData }> {
  const {
    dayNumber,
    date,
    isFirstDay,
    isLastDay,
    attractions,
    allAttractions = attractions, // Par défaut, utiliser les attractions du jour
    preferences,
    cityCenter,
    outboundFlight,
    returnFlight,
    groundTransport,
    originAirport,
    destAirport,
    parking,
    accommodation,
    tripUsedAttractionIds, // ANTI-DOUBLON: Set partagé entre tous les jours
    locationTracker, // LOCATION TRACKING: Validation géographique
    budgetStrategy, // Stratégie budget pour repas
    budgetTracker, // Suivi budget en temps réel
    lateFlightArrivalData, // Vol tardif à traiter en début de journée
    isDayTrip,
    dayTripDestination,
    groceriesDone,
  } = params;

  // Date de début du voyage normalisée (pour les URLs de réservation)
  // Évite les erreurs de timezone: "2026-01-27T23:00:00.000Z" → 27 janvier, pas 28
  const tripStartDate = normalizeToLocalDate(preferences.startDate);

  // Déterminer les heures de disponibilité
  let dayStart = parseTime(date, '08:00');

  // RÈGLE 3: Si nightlife sélectionné, journées jusqu'à minuit
  const hasNightlife = preferences.activities?.includes('nightlife') ?? false;
  let dayEnd = parseTime(date, hasNightlife ? '23:59' : '23:00');

  // DEBUG: Afficher les infos de transport
  console.log(`[Jour ${dayNumber}] DEBUG: isFirstDay=${isFirstDay}, outboundFlight=${outboundFlight ? 'OUI' : 'NON'}, groundTransport=${groundTransport ? groundTransport.mode : 'NON'}`);

  // Ajuster selon les contraintes de transport
  // JOUR 1: On NE PEUT PAS faire d'activités à destination AVANT d'y arriver!
  if (isFirstDay) {
    if (outboundFlight) {
      // Vol aller: disponible après arrivée + transfert + check-in hôtel
      const arrivalTime = new Date(outboundFlight.arrivalTime);
      console.log(`[Jour ${dayNumber}] DEBUG: Vol arrivée raw = "${outboundFlight.arrivalTime}", parsed = ${arrivalTime.toISOString()}`);

      // Vérifier que la date est valide
      if (isNaN(arrivalTime.getTime())) {
        console.error(`[Jour ${dayNumber}] ERREUR: arrivalTime invalide, utilisation de 20:00 par défaut`);
        dayStart = parseTime(date, '21:30'); // 20:00 + 1h30
      } else {
        // +1h30 après arrivée (transfert aéroport + check-in hôtel)
        dayStart = new Date(arrivalTime.getTime() + 90 * 60 * 1000);
        console.log(`[Jour ${dayNumber}] Vol arrive à ${arrivalTime.toLocaleTimeString('fr-FR')}, activités possibles à partir de ${dayStart.toLocaleTimeString('fr-FR')}`);
      }
    } else if (groundTransport) {
      // Transport terrestre: disponible après arrivée + check-in hôtel
      const departureTime = parseTime(date, '08:00');
      const arrivalTime = new Date(departureTime.getTime() + groundTransport.totalDuration * 60 * 1000);
      dayStart = new Date(arrivalTime.getTime() + 15 * 60 * 1000); // +15min buffer (check-in est un fixed item)
      console.log(`[Jour ${dayNumber}] Transport terrestre arrive à ${arrivalTime.toLocaleTimeString('fr-FR')}, activités possibles à partir de ${dayStart.toLocaleTimeString('fr-FR')}`);
    }
  }

  if (isLastDay) {
    if (returnFlight) {
      // Dernier jour avec vol: checkout cappé à 12h, activités possibles entre checkout et transfert aéroport
      const departureTime = new Date(returnFlight.departureTime);
      const checkoutByFlight = new Date(departureTime.getTime() - 210 * 60 * 1000);
      const checkoutByStandard = parseTime(date, '12:00');
      const checkoutTime = checkoutByFlight < checkoutByStandard ? checkoutByFlight : checkoutByStandard;
      // Activités possibles jusqu'au transfert aéroport (2h avant vol)
      const transferToAirport = new Date(departureTime.getTime() - 120 * 60 * 1000);

      if (checkoutTime <= dayStart) {
        console.log(`[Jour ${dayNumber}] Vol matinal → Pas d'activités`);
        dayEnd = dayStart;
      } else {
        // Activités entre checkout et transfert (pas juste jusqu'au checkout)
        dayEnd = transferToAirport > checkoutTime ? transferToAirport : checkoutTime;
        console.log(`[Jour ${dayNumber}] Dernier jour - checkout ${checkoutTime.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})}, activités jusqu'à ${dayEnd.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})}`);
      }
    } else if (groundTransport) {
      // Dernier jour transport terrestre: activités possibles APRÈS check-out (10:30) jusqu'au départ (14:00)
      // Le check-out (10:00-10:30) et le transport retour (14:00) sont des fixed items
      // On étend dayEnd jusqu'à 13:30 pour permettre des activités entre check-out et départ
      const targetEnd = parseTime(date, '13:30'); // 30min avant transport retour (14:00)

      if (targetEnd <= dayStart) {
        console.log(`[Jour ${dayNumber}] Transport matinal - pas d'activités possibles`);
        dayEnd = dayStart;
      } else {
        dayEnd = targetEnd;
        console.log(`[Jour ${dayNumber}] Dernier jour ground - activités jusqu'à 13:30 (départ 14:00)`);
      }
    }
  }

  // Créer le scheduler pour ce jour
  const scheduler = new DayScheduler(date, dayStart, dayEnd);
  const items: TripItem[] = [];
  let orderIndex = 0;

  // Variable pour stocker les infos d'un vol tardif à reporter au jour suivant
  let lateFlightForNextDay: LateFlightArrivalData | undefined;

  // Position actuelle pour les itinéraires (déclaré au niveau fonction)
  let lastCoords = cityCenter;

  console.log(`[Jour ${dayNumber}] Plage horaire: ${formatScheduleTime(dayStart)} - ${formatScheduleTime(dayEnd)}`);
  console.log(`[Jour ${dayNumber}] Position: ${isFirstDay ? 'ORIGINE (en transit)' : 'DESTINATION'} | isLastDay: ${isLastDay}`);

  // === TRAITER UN VOL OVERNIGHT DU JOUR PRÉCÉDENT ===
  // Pour un vol overnight (arrivée le lendemain), le transfert et check-in hôtel
  // n'ont PAS été faits la veille - on les fait ce matin
  if (lateFlightArrivalData && !isFirstDay) {
    const overnightFlight = lateFlightArrivalData.flight;
    const overnightArrival = new Date(overnightFlight.arrivalTime);
    const overnightDestAirport = lateFlightArrivalData.destAirport;
    const overnightAccommodation = lateFlightArrivalData.accommodation;

    console.log(`[Jour ${dayNumber}] VOL OVERNIGHT arrivé: transfert et check-in hôtel à faire ce matin`);
    console.log(`[Jour ${dayNumber}] Arrivée vol: ${overnightArrival.toLocaleTimeString('fr-FR')}`);

    // Transfert aéroport → hôtel (après l'arrivée du vol overnight)
    const transferStart = new Date(overnightArrival.getTime() + 30 * 60 * 1000); // 30min après atterrissage
    const transferEnd = new Date(transferStart.getTime() + 40 * 60 * 1000);

    const transferItem = scheduler.insertFixedItem({
      id: generateId(),
      title: 'Transfert Aéroport → Centre-ville',
      type: 'transport',
      startTime: transferStart,
      endTime: transferEnd,
    });
    if (transferItem) {
      // LOCATION TRACKING: Atterrissage = arrivé à destination
      locationTracker.landFlight(preferences.destination, formatScheduleTime(transferEnd));
      console.log(`[LocationTracker] Atterrissage overnight: arrivé à ${preferences.destination} à ${formatScheduleTime(transferEnd)}`);

      items.push(schedulerItemToTripItem(transferItem, dayNumber, orderIndex++, {
        description: preferences.carRental ? 'Récupérez votre voiture de location.' : 'Taxi ou transports en commun.',
        locationName: `${overnightDestAirport.name} → Centre-ville`,
        latitude: cityCenter.lat,
        longitude: cityCenter.lng,
        estimatedCost: preferences.carRental ? 0 : 25 * Math.ceil(preferences.groupSize / 4),
      }));
    }

    // Check-in ou dépôt bagages (selon l'heure d'arrivée vs heure de check-in officielle)
    const overnightCheckInTime = overnightAccommodation?.checkInTime || '15:00';
    const [oCheckInH, oCheckInM] = overnightCheckInTime.split(':').map(Number);
    const officialCheckIn = new Date(date);
    officialCheckIn.setHours(oCheckInH, oCheckInM, 0, 0);
    const isBeforeCheckIn = transferEnd < officialCheckIn;

    const hotelCheckinStart = transferEnd;
    const hotelCheckinEnd = new Date(hotelCheckinStart.getTime() + (isBeforeCheckIn ? 10 : 20) * 60 * 1000);
    const hotelName = overnightAccommodation?.name || 'Hébergement';
    const hotelItem = scheduler.insertFixedItem({
      id: generateId(),
      title: isBeforeCheckIn ? `Dépôt bagages ${hotelName}` : `Check-in ${hotelName}`,
      type: 'hotel',
      startTime: hotelCheckinStart,
      endTime: hotelCheckinEnd,
    });
    if (hotelItem) {
      const hotelCheckOutDate = new Date(tripStartDate);
      hotelCheckOutDate.setDate(hotelCheckOutDate.getDate() + preferences.durationDays - 1);
      const hotelBookingUrl = getAccommodationBookingUrl(overnightAccommodation, preferences.destination, tripStartDate, hotelCheckOutDate);

      items.push(schedulerItemToTripItem(hotelItem, dayNumber, orderIndex++, {
        description: overnightAccommodation
          ? (isBeforeCheckIn
            ? `Déposez vos bagages en attendant le check-in à ${overnightCheckInTime} | ${overnightAccommodation.pricePerNight}€/nuit`
            : `${overnightAccommodation.stars ? overnightAccommodation.stars + '⭐ | ' : ''}${overnightAccommodation.rating?.toFixed(1)}/10 | ${overnightAccommodation.pricePerNight}€/nuit`)
          : 'Déposez vos affaires et installez-vous.',
        locationName: getHotelLocationName(overnightAccommodation, preferences.destination),
        latitude: overnightAccommodation?.latitude || cityCenter.lat + 0.005,
        longitude: overnightAccommodation?.longitude || cityCenter.lng + 0.005,
        bookingUrl: hotelBookingUrl,
      }));
    }

    // Avancer le curseur après le check-in hôtel
    scheduler.advanceTo(hotelCheckinEnd);
    console.log(`[Jour ${dayNumber}] VOL OVERNIGHT: Transfert et check-in terminés à ${formatScheduleTime(hotelCheckinEnd)}`);
  }

  // === JOUR 1: LOGISTIQUE DEPART ===
  if (isFirstDay) {
    if (outboundFlight) {
      // Vol aller
      const flightDeparture = new Date(outboundFlight.departureTime);
      const flightArrival = new Date(outboundFlight.arrivalTime);
      const airportArrival = new Date(flightDeparture.getTime() - 2 * 60 * 60 * 1000);

      // === TEMPS LIBRE À L'ORIGINE AVANT LE DÉPART ===
      // Si le vol est tard, on peut profiter de la matinée à l'origine
      const departureHour = flightDeparture.getHours();
      const dayStartHour = 8; // On commence la journée à 8h

      // Calculer l'heure effective où on doit partir de l'origine
      let originDepartureTime = airportArrival; // Par défaut: 2h avant le vol

      // === TRAJET ORIGINE → AÉROPORT (si villes différentes) ===
      // Ex: Angers → Paris Orly = train/voiture de ~2h30
      // Toujours calculer la distance réelle entre l'origine et l'aéroport
      // L'ancien check par nom échouait quand la ville et l'aéroport ont le même nom
      // (ex: "Marseille" → "Marseille Provence" = même nom mais 25km de distance)
      const originCoordsCheck = getCityCenterCoords(preferences.origin);
      const distOriginToAirport = originCoordsCheck
        ? calculateDistance(originCoordsCheck.lat, originCoordsCheck.lng, originAirport.latitude, originAirport.longitude)
        : 0;
      const originDifferentFromAirport = distOriginToAirport > 5; // >5km = besoin d'un transfert

      // Calculer le temps de trajet vers l'aéroport si villes différentes
      let travelTimeMinutes = 0;
      let distanceToAirport = 0;
      // IMPORTANT: Ne PAS utiliser cityCenter (destination) comme fallback pour l'origine !
      // Utiliser les coordonnées de l'aéroport d'origine comme fallback
      const originCoordsLocal = getCityCenterCoords(preferences.origin) || {
        lat: originAirport.latitude,
        lng: originAirport.longitude,
      };

      // Variables pour le calcul du temps disponible à l'origine
      let transferToAirportStart: Date;
      let estimatedTravelCost = 0;

      if (originDifferentFromAirport) {
        // Estimer le temps de trajet (basé sur la distance)
        distanceToAirport = calculateDistance(
          originCoordsLocal.lat, originCoordsLocal.lng,
          originAirport.latitude, originAirport.longitude
        );
        // Estimation réaliste du temps de trajet:
        // - Train grande vitesse: ~200km/h effectif (inclut temps gare)
        // - Train régional/voiture: ~100km/h effectif
        // - Minimum 60min pour tout trajet (temps de déplacement local + marge)
        const effectiveSpeed = distanceToAirport > 200 ? 150 : 100; // km/h
        travelTimeMinutes = Math.max(60, Math.round((distanceToAirport / effectiveSpeed) * 60) + 30); // +30min marge
        // Estimation coût: TGV ~40-80€, voiture ~0.15€/km
        estimatedTravelCost = distanceToAirport > 200 ? 70 : Math.round(distanceToAirport * 0.15);

        console.log(`[Jour ${dayNumber}] Origine "${preferences.origin}" ≠ Aéroport "${originAirport.city}" → Ajout trajet ${travelTimeMinutes}min`);

        // Calculer l'heure de départ (avant parking ou arrivée aéroport)
        const transferToAirportEnd = parking
          ? new Date(airportArrival.getTime() - calculateParkingTime(parking) * 60 * 1000)
          : airportArrival;
        transferToAirportStart = new Date(transferToAirportEnd.getTime() - travelTimeMinutes * 60 * 1000);
        originDepartureTime = transferToAirportStart;

        const originTransferItem = scheduler.insertFixedItem({
          id: generateId(),
          title: `Trajet ${preferences.origin} → ${originAirport.city}`,
          type: 'transport',
          startTime: transferToAirportStart,
          endTime: transferToAirportEnd,
        });
        if (originTransferItem) {
          items.push(schedulerItemToTripItem(originTransferItem, dayNumber, orderIndex++, {
            description: distanceToAirport > 150
              ? `Train ou covoiturage vers l'aéroport (${Math.round(distanceToAirport)}km)`
              : `Voiture ou navette vers l'aéroport (${Math.round(distanceToAirport)}km)`,
            locationName: `${preferences.origin} → ${originAirport.name}`,
            latitude: originAirport.latitude,
            longitude: originAirport.longitude,
            estimatedCost: estimatedTravelCost,
          }));
        }
      } else {
        // Origine = même ville que l'aéroport, mais on a quand même besoin d'un transfert local
        const localTransferMin = Math.max(20, Math.round((distOriginToAirport || 15) * 2)); // ~2min/km, min 20min
        const transferToAirportEnd = parking
          ? new Date(airportArrival.getTime() - calculateParkingTime(parking) * 60 * 1000)
          : airportArrival;
        transferToAirportStart = new Date(transferToAirportEnd.getTime() - localTransferMin * 60 * 1000);
        originDepartureTime = transferToAirportStart;

        // Ajouter un item de transfert local vers l'aéroport
        const localTransferItem = scheduler.insertFixedItem({
          id: generateId(),
          title: `Trajet vers ${originAirport.name}`,
          type: 'transport',
          startTime: transferToAirportStart,
          endTime: transferToAirportEnd,
        });
        if (localTransferItem) {
          items.push(schedulerItemToTripItem(localTransferItem, dayNumber, orderIndex++, {
            description: `Taxi ou transports vers l'aéroport`,
            locationName: `${preferences.origin} → ${originAirport.name}`,
            latitude: originAirport.latitude,
            longitude: originAirport.longitude,
            estimatedCost: Math.round(15 * Math.ceil((preferences.groupSize || 1) / 4)),
          }));
        }
      }

      // Parking (si applicable)
      if (parking) {
        const parkingTime = calculateParkingTime(parking);
        const parkingStart = new Date(airportArrival.getTime() - parkingTime * 60 * 1000);
        const parkingItem = scheduler.insertFixedItem({
          id: generateId(),
          title: `Parking: ${parking.name}`,
          type: 'parking',
          startTime: parkingStart,
          endTime: airportArrival,
          data: { parking },
        });
        if (parkingItem) {
          items.push(schedulerItemToTripItem(parkingItem, dayNumber, orderIndex++, {
            description: `Garez votre voiture. Prix: ${parking.totalPrice}€`,
            locationName: parking.address,
            latitude: parking.latitude,
            longitude: parking.longitude,
            estimatedCost: parking.totalPrice,
          }));
        }
      }

      // Enregistrement
      const checkinEnd = new Date(flightDeparture.getTime() - 30 * 60 * 1000);
      const checkinItem = scheduler.insertFixedItem({
        id: generateId(),
        title: 'Enregistrement & Sécurité',
        type: 'checkin',
        startTime: airportArrival,
        endTime: checkinEnd,
      });
      if (checkinItem) {
        items.push(schedulerItemToTripItem(checkinItem, dayNumber, orderIndex++, {
          description: `Arrivez 2h avant. Terminal: ${originAirport.name}`,
          locationName: originAirport.name,
          latitude: originAirport.latitude,
          longitude: originAirport.longitude,
        }));
      }

      // Vol
      // Utiliser les heures d'affichage (heures locales aéroport) si disponibles
      const outboundFlightStartTime = outboundFlight.departureTimeDisplay || formatTime(flightDeparture);
      const outboundFlightEndTime = outboundFlight.arrivalTimeDisplay || formatTime(flightArrival);
      console.log(`[AI] Vol aller ${outboundFlight.flightNumber}: ${outboundFlightStartTime} - ${outboundFlightEndTime}`);

      const flightItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `Vol ${outboundFlight.flightNumber} → ${preferences.destination}`,
        type: 'flight',
        startTime: flightDeparture,
        endTime: flightArrival,
        data: { flight: outboundFlight },
      });
      if (flightItem) {
        // LOCATION TRACKING: Embarquement = en transit (pas d'activités possibles)
        locationTracker.boardFlight(preferences.origin, preferences.destination);
        console.log(`[LocationTracker] Embarquement: ${preferences.origin} → ${preferences.destination} (en transit)`);

        // Utiliser l'URL de réservation du vol (Google Flights) si disponible
        // Sinon fallback sur Skyscanner via linkGenerator
        const tripEndDate = new Date(tripStartDate);
        tripEndDate.setDate(tripEndDate.getDate() + preferences.durationDays - 1);
        const flightBookingUrl = outboundFlight.bookingUrl || generateFlightLink(
          { origin: originAirport.code, destination: destAirport.code },
          { date: formatDateForUrl(tripStartDate), returnDate: formatDateForUrl(tripEndDate), passengers: preferences.groupSize }
        );

        // Créer l'item et surcharger les heures avec les heures locales de l'aéroport
        // Afficher le prix par personne ET le prix total (avec protections NaN)
        const flightPrice = outboundFlight.price || 0;
        const groupSize = preferences.groupSize || 1;
        const pricePerPerson = outboundFlight.pricePerPerson || (flightPrice > 0 ? Math.round(flightPrice / groupSize) : 0);
        const priceDisplay = groupSize > 1 && pricePerPerson > 0
          ? `${pricePerPerson}€/pers (${flightPrice}€ total)`
          : flightPrice > 0 ? `${flightPrice}€` : 'Prix non disponible';
        const tripItem = schedulerItemToTripItem(flightItem, dayNumber, orderIndex++, {
          description: `${outboundFlight.flightNumber} | ${formatFlightDuration(outboundFlight.duration)} | ${outboundFlight.stops === 0 ? 'Direct' : `${outboundFlight.stops} escale(s)`} | ${priceDisplay}`,
          locationName: `${originAirport.code} → ${destAirport.code}`,
          latitude: (originAirport.latitude + destAirport.latitude) / 2,
          longitude: (originAirport.longitude + destAirport.longitude) / 2,
          estimatedCost: outboundFlight.price,
          bookingUrl: flightBookingUrl,
        });
        // IMPORTANT: Surcharger les heures formatées avec les heures d'affichage correctes
        tripItem.startTime = outboundFlightStartTime;
        // Si vol overnight (arrivée < départ en string), ajouter "+1j" pour clarifier
        const isOvernightDisplay = outboundFlightEndTime < outboundFlightStartTime;
        tripItem.endTime = isOvernightDisplay ? `${outboundFlightEndTime} (+1j)` : outboundFlightEndTime;
        items.push(tripItem);
      }

      // === GESTION VOL TARDIF / OVERNIGHT ===
      // Détecter si le vol arrive le LENDEMAIN (vol overnight avec escale)
      // Exemple: Départ 18:30 le 28/01, arrivée 08:35 le 29/01
      const departureDay = new Date(flightDeparture.getFullYear(), flightDeparture.getMonth(), flightDeparture.getDate());
      const arrivalDay = new Date(flightArrival.getFullYear(), flightArrival.getMonth(), flightArrival.getDate());
      const isOvernightFlight = arrivalDay.getTime() > departureDay.getTime();

      const arrivalHour = flightArrival.getHours();
      // Vol tardif: arrive après 22h OU avant 5h (mais PAS overnight, géré séparément)
      const isLateNightFlight = (arrivalHour >= 22 || arrivalHour < 5) && !isOvernightFlight;

      // === VOL OVERNIGHT: Arrivée le lendemain ===
      // Le Jour 1 ne contient QUE la logistique de départ (parking, enregistrement, vol)
      // Le transfert et check-in hôtel seront faits au Jour 2
      if (isOvernightFlight) {
        console.log(`[Jour ${dayNumber}] VOL OVERNIGHT détecté: départ ${flightDeparture.toDateString()}, arrivée ${flightArrival.toDateString()} (lendemain!)`);
        console.log(`[Jour ${dayNumber}] → Jour 1 = uniquement logistique départ, Jour 2 = arrivée + activités`);
        // Stocker les infos pour le jour suivant
        lateFlightForNextDay = {
          flight: outboundFlight,
          destAirport,
          accommodation,
        };
        // NE PAS ajouter de transfert/check-in hôtel aujourd'hui - ils seront au Jour 2
      } else if (isLateNightFlight) {
        console.log(`[Jour ${dayNumber}] VOL TARDIF détecté: arrivée à ${arrivalHour}h → Transfert et hôtel ce soir, activités demain`);

        // MÊME pour un vol tardif, on fait le transfert et check-in hôtel le même soir
        // Cela évite que le voyageur "dorme à l'aéroport"

        // Transfert aéroport → hôtel (directement, pas de consigne à cette heure)
        const lateTransferStart = new Date(flightArrival.getTime() + 30 * 60 * 1000); // 30min après atterrissage
        const lateTransferEnd = new Date(lateTransferStart.getTime() + 40 * 60 * 1000);

        const lateTransferItem = scheduler.insertFixedItem({
          id: generateId(),
          title: 'Transfert Aéroport → Hôtel',
          type: 'transport',
          startTime: lateTransferStart,
          endTime: lateTransferEnd,
        });
        if (lateTransferItem) {
          // LOCATION TRACKING: Atterrissage tardif = arrivé à destination
          locationTracker.landFlight(preferences.destination, formatScheduleTime(lateTransferEnd));
          console.log(`[LocationTracker] Atterrissage tardif: arrivé à ${preferences.destination} à ${formatScheduleTime(lateTransferEnd)}`);

          items.push(schedulerItemToTripItem(lateTransferItem, dayNumber, orderIndex++, {
            description: preferences.carRental ? 'Récupérez votre voiture de location.' : 'Taxi ou Uber vers votre hôtel.',
            locationName: `${destAirport.name} → Hôtel`,
            latitude: cityCenter.lat,
            longitude: cityCenter.lng,
            estimatedCost: preferences.carRental ? 0 : 35 * Math.ceil(preferences.groupSize / 4), // Plus cher la nuit
          }));
        }

        // Check-in hôtel tardif (les hôtels acceptent généralement les arrivées tardives)
        const lateCheckinStart = lateTransferEnd;
        const lateCheckinEnd = new Date(lateCheckinStart.getTime() + 15 * 60 * 1000);
        const hotelName = accommodation?.name || 'Hébergement';

        const lateHotelItem = scheduler.insertFixedItem({
          id: generateId(),
          title: `Check-in tardif ${hotelName}`,
          type: 'hotel',
          startTime: lateCheckinStart,
          endTime: lateCheckinEnd,
        });
        if (lateHotelItem) {
          // tripStartDate est déjà normalisé au début de la fonction
          const hotelCheckOutDate = new Date(tripStartDate);
          hotelCheckOutDate.setDate(hotelCheckOutDate.getDate() + preferences.durationDays - 1);
          const hotelBookingUrl = getAccommodationBookingUrl(accommodation, preferences.destination, tripStartDate, hotelCheckOutDate);

          items.push(schedulerItemToTripItem(lateHotelItem, dayNumber, orderIndex++, {
            description: `Arrivée tardive prévue. Check-out le dernier jour à ${accommodation?.checkOutTime || '11:00'}.`,
            locationName: getHotelLocationName(accommodation, preferences.destination),
            latitude: accommodation?.latitude || cityCenter.lat,
            longitude: accommodation?.longitude || cityCenter.lng,
            estimatedCost: 0, // Inclus dans le prix total
            bookingUrl: hotelBookingUrl,
          }));
        }

        // PAS de report au jour suivant pour le transfert/hôtel, c'est fait!
        // Les activités du jour 2 commenceront normalement à 08:00
        console.log(`[Jour ${dayNumber}] VOL TARDIF: Transfert et check-in hôtel programmés pour ${formatScheduleTime(lateTransferStart)}-${formatScheduleTime(lateCheckinEnd)}`);

      } else {
        // Vol normal (arrivée avant 22h) - générer les activités post-arrivée normalement

      // Transfert aéroport → centre-ville/hôtel
      const transferStart = new Date(flightArrival.getTime() + 30 * 60 * 1000);
      const transferEnd = new Date(transferStart.getTime() + 40 * 60 * 1000);

      // Heure de check-in de l'hôtel
      const hotelCheckInTime = accommodation?.checkInTime || '15:00';
      const [checkInHour, checkInMin] = hotelCheckInTime.split(':').map(Number);

      // FLUX OPTIMISÉ: Aéroport → Centre-ville → Activités → Check-in hôtel
      // Si on arrive avant l'heure de check-in, on fait des activités en attendant

      const transferItem = scheduler.insertFixedItem({
        id: generateId(),
        title: 'Transfert Aéroport → Centre-ville',
        type: 'transport',
        startTime: transferStart,
        endTime: transferEnd,
      });
      if (transferItem) {
        // LOCATION TRACKING: Atterrissage = arrivé à destination (activités possibles)
        const arrivalTimeStr = formatScheduleTime(transferEnd);
        locationTracker.landFlight(preferences.destination, arrivalTimeStr);
        console.log(`[LocationTracker] Atterrissage: arrivé à ${preferences.destination} à ${arrivalTimeStr}`);

        items.push(schedulerItemToTripItem(transferItem, dayNumber, orderIndex++, {
          description: preferences.carRental ? 'Récupérez votre voiture de location.' : 'Taxi ou transports en commun. Déposez vos bagages à l\'hôtel (bagagerie) si possible.',
          locationName: `${destAirport.name} → Centre-ville`,
          latitude: cityCenter.lat,
          longitude: cityCenter.lng,
          estimatedCost: preferences.carRental ? 0 : 25 * Math.ceil(preferences.groupSize / 4),
        }));
      }

      // Avancer le curseur après le transfert
      scheduler.advanceTo(transferEnd);

      // Calculer l'heure de check-in de l'hôtel
      const actualCheckInTime = new Date(date);
      actualCheckInTime.setHours(checkInHour, checkInMin, 0, 0);

      // Calculer le temps disponible avant le check-in
      const timeBeforeCheckInMs = actualCheckInTime.getTime() - transferEnd.getTime();
      const hoursBeforeCheckIn = timeBeforeCheckInMs / (1000 * 60 * 60);

      console.log(`[Jour ${dayNumber}] Arrivée à ${formatScheduleTime(transferEnd)}, check-in à ${checkInHour}:${String(checkInMin).padStart(2, '0')} → ${hoursBeforeCheckIn.toFixed(1)}h disponibles`);

      // === CONSIGNE À BAGAGES (vol) ===
      const flightArrivalTimeStr = `${transferEnd.getHours().toString().padStart(2, '0')}:${transferEnd.getMinutes().toString().padStart(2, '0')}`;
      const flightNeedsStorage = preferences.durationDays > 1 && needsLuggageStorage(flightArrivalTimeStr, hotelCheckInTime);

      if (flightNeedsStorage && hoursBeforeCheckIn >= 1.5) {
        try {
          const flightStorages = await searchLuggageStorage(preferences.destination, { latitude: cityCenter.lat, longitude: cityCenter.lng });
          const flightBestStorage = selectBestStorage(flightStorages, { latitude: cityCenter.lat, longitude: cityCenter.lng });

          if (flightBestStorage) {
            const flightLuggageDropStart = scheduler.getCurrentTime();
            const flightLuggageDropEnd = new Date(flightLuggageDropStart.getTime() + 15 * 60 * 1000);
            const flightLuggageDropItem = scheduler.addItem({
              id: generateId(),
              title: '🧳 Dépôt bagages en consigne',
              type: 'activity',
              duration: 15,
              travelTime: 10,
            });
            if (flightLuggageDropItem) {
              items.push(schedulerItemToTripItem(flightLuggageDropItem, dayNumber, orderIndex++, {
                description: `${flightBestStorage.name} — ${flightBestStorage.pricePerDay}€/jour${flightBestStorage.notes ? ` | ${flightBestStorage.notes}` : ''}`,
                locationName: flightBestStorage.address,
                latitude: flightBestStorage.latitude || cityCenter.lat,
                longitude: flightBestStorage.longitude || cityCenter.lng,
                estimatedCost: flightBestStorage.pricePerDay * preferences.groupSize,
                bookingUrl: flightBestStorage.bookingUrl,
              }));
              console.log(`[Jour ${dayNumber}] 🧳 Dépôt bagages (vol) ajouté: ${flightBestStorage.name}`);
            }

            // Récupération bagages avant check-in
            const flightLuggagePickupStart = new Date(actualCheckInTime.getTime() - 30 * 60 * 1000);
            if (flightLuggagePickupStart > flightLuggageDropEnd) {
              const flightLuggagePickupItem = scheduler.insertFixedItem({
                id: generateId(),
                title: '🧳 Récupération bagages',
                type: 'activity',
                startTime: flightLuggagePickupStart,
                endTime: new Date(flightLuggagePickupStart.getTime() + 15 * 60 * 1000),
              });
              if (flightLuggagePickupItem) {
                items.push(schedulerItemToTripItem(flightLuggagePickupItem, dayNumber, orderIndex++, {
                  description: `Récupérez vos bagages à ${flightBestStorage.name} avant le check-in`,
                  locationName: flightBestStorage.address,
                  latitude: flightBestStorage.latitude || cityCenter.lat,
                  longitude: flightBestStorage.longitude || cityCenter.lng,
                }));
              }
            }
          }
        } catch (err) {
          console.warn(`[Jour ${dayNumber}] 🧳 Erreur recherche consigne (vol):`, err instanceof Error ? err.message : err);
        }
      }

      // Si on arrive avant le check-in mais gap < 1h30 → déposer bagages à l'hôtel
      if (hoursBeforeCheckIn > 0 && hoursBeforeCheckIn < 1.5) {
        const luggageDropItem = scheduler.addItem({
          id: generateId(),
          title: `Déposer bagages à ${accommodation?.name || 'l\'hôtel'}`,
          type: 'activity',
          duration: 10,
          travelTime: 5,
        });
        if (luggageDropItem) {
          items.push(schedulerItemToTripItem(luggageDropItem, dayNumber, orderIndex++, {
            description: 'Déposez vos bagages à la réception avant le check-in officiel.',
            locationName: getHotelLocationName(accommodation, preferences.destination),
            latitude: accommodation?.latitude || cityCenter.lat + 0.005,
            longitude: accommodation?.longitude || cityCenter.lng + 0.005,
          }));
        }
      }

      // Si on a du temps avant le check-in (> 1h30), faire des activités
      if (hoursBeforeCheckIn >= 1.5) {
        // Déjeuner si on est dans la plage horaire (11h30 - 14h)
        const currentHour = transferEnd.getHours();
        const currentMin = transferEnd.getMinutes();
        const canDoLunch = (currentHour >= 11 && currentMin >= 30) || (currentHour >= 12 && currentHour < 14);

        if (canDoLunch && hoursBeforeCheckIn >= 2.5) {
          const lunchItem = scheduler.addItem({
            id: generateId(),
            title: 'Déjeuner',
            type: 'restaurant',
            duration: 75,
            travelTime: 15,
          });
          if (lunchItem) {
            if (shouldSelfCater('lunch', dayNumber, budgetStrategy, false, preferences.durationDays, isDayTrip, groceriesDone)) {
              items.push(schedulerItemToTripItem(lunchItem, dayNumber, orderIndex++, {
                title: 'Déjeuner pique-nique / maison',
                description: 'Repas préparé avec les courses | Option économique',
                locationName: `Centre-ville, ${preferences.destination}`,
                latitude: lastCoords.lat,
                longitude: lastCoords.lng,
                estimatedCost: 8 * (preferences.groupSize || 1),
              }));
            } else {
              const restaurant = await findRestaurantForMeal('lunch', cityCenter, preferences, dayNumber, lastCoords);
              const restaurantCoords = {
                lat: restaurant?.latitude || cityCenter.lat,
                lng: restaurant?.longitude || cityCenter.lng,
              };
              const restaurantGoogleMapsUrl = getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);

              items.push(schedulerItemToTripItem(lunchItem, dayNumber, orderIndex++, {
                title: restaurant?.name || 'Déjeuner',
                description: restaurant ? `${restaurant.cuisineTypes.join(', ')} | ⭐ ${restaurant.rating?.toFixed(1)}/5` : 'Découvrez la cuisine locale',
                locationName: restaurant?.address || `Centre-ville, ${preferences.destination}`,
                latitude: restaurantCoords.lat,
                longitude: restaurantCoords.lng,
                estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'lunch') * preferences.groupSize,
                rating: restaurant?.rating,
                googleMapsPlaceUrl: restaurantGoogleMapsUrl,
              }));
              lastCoords = restaurantCoords;
            }
            console.log(`[Jour ${dayNumber}] Déjeuner ajouté avant check-in`);
          }
        }

        // Activités en attendant le check-in (jusqu'à 30min avant)
        const checkInBuffer = new Date(actualCheckInTime.getTime() - 30 * 60 * 1000);

        for (const attraction of attractions) {
          // Vérifier qu'on a le temps avant le check-in
          const travelTime = estimateTravelTime({ latitude: lastCoords.lat, longitude: lastCoords.lng } as Attraction, attraction);
          const activityEndTime = new Date(scheduler.getCurrentTime().getTime() + (travelTime + attraction.duration + 15) * 60 * 1000);

          if (activityEndTime > checkInBuffer) {
            console.log(`[Jour ${dayNumber}] Plus de temps pour activités avant check-in`);
            break;
          }

          // ANTI-DOUBLON: Skip si déjà utilisée
          if (tripUsedAttractionIds.has(attraction.id)) {
            continue;
          }

          const activityItem = scheduler.addItem({
            id: generateId(),
            title: attraction.name,
            type: 'activity',
            duration: attraction.duration,
            travelTime,
          });

          if (activityItem) {
            tripUsedAttractionIds.add(attraction.id);
            const attractionCoords = {
              lat: attraction.latitude || cityCenter.lat,
              lng: attraction.longitude || cityCenter.lng,
            };
            items.push(schedulerItemToTripItem(activityItem, dayNumber, orderIndex++, {
              description: attraction.description,
              locationName: `${attraction.name}, ${preferences.destination}`,
              latitude: attractionCoords.lat,
              longitude: attractionCoords.lng,
              estimatedCost: attraction.estimatedCost * preferences.groupSize,
              rating: attraction.rating,
              bookingUrl: attraction.bookingUrl,
              dataReliability: attraction.dataReliability || 'verified',
            }));
            lastCoords = attractionCoords;
            console.log(`[Jour ${dayNumber}] Activité avant check-in: ${attraction.name}`);
          }
        }
      }

      // Check-in hôtel - à l'heure officielle ou maintenant si on est déjà en retard
      const hotelCheckinStart = scheduler.getCurrentTime() > actualCheckInTime ? scheduler.getCurrentTime() : actualCheckInTime;
      const hotelCheckinEnd = new Date(hotelCheckinStart.getTime() + 20 * 60 * 1000);
      const hotelName = accommodation?.name || 'Hébergement';
      const hotelItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `Check-in ${hotelName}`,
        type: 'hotel',
        startTime: hotelCheckinStart,
        endTime: hotelCheckinEnd,
      });
      if (hotelItem) {
        // tripStartDate est déjà normalisé au début de la fonction
        const hotelCheckOutDate = new Date(tripStartDate);
        hotelCheckOutDate.setDate(hotelCheckOutDate.getDate() + preferences.durationDays - 1);
        const hotelBookingUrl = getAccommodationBookingUrl(accommodation, preferences.destination, tripStartDate, hotelCheckOutDate);

        items.push(schedulerItemToTripItem(hotelItem, dayNumber, orderIndex++, {
          description: accommodation ? `${accommodation.stars ? accommodation.stars + '⭐ | ' : ''}${accommodation.rating?.toFixed(1)}/10 | ${accommodation.pricePerNight}€/nuit` : 'Déposez vos affaires et installez-vous.',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodation?.latitude || cityCenter.lat + 0.005,
          longitude: accommodation?.longitude || cityCenter.lng + 0.005,
          bookingUrl: hotelBookingUrl,
        }));
      }

      // Avancer le curseur après le check-in hôtel
      scheduler.advanceTo(hotelCheckinEnd);
      // Mettre à jour lastCoords à la position de l'hôtel
      lastCoords = {
        lat: accommodation?.latitude || cityCenter.lat,
        lng: accommodation?.longitude || cityCenter.lng,
      };

      } // Fin du bloc else (vol NON tardif)

    } else if (groundTransport) {
      // Transport terrestre
      const transportStart = parseTime(date, '08:00');
      const transportEnd = new Date(transportStart.getTime() + groundTransport.totalDuration * 60 * 1000);

      const modeIcons: Record<string, string> = { train: '🚄', bus: '🚌', car: '🚗', combined: '🔄' };
      const modeLabels: Record<string, string> = { train: 'Train', bus: 'Bus', car: 'Voiture', combined: 'Transport combiné' };

      const transportItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `${modeIcons[groundTransport.mode] || '🚊'} ${modeLabels[groundTransport.mode] || groundTransport.mode || 'Transport'} → ${preferences.destination}`,
        type: 'transport',
        startTime: transportStart,
        endTime: transportEnd,
        data: { transport: groundTransport },
      });
      if (transportItem) {
        // LOCATION TRACKING: Transport terrestre = en transit pendant le trajet
        locationTracker.boardFlight(preferences.origin, preferences.destination);
        console.log(`[LocationTracker] Départ transport terrestre: ${preferences.origin} → ${preferences.destination}`);

        items.push(schedulerItemToTripItem(transportItem, dayNumber, orderIndex++, {
          description: groundTransport.segments?.map(s => `${s.from} → ${s.to}`).join(' | ') + ` | ${groundTransport.totalPrice}€`,
          locationName: `${preferences.origin} → ${preferences.destination}`,
          latitude: cityCenter.lat,
          longitude: cityCenter.lng,
          estimatedCost: groundTransport.totalPrice,
          bookingUrl: groundTransport.bookingUrl,
        }));

        // LOCATION TRACKING: Arrivée = à destination (activités possibles)
        const arrivalTimeStr = formatScheduleTime(transportEnd);
        locationTracker.landFlight(preferences.destination, arrivalTimeStr);
        console.log(`[LocationTracker] Arrivée transport terrestre: ${preferences.destination} à ${arrivalTimeStr}`);
      }

      // Check-in hôtel - IMPORTANT: ne pas programmer avant l'heure officielle de check-in
      const hotelCheckInTimeStr = accommodation?.checkInTime || '15:00';
      const [hotelCheckInHour, hotelCheckInMin] = hotelCheckInTimeStr.split(':').map(Number);
      const minCheckInTime = new Date(date);
      minCheckInTime.setHours(hotelCheckInHour || 15, hotelCheckInMin || 0, 0, 0);

      // Le check-in commence au plus tôt à l'heure officielle (généralement 14h-15h)
      const arrivalPlusBuffer = new Date(transportEnd.getTime() + 30 * 60 * 1000);
      const hotelStart = arrivalPlusBuffer > minCheckInTime ? arrivalPlusBuffer : minCheckInTime;
      const hotelEnd = new Date(hotelStart.getTime() + 20 * 60 * 1000);

      // === CONSIGNE À BAGAGES ===
      // Si arrivée > 2h30 avant check-in et voyage > 1 jour, proposer consigne.
      // Pour des gaps plus courts, on va directement à l'hôtel (bagagerie gratuite).
      const arrivalTimeForLuggage = `${transportEnd.getHours().toString().padStart(2, '0')}:${transportEnd.getMinutes().toString().padStart(2, '0')}`;
      const needsStorage = preferences.durationDays > 1 && needsLuggageStorage(arrivalTimeForLuggage, hotelCheckInTimeStr);

      if (needsStorage) {
        console.log(`[Jour ${dayNumber}] 🧳 Consigne nécessaire: arrivée ${arrivalTimeForLuggage}, check-in ${hotelCheckInTimeStr}`);
        try {
          const storages = await searchLuggageStorage(preferences.destination, { latitude: cityCenter.lat, longitude: cityCenter.lng });
          const bestStorage = selectBestStorage(storages, { latitude: cityCenter.lat, longitude: cityCenter.lng });

          if (bestStorage) {
            // Dépôt bagages (15min) juste après arrivée
            const luggageDropStart = new Date(transportEnd.getTime() + 15 * 60 * 1000);
            const luggageDropEnd = new Date(luggageDropStart.getTime() + 15 * 60 * 1000);
            const luggageDropItem = scheduler.insertFixedItem({
              id: generateId(),
              title: '🧳 Dépôt bagages en consigne',
              type: 'activity',
              startTime: luggageDropStart,
              endTime: luggageDropEnd,
            });
            if (luggageDropItem) {
              items.push(schedulerItemToTripItem(luggageDropItem, dayNumber, orderIndex++, {
                description: `${bestStorage.name} — ${bestStorage.pricePerDay}€/jour${bestStorage.notes ? ` | ${bestStorage.notes}` : ''}`,
                locationName: bestStorage.address,
                latitude: bestStorage.latitude || cityCenter.lat,
                longitude: bestStorage.longitude || cityCenter.lng,
                estimatedCost: bestStorage.pricePerDay * preferences.groupSize,
                bookingUrl: bestStorage.bookingUrl,
              }));
              console.log(`[Jour ${dayNumber}] 🧳 Dépôt bagages ajouté: ${bestStorage.name} (${bestStorage.pricePerDay}€/jour)`);
            }

            // Récupération bagages (15min) 30min avant check-in hôtel
            const luggagePickupStart = new Date(hotelStart.getTime() - 30 * 60 * 1000);
            const luggagePickupEnd = new Date(luggagePickupStart.getTime() + 15 * 60 * 1000);
            if (luggagePickupStart > luggageDropEnd) {
              const luggagePickupItem = scheduler.insertFixedItem({
                id: generateId(),
                title: '🧳 Récupération bagages',
                type: 'activity',
                startTime: luggagePickupStart,
                endTime: luggagePickupEnd,
              });
              if (luggagePickupItem) {
                items.push(schedulerItemToTripItem(luggagePickupItem, dayNumber, orderIndex++, {
                  description: `Récupérez vos bagages à ${bestStorage.name} avant le check-in`,
                  locationName: bestStorage.address,
                  latitude: bestStorage.latitude || cityCenter.lat,
                  longitude: bestStorage.longitude || cityCenter.lng,
                }));
                console.log(`[Jour ${dayNumber}] 🧳 Récupération bagages ajoutée avant check-in`);
              }
            }
          }
        } catch (err) {
          console.warn(`[Jour ${dayNumber}] 🧳 Erreur recherche consigne:`, err instanceof Error ? err.message : err);
        }
      }

      const hotelNameGround = accommodation?.name || 'Hébergement';
      const hotelItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `Check-in ${hotelNameGround}`,
        type: 'hotel',
        startTime: hotelStart,
        endTime: hotelEnd,
      });
      if (hotelItem) {
        // tripStartDate est déjà normalisé au début de la fonction
        const hotelCheckOutDate3 = new Date(tripStartDate);
        hotelCheckOutDate3.setDate(hotelCheckOutDate3.getDate() + preferences.durationDays - 1);
        const hotelBookingUrl3 = getAccommodationBookingUrl(accommodation, preferences.destination, tripStartDate, hotelCheckOutDate3);

        items.push(schedulerItemToTripItem(hotelItem, dayNumber, orderIndex++, {
          description: accommodation ? `${accommodation.stars ? accommodation.stars + '⭐ | ' : ''}${accommodation.rating?.toFixed(1)}/10 | ${accommodation.pricePerNight}€/nuit` : 'Déposez vos affaires et installez-vous.',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodation?.latitude || cityCenter.lat + 0.005,
          longitude: accommodation?.longitude || cityCenter.lng + 0.005,
          bookingUrl: hotelBookingUrl3,
        }));
      }

      // NE PAS avancer le curseur au check-in: laisser du temps pour des activités avant
      // Le scheduler les programmera naturellement entre l'arrivée et le check-in (fixed item)
      // Avancer juste après l'arrivée du transport + buffer
      const afterArrival = new Date(transportEnd.getTime() + 30 * 60 * 1000);
      if (afterArrival < hotelStart) {
        scheduler.advanceTo(afterArrival);
        console.log(`[Jour ${dayNumber}] ⏰ ${Math.round((hotelStart.getTime() - afterArrival.getTime()) / 60000)}min de temps libre avant check-in`);
      } else {
        scheduler.advanceTo(hotelEnd);
      }
      // Mettre à jour lastCoords à la gare/arrivée pour les activités pré-check-in
      lastCoords = {
        lat: cityCenter.lat,
        lng: cityCenter.lng,
      };
    }
  }

  // === PROTECTION CRITIQUE: JOUR 1 - S'assurer que le curseur est APRÈS le transport ===
  // Si on a un transport le Jour 1, le curseur DOIT être après l'arrivée + check-in
  if (isFirstDay) {
    let minActivityStart: Date | null = null;

    if (outboundFlight) {
      const flightArrival = new Date(outboundFlight.arrivalTime);
      if (!isNaN(flightArrival.getTime())) {
        // Minimum: arrivée vol + 1h30 (transfert + check-in)
        minActivityStart = new Date(flightArrival.getTime() + 90 * 60 * 1000);
      }
    } else if (groundTransport) {
      // Transport terrestre: activités possibles dès l'arrivée + petit buffer
      // Le check-in hôtel est un fixed item, pas besoin d'attendre pour visiter
      const departureTime = parseTime(date, '08:00');
      const arrivalTime = new Date(departureTime.getTime() + groundTransport.totalDuration * 60 * 1000);
      minActivityStart = new Date(arrivalTime.getTime() + 15 * 60 * 1000); // 15min buffer après descente
    }

    if (minActivityStart) {
      const currentCursor = scheduler.getCurrentTime();
      console.log(`[Jour ${dayNumber}] PROTECTION: Vérification curseur (${currentCursor.toLocaleTimeString('fr-FR')}) vs arrivée transport + check-in (${minActivityStart.toLocaleTimeString('fr-FR')})`);

      if (currentCursor < minActivityStart) {
        console.log(`[Jour ${dayNumber}] PROTECTION: ⚠️ Curseur AVANT arrivée! Forçage à ${minActivityStart.toLocaleTimeString('fr-FR')}`);
        scheduler.advanceTo(minActivityStart);
      } else {
        console.log(`[Jour ${dayNumber}] PROTECTION: ✓ Curseur OK, activités peuvent commencer`);
      }
    }
  }

  // === ACTIVITÉS ET REPAS ===
  const currentHour = scheduler.getCurrentTime().getHours();
  const endHour = dayEnd.getHours();

  console.log(`[Jour ${dayNumber}] Début des activités - curseur à ${scheduler.getCurrentTime().toLocaleTimeString('fr-FR')}, fin de journée à ${dayEnd.toLocaleTimeString('fr-FR')}`);

  // Sur les jours suivants, réinitialiser au centre-ville (le petit-déjeuner mettra à jour vers l'hôtel)
  // Sur le jour 1 avec check-in hôtel, lastCoords est déjà à la position de l'hôtel
  if (!isFirstDay) {
    lastCoords = cityCenter;
  }

  // Petit-déjeuner (si avant 10h et pas jour 1 avec logistique)
  // Si l'hôtel inclut le petit-déjeuner, on prend le petit-dej à l'hôtel (gratuit)
  // Sinon, on cherche un restaurant pour le petit-déjeuner
  const hotelHasBreakfast = accommodation?.breakfastIncluded === true;

  // Dernier jour avec vol: calculer le checkout et forcer le breakfast avant
  let lastDayCheckoutTime: Date | null = null;
  let skipBreakfastLastDay = false;
  if (isLastDay && returnFlight && !isFirstDay) {
    const flightDep = new Date(returnFlight.departureTime);
    const checkoutByFlight = new Date(flightDep.getTime() - 210 * 60 * 1000); // 3h30 avant vol
    const checkoutByStandard = parseTime(date, '12:00');
    lastDayCheckoutTime = checkoutByFlight < checkoutByStandard ? checkoutByFlight : checkoutByStandard;
    const checkoutH = lastDayCheckoutTime.getHours();
    if (checkoutH < 8) {
      // Vol trop tôt: skip breakfast, pas le temps
      skipBreakfastLastDay = true;
      console.log(`[Jour ${dayNumber}] Checkout à ${checkoutH}h: pas de petit-déjeuner (vol tôt)`);
    } else {
      // Forcer le breakfast tôt: au moins 1h avant checkout
      const latestBreakfastStart = new Date(lastDayCheckoutTime.getTime() - 60 * 60 * 1000);
      const earlyBreakfastTime = parseTime(date, '07:00');
      const breakfastTarget = earlyBreakfastTime < latestBreakfastStart ? earlyBreakfastTime : latestBreakfastStart;
      if (scheduler.getCurrentTime() <= breakfastTarget) {
        scheduler.advanceTo(breakfastTarget);
      }
    }
  }

  if (currentHour < 10 && !isFirstDay && !skipBreakfastLastDay) {
    const breakfastItem = scheduler.addItem({
      id: generateId(),
      title: hotelHasBreakfast ? `Petit-déjeuner à l'hôtel` : 'Petit-déjeuner',
      type: hotelHasBreakfast ? 'hotel' : 'restaurant',
      duration: hotelHasBreakfast ? 30 : 45, // Plus rapide à l'hôtel
      travelTime: hotelHasBreakfast ? 0 : 10, // Pas de déplacement si à l'hôtel
    });

    if (breakfastItem) {
      if (hotelHasBreakfast) {
        // Petit-déjeuner à l'hôtel (inclus dans le prix)
        console.log(`[Jour ${dayNumber}] 🍳 Petit-déjeuner INCLUS à l'hôtel ${accommodation?.name}`);
        items.push(schedulerItemToTripItem(breakfastItem, dayNumber, orderIndex++, {
          title: `Petit-déjeuner à l'hôtel`,
          description: `Inclus dans le prix de l'hôtel | ${accommodation?.name}`,
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodation?.latitude || cityCenter.lat,
          longitude: accommodation?.longitude || cityCenter.lng,
          estimatedCost: 0, // Inclus dans le prix de l'hôtel
        }));
        // Position reste à l'hôtel
        lastCoords = {
          lat: accommodation?.latitude || cityCenter.lat,
          lng: accommodation?.longitude || cityCenter.lng,
        };
      } else if (shouldSelfCater('breakfast', dayNumber, budgetStrategy, hotelHasBreakfast, preferences.durationDays, isDayTrip, groceriesDone)) {
        // Petit-déjeuner self_catered (courses/cuisine au logement)
        const accommodationCoords = {
          lat: accommodation?.latitude || cityCenter.lat,
          lng: accommodation?.longitude || cityCenter.lng,
        };
        items.push(schedulerItemToTripItem(breakfastItem, dayNumber, orderIndex++, {
          title: 'Petit-déjeuner au logement',
          description: 'Courses au supermarché local | Repas préparé au logement',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodationCoords.lat,
          longitude: accommodationCoords.lng,
          estimatedCost: 7 * (preferences.groupSize || 1), // ~7€/pers
        }));
        lastCoords = accommodationCoords;
      } else {
        // Petit-déjeuner dans un restaurant externe
        const restaurant = await findRestaurantForMeal('breakfast', cityCenter, preferences, dayNumber, lastCoords);
        const restaurantCoords = {
          lat: restaurant?.latitude || cityCenter.lat,
          lng: restaurant?.longitude || cityCenter.lng,
        };
        const googleMapsUrl = generateGoogleMapsUrl(lastCoords, restaurantCoords, pickDirectionMode(lastCoords, restaurantCoords));
        const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
          getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);

        items.push(schedulerItemToTripItem(breakfastItem, dayNumber, orderIndex++, {
          title: restaurant?.name || 'Petit-déjeuner',
          description: restaurant ? `${restaurant.cuisineTypes.join(', ')} | ⭐ ${restaurant.rating?.toFixed(1)}/5` : 'Petit-déjeuner local',
          locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
          latitude: restaurantCoords.lat,
          longitude: restaurantCoords.lng,
          estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'breakfast') * preferences.groupSize,
          rating: restaurant?.rating,
          googleMapsUrl,
          googleMapsPlaceUrl: restaurantGoogleMapsUrl,
        }));
        lastCoords = restaurantCoords;
      }
    }
  }

  // Activites du matin - SEULEMENT si on est deja sur place (pas le jour 1)
  // Le jour 1, on arrive generalement l'apres-midi, donc pas d'activites matin
  const cursorHour = scheduler.getCurrentTime().getHours();
  const canDoMorningActivities = cursorHour < 12;

  // IMPORTANT: Utiliser le Set partagé au niveau du voyage pour éviter les doublons
  // tripUsedAttractionIds est passé en paramètre et partagé entre tous les jours

  if (canDoMorningActivities) {
    // Matin: itérer TOUTES les attractions dans l'ordre de Claude (visitOrder)
    // Le scheduler s'arrêtera naturellement au déjeuner, les restantes seront traitées l'après-midi

    for (const attraction of attractions) {
      // ANTI-DOUBLON: Skip si déjà utilisée (dans n'importe quel jour du voyage)
      if (tripUsedAttractionIds.has(attraction.id)) {
        console.log(`[Jour ${dayNumber}] Skip "${attraction.name}": déjà utilisée dans le voyage`);
        continue;
      }

      // LOCATION TRACKING: Vérifier que l'utilisateur est bien à destination
      // LOCATION TRACKING: Skip validation for day trips (attractions are in a different city by design)
      if (!isDayTrip) {
        const locationValidation = locationTracker.validateActivity({
          city: preferences.destination,
          name: attraction.name,
        });
        if (!locationValidation.valid) {
          console.log(`[LocationTracker] Skip "${attraction.name}": ${locationValidation.reason}`);
          continue;
        }
      }

      // Verifier qu'on a le temps avant le dejeuner (12:30)
      const lunchTime = parseTime(date, '12:30');
      if (scheduler.getCurrentTime().getTime() + 30 * 60 * 1000 + attraction.duration * 60 * 1000 > lunchTime.getTime()) {
        // CORRIGÉ: continue au lieu de break pour essayer les autres attractions (plus courtes)
        console.log(`[Jour ${dayNumber}] Skip matin "${attraction.name}": trop longue (${attraction.duration}min) avant déjeuner`);
        continue;
      }

    const travelTime = estimateTravelTime({ latitude: lastCoords.lat, longitude: lastCoords.lng } as any, attraction);
    const openTime = parseTime(date, attraction.openingHours.open);
    const closeTime = parseTime(date, attraction.openingHours.close);

    // MARGE DE SÉCURITÉ: On doit finir 30 min AVANT la fermeture (dernière entrée)
    const safeCloseTime = new Date(closeTime.getTime() - 30 * 60 * 1000);

    // Calculer l'heure de debut reelle
    let actualStartTime = new Date(scheduler.getCurrentTime().getTime() + travelTime * 60 * 1000);
    if (actualStartTime < openTime && openTime >= scheduler.getCurrentTime()) {
      actualStartTime = new Date(openTime);
    }

    // Verifier que le lieu sera encore ouvert quand on aura fini (avec marge de 30min)
    const potentialEndTime = new Date(actualStartTime.getTime() + attraction.duration * 60 * 1000);
    if (potentialEndTime > safeCloseTime) {
      console.log(`[Planning] Skip "${attraction.name}": ferme a ${formatScheduleTime(closeTime)} (dernière entrée ${formatScheduleTime(safeCloseTime)}), on finirait a ${formatScheduleTime(potentialEndTime)}`);
      continue;
    }

    // Budget check: skip if activity costs more than remaining budget
    const activityCost = (attraction.estimatedCost || 0) * (preferences.groupSize || 1);
    if (activityCost > 0 && budgetTracker && !budgetTracker.canAfford('activities', activityCost)) {
      console.log(`[Jour ${dayNumber}] Skip "${attraction.name}": coût ${activityCost}€ dépasse le budget restant`);
      continue;
    }

    const activityItem = scheduler.addItem({
      id: generateId(),
      title: attraction.name,
      type: 'activity',
      duration: attraction.duration,
      travelTime,
      minStartTime: openTime,
      data: { attraction },
    });

    if (activityItem) {
      // Track spending
      if (activityCost > 0 && budgetTracker) {
        budgetTracker.spend('activities', activityCost);
      }
      tripUsedAttractionIds.add(attraction.id); // ANTI-DOUBLON (trip-level)
      const attractionCoords = {
        lat: attraction.latitude || cityCenter.lat + (Math.random() - 0.5) * 0.02,
        lng: attraction.longitude || cityCenter.lng + (Math.random() - 0.5) * 0.02,
      };
      // Générer le lien Google Maps avec itinéraire depuis le point précédent
      const googleMapsUrl = generateGoogleMapsUrl(lastCoords, attractionCoords, pickDirectionMode(lastCoords, attractionCoords));
      items.push(schedulerItemToTripItem(activityItem, dayNumber, orderIndex++, {
        description: attraction.description,
        // IMPORTANT: locationName doit inclure le nom de l'attraction pour les liens d'itinéraire
        locationName: `${attraction.name}, ${preferences.destination}`,
        latitude: attractionCoords.lat,
        longitude: attractionCoords.lng,
        estimatedCost: attraction.estimatedCost * preferences.groupSize,
        rating: attraction.rating,
        bookingUrl: attraction.bookingUrl,
        timeFromPrevious: travelTime,
        googleMapsUrl,
        dataReliability: attraction.dataReliability || 'verified', // POI réel de SerpAPI
      }));
      lastCoords = attractionCoords;
    }
  }
  } // Fin du bloc canDoMorningActivities

  // === REMPLISSAGE DES TROUS AVANT LE DÉJEUNER ===
  // Si on a du temps libre avant le déjeuner (> 60min), essayer d'ajouter des attractions supplémentaires
  {
    const currentHourBeforeLunch = scheduler.getCurrentTime().getHours();
    const currentMinBeforeLunch = scheduler.getCurrentTime().getMinutes();
    const timeBeforeLunchMin = 12 * 60 + 30 - (currentHourBeforeLunch * 60 + currentMinBeforeLunch);

    if (timeBeforeLunchMin > 60) {
      console.log(`[Jour ${dayNumber}] ${Math.round(timeBeforeLunchMin / 60)}h de temps libre avant déjeuner - tentative de remplissage`);

      // Chercher des attractions pas encore utilisées DANS LA SÉLECTION DU JOUR (Claude)
      // On ne pioche PAS dans allAttractions pour ne pas diluer la curation de Claude
      const unusedAttractionsMorning = attractions.filter(a => !tripUsedAttractionIds.has(a.id));

      for (const attraction of unusedAttractionsMorning) {
        // Vérifier qu'on a le temps avant le déjeuner (12:30)
        const lunchTime = parseTime(date, '12:30');
        const estimatedTravelTimeMorning = estimateTravelTime({ latitude: lastCoords.lat, longitude: lastCoords.lng } as Attraction, attraction);
        const estimatedEndTimeMorning = new Date(scheduler.getCurrentTime().getTime() + (estimatedTravelTimeMorning + attraction.duration + 15) * 60 * 1000);

        if (estimatedEndTimeMorning > lunchTime) {
          // CORRIGÉ: continue au lieu de break pour essayer les autres attractions (plus courtes)
          console.log(`[Jour ${dayNumber}] Skip "${attraction.name}": trop longue (${attraction.duration}min) avant déjeuner`);
          continue;
        }

        // Vérifier les horaires d'ouverture
        const openTimeMorning = parseTime(date, attraction.openingHours.open);
        const closeTimeMorning = parseTime(date, attraction.openingHours.close);
        const safeCloseTimeMorning = new Date(closeTimeMorning.getTime() - 30 * 60 * 1000);

        let actualStartTimeMorning = new Date(scheduler.getCurrentTime().getTime() + estimatedTravelTimeMorning * 60 * 1000);
        if (actualStartTimeMorning < openTimeMorning) {
          actualStartTimeMorning = openTimeMorning;
        }

        const potentialEndTimeMorning = new Date(actualStartTimeMorning.getTime() + attraction.duration * 60 * 1000);
        if (potentialEndTimeMorning > safeCloseTimeMorning || potentialEndTimeMorning > lunchTime) {
          continue;
        }

        const activityItemMorning = scheduler.addItem({
          id: generateId(),
          title: attraction.name,
          type: 'activity',
          duration: attraction.duration,
          travelTime: estimatedTravelTimeMorning,
          minStartTime: openTimeMorning,
        });

        if (activityItemMorning) {
          tripUsedAttractionIds.add(attraction.id);
          const attractionCoordsMorning = {
            lat: attraction.latitude || cityCenter.lat,
            lng: attraction.longitude || cityCenter.lng,
          };
          const googleMapsUrlMorning = generateGoogleMapsUrl(lastCoords, attractionCoordsMorning, pickDirectionMode(lastCoords, attractionCoordsMorning));

          items.push(schedulerItemToTripItem(activityItemMorning, dayNumber, orderIndex++, {
            description: attraction.description,
            locationName: `${attraction.name}, ${preferences.destination}`,
            latitude: attractionCoordsMorning.lat,
            longitude: attractionCoordsMorning.lng,
            estimatedCost: attraction.estimatedCost * preferences.groupSize,
            rating: attraction.rating,
            bookingUrl: attraction.bookingUrl,
            timeFromPrevious: estimatedTravelTimeMorning,
            googleMapsUrl: googleMapsUrlMorning,
            dataReliability: attraction.dataReliability || 'verified',
          }));
          lastCoords = attractionCoordsMorning;
          console.log(`[Jour ${dayNumber}] Attraction matin supplémentaire ajoutée: ${attraction.name}`);
        }
      }
    }
  }

  // Dejeuner - TOUJOURS ajouter vers 12:30 pour les jours complets (pas jour 1, pas dernier jour court)
  // IMPORTANT: Ne pas dépendre du curseur actuel - le déjeuner est une pause obligatoire
  // Déjeuner sur tous les jours où on est à destination avant 12:30
  // Jour 1 avec ground transport: on arrive ~10-11h, donc déjeuner possible
  // Jour 1 avec vol: on arrive souvent l'après-midi, pas de déjeuner
  const isDay1WithEarlyArrival = isFirstDay && groundTransport && !outboundFlight;
  const shouldHaveLunch = (!isFirstDay || isDay1WithEarlyArrival) && endHour >= 14;
  const lunchTargetTime = parseTime(date, '12:30');

  if (shouldHaveLunch) {
    // Forcer l'ajout du déjeuner à 12:30, peu importe où en est le curseur
    const lunchItem = scheduler.insertFixedItem({
      id: generateId(),
      title: 'Déjeuner',
      type: 'restaurant',
      startTime: lunchTargetTime,
      endTime: new Date(lunchTargetTime.getTime() + 75 * 60 * 1000), // 1h15
    });
    if (lunchItem) {
      if (shouldSelfCater('lunch', dayNumber, budgetStrategy, false, preferences.durationDays, isDayTrip, groceriesDone)) {
        // Déjeuner self_catered : pique-nique ou repas au logement
        items.push(schedulerItemToTripItem(lunchItem, dayNumber, orderIndex++, {
          title: 'Déjeuner pique-nique / maison',
          description: 'Repas préparé avec les courses | Option économique',
          locationName: `Centre-ville, ${preferences.destination}`,
          latitude: lastCoords.lat,
          longitude: lastCoords.lng,
          estimatedCost: 8 * (preferences.groupSize || 1), // ~8€/pers
        }));
      } else {
        const restaurant = await findRestaurantForMeal('lunch', cityCenter, preferences, dayNumber, lastCoords);
        const restaurantCoords = {
          lat: restaurant?.latitude || cityCenter.lat,
          lng: restaurant?.longitude || cityCenter.lng,
        };
        const googleMapsUrl = generateGoogleMapsUrl(lastCoords, restaurantCoords, pickDirectionMode(lastCoords, restaurantCoords));
        const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
          getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);

        items.push(schedulerItemToTripItem(lunchItem, dayNumber, orderIndex++, {
          title: restaurant?.name || 'Déjeuner',
          description: restaurant ? `${restaurant.cuisineTypes.join(', ')} | ⭐ ${restaurant.rating?.toFixed(1)}/5` : 'Déjeuner local',
          locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
          latitude: restaurantCoords.lat,
          longitude: restaurantCoords.lng,
          estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'lunch') * preferences.groupSize,
          rating: restaurant?.rating,
          googleMapsUrl,
          googleMapsPlaceUrl: restaurantGoogleMapsUrl,
        }));
        lastCoords = restaurantCoords;
      }
      const lunchEndTime = new Date(lunchTargetTime.getTime() + 75 * 60 * 1000);
      scheduler.advanceTo(lunchEndTime);
      console.log(`[Jour ${dayNumber}] Déjeuner ajouté à ${lunchTargetTime.toLocaleTimeString('fr-FR')}, curseur avancé à ${lunchEndTime.toLocaleTimeString('fr-FR')}`);
    }
  }

  // Activités de l'après-midi
  // Re-sort remaining attractions by proximity to current position (after lunch, position may have changed)
  // This prevents geographic back-and-forth (e.g., going west, coming back to center for lunch, then west again)
  const afternoonAttractions = [...attractions].sort((a, b) => {
    // Already-used attractions will be skipped in the loop, no need to filter here
    const distA = calculateDistance(lastCoords.lat, lastCoords.lng, a.latitude || 0, a.longitude || 0);
    const distB = calculateDistance(lastCoords.lat, lastCoords.lng, b.latitude || 0, b.longitude || 0);
    return distA - distB;
  });

  for (const attraction of afternoonAttractions) {
    // ANTI-DOUBLON: Skip si déjà utilisée dans n'importe quel jour du voyage
    if (tripUsedAttractionIds.has(attraction.id)) {
      console.log(`[Jour ${dayNumber}] Skip "${attraction.name}": déjà utilisée dans le voyage`);
      continue;
    }

    // LOCATION TRACKING: Vérifier que l'utilisateur est bien à destination
    const locationValidation = locationTracker.validateActivity({
      city: preferences.destination,
      name: attraction.name,
    });
    if (!locationValidation.valid) {
      console.log(`[LocationTracker] Skip "${attraction.name}": ${locationValidation.reason}`);
      continue;
    }

    // Vérifier qu'on a le temps avant le dîner (19:30) ou la fin de journée
    const dinnerTime = parseTime(date, '19:30');
    const maxTime = endHour >= 20 ? dinnerTime : dayEnd;

    if (scheduler.getCurrentTime().getTime() + 30 * 60 * 1000 + attraction.duration * 60 * 1000 > maxTime.getTime()) {
      // CORRIGÉ: continue au lieu de break pour essayer les autres attractions (plus courtes)
      console.log(`[Jour ${dayNumber}] Skip "${attraction.name}": pas assez de temps (${attraction.duration}min)`);
      continue;
    }

    const travelTime = estimateTravelTime({ latitude: lastCoords.lat, longitude: lastCoords.lng } as any, attraction);
    const openTime = parseTime(date, attraction.openingHours.open);
    const closeTime = parseTime(date, attraction.openingHours.close);

    // MARGE DE SÉCURITÉ: On doit finir 30 min AVANT la fermeture (dernière entrée)
    const safeCloseTime = new Date(closeTime.getTime() - 30 * 60 * 1000);

    // Calculer l'heure de debut reelle (meme logique que le scheduler)
    let actualStartTime = new Date(scheduler.getCurrentTime().getTime() + travelTime * 60 * 1000);
    // Si on arrive avant l'ouverture, on attend
    if (actualStartTime < openTime && openTime >= scheduler.getCurrentTime()) {
      actualStartTime = new Date(openTime);
    }

    // Calculer l'heure de fin reelle
    const potentialEndTime = new Date(actualStartTime.getTime() + attraction.duration * 60 * 1000);

    // Vérifier que le lieu sera encore ouvert quand on aura fini (avec marge de 30min)
    if (potentialEndTime > safeCloseTime) {
      console.log(`[Planning] Skip "${attraction.name}": ferme a ${formatScheduleTime(closeTime)} (dernière entrée ${formatScheduleTime(safeCloseTime)}), on finirait a ${formatScheduleTime(potentialEndTime)}`);
      continue;
    }

    // Budget check: skip if activity costs more than remaining budget
    const activityCostPM = (attraction.estimatedCost || 0) * (preferences.groupSize || 1);
    if (activityCostPM > 0 && budgetTracker && !budgetTracker.canAfford('activities', activityCostPM)) {
      console.log(`[Jour ${dayNumber}] Skip "${attraction.name}": coût ${activityCostPM}€ dépasse le budget restant`);
      continue;
    }

    const activityItem = scheduler.addItem({
      id: generateId(),
      title: attraction.name,
      type: 'activity',
      duration: attraction.duration,
      travelTime,
      minStartTime: openTime,
      data: { attraction },
    });

    if (activityItem) {
      // Track spending
      if (activityCostPM > 0 && budgetTracker) {
        budgetTracker.spend('activities', activityCostPM);
      }
      tripUsedAttractionIds.add(attraction.id); // ANTI-DOUBLON (trip-level)
      const attractionCoords = {
        lat: attraction.latitude || cityCenter.lat + (Math.random() - 0.5) * 0.02,
        lng: attraction.longitude || cityCenter.lng + (Math.random() - 0.5) * 0.02,
      };
      // Générer le lien Google Maps avec itinéraire depuis le point précédent
      const googleMapsUrl = generateGoogleMapsUrl(lastCoords, attractionCoords, pickDirectionMode(lastCoords, attractionCoords));
      items.push(schedulerItemToTripItem(activityItem, dayNumber, orderIndex++, {
        description: attraction.description,
        // IMPORTANT: locationName doit inclure le nom de l'attraction pour les liens d'itinéraire
        locationName: `${attraction.name}, ${preferences.destination}`,
        latitude: attractionCoords.lat,
        longitude: attractionCoords.lng,
        estimatedCost: attraction.estimatedCost * preferences.groupSize,
        rating: attraction.rating,
        bookingUrl: attraction.bookingUrl,
        timeFromPrevious: travelTime,
        googleMapsUrl,
        dataReliability: attraction.dataReliability || 'verified', // POI réel de SerpAPI
      }));
      lastCoords = attractionCoords;
    }
  }

  // === REMPLISSAGE DES TROUS AVANT LE DÎNER ===
  // Si on a du temps libre avant le dîner (> 60min), essayer d'ajouter des attractions supplémentaires
  // Prendre des attractions qui n'ont pas encore été utilisées dans le voyage
  // CORRIGÉ: Seuil de 60min au lieu de 90min pour éviter les trous d'1h+
  const currentHourAfterAttractions = scheduler.getCurrentTime().getHours();
  const currentMinAfterAttractions = scheduler.getCurrentTime().getMinutes();
  const timeBeforeDinnerMin = 19 * 60 - (currentHourAfterAttractions * 60 + currentMinAfterAttractions);

  if (timeBeforeDinnerMin > 60) {
    console.log(`[Jour ${dayNumber}] ${Math.round(timeBeforeDinnerMin / 60)}h de temps libre avant dîner - tentative de remplissage avec attractions supplémentaires`);

    // Smart gap filling: use allAttractions but filter by proximity + diversity
    const dayTypes = new Set(attractions.filter(a => tripUsedAttractionIds.has(a.id)).map(a => a.type));
    const dayHasReligious = attractions.some(a => tripUsedAttractionIds.has(a.id) && /church|cathedral|basilica|chapel|mosque|synagogue|temple|shrine/i.test(a.name));

    // Compute centroid of day's placed attractions for proximity filter
    const placedAttractions = attractions.filter(a => tripUsedAttractionIds.has(a.id) && a.latitude && a.longitude);
    const centroid = placedAttractions.length > 0 ? {
      lat: placedAttractions.reduce((s, a) => s + a.latitude, 0) / placedAttractions.length,
      lng: placedAttractions.reduce((s, a) => s + a.longitude, 0) / placedAttractions.length,
    } : cityCenter;

    let gapFillAdded = 0;
    const MAX_GAP_FILL = 3; // Allow up to 3 gap-fill attractions to avoid large empty blocks
    const PROXIMITY_KM = 5; // 5km radius from day's centroid (covers most city neighborhoods)
    const unusedAttractions = allAttractions.filter(a => {
      if (tripUsedAttractionIds.has(a.id)) return false;
      // Proximity: within ~5km of day's centroid (or last placed coords)
      if (a.latitude && a.longitude) {
        const refPoint = lastCoords.lat !== cityCenter.lat ? lastCoords : centroid;
        const dlat = (a.latitude - refPoint.lat) * 111;
        const dlng = (a.longitude - refPoint.lng) * 111 * Math.cos(refPoint.lat * Math.PI / 180);
        if (Math.sqrt(dlat * dlat + dlng * dlng) > PROXIMITY_KM) return false;
      }
      // No religious if day already has one
      if (dayHasReligious && /church|cathedral|basilica|chapel|mosque|synagogue|temple|shrine/i.test(a.name)) return false;
      return true;
    });

    if (unusedAttractions.length > 0) {
      // Sort by distance to last coords (nearest first) for optimal gap filling
      unusedAttractions.sort((a, b) => {
        const distA = calculateDistance(lastCoords.lat, lastCoords.lng, a.latitude || 0, a.longitude || 0);
        const distB = calculateDistance(lastCoords.lat, lastCoords.lng, b.latitude || 0, b.longitude || 0);
        return distA - distB;
      });
      console.log(`[Jour ${dayNumber}] ${unusedAttractions.length} attractions non utilisées disponibles pour remplissage`);

      for (const attraction of unusedAttractions) {
        if (gapFillAdded >= MAX_GAP_FILL) break;
        // Vérifier qu'on a le temps avant le dîner (19:00)
        const dinnerTime = parseTime(date, '19:00');
        const estimatedTravelTime = estimateTravelTime({ latitude: lastCoords.lat, longitude: lastCoords.lng } as Attraction, attraction);
        const estimatedEndTime = new Date(scheduler.getCurrentTime().getTime() + (estimatedTravelTime + attraction.duration + 15) * 60 * 1000);

        if (estimatedEndTime > dinnerTime) {
          // CORRIGÉ: continue au lieu de break pour essayer les autres attractions (plus courtes)
          console.log(`[Jour ${dayNumber}] Skip "${attraction.name}": trop longue (${attraction.duration}min) avant dîner`);
          continue;
        }

        // Vérifier les horaires d'ouverture
        const openTime = parseTime(date, attraction.openingHours.open);
        const closeTime = parseTime(date, attraction.openingHours.close);
        const safeCloseTime = new Date(closeTime.getTime() - 30 * 60 * 1000);

        let actualStartTime = new Date(scheduler.getCurrentTime().getTime() + estimatedTravelTime * 60 * 1000);
        if (actualStartTime < openTime) {
          actualStartTime = openTime;
        }

        const potentialEndTime = new Date(actualStartTime.getTime() + attraction.duration * 60 * 1000);
        if (potentialEndTime > safeCloseTime) {
          console.log(`[Jour ${dayNumber}] Skip "${attraction.name}": ferme trop tôt`);
          continue;
        }

        // Budget check for gap-fill activities
        const gapFillCost = (attraction.estimatedCost || 0) * (preferences.groupSize || 1);
        if (gapFillCost > 0 && budgetTracker && !budgetTracker.canAfford('activities', gapFillCost)) {
          continue;
        }

        const activityItem = scheduler.addItem({
          id: generateId(),
          title: attraction.name,
          type: 'activity',
          duration: attraction.duration,
          travelTime: estimatedTravelTime,
          minStartTime: openTime,
        });

        if (activityItem) {
          gapFillAdded++;
          if (gapFillCost > 0 && budgetTracker) {
            budgetTracker.spend('activities', gapFillCost);
          }
          tripUsedAttractionIds.add(attraction.id);
          const attractionCoords = {
            lat: attraction.latitude || cityCenter.lat,
            lng: attraction.longitude || cityCenter.lng,
          };
          const googleMapsUrl = generateGoogleMapsUrl(lastCoords, attractionCoords, pickDirectionMode(lastCoords, attractionCoords));

          items.push(schedulerItemToTripItem(activityItem, dayNumber, orderIndex++, {
            description: attraction.description,
            locationName: `${attraction.name}, ${preferences.destination}`,
            latitude: attractionCoords.lat,
            longitude: attractionCoords.lng,
            estimatedCost: attraction.estimatedCost * preferences.groupSize,
            rating: attraction.rating,
            bookingUrl: attraction.bookingUrl,
            timeFromPrevious: estimatedTravelTime,
            googleMapsUrl,
            dataReliability: attraction.dataReliability || 'verified',
          }));
          lastCoords = attractionCoords;
          console.log(`[Jour ${dayNumber}] Attraction supplémentaire ajoutée: ${attraction.name}`);
        }
      }
    } else {
      console.log(`[Jour ${dayNumber}] Pas d'attractions supplémentaires disponibles - temps libre`);
    }
  }

  // Diner - TOUJOURS prévoir pour les jours intermédiaires si la journée finit assez tard
  const currentTimeForDinner = scheduler.getCurrentTime();
  const currentDinnerHour = currentTimeForDinner.getHours();

  // CORRECTION: On vérifie si la JOURNÉE doit avoir un dîner (endHour >= 20), pas si on est DÉJÀ à 19h
  // Cela évite le bug où le scheduler reste bloqué à 17h et ne propose jamais de dîner
  const daySupportsDinner = endHour >= 20; // Journée assez longue pour un dîner
  const canHaveDinner = scheduler.canFit(90, 15); // 90min diner + 15min trajet
  const shouldAddDinner = !isLastDay && daySupportsDinner && canHaveDinner;

  console.log(`[Jour ${dayNumber}] Check dîner: heure=${currentDinnerHour}h, endHour=${endHour}, daySupports=${daySupportsDinner}, canFit=${canHaveDinner}, isLastDay=${isLastDay}, shouldAdd=${shouldAddDinner}`);

  if (shouldAddDinner) {
    // Forcer le dîner à commencer à 19h minimum (pas avant, restaurants fermés + gens pas faim)
    const dinnerMinTime = parseTime(date, '19:00');
    const dinnerItem = scheduler.addItem({
      id: generateId(),
      title: 'Dîner',
      type: 'restaurant',
      duration: 90,
      travelTime: 15,
      minStartTime: dinnerMinTime, // FORCE 19h minimum
    });
    if (dinnerItem) {
      if (shouldSelfCater('dinner', dayNumber, budgetStrategy, false, preferences.durationDays, isDayTrip, groceriesDone)) {
        // Dîner self_catered : cuisine au logement
        const accommodationCoords = {
          lat: accommodation?.latitude || cityCenter.lat,
          lng: accommodation?.longitude || cityCenter.lng,
        };
        items.push(schedulerItemToTripItem(dinnerItem, dayNumber, orderIndex++, {
          title: 'Dîner au logement',
          description: 'Repas cuisiné au logement | Courses au supermarché local',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodationCoords.lat,
          longitude: accommodationCoords.lng,
          estimatedCost: 10 * (preferences.groupSize || 1), // ~10€/pers
        }));
        lastCoords = accommodationCoords;
      } else {
        const restaurant = await findRestaurantForMeal('dinner', cityCenter, preferences, dayNumber, lastCoords);
        const restaurantCoords = {
          lat: restaurant?.latitude || cityCenter.lat,
          lng: restaurant?.longitude || cityCenter.lng,
        };
        const googleMapsUrl = generateGoogleMapsUrl(lastCoords, restaurantCoords, pickDirectionMode(lastCoords, restaurantCoords));
        const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
          getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);

        items.push(schedulerItemToTripItem(dinnerItem, dayNumber, orderIndex++, {
          title: restaurant?.name || 'Dîner',
          description: restaurant ? `${restaurant.cuisineTypes.join(', ')} | ⭐ ${restaurant.rating?.toFixed(1)}/5` : 'Dîner local',
          locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
          latitude: restaurantCoords.lat,
          longitude: restaurantCoords.lng,
          estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'dinner') * preferences.groupSize,
          rating: restaurant?.rating,
          googleMapsUrl,
          googleMapsPlaceUrl: restaurantGoogleMapsUrl,
        }));
        lastCoords = restaurantCoords;
      }
    }
  }

  // === APRÈS LE DÎNER ===
  // On ne génère plus d'activités génériques après le dîner ("Promenade digestive", "Glace artisanale")
  // Sauf si l'utilisateur a explicitement demandé "nightlife" - dans ce cas on ajoute UNE activité nocturne
  const currentTimeAfterDinnerCheck = scheduler.getCurrentTime();
  const hoursAfterDinner = currentTimeAfterDinnerCheck.getHours();
  console.log(`[Jour ${dayNumber}] Après dîner: ${hoursAfterDinner}h, hasNightlife: ${hasNightlife}, isLastDay: ${isLastDay}`);

  // Activité nocturne UNIQUEMENT si nightlife demandé explicitement
  if (hasNightlife && !isLastDay && hoursAfterDinner >= 20 && hoursAfterDinner < 23) {
    const canFitNightlife = scheduler.canFit(90, 15);

    if (canFitNightlife) {
      console.log(`[Jour ${dayNumber}] Ajout d'une activité nocturne (nightlife explicitement demandé)`);
      // Note: Ces activités sont génériques mais acceptables car l'utilisateur a demandé "nightlife"
      // TODO: Remplacer par des vrais bars/clubs récupérés via SerpAPI
    }
  }

  // === DERNIER JOUR: LOGISTIQUE RETOUR ===
  if (isLastDay) {
    if (returnFlight) {
      const flightDeparture = new Date(returnFlight.departureTime);
      const flightArrival = new Date(returnFlight.arrivalTime);

      // Check-out hôtel (min entre 3h30 avant vol et 12h standard)
      const checkoutByFlight = new Date(flightDeparture.getTime() - 210 * 60 * 1000);
      const checkoutByStandard = parseTime(date, '12:00');
      const checkoutStart = checkoutByFlight < checkoutByStandard ? checkoutByFlight : checkoutByStandard;
      const checkoutEnd = new Date(checkoutStart.getTime() + 30 * 60 * 1000);
      const hotelNameCheckout = accommodation?.name || 'Hébergement';
      const checkoutItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `Check-out ${hotelNameCheckout}`,
        type: 'checkout',
        startTime: checkoutStart,
        endTime: checkoutEnd,
      });
      if (checkoutItem) {
        items.push(schedulerItemToTripItem(checkoutItem, dayNumber, orderIndex++, {
          description: 'Libérez votre hébergement.',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodation?.latitude || cityCenter.lat + 0.005,
          longitude: accommodation?.longitude || cityCenter.lng + 0.005,
        }));
      }

      // Transfert hôtel → aéroport (2h avant vol)
      const transferEnd = new Date(flightDeparture.getTime() - 120 * 60 * 1000);
      const transferStart = new Date(transferEnd.getTime() - 40 * 60 * 1000); // 40min de trajet par défaut
      const transferItem = scheduler.insertFixedItem({
        id: generateId(),
        title: 'Transfert Hôtel → Aéroport',
        type: 'transport',
        startTime: transferStart,
        endTime: transferEnd,
      });
      if (transferItem) {
        items.push(schedulerItemToTripItem(transferItem, dayNumber, orderIndex++, {
          description: preferences.carRental ? 'Rendez votre voiture.' : 'Taxi ou transports.',
          locationName: `Centre-ville → ${destAirport.name}`,
          latitude: destAirport.latitude,
          longitude: destAirport.longitude,
          estimatedCost: preferences.carRental ? 0 : 25 * Math.ceil(preferences.groupSize / 4),
        }));
      }

      // Vol retour
      // Utiliser les heures d'affichage si disponibles (heures locales de l'aéroport)
      const returnFlightStartTime = returnFlight.departureTimeDisplay || formatTime(flightDeparture);
      const returnFlightEndTime = returnFlight.arrivalTimeDisplay || formatTime(flightArrival);

      console.log(`[AI] Vol retour ${returnFlight.flightNumber}: ${returnFlightStartTime} - ${returnFlightEndTime}`);

      const flightItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `Vol ${returnFlight.flightNumber} → ${preferences.origin}`,
        type: 'flight',
        startTime: flightDeparture,
        endTime: flightArrival,
        data: { flight: returnFlight, displayTimes: { start: returnFlightStartTime, end: returnFlightEndTime } },
      });
      if (flightItem) {
        // Utiliser l'URL de réservation du vol (Google Flights) si disponible
        const tripEndDateReturn = new Date(tripStartDate);
        tripEndDateReturn.setDate(tripEndDateReturn.getDate() + preferences.durationDays - 1);
        const returnFlightBookingUrl = returnFlight.bookingUrl || generateFlightLink(
          { origin: destAirport.code, destination: originAirport.code },
          { date: formatDateForUrl(tripEndDateReturn), passengers: preferences.groupSize }
        );

        // Créer l'item mais avec les heures d'affichage correctes
        // Afficher le prix par personne ET le prix total (avec protections NaN)
        const returnFlightPrice = returnFlight.price || 0;
        const returnGroupSize = preferences.groupSize || 1;
        const returnPricePerPerson = returnFlight.pricePerPerson || (returnFlightPrice > 0 ? Math.round(returnFlightPrice / returnGroupSize) : 0);
        const returnPriceDisplay = returnGroupSize > 1 && returnPricePerPerson > 0
          ? `${returnPricePerPerson}€/pers (${returnFlightPrice}€ total)`
          : returnFlightPrice > 0 ? `${returnFlightPrice}€` : 'Prix non disponible';
        const tripItem = schedulerItemToTripItem(flightItem, dayNumber, orderIndex++, {
          description: `${returnFlight.flightNumber} | ${formatFlightDuration(returnFlight.duration)} | ${returnFlight.stops === 0 ? 'Direct' : `${returnFlight.stops} escale(s)`} | ${returnPriceDisplay}`,
          locationName: `${destAirport.code} → ${originAirport.code}`,
          latitude: (destAirport.latitude + originAirport.latitude) / 2,
          longitude: (destAirport.longitude + originAirport.longitude) / 2,
          estimatedCost: returnFlight.price,
          bookingUrl: returnFlightBookingUrl,
        });
        // Override les heures avec les heures locales de l'aéroport
        tripItem.startTime = returnFlightStartTime;
        const isReturnOvernightDisplay = returnFlightEndTime < returnFlightStartTime;
        tripItem.endTime = isReturnOvernightDisplay ? `${returnFlightEndTime} (+1j)` : returnFlightEndTime;
        items.push(tripItem);
      }

      if (!flightItem) {
        // Forcer l'ajout du vol retour même si le scheduler ne peut pas l'insérer
        console.warn(`[Jour ${dayNumber}] ⚠️ Vol retour ${returnFlight.flightNumber} non inséré par le scheduler, ajout forcé`);
        const returnFlightPrice = returnFlight.price || 0;
        const returnGroupSize = preferences.groupSize || 1;
        const returnPricePerPerson = returnFlight.pricePerPerson || (returnFlightPrice > 0 ? Math.round(returnFlightPrice / returnGroupSize) : 0);
        const returnPriceDisplay = returnGroupSize > 1 && returnPricePerPerson > 0
          ? `${returnPricePerPerson}€/pers (${returnFlightPrice}€ total)`
          : returnFlightPrice > 0 ? `${returnFlightPrice}€` : 'Prix non disponible';
        const tripEndDateReturn = new Date(tripStartDate);
        tripEndDateReturn.setDate(tripEndDateReturn.getDate() + preferences.durationDays - 1);
        const returnFlightBookingUrl = returnFlight.bookingUrl || generateFlightLink(
          { origin: destAirport.code, destination: originAirport.code },
          { date: formatDateForUrl(tripEndDateReturn), passengers: preferences.groupSize }
        );
        const isReturnOvernightDisplay = returnFlightEndTime < returnFlightStartTime;
        items.push({
          id: generateId(),
          type: 'flight' as TripItemType,
          title: `Vol ${returnFlight.flightNumber} → ${preferences.origin}`,
          description: `${returnFlight.flightNumber} | ${formatFlightDuration(returnFlight.duration)} | ${returnFlight.stops === 0 ? 'Direct' : `${returnFlight.stops} escale(s)`} | ${returnPriceDisplay}`,
          startTime: returnFlightStartTime,
          endTime: isReturnOvernightDisplay ? `${returnFlightEndTime} (+1j)` : returnFlightEndTime,
          duration: returnFlight.duration,
          locationName: `${destAirport.code} → ${originAirport.code}`,
          latitude: (destAirport.latitude + originAirport.latitude) / 2,
          longitude: (destAirport.longitude + originAirport.longitude) / 2,
          estimatedCost: returnFlight.price,
          bookingUrl: returnFlightBookingUrl,
          dayNumber,
          orderIndex: orderIndex++,
        });
      }

      // Récupération parking - UNIQUEMENT si le vol retour arrive le MÊME JOUR
      // Pour les vols overnight (arrivée lendemain), le parking serait récupéré le lendemain
      if (parking) {
        const returnDepDay = new Date(flightDeparture.getFullYear(), flightDeparture.getMonth(), flightDeparture.getDate());
        const returnArrDay = new Date(flightArrival.getFullYear(), flightArrival.getMonth(), flightArrival.getDate());
        const isReturnOvernight = returnArrDay.getTime() > returnDepDay.getTime();

        if (!isReturnOvernight) {
          // Vol retour normal: récupération du parking le même jour
          const parkingStart = new Date(flightArrival.getTime() + 30 * 60 * 1000);
          const parkingEnd = new Date(parkingStart.getTime() + 30 * 60 * 1000);
          const parkingItem = scheduler.insertFixedItem({
            id: generateId(),
            title: `Récupération véhicule: ${parking.name}`,
            type: 'parking',
            startTime: parkingStart,
            endTime: parkingEnd,
            data: { parking },
          });
          if (parkingItem) {
            items.push(schedulerItemToTripItem(parkingItem, dayNumber, orderIndex++, {
              description: 'Navette et récupération de votre véhicule.',
              locationName: parking.address,
              latitude: parking.latitude,
              longitude: parking.longitude,
            }));
          }
        } else {
          // Vol retour overnight: le parking sera récupéré le lendemain (pas dans ce voyage)
          console.log(`[Jour ${dayNumber}] Vol retour overnight - récupération parking le lendemain (hors voyage)`);
        }
      }

    } else if (groundTransport) {
      // Check-out
      const checkoutStart = parseTime(date, '10:00');
      const checkoutEnd = new Date(checkoutStart.getTime() + 30 * 60 * 1000);
      const hotelNameCheckoutGround = accommodation?.name || 'Hébergement';
      const checkoutItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `Check-out ${hotelNameCheckoutGround}`,
        type: 'checkout',
        startTime: checkoutStart,
        endTime: checkoutEnd,
      });
      if (checkoutItem) {
        items.push(schedulerItemToTripItem(checkoutItem, dayNumber, orderIndex++, {
          description: 'Libérez votre hébergement.',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodation?.latitude || cityCenter.lat + 0.005,
          longitude: accommodation?.longitude || cityCenter.lng + 0.005,
        }));
        // Update lastCoords to hotel position for post-checkout activities
        lastCoords = {
          lat: accommodation?.latitude || cityCenter.lat,
          lng: accommodation?.longitude || cityCenter.lng,
        };
      }

      // Transport retour
      const transportStart = parseTime(date, '14:00');
      const transportEnd = new Date(transportStart.getTime() + groundTransport.totalDuration * 60 * 1000);
      const modeIcons: Record<string, string> = { train: '🚄', bus: '🚌', car: '🚗', combined: '🔄' };
      const modeLabels: Record<string, string> = { train: 'Train', bus: 'Bus', car: 'Voiture', combined: 'Transport combiné' };

      const transportItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `${modeIcons[groundTransport.mode] || '🚊'} ${modeLabels[groundTransport.mode] || groundTransport.mode || 'Transport'} → ${preferences.origin}`,
        type: 'transport',
        startTime: transportStart,
        endTime: transportEnd,
        data: { transport: groundTransport },
      });
      if (transportItem) {
        // Generate return booking URL with correct direction and date
        // For combined transport, generate URL for the first bookable segment
        let returnBookingUrl = groundTransport.bookingUrl;
        if (groundTransport.mode === 'combined' && groundTransport.segments?.length) {
          // For combined, generate booking URL based on first segment mode
          const firstSeg = groundTransport.segments[0];
          if (firstSeg.mode === 'train') {
            returnBookingUrl = getTrainBookingUrl(preferences.destination, firstSeg.to || preferences.origin, preferences.groupSize, date);
          } else if (firstSeg.mode === 'ferry') {
            // Link to ferry operator if available
            const operator = firstSeg.operator?.toLowerCase() || '';
            if (operator.includes('corsica')) {
              returnBookingUrl = `https://www.corsica-linea.com/`;
            } else {
              returnBookingUrl = `https://www.directferries.fr/`;
            }
          }
        } else if (groundTransport.mode === 'train') {
          returnBookingUrl = getTrainBookingUrl(preferences.destination, preferences.origin, preferences.groupSize, date);
        } else if (groundTransport.mode === 'bus') {
          const dateStr = date ? date.toISOString().split('T')[0] : '';
          returnBookingUrl = `https://www.flixbus.fr/recherche?departureCity=${encodeURIComponent(preferences.destination)}&arrivalCity=${encodeURIComponent(preferences.origin)}${dateStr ? `&rideDate=${dateStr}` : ''}`;
        } else if (groundTransport.mode === 'car') {
          returnBookingUrl = `https://www.google.com/maps/dir/${encodeURIComponent(preferences.destination)}/${encodeURIComponent(preferences.origin)}`;
        }
        // Build detailed description with segments (like outbound)
        const returnSegmentsDesc = groundTransport.segments?.length
          ? groundTransport.segments.map(s => {
              const segMode = s.mode === 'train' ? '🚄' : s.mode === 'ferry' ? '⛴️' : s.mode === 'bus' ? '🚌' : s.mode === 'car' ? '🚗' : '🚊';
              const segOperator = s.operator ? ` (${s.operator})` : '';
              const segDuration = s.duration ? ` ${Math.floor(s.duration / 60)}h${s.duration % 60 > 0 ? String(s.duration % 60).padStart(2, '0') : ''}` : '';
              const segPrice = s.price ? ` ${s.price}€` : '';
              return `${segMode} ${s.to} → ${s.from}${segOperator}${segDuration}${segPrice}`;
            }).join(' puis ')
          : `${preferences.destination} → ${preferences.origin}`;
        const returnDescription = `${returnSegmentsDesc} | ${groundTransport.totalPrice}€ total`;

        items.push(schedulerItemToTripItem(transportItem, dayNumber, orderIndex++, {
          description: returnDescription,
          locationName: `${preferences.destination} → ${preferences.origin}`,
          latitude: cityCenter.lat,
          longitude: cityCenter.lng,
          estimatedCost: groundTransport.totalPrice,
          bookingUrl: returnBookingUrl,
        }));
      }
    }
  }

  // === CORRECTION AUTOMATIQUE DES CONFLITS ===
  // Étape 1: Pour le Jour 1 avec vol ALLER, supprimer toute activité non-logistique
  // Le jour 1 avec vol = uniquement logistique (trajet aéroport, parking, checkin, vol, transfert arrivée, hôtel)
  // Pas de restaurant ni d'activité car:
  // - On ne peut pas faire d'activités à destination AVANT d'y arriver
  // - On ne veut pas programmer d'activités à l'ORIGINE avant le départ
  if (isFirstDay && outboundFlight) {
    const flightDep = new Date(outboundFlight.departureTime);
    const flightArr = new Date(outboundFlight.arrivalTime);
    const depDay = new Date(flightDep.getFullYear(), flightDep.getMonth(), flightDep.getDate());
    const arrDay = new Date(flightArr.getFullYear(), flightArr.getMonth(), flightArr.getDate());
    const isOvernight = arrDay.getTime() > depDay.getTime();

    // Pour TOUS les vols du jour 1 (overnight ou pas), supprimer les items non-logistique
    // AVANT le trajet vers l'aéroport (on ne veut pas de restaurant à l'origine avant le départ)
    // Calculer l'heure de départ effective (trajet vers aéroport ou 2h avant vol)
    const airportArrivalTime = new Date(flightDep.getTime() - 2 * 60 * 60 * 1000); // 2h avant le vol

    // Supprimer tous les restaurants et activités du jour 1 qui sont AVANT le trajet vers l'aéroport
    // Garder uniquement: transport, parking, checkin, flight, hotel
    const protectedTypes = ['flight', 'transport', 'checkin', 'parking', 'hotel', 'checkout'];
    const allSchedulerItems = scheduler.getItems();
    let itemsRemoved = 0;

    for (const item of allSchedulerItems) {
      // Supprimer si c'est un restaurant ou une activité (pas de la logistique)
      if (!protectedTypes.includes(item.type)) {
        // Supprimer si AVANT le départ vers l'aéroport (on est encore à l'origine)
        if (item.slot.start < airportArrivalTime) {
          console.log(`[Jour ${dayNumber}] Suppression "${item.title}" (${formatScheduleTime(item.slot.start)}) - activité à l'origine avant départ aéroport`);
          itemsRemoved++;
        }
        // OU supprimer si APRÈS le vol mais AVANT l'arrivée réelle + transfert (impossible d'être là)
        else if (!isOvernight) {
          // Vol court: vérifier que l'item est APRÈS l'arrivée + transfert
          const minActivityTime = new Date(flightArr.getTime() + 90 * 60 * 1000); // arrivée + 1h30
          if (item.slot.start < minActivityTime) {
            console.log(`[Jour ${dayNumber}] Suppression "${item.title}" (${formatScheduleTime(item.slot.start)}) - avant arrivée à destination (${formatScheduleTime(minActivityTime)})`);
            itemsRemoved++;
          }
        }
      }
    }

    // Appliquer les suppressions via removeItemsBefore avec une heure très tardive pour les non-logistique
    // Alternative: utiliser la logique existante mais avec l'heure de départ vers l'aéroport
    if (!isOvernight) {
      const arrivalTime = new Date(outboundFlight.arrivalTime);
      const minActivityTime = new Date(arrivalTime.getTime() + 90 * 60 * 1000); // arrivée + 1h30
      const removed = scheduler.removeItemsBefore(minActivityTime, protectedTypes);
      if (removed > 0) {
        console.log(`[Jour ${dayNumber}] ${removed} item(s) supprimé(s) car planifiés avant l'arrivée effective à destination`);
      }
    } else {
      // Vol overnight: le jour 1 ne contient QUE la logistique de départ
      // Supprimer TOUT ce qui n'est pas logistique car on n'arrive que le lendemain
      const removed = scheduler.removeItemsBefore(new Date(dayEnd.getTime() + 24 * 60 * 60 * 1000), protectedTypes);
      if (removed > 0) {
        console.log(`[Jour ${dayNumber}] Vol overnight - ${removed} item(s) non-logistique supprimé(s)`);
      }
    }
  }

  // Étape 2: Supprimer les items en conflit (chevauchements)
  const conflictsRemoved = scheduler.removeConflicts();
  if (conflictsRemoved > 0) {
    console.log(`[Jour ${dayNumber}] ${conflictsRemoved} conflit(s) résolu(s) par suppression`);
  }

  // Validation finale (devrait être propre maintenant)
  const validation = scheduler.validate();
  if (!validation.valid) {
    console.error(`[Jour ${dayNumber}] CONFLITS RESTANTS (ne devrait pas arriver):`);
    validation.conflicts.forEach(c => console.error(`  - ${c.item1} vs ${c.item2}`));
  }

  // Debug
  scheduler.debug();

  // Reconstruire la liste des items à partir du scheduler (certains ont été supprimés)
  const validItemIds = new Set(scheduler.getItems().map(i => i.id));
  const filteredItems = items.filter(item => validItemIds.has(item.id));

  // Trier par heure de début
  const sortedItems = filteredItems.sort((a, b) => {
    const aTime = parseTime(date, a.startTime).getTime();
    const bTime = parseTime(date, b.startTime).getTime();
    return aTime - bTime;
  });

  return { items: sortedItems, lateFlightForNextDay };
}

/**
 * Convertit un ScheduleItem en TripItem
 *
 * IMPORTANT: Génère automatiquement googleMapsPlaceUrl par recherche de nom
 * pour éviter les problèmes de coordonnées GPS incorrectes (hallucinations).
 *
 * Google Maps trouvera automatiquement le vrai lieu par son nom.
 */
function schedulerItemToTripItem(
  item: import('./services/scheduler').ScheduleItem,
  dayNumber: number,
  orderIndex: number,
  extra: Partial<TripItem> & { dataReliability?: 'verified' | 'estimated' | 'generated' }
): TripItem {
  // Extraire le nom du lieu et la ville depuis les données disponibles
  const placeName = extra.title || item.title;
  // Extraire la ville depuis locationName (format: "Adresse, Ville" ou "Centre-ville, Barcelona")
  const locationParts = extra.locationName?.split(',') || [];
  const city = locationParts.length > 0 ? locationParts[locationParts.length - 1].trim() : undefined;

  // Générer l'URL de recherche Google Maps par nom (BEAUCOUP plus fiable que GPS!)
  // Au lieu de coordonnées potentiellement fausses, Google Maps cherche le vrai lieu
  const googleMapsPlaceUrl = generateGoogleMapsSearchUrl(placeName, city);

  // Déterminer la fiabilité des données:
  // - 'verified' si passé explicitement (données réelles de SerpAPI)
  // - 'estimated' si données partiellement vérifiées
  // - 'verified' par défaut pour les éléments de transport (vol, transfert, checkin, etc.)
  // - 'generated' pour les activités de remplissage
  const logisticsTypes = ['flight', 'transport', 'checkin', 'checkout', 'parking', 'hotel', 'luggage'];
  const isLogistics = logisticsTypes.includes(item.type);
  const reliability = extra.dataReliability || (isLogistics ? 'verified' : 'generated');

  return {
    id: item.id,
    dayNumber,
    startTime: formatScheduleTime(item.slot.start),
    endTime: formatScheduleTime(item.slot.end),
    type: item.type as TripItem['type'],
    title: item.title,
    orderIndex,
    timeFromPrevious: item.travelTimeFromPrevious,
    googleMapsPlaceUrl, // Lien fiable par nom (pas de GPS hallucié!)
    dataReliability: reliability as 'verified' | 'estimated' | 'generated',
    ...extra,
  } as TripItem;
}

// Track used restaurants to avoid repetition
const usedRestaurantIds = new Set<string>();

/**
 * Trouve un restaurant pour un repas (avec rotation pour éviter les répétitions)
 */
async function findRestaurantForMeal(
  mealType: 'breakfast' | 'lunch' | 'dinner',
  cityCenter: { lat: number; lng: number },
  preferences: TripPreferences,
  dayNumber: number = 1,
  lastCoords?: { lat: number; lng: number }
): Promise<import('./types').Restaurant | null> {
  try {
    // Utiliser lastCoords si disponible (position actuelle du voyageur), sinon cityCenter
    const searchLocation = lastCoords || cityCenter;

    // Demander plus de restaurants pour avoir du choix
    const restaurants = await searchRestaurants({
      latitude: searchLocation.lat,
      longitude: searchLocation.lng,
      mealType,
      dietary: preferences.dietary,
      priceLevel: getBudgetPriceLevel(preferences.budgetLevel),
      limit: 10, // Plus de choix
      destination: preferences.destination,
    });

    if (restaurants.length === 0) return null;

    // FILTRE CUISINE: Exclure les restaurants avec cuisine interdite (chinois à Barcelone, etc.)
    const { isForbiddenCuisine, getCountryFromDestination } = await import('./services/cuisineValidator');

    // Mots-clés à détecter dans le NOM ou DESCRIPTION du restaurant (en plus des cuisineTypes)
    const FORBIDDEN_NAME_KEYWORDS: Record<string, string[]> = {
      Spain: ['chinese', 'chinois', 'china', 'chino', 'wok', 'asia', 'asian', 'asiatique', 'asiatico', 'oriental', 'sushi', 'ramen', 'noodle', 'dim sum', 'thai', 'thaï', 'vietnam', 'viet', 'pho', 'indian', 'indien', 'curry', 'tandoori', 'kebab', 'döner', 'doner', 'korean', 'coreen', 'japonais', 'japanese', 'pekin', 'beijing', 'szechuan', 'cantonese', 'mandarin', 'hong kong'],
      Italy: ['chinese', 'chinois', 'china', 'chino', 'wok', 'asia', 'asian', 'asiatique', 'oriental', 'sushi', 'ramen', 'noodle', 'mexican', 'mexicain', 'tacos', 'burrito', 'tex-mex', 'indian', 'curry', 'kebab', 'döner'],
      France: ['american', 'burger king', 'mcdonald', 'kfc', 'subway', 'quick', 'five guys'],
      Portugal: ['chinese', 'chinois', 'china', 'wok', 'asia', 'asian', 'sushi', 'indian', 'curry', 'kebab', 'döner'],
      Greece: ['chinese', 'chinois', 'china', 'wok', 'asia', 'asian', 'sushi', 'indian', 'curry', 'mexican', 'kebab'],
    };

    const country = getCountryFromDestination(preferences.destination);
    const forbiddenKeywords = country ? (FORBIDDEN_NAME_KEYWORDS[country] || []) : [];

    const cuisineFilteredRestaurants = restaurants.filter(r => {
      // Vérifier les cuisineTypes
      const hasForbiddenCuisine = r.cuisineTypes?.some(cuisine =>
        isForbiddenCuisine(cuisine, preferences.destination)
      );

      // Vérifier le NOM du restaurant (souvent "Wok Palace", "China Town", etc.)
      const nameLower = r.name?.toLowerCase() || '';
      const descLower = (r.description || '').toLowerCase();
      const hasForbiddenName = forbiddenKeywords.some(keyword =>
        nameLower.includes(keyword) || descLower.includes(keyword)
      );

      if (hasForbiddenCuisine || hasForbiddenName) {
        console.log(`[Restaurants] EXCLU: "${r.name}" - cuisine non-locale (${r.cuisineTypes?.join(', ')})${hasForbiddenName ? ' [mot interdit détecté]' : ''}`);
        return false;
      }
      return true;
    });

    // Si tous ont été filtrés, utiliser la liste originale mais avec warning
    const filteredList = cuisineFilteredRestaurants.length > 0 ? cuisineFilteredRestaurants : restaurants;

    // Filtrer les restaurants déjà utilisés
    let availableRestaurants = filteredList.filter(r => !usedRestaurantIds.has(r.id));

    // Si tous ont été utilisés, try wider search before allowing repeats
    if (availableRestaurants.length === 0) {
      // Try expanding search radius (2km, then 3km)
      for (const expandedRadius of [2000, 3000]) {
        try {
          const widerResults = await searchRestaurants({
            latitude: searchLocation.lat,
            longitude: searchLocation.lng,
            mealType,
            dietary: preferences.dietary,
            priceLevel: getBudgetPriceLevel(preferences.budgetLevel),
            limit: 15,
            radius: expandedRadius,
            destination: preferences.destination,
          });
          const widerFiltered = widerResults.filter(r => !usedRestaurantIds.has(r.id));
          if (widerFiltered.length > 0) {
            availableRestaurants = widerFiltered;
            console.log(`[Restaurants] Rayon élargi à ${expandedRadius}m: ${widerFiltered.length} nouveaux restos`);
            break;
          }
        } catch {
          // ignore, fall through
        }
      }

      // Last resort: allow repeats
      if (availableRestaurants.length === 0) {
        console.warn(`[Restaurants] Pool épuisé même à 3km, autorisation de doublons`);
        availableRestaurants = filteredList;
      }
    }

    // Calculer un score pour chaque restaurant: note + proximité
    const scoredRestaurants = availableRestaurants.map(r => {
      let score = r.rating * 10; // Note sur 50

      // Bonus si proche du point précédent
      if (lastCoords) {
        const distFromPrevious = calculateDistance(
          lastCoords.lat, lastCoords.lng,
          r.latitude, r.longitude
        );
        // Moins c'est loin, plus le score est élevé (max +20 pour < 500m)
        score += Math.max(0, 20 - distFromPrevious * 20);
      }

      // Petit bonus aléatoire pour varier (0-5)
      score += Math.random() * 5;

      return { restaurant: r, score };
    });

    // Trier par score décroissant
    scoredRestaurants.sort((a, b) => b.score - a.score);

    // Prendre le meilleur
    const selected = scoredRestaurants[0]?.restaurant;

    if (selected) {
      usedRestaurantIds.add(selected.id);
    }

    return selected || null;
  } catch {
    return null;
  }
}

/**
 * @deprecated Utilisez generateDayWithScheduler à la place
 * Génère le programme d'une journée avec activités et repas
 * Inclut les temps de trajet réalistes entre les attractions
 */
async function generateDayProgram(
  context: DayContext,
  attractions: Attraction[],
  preferences: TripPreferences,
  startOrderIndex: number
): Promise<TripItem[]> {
  const items: TripItem[] = [];
  let orderIndex = startOrderIndex;
  let currentTime = new Date(context.availableFrom);
  let lastAttraction: Attraction | null = null;
  // Track the actual computed coordinates (not raw 0,0 from attractions)
  let lastComputedCoords: { lat: number; lng: number } | null = null;

  // Déterminer quels repas inclure
  const startHour = context.availableFrom.getHours();
  const endHour = context.availableUntil.getHours();

  const includeBreakfast = startHour <= 9;
  const includeLunch = startHour <= 12 && endHour >= 14;
  const includeDinner = endHour >= 20;

  // === PETIT-DÉJEUNER ===
  if (includeBreakfast) {
    const breakfast = await generateMealItem(
      context.dayNumber,
      '08:30',
      '09:30',
      'breakfast',
      context.cityCenter,
      preferences,
      orderIndex++
    );
    if (breakfast) {
      items.push(breakfast);
      currentTime = new Date(context.date);
      currentTime.setHours(9, 45, 0, 0); // +15min pour se déplacer
    }
  }

  // Séparer les attractions en matin/après-midi
  const morningAttractions: Attraction[] = [];
  const afternoonAttractions: Attraction[] = [];

  // Répartir équitablement les attractions
  attractions.forEach((a, i) => {
    if (i < Math.ceil(attractions.length / 2)) {
      morningAttractions.push(a);
    } else {
      afternoonAttractions.push(a);
    }
  });

  // === ACTIVITÉS DU MATIN ===
  const lunchStart = new Date(context.date);
  lunchStart.setHours(12, 30, 0, 0);

  for (const attraction of morningAttractions) {
    // Calculer les coordonnées réelles de cette attraction (avec fallback)
    const attractionCoords = {
      lat: attraction.latitude || context.cityCenter.lat + (Math.random() - 0.5) * 0.03,
      lng: attraction.longitude || context.cityCenter.lng + (Math.random() - 0.5) * 0.03,
    };

    // Calculer temps de trajet (estimation rapide)
    let travelTime = 20; // Par défaut
    let directions: DirectionsResult | undefined;
    let fromCoords: { lat: number; lng: number } | undefined;

    if (lastComputedCoords) {
      // Utiliser les coordonnées calculées, pas les coordonnées brutes (0,0)
      fromCoords = lastComputedCoords;
      travelTime = estimateTravelTime(lastAttraction!, attraction);

      // Essayer d'obtenir les directions détaillées (async, non-bloquant)
      try {
        directions = await getDirections({
          from: fromCoords,
          to: attractionCoords,
          mode: 'transit',
          departureTime: currentTime,
        });
        travelTime = directions.duration; // Utiliser le temps réel si disponible
      } catch {
        // Fallback silencieux sur l'estimation
      }
    }

    // Ajouter le temps de trajet
    currentTime = new Date(currentTime.getTime() + travelTime * 60 * 1000);

    // Vérifier si on a le temps avant le déjeuner
    const endTime = new Date(currentTime.getTime() + attraction.duration * 60 * 1000);
    if (endTime > lunchStart && includeLunch) break;

    // Vérifier les horaires d'ouverture
    const [openH, openM] = attraction.openingHours.open.split(':').map(Number);
    const openTime = new Date(context.date);
    openTime.setHours(openH, openM, 0, 0);

    if (currentTime < openTime) {
      currentTime = openTime;
    }

    items.push(createAttractionItem(
      context.dayNumber,
      formatTime(currentTime),
      formatTime(endTime),
      attraction,
      context.cityCenter,
      preferences,
      orderIndex++,
      lastComputedCoords ? { travelTime, directions, fromCoords } : undefined
    ));

    currentTime = endTime;
    lastAttraction = attraction;
    lastComputedCoords = attractionCoords; // Sauvegarder les vraies coordonnées
  }

  // === DÉJEUNER ===
  if (includeLunch) {
    const lunch = await generateMealItem(
      context.dayNumber,
      '12:45',
      '14:15',
      'lunch',
      context.cityCenter,
      preferences,
      orderIndex++
    );
    if (lunch) items.push(lunch);
    currentTime = new Date(context.date);
    currentTime.setHours(14, 30, 0, 0);
  }

  // === ACTIVITÉS DE L'APRÈS-MIDI ===
  const dinnerStart = new Date(context.date);
  dinnerStart.setHours(19, 30, 0, 0);

  for (const attraction of afternoonAttractions) {
    // Calculer les coordonnées réelles de cette attraction (avec fallback)
    const attractionCoords = {
      lat: attraction.latitude || context.cityCenter.lat + (Math.random() - 0.5) * 0.03,
      lng: attraction.longitude || context.cityCenter.lng + (Math.random() - 0.5) * 0.03,
    };

    // Calculer temps de trajet (estimation rapide)
    let travelTime = 25;
    let directions: DirectionsResult | undefined;
    let fromCoords: { lat: number; lng: number } | undefined;

    if (lastComputedCoords) {
      // Utiliser les coordonnées calculées, pas les coordonnées brutes (0,0)
      fromCoords = lastComputedCoords;
      travelTime = estimateTravelTime(lastAttraction!, attraction);

      // Essayer d'obtenir les directions détaillées
      try {
        directions = await getDirections({
          from: fromCoords,
          to: attractionCoords,
          mode: 'transit',
          departureTime: currentTime,
        });
        travelTime = directions.duration;
      } catch {
        // Fallback silencieux
      }
    }

    currentTime = new Date(currentTime.getTime() + travelTime * 60 * 1000);

    // Vérifier si on a le temps avant le dîner
    const endTime = new Date(currentTime.getTime() + attraction.duration * 60 * 1000);
    const maxEnd = includeDinner ? dinnerStart : context.availableUntil;
    if (endTime > maxEnd) break;

    // Vérifier les horaires d'ouverture
    const [openH, openM] = attraction.openingHours.open.split(':').map(Number);
    const [closeH, closeM] = attraction.openingHours.close.split(':').map(Number);
    const openTime = new Date(context.date);
    openTime.setHours(openH, openM, 0, 0);
    const closeTime = new Date(context.date);
    closeTime.setHours(closeH, closeM, 0, 0);

    if (currentTime < openTime) {
      currentTime = openTime;
    }
    if (endTime > closeTime) continue; // Skip si fermé

    items.push(createAttractionItem(
      context.dayNumber,
      formatTime(currentTime),
      formatTime(endTime),
      attraction,
      context.cityCenter,
      preferences,
      orderIndex++,
      lastComputedCoords ? { travelTime, directions, fromCoords } : undefined
    ));

    currentTime = endTime;
    lastAttraction = attraction;
    lastComputedCoords = attractionCoords; // Sauvegarder les vraies coordonnées
  }

  // === DÎNER ===
  if (includeDinner) {
    const dinner = await generateMealItem(
      context.dayNumber,
      '20:00',
      '21:30',
      'dinner',
      context.cityCenter,
      preferences,
      orderIndex++
    );
    if (dinner) items.push(dinner);
  }

  return items;
}

/**
 * Crée un item d'attraction avec temps de trajet et infos Google Maps
 */
function createAttractionItem(
  dayNumber: number,
  startTime: string,
  endTime: string,
  attraction: Attraction,
  cityCenter: { lat: number; lng: number },
  preferences: TripPreferences,
  orderIndex: number,
  travelInfo?: {
    travelTime: number;
    directions?: DirectionsResult;
    fromCoords?: { lat: number; lng: number };
  }
): TripItem {
  const attractionCoords = {
    lat: attraction.latitude || cityCenter.lat + (Math.random() - 0.5) * 0.03,
    lng: attraction.longitude || cityCenter.lng + (Math.random() - 0.5) * 0.03,
  };

  // Générer le lien Google Maps si on a les coordonnées d'origine
  let googleMapsUrl: string | undefined;
  if (travelInfo?.fromCoords) {
    googleMapsUrl = generateGoogleMapsUrl(
      travelInfo.fromCoords,
      attractionCoords,
      pickDirectionMode(travelInfo.fromCoords, attractionCoords)
    );
  }

  // Extraire les infos de transit si disponibles
  const transitInfo = travelInfo?.directions ? {
    lines: travelInfo.directions.transitLines.map(line => ({
      number: line.number,
      mode: line.mode,
      color: line.color,
    })),
    walkingDistance: travelInfo.directions.steps
      .filter(s => s.mode === 'walk')
      .reduce((sum, s) => sum + s.distance, 0),
    steps: travelInfo.directions.steps
      .filter(s => s.instruction)
      .map(s => s.instruction),
    source: travelInfo.directions.source,
  } : undefined;

  return {
    id: generateId(),
    dayNumber,
    startTime,
    endTime,
    type: 'activity',
    title: attraction.name,
    description: attraction.description + (attraction.tips ? ` | ${attraction.tips}` : ''),
    locationName: `${preferences.destination}`,
    latitude: attractionCoords.lat,
    longitude: attractionCoords.lng,
    orderIndex,
    estimatedCost: attraction.estimatedCost * preferences.groupSize,
    rating: attraction.rating,
    bookingUrl: attraction.bookingUrl,
    timeFromPrevious: travelInfo?.travelTime,
    distanceFromPrevious: travelInfo?.directions?.distance,
    transportToPrevious: travelInfo?.travelTime && travelInfo.travelTime > 20 ? 'public' : 'walk',
    transitInfo,
    googleMapsUrl,
    dataReliability: attraction.dataReliability || 'verified', // POI réel de SerpAPI
  };
}

/**
 * Génère un item de repas
 */
async function generateMealItem(
  dayNumber: number,
  startTime: string,
  endTime: string,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  cityCenter: { lat: number; lng: number },
  preferences: TripPreferences,
  orderIndex: number
): Promise<TripItem | null> {
  const restaurants = await searchRestaurants({
    latitude: cityCenter.lat,
    longitude: cityCenter.lng,
    mealType,
    dietary: preferences.dietary,
    priceLevel: getBudgetPriceLevel(preferences.budgetLevel),
    limit: 5,
    destination: preferences.destination, // Pour la recherche AI
  });

  const restaurant = selectBestRestaurant(restaurants, {
    dietary: preferences.dietary,
    maxDistance: 1.5,
    preferHighRating: true,
    destination: preferences.destination, // RÈGLE 4: scoring cuisine locale
  });

  if (!restaurant) return null;

  const mealLabels = {
    breakfast: 'Petit-déjeuner',
    lunch: 'Déjeuner',
    dinner: 'Dîner',
  };

  return {
    id: generateId(),
    dayNumber,
    startTime,
    endTime,
    type: 'restaurant',
    title: restaurant.name,
    description: `${mealLabels[mealType]} | ${restaurant.cuisineTypes.join(', ')} | Note: ${restaurant.rating.toFixed(1)}/5 | ${formatPriceLevel(restaurant.priceLevel)}`,
    locationName: restaurant.address,
    latitude: restaurant.latitude,
    longitude: restaurant.longitude,
    orderIndex,
    estimatedCost: estimateMealPrice(restaurant.priceLevel, mealType) * preferences.groupSize,
    rating: restaurant.rating,
    restaurant,
    distanceFromPrevious: restaurant.distance,
    timeFromPrevious: restaurant.walkingTime,
    transportToPrevious: 'walk',
  };
}

/**
 * Ajoute la logistique de départ (parking, vol, transfert)
 */
function addDepartureLogistics(
  items: TripItem[],
  dayNumber: number,
  outboundFlight: Flight,
  originAirport: AirportInfo,
  destAirport: AirportInfo,
  parking: ParkingOption | null,
  preferences: TripPreferences,
  cityCenter: { lat: number; lng: number }
): number {
  let orderIndex = 0;

  const flightDepartureTime = new Date(outboundFlight.departureTime);
  const flightArrivalTime = new Date(outboundFlight.arrivalTime);
  const airportArrivalTime = new Date(flightDepartureTime.getTime() - 2 * 60 * 60 * 1000);

  // Parking
  if (parking) {
    const parkingTime = calculateParkingTime(parking);
    const parkingArrivalTime = new Date(airportArrivalTime.getTime() - parkingTime * 60 * 1000);

    items.push({
      id: generateId(),
      dayNumber,
      startTime: formatTime(parkingArrivalTime),
      endTime: formatTime(airportArrivalTime),
      type: 'parking',
      title: `Parking: ${parking.name}`,
      description: `Garez votre voiture. Prix: ${parking.totalPrice}€ pour ${preferences.durationDays} jours.`,
      locationName: parking.address,
      latitude: parking.latitude,
      longitude: parking.longitude,
      orderIndex: orderIndex++,
      estimatedCost: parking.totalPrice,
      parking,
    });
  }

  // Enregistrement
  items.push({
    id: generateId(),
    dayNumber,
    startTime: formatTime(airportArrivalTime),
    endTime: formatTime(new Date(flightDepartureTime.getTime() - 30 * 60 * 1000)),
    type: 'checkin',
    title: 'Enregistrement & Sécurité',
    description: `Arrivez 2h avant. Terminal: ${originAirport.name}`,
    locationName: originAirport.name,
    latitude: originAirport.latitude,
    longitude: originAirport.longitude,
    orderIndex: orderIndex++,
  });

  // Vol aller
  // Utiliser les heures d'affichage si disponibles (heures locales de l'aéroport, sans conversion timezone)
  // Sinon fallback sur formatTime qui peut avoir des problèmes de timezone
  const flightStartTime = outboundFlight.departureTimeDisplay || formatTime(flightDepartureTime);
  const flightEndTime = outboundFlight.arrivalTimeDisplay || formatTime(flightArrivalTime);

  console.log(`[AI] Vol ${outboundFlight.flightNumber}: ${flightStartTime} - ${flightEndTime} (display times: ${outboundFlight.departureTimeDisplay || 'N/A'} - ${outboundFlight.arrivalTimeDisplay || 'N/A'})`);

  // Afficher le prix par personne et total comme dans l'autre section (avec protections NaN)
  const fallbackFlightPrice = outboundFlight.price || 0;
  const fallbackGroupSize = preferences.groupSize || 1;
  const pricePerPerson = outboundFlight.pricePerPerson || (fallbackFlightPrice > 0 ? Math.round(fallbackFlightPrice / fallbackGroupSize) : 0);
  const priceDisplay = fallbackGroupSize > 1 && pricePerPerson > 0
    ? `${pricePerPerson}€/pers (${fallbackFlightPrice}€ total)`
    : fallbackFlightPrice > 0 ? `${fallbackFlightPrice}€` : 'Prix non disponible';

  items.push({
    id: generateId(),
    dayNumber,
    startTime: flightStartTime,
    endTime: flightEndTime,
    type: 'flight',
    title: `Vol ${outboundFlight.flightNumber} → ${preferences.destination}`,
    description: `${outboundFlight.flightNumber} | ${formatFlightDuration(outboundFlight.duration)} | ${outboundFlight.stops === 0 ? 'Direct' : `${outboundFlight.stops} escale(s)`} | ${priceDisplay}`,
    locationName: `${originAirport.code} → ${destAirport.code}`,
    latitude: (originAirport.latitude + destAirport.latitude) / 2,
    longitude: (originAirport.longitude + destAirport.longitude) / 2,
    orderIndex: orderIndex++,
    estimatedCost: outboundFlight.price,
    flight: outboundFlight,
    bookingUrl: outboundFlight.bookingUrl,
  });

  // Transfert aéroport → hôtel
  const transferDuration = 40;
  const hotelArrivalTime = new Date(flightArrivalTime.getTime() + (transferDuration + 30) * 60 * 1000);

  items.push({
    id: generateId(),
    dayNumber,
    startTime: formatTime(new Date(flightArrivalTime.getTime() + 30 * 60 * 1000)),
    endTime: formatTime(hotelArrivalTime),
    type: 'transport',
    title: 'Transfert Aéroport → Hôtel',
    description: preferences.carRental
      ? 'Récupérez votre voiture de location.'
      : 'Taxi ou transports en commun vers l\'hébergement.',
    locationName: `${destAirport.name} → Centre-ville`,
    latitude: cityCenter.lat,
    longitude: cityCenter.lng,
    orderIndex: orderIndex++,
    estimatedCost: preferences.carRental ? 0 : 25 * Math.ceil(preferences.groupSize / 4),
    duration: transferDuration,
  });

  // Check-in hôtel - IMPORTANT: ne pas programmer avant 14h (heure minimum standard)
  // Heure de check-in minimum: 14h (la plupart des hôtels)
  const minCheckInTime = new Date(flightArrivalTime);
  minCheckInTime.setHours(14, 0, 0, 0);

  // Le check-in commence au plus tôt à 14h, ou après l'arrivée si on arrive plus tard
  const actualCheckInStart = hotelArrivalTime > minCheckInTime ? hotelArrivalTime : minCheckInTime;
  const checkInEnd = new Date(actualCheckInStart.getTime() + 20 * 60 * 1000);

  items.push({
    id: generateId(),
    dayNumber,
    startTime: formatTime(actualCheckInStart),
    endTime: formatTime(checkInEnd),
    type: 'hotel',
    title: 'Check-in Hébergement',
    description: 'Déposez vos affaires et installez-vous.',
    locationName: `Hébergement, ${preferences.destination}`,
    latitude: cityCenter.lat + 0.005,
    longitude: cityCenter.lng + 0.005,
    orderIndex: orderIndex++,
  });

  return orderIndex;
}

// ============================================
// Fonctions utilitaires
// ============================================

function formatDate(date: Date): string {
  // IMPORTANT: Utiliser getFullYear/Month/Date pour la date LOCALE
  // et non toISOString() qui convertit en UTC et peut décaler d'un jour
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatPriceLevel(level: 1 | 2 | 3 | 4): string {
  return '€'.repeat(level);
}

/**
 * Retourne le locationName pour un hôtel
 * Si l'adresse est disponible et valide, l'utiliser
 * Sinon, utiliser "Nom de l'hôtel, Ville" pour que Google Maps trouve le lieu
 */
function getHotelLocationName(
  accommodation: { name?: string; address?: string } | null,
  destination: string
): string {
  // Si l'adresse existe et n'est pas le placeholder "Adresse non disponible"
  if (accommodation?.address &&
      !accommodation.address.toLowerCase().includes('non disponible') &&
      !accommodation.address.toLowerCase().includes('not available')) {
    return accommodation.address;
  }

  // Sinon utiliser le nom de l'hôtel + ville pour que Google Maps trouve
  if (accommodation?.name) {
    return `${accommodation.name}, ${destination}`;
  }

  // Fallback ultime
  return `Hébergement, ${destination}`;
}

function getBudgetCabinClass(budgetLevel?: BudgetLevel): 'economy' | 'premium_economy' | 'business' | 'first' {
  switch (budgetLevel) {
    case 'luxury': return 'business';
    case 'comfort': return 'premium_economy';
    default: return 'economy';
  }
}

/**
 * Génère un lien Google Maps fiable pour un restaurant
 * Priorité: googleMapsUrl existante > place_id > nom + ville (plus fiable que nom + adresse incomplète)
 */
function getReliableGoogleMapsPlaceUrl(
  restaurant: { name: string; address?: string; googleMapsUrl?: string } | null,
  destination: string,
): string | undefined {
  if (!restaurant) return undefined;
  // Utiliser l'URL existante si disponible (souvent de SerpAPI avec place_id)
  if (restaurant.googleMapsUrl) return restaurant.googleMapsUrl;
  // Construire une URL fiable: nom + ville est plus fiable que nom + adresse partielle
  const hasRealAddress = restaurant.address && !restaurant.address.includes('non disponible');
  const searchQuery = hasRealAddress
    ? `${restaurant.name}, ${restaurant.address}`
    : `${restaurant.name}, ${destination}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;
}

function getBudgetPriceLevel(budgetLevel?: BudgetLevel): 1 | 2 | 3 | 4 {
  switch (budgetLevel) {
    case 'economic': return 1;
    case 'moderate': return 2;
    case 'comfort': return 3;
    case 'luxury': return 4;
    default: return 2;
  }
}

function selectFlightByBudget(flights: Flight[], budgetLevel?: BudgetLevel, flightType: 'outbound' | 'return' = 'outbound'): Flight | null {
  if (flights.length === 0) return null;

  // ÉTAPE 1: Filtrer les vols avec une durée excessive
  // Trouver la durée minimale parmi tous les vols
  const minDuration = Math.min(...flights.map(f => f.duration || Infinity));
  const MAX_DURATION_RATIO = 3; // Max 3x la durée du vol le plus court
  const maxAcceptableDuration = minDuration * MAX_DURATION_RATIO;

  // Filtrer les vols trop longs (sauf si ça élimine tout)
  let filteredFlights = flights.filter(f => (f.duration || 0) <= maxAcceptableDuration);
  if (filteredFlights.length === 0) {
    // Si tous les vols sont trop longs, garder les originaux
    filteredFlights = flights;
    console.warn(`⚠️ Tous les vols dépassent ${MAX_DURATION_RATIO}x la durée minimale (${minDuration}min)`);
  } else if (filteredFlights.length < flights.length) {
    const excluded = flights.length - filteredFlights.length;
    console.log(`✂️ ${excluded} vol(s) exclu(s) car durée > ${maxAcceptableDuration}min (${MAX_DURATION_RATIO}x le vol le plus court de ${minDuration}min)`);
  }

  // Calculer le score de chaque vol
  // - Vol retour: pénalité pour départs très tôt le matin
  // - Vol aller: pénalité pour arrivées tardives (après 22h) qui gaspillent le Jour 1
  const scoredFlights = filteredFlights.map(flight => {
    // Extraire l'heure d'arrivée au format HH:MM pour le scoring
    let arrivalTimeForScoring: string | undefined;
    if (flight.arrivalTimeDisplay) {
      arrivalTimeForScoring = flight.arrivalTimeDisplay;
    } else if (flight.arrivalTime) {
      // Extraire HH:MM de la date ISO
      const arrivalDate = new Date(flight.arrivalTime);
      if (!isNaN(arrivalDate.getTime())) {
        arrivalTimeForScoring = `${arrivalDate.getHours().toString().padStart(2, '0')}:${arrivalDate.getMinutes().toString().padStart(2, '0')}`;
      }
    }

    const timeScore = calculateFlightScore({
      id: flight.flightNumber || 'unknown',
      departureTime: flight.departureTimeDisplay || new Date(flight.departureTime).toTimeString().substring(0, 5),
      arrivalTime: arrivalTimeForScoring,
      type: flightType,
      price: flight.price,
    });

    // Combiner avec le prix selon le budget
    let priceWeight = 0.5; // Par défaut équilibré
    switch (budgetLevel) {
      case 'economic': priceWeight = 0.8; break;  // Prix très important
      case 'moderate': priceWeight = 0.5; break;  // Équilibré
      case 'comfort': priceWeight = 0.3; break;   // Confort plus important
      case 'luxury': priceWeight = 0.1; break;    // Prix quasi ignoré
    }

    // Normaliser le prix (0-100, où 100 = le moins cher)
    const maxPrice = Math.max(...filteredFlights.map(f => f.price));
    const minPrice = Math.min(...filteredFlights.map(f => f.price));
    const priceRange = maxPrice - minPrice || 1;
    const priceScore = 100 - ((flight.price - minPrice) / priceRange) * 100;

    // Pénalité par escale (-15 points par escale, bonus +10 pour direct)
    // Vol direct: +10, 1 escale: -15, 2 escales: -30, etc.
    const stopsPenalty = flight.stops === 0 ? 10 : -(flight.stops * 15);

    // Pénalité pour durée excessive (au-delà de 2x le vol le plus court)
    let durationPenalty = 0;
    if (flight.duration && minDuration > 0) {
      const durationRatio = flight.duration / minDuration;
      if (durationRatio > 2) {
        // -10 points par tranche de 50% au-delà de 2x
        durationPenalty = -Math.floor((durationRatio - 2) * 20);
      }
    }

    // Score final combiné
    const finalScore = (timeScore * (1 - priceWeight)) + (priceScore * priceWeight) + stopsPenalty + durationPenalty;

    return { flight, timeScore, priceScore, finalScore };
  });

  // Trier par score final décroissant
  scoredFlights.sort((a, b) => b.finalScore - a.finalScore);

  // Log pour debug
  if (flightType === 'return') {
    const best = scoredFlights[0];
    const hour = parseInt(best.flight.departureTime.split(':')[0]);
    if (hour < 8) {
      console.warn(`⚠️ Vol retour sélectionné à ${best.flight.departureTime} - pénalité appliquée (score: ${best.timeScore.toFixed(0)})`);
    }
  }

  return scoredFlights[0].flight;
}

function calculateCostBreakdown(
  days: TripDay[],
  outboundFlight: Flight | null,
  returnFlight: Flight | null,
  parking: ParkingOption | null,
  preferences: TripPreferences,
  accommodation?: Accommodation | null,
): { flights: number; accommodation: number; food: number; activities: number; transport: number; parking: number; other: number } {
  // Utiliser le VRAI prix de l'hébergement sélectionné si disponible
  const nightlyRate = accommodation?.pricePerNight || getAccommodationCost(preferences.budgetLevel);
  const breakdown = {
    flights: (outboundFlight?.price || 0) + (returnFlight?.price || 0),
    accommodation: (preferences.durationDays - 1) * nightlyRate, // -1 car dernière nuit pas dormie
    food: 0,
    activities: 0,
    transport: 0,
    parking: parking?.totalPrice || 0,
    other: 0,
  };

  for (const day of days) {
    for (const item of day.items) {
      if (!item.estimatedCost) continue;

      switch (item.type) {
        case 'restaurant':
          breakdown.food += item.estimatedCost;
          break;
        case 'activity':
          breakdown.activities += item.estimatedCost;
          break;
        case 'transport':
          breakdown.transport += item.estimatedCost;
          break;
        case 'luggage':
          // Consigne à bagages → catégorie "other"
          breakdown.other += item.estimatedCost;
          break;
        case 'hotel':
          // Le coût hébergement est déjà compté via accommodation.totalPrice dans le breakdown
          // Ne pas re-ajouter les items hôtel individuels pour éviter le double-comptage
          break;
        case 'flight':
        case 'parking':
        case 'checkin':
        case 'checkout':
          // Déjà comptés via flights/accommodation/parking dans le breakdown principal
          break;
        default:
          // Tout autre type non prévu → other
          if (item.estimatedCost > 0) {
            breakdown.other += item.estimatedCost;
          }
          break;
      }
    }
  }

  return breakdown;
}

function getAccommodationCost(budgetLevel?: BudgetLevel): number {
  switch (budgetLevel) {
    case 'economic': return 60;
    case 'moderate': return 100;
    case 'comfort': return 180;
    case 'luxury': return 350;
    default: return 100;
  }
}

export { generateTripWithAI as generateTripMock };
