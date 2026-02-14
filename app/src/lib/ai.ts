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
  Restaurant,
} from './types';
import { findNearbyAirports, findNearbyAirportsAsync, calculateDistance, AirportInfo, getCityCenterCoords, getCityCenterCoordsAsync, geocodeAddress, clearGeocodeCache } from './services/geocoding';
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
import { generateFlightLink, generateFlightOmioLink, generateHotelLink, formatDateForUrl } from './services/linkGenerator';
import { searchAttractionsMultiQuery, searchMustSeeAttractions, searchGroceryStores, parseSimpleOpeningHours, type GroceryStore } from './services/serpApiPlaces';
import { resolveAttractionByName } from './services/overpassAttractions';
import { resolveCoordinates, resetResolutionStats, getResolutionStats } from './services/coordsResolver';
import { generateClaudeItinerary, summarizeAttractions, mapItineraryToAttractions, areNamesSimilar } from './services/claudeItinerary';
import { generateTravelTips } from './services/travelTips';
import { resolveBudget, generateBudgetStrategy } from './services/budgetResolver';
import { searchAirbnbListings, isAirbnbApiConfigured } from './services/airbnb';
import { BudgetTracker } from './services/budgetTracker';
import { enrichRestaurantsWithGemini, geocodeWithGemini, resetGeminiGeocodeCounter } from './services/geminiSearch';
import { findViatorProduct, searchViatorActivities, isViatorConfigured } from './services/viator';
import { findKnownViatorProduct } from './services/viatorKnownProducts';
import { isImpactConfigured, createTrackingLinks } from './services/impactTracking';
import { getMustSeeAttractions } from './services/attractions';

import { generateId, normalizeToLocalDate, formatDate, formatTime, formatPriceLevel, pickDirectionMode, getAccommodationBookingUrl, getHotelLocationName, getBudgetCabinClass, getBudgetPriceLevel, getReliableGoogleMapsPlaceUrl } from './tripUtils';
import { findBestFlights, selectFlightByBudget, LateFlightArrivalData } from './tripFlights';
import { fixAttractionDuration, fixAttractionCost, estimateTotalAvailableTime, preAllocateAttractions } from './tripAttractions';
import { shouldSelfCater, findRestaurantForMeal, usedRestaurantIds } from './tripMeals';
import { generateDayWithScheduler, getDayContext, TimeSlot, DayContext } from './tripDay';

/**
 * Vérifie si des coordonnées sont proches du centre-ville (fallback non résolu)
 */
function isCoordsNearCenter(lat: number, lng: number, center: {lat: number, lng: number}, thresholdKm = 0.3): boolean {
  const dLat = (lat - center.lat) * 111;
  const dLng = (lng - center.lng) * 111 * Math.cos(center.lat * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng) < thresholdKm;
}

/**
 * Nettoie un nom d'attraction pour améliorer le géocodage
 * Supprime les préfixes génériques qui perturbent Nominatim
 */
function cleanNameForGeocoding(name: string): string {
  return name
    .replace(/^(cours de|visite de|tour de|balade|promenade|excursion|atelier|dégustation)\s+/i, '')
    .replace(/^(cooking class|food tour|walking tour|guided tour|wine tasting)\s+/i, '')
    .trim();
}

/**
 * Génère un voyage complet avec toute la logistique
 */
export async function generateTripWithAI(preferences: TripPreferences): Promise<Trip> {
  const T0 = Date.now();
  // RESET: Nettoyer les trackers de la session précédente pour éviter les doublons inter-voyages
  usedRestaurantIds.clear();
  clearGeocodeCache();
  resetGeminiGeocodeCounter();

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

  if (destCityCenter) {
    // Using city center coords
  } else {
    console.warn(`[AI] ⚠ Coords via fallback aéroport pour "${preferences.destination}"`);
  }

  // 2. Comparer les options de transport (lancé en parallèle avec attractions + hôtels)
  // Calculer la date de retour pour les liens de réservation
  const tripReturnDate = new Date(preferences.startDate);
  tripReturnDate.setDate(tripReturnDate.getDate() + preferences.durationDays - 1);

  const transportPromise = compareTransportOptions({
    origin: preferences.origin,
    originCoords,
    destination: preferences.destination,
    destCoords,
    date: new Date(preferences.startDate),
    returnDate: tripReturnDate,
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
  // Résoudre le budget et générer la stratégie
  const resolvedBudget = resolveBudget(preferences);

  const budgetStrategyPromise = generateBudgetStrategy(
    resolvedBudget,
    preferences.destination,
    preferences.durationDays,
    preferences.groupSize,
    preferences.activities,
    preferences.mealPreference,
  );

  // Lancer attractions + hôtels en parallèle avec le transport
  const attractionsPromise = searchAttractionsMultiQuery(
    preferences.destination,
    destCoords,
    { types: preferences.activities, activities: preferences.activities, limit: preferences.durationDays >= 5 ? 80 : 50 }
  );

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
  const travelTipsPromise = generateTravelTips(
    preferences.origin,
    preferences.destination,
    startDate,
    preferences.durationDays,
  );

  // Lancer must-see + Viator en parallèle (ne dépendent que de destCoords + preferences)
  const mustSeePromise = preferences.mustSee?.trim()
    ? searchMustSeeAttractions(preferences.mustSee, preferences.destination, destCoords)
    : Promise.resolve([] as Attraction[]);

  const viatorMixPromise = isViatorConfigured()
    ? searchViatorActivities(preferences.destination, destCoords, {
        types: preferences.activities,
        limit: 20,
      }).catch((error: unknown) => { console.warn('[AI] Viator mixing error (non bloquant):', error); return [] as Attraction[]; })
    : Promise.resolve([] as Attraction[]);

  // Attendre les 7 en parallèle (inclut stratégie budget + must-see + Viator)
  const [transportOptions, attractionPoolRaw, accommodationOptions, travelTipsData, budgetStrategy, mustSeeAttractions, viatorActivitiesRaw] = await Promise.all([
    transportPromise,
    attractionsPromise,
    hotelsPromise,
    travelTipsPromise,
    budgetStrategyPromise,
    mustSeePromise,
    viatorMixPromise,
  ]);

  // Si la stratégie recommande Airbnb, lancer une recherche en parallèle
  let airbnbOptions: Accommodation[] = [];
  if (budgetStrategy.accommodationType.includes('airbnb') && isAirbnbApiConfigured()) {
    // API Airbnb disponible → recherche directe
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
    } catch (error) {
      console.warn('[AI] Recherche Airbnb échouée, fallback hôtels:', error);
    }
  } else if (budgetStrategy.accommodationType.includes('airbnb') && !isAirbnbApiConfigured()) {
    // Pas d'API Airbnb → filtrer les appartements/flats dans les résultats hôtel existants
    const apartmentKeywords = /\b(apartment|flat|appart|résidence|studio|loft|suite.*kitchen|self.?catering)\b/i;
    const apartmentResults = accommodationOptions.filter(h =>
      apartmentKeywords.test(h.name) || apartmentKeywords.test(h.description || '') ||
      (h.amenities && h.amenities.some((a: string) => /kitchen|cuisine|kitchenette/i.test(a)))
    );
    if (apartmentResults.length > 0) {
      // Prioriser les apartments en les mettant en premier
      airbnbOptions = apartmentResults;
    } else {
      // Ne PAS générer de fallback Airbnb - les résultats Booking.com ont déjà des liens directs
      // airbnbOptions reste vide
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
    priceRange: opt.priceRange,
  }));

  // Sélectionner la meilleure option (ou celle choisie par l'utilisateur via preferences.transport)
  let selectedTransport = transportOptions.find(t => t.recommended) || transportOptions[0];

  // Si l'utilisateur a spécifié un mode de transport (pas 'optimal'), RESPECTER son choix
  if (preferences.transport && preferences.transport !== 'optimal') {
    const userPreferred = transportOptions.find(t => t.mode === preferences.transport);
    if (userPreferred) {
      selectedTransport = userPreferred;
    } else {
      console.warn(`Mode de transport "${preferences.transport}" demandé mais non disponible pour cette destination`);
      console.warn(`Options disponibles: ${transportOptions.map(t => t.mode).join(', ')}`);
    }
  } else {
    // Mode optimal: best option selected automatically
  }

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

    }
  }

  // 4a. Validation: si transport avion mais pas de vol retour trouvé
  if ((selectedTransport?.mode === 'plane' || selectedTransport?.mode === 'combined') && !returnFlight) {
    console.error('[AI] ⚠️ CRITICAL: Transport is plane/combined but no return flight found!');
  }

  // 4b. Initialiser le tracker de localisation pour la cohérence géographique
  // CRITIQUE: Empêche les activités à Barcelona avant d'avoir atterri
  const locationTracker = createLocationTracker(preferences.origin, preferences.origin);

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

  // Injection des mustSee (déjà récupérés en parallèle ci-dessus)
  const mustSeeNames = new Set<string>();
  if (mustSeeAttractions.length > 0) {
    const poolNames = new Set(attractionPool.map(a => a.name.toLowerCase()));
    for (const msAttr of mustSeeAttractions) {
      // Marquer comme mustSee pour garantir l'inclusion
      msAttr.mustSee = true;
      mustSeeNames.add(msAttr.name.toLowerCase());
      if (!poolNames.has(msAttr.name.toLowerCase())) {
        attractionPool.unshift(msAttr);
        poolNames.add(msAttr.name.toLowerCase());
      } else {
        // Marquer l'attraction existante dans le pool comme mustSee
        const existing = attractionPool.find(a => a.name.toLowerCase() === msAttr.name.toLowerCase());
        if (existing) existing.mustSee = true;
      }
    }
  }

  // TOUJOURS injecter les must-see curés (Rijksmuseum, etc.) même si SerpAPI les a manqués
  const curatedMustSee = getMustSeeAttractions(preferences.destination);
  if (curatedMustSee.length > 0) {
    const poolNames = new Set(attractionPool.map(a => a.name.toLowerCase()));
    let injectedCount = 0;
    for (const curated of curatedMustSee) {
      if (!poolNames.has(curated.name.toLowerCase())) {
        attractionPool.unshift(curated); // Ajouter en tête pour priorité
        poolNames.add(curated.name.toLowerCase());
        injectedCount++;
      }
    }
    if (injectedCount > 0) {
    }
  }

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

  // Mixer avec des activités Viator originales (déjà récupérées en parallèle ci-dessus)
  if (viatorActivitiesRaw.length > 0) {
    // Filtrer par prix max selon budget
    const maxActivityPrice = budgetStrategy.maxPricePerActivity || 100;
    const viatorPriceFiltered = viatorActivitiesRaw.filter(v => {
      if (v.estimatedCost && v.estimatedCost > maxActivityPrice) {
        return false;
      }
      return true;
    });

    // Filtrer les doublons (même nom qu'une attraction SerpAPI)
    const existingNames = new Set(attractionPool.map(a => a.name.toLowerCase()));
    const uniqueViator = viatorPriceFiltered.filter(v => {
      const vName = v.name.toLowerCase();
      return !existingNames.has(vName) &&
        ![...existingNames].some(n => n.includes(vName) || vName.includes(n));
    });

    // Prioriser : food tours, outdoor, experiences (pas culture/musées déjà couverts par SerpAPI)
    const experientialTypes = new Set(['gastronomy', 'adventure', 'nature', 'nightlife', 'wellness', 'beach']);
    const experiential = uniqueViator.filter(v => experientialTypes.has(v.type));
    const others = uniqueViator.filter(v => !experientialTypes.has(v.type));

    // Ajouter ~3 activités Viator par jour (boost si gastro/adventure/nightlife/wellness/beach)
    const experientialBoost = preferences.activities.some(a =>
      ['gastronomy', 'adventure', 'nightlife', 'wellness', 'beach'].includes(a)) ? 4 : 0;
    const viatorCap = Math.min(preferences.durationDays * 3 + experientialBoost, 15);
    const viatorToAdd = [...experiential, ...others].slice(0, viatorCap);

    if (viatorToAdd.length > 0) {
      attractionPool.push(...viatorToAdd);
    }
  }

  // === Enrichissement pré-Claude : remplacer les estimations SerpAPI par des données Viator vérifiées ===
  {
    let enrichedCount = 0;
    for (const attraction of attractionPool) {
      // Ne pas toucher les attractions déjà vérifiées (Viator API, curated)
      if (attraction.dataReliability === 'verified') continue;

      // 1. Chercher dans viatorActivitiesRaw (données API Viator, déjà en mémoire)
      const viatorMatch = viatorActivitiesRaw.find(v => areNamesSimilar(attraction.name, v.name));
      if (viatorMatch) {
        if (viatorMatch.duration && viatorMatch.duration > 0) {
          attraction.duration = viatorMatch.duration;
        }
        if (viatorMatch.estimatedCost && viatorMatch.estimatedCost > 0) {
          attraction.estimatedCost = viatorMatch.estimatedCost;
        }
        attraction.dataReliability = 'verified';
        attraction.providerName = attraction.providerName || 'Viator';
        enrichedCount++;
        continue;
      }

      // 2. Chercher dans viatorKnownProducts (base statique, lookup instant)
      const knownMatch = findKnownViatorProduct(attraction.name);
      if (knownMatch) {
        if (knownMatch.duration && knownMatch.duration > 0) {
          attraction.duration = knownMatch.duration;
        }
        if (knownMatch.price && knownMatch.price > 0) {
          attraction.estimatedCost = knownMatch.price;
        }
        attraction.dataReliability = 'verified';
        enrichedCount++;
        continue;
      }

      // 3. Sinon : garder les estimations SerpAPI (fallback)
      // dataReliability reste 'estimated' ou 'generated'
    }
    const totalNonViator = attractionPool.filter(a => a.providerName !== 'Viator').length;
  }

  const selectedAttractions = attractionPool;

  // Protection finale: s'assurer que groupSize est valide pour eviter NaN
  if (!preferences.groupSize || preferences.groupSize < 1) {
    console.warn('[AI] groupSize invalide, utilisation de 1 par defaut');
    preferences.groupSize = 1;
  }

  // Étape 2: Claude organise l'itinéraire intelligemment
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
      dailyActivityBudget: budgetStrategy.dailyActivityBudget,
      maxPricePerActivity: budgetStrategy.maxPricePerActivity,
    });
  } catch (error) {
    console.error('[AI] Claude curation error:', error);
  }

  if (claudeItinerary) {

    // Stocker les métadonnées par jour
    dayMetadata = claudeItinerary.days.map(d => ({
      theme: d.theme,
      dayNarrative: d.dayNarrative,
      isDayTrip: d.isDayTrip,
      dayTripDestination: d.dayTripDestination || undefined,
    }));

    // PARALLELIZED: Resolve all additional suggestions across all days at once

    // Step 1: Pre-resolve all day trip destination centers in parallel (AVANT mapping pour filtrer)
    const dayTripDestinations = claudeItinerary.days
      .filter(d => d.isDayTrip && d.dayTripDestination)
      .map(d => d.dayTripDestination!);
    const uniqueDayTripDests = [...new Set(dayTripDestinations)];
    const dayTripCenterMap = new Map<string, { lat: number; lng: number }>();

    if (uniqueDayTripDests.length > 0) {
      const dtResults = await Promise.allSettled(
        uniqueDayTripDests.map(dest => getCityCenterCoordsAsync(dest))
      );
      uniqueDayTripDests.forEach((dest, idx) => {
        const result = dtResults[idx];
        if (result.status === 'fulfilled' && result.value) {
          dayTripCenterMap.set(dest, result.value);
        }
      });
    }

    // Mapper APRÈS résolution des day trip centers pour filtrer les attractions hors zone
    attractionsByDay = mapItineraryToAttractions(claudeItinerary, attractionPool, cityCenter, dayTripCenterMap);

    // Step 2: Collect all suggestions into a flat list for parallel resolution
    const suggestionTasks: Array<{
      dayIndex: number;
      genIndex: number;
      suggestionName: string;
      suggestionArea?: string;
      isDayTrip: boolean;
      dayTripDestination?: string;
      geoContext: string;
      geoCenter: { lat: number; lng: number } | undefined;
      dayTripCenter: { lat: number; lng: number } | undefined;
    }> = [];

    for (let i = 0; i < claudeItinerary.days.length; i++) {
      const day = claudeItinerary.days[i];
      const geoContext = day.isDayTrip && day.dayTripDestination ? day.dayTripDestination : preferences.destination;
      const geoCenter = day.isDayTrip && day.dayTripDestination ? undefined : cityCenter;
      const dayTripCenter = day.isDayTrip && day.dayTripDestination
        ? dayTripCenterMap.get(day.dayTripDestination) : undefined;

      for (const suggestion of day.additionalSuggestions) {
        const genIndex = attractionsByDay[i].findIndex(a => a.id.startsWith('claude-') && a.name === suggestion.name);
        if (genIndex < 0) continue;
        suggestionTasks.push({
          dayIndex: i, genIndex, suggestionName: suggestion.name,
          suggestionArea: suggestion.area || undefined,
          isDayTrip: !!(day.isDayTrip && day.dayTripDestination),
          dayTripDestination: day.dayTripDestination || undefined,
          geoContext, geoCenter, dayTripCenter,
        });
      }
    }


    // Step 3: Resolve all suggestions in parallel (each with sequential fallback chain)
    // Fallback order: Travel Places (free) → Nominatim (free) → SerpAPI (paid, last resort)
    await Promise.allSettled(suggestionTasks.map(async (task) => {
      const { dayIndex, genIndex, suggestionName, suggestionArea, isDayTrip, dayTripDestination, geoContext, geoCenter, dayTripCenter } = task;

      // Clean name for better geocoding (strip generic prefixes like "Cours de", "Food tour")
      const cleanedName = cleanNameForGeocoding(suggestionName);
      // Build geocoding query: use area if available for precision
      const geoQuery = suggestionArea
        ? `${cleanedName}, ${suggestionArea}, ${geoContext}`
        : `${cleanedName}, ${geoContext}`;

      // For day trips, try Nominatim first (better for named places outside city center radius)
      if (isDayTrip && dayTripDestination) {
        try {
          const dayTripQuery = suggestionArea
            ? `${cleanedName}, ${suggestionArea}, ${dayTripDestination}`
            : `${cleanedName}, ${dayTripDestination}`;
          const geo = await geocodeAddress(dayTripQuery);
          if (geo && geo.lat && geo.lng) {
            attractionsByDay[dayIndex][genIndex] = {
              ...attractionsByDay[dayIndex][genIndex],
              latitude: geo.lat, longitude: geo.lng,
              mustSee: true, dataReliability: 'verified',
              googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(suggestionName + ', ' + dayTripDestination)}`,
            };
            return;
          }
        } catch (e) {
          console.warn(`[AI]   Nominatim day trip error for "${suggestionName}":`, e);
        }
      }

      // Fallback 1: Travel Places API (free, via RapidAPI)
      const resolved = await resolveAttractionByName(cleanedName, dayTripCenter || geoCenter || cityCenter);
      if (resolved) {
        attractionsByDay[dayIndex][genIndex] = {
          ...attractionsByDay[dayIndex][genIndex],
          latitude: resolved.lat, longitude: resolved.lng,
          name: resolved.name || suggestionName,
          mustSee: true, dataReliability: 'verified',
        };
        return;
      }

      // Fallback 2: Nominatim geocoding (free, reliable for named places)
      try {
        const geo = await geocodeAddress(geoQuery);
        if (geo && geo.lat && geo.lng) {
          attractionsByDay[dayIndex][genIndex] = {
            ...attractionsByDay[dayIndex][genIndex],
            latitude: geo.lat, longitude: geo.lng,
            mustSee: true, dataReliability: 'verified',
            googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(suggestionName + ', ' + geoContext)}`,
          };
          return;
        }
      } catch (e) {
        console.warn(`[AI]   Nominatim error for "${suggestionName}":`, e);
      }

      // Fallback 3: Gemini 2.5 Flash + Google Search grounding (free, good for well-known places)
      try {
        const geminiGeo = await geocodeWithGemini(suggestionName, geoContext);
        if (geminiGeo && geminiGeo.lat && geminiGeo.lng) {
          attractionsByDay[dayIndex][genIndex] = {
            ...attractionsByDay[dayIndex][genIndex],
            latitude: geminiGeo.lat, longitude: geminiGeo.lng,
            mustSee: true, dataReliability: 'verified' as const,
            googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(suggestionName + ', ' + geoContext)}`,
          };
          return;
        }
      } catch (e) {
        console.warn(`[AI]   Gemini geocode error for "${suggestionName}":`, e);
      }

      // Fallback 4: SerpAPI (paid, last resort — only if free APIs failed)
      const found = await searchMustSeeAttractions(suggestionName, geoContext, geoCenter || cityCenter);
      if (found.length > 0) {
        attractionsByDay[dayIndex][genIndex] = { ...found[0], mustSee: true };
        return;
      }
    }));


    // === Enrichissement post-Claude : remplacer les defaults (60min, 0€) par des données Viator vérifiées ===
    {
      let suggestionEnriched = 0;
      let suggestionTotal = 0;
      for (const dayAttrs of attractionsByDay) {
        for (const attr of dayAttrs) {
          // Uniquement les suggestions Claude (pas les attractions du pool, déjà enrichies)
          if (!attr.id.startsWith('claude-')) continue;
          suggestionTotal++;

          // 1. Chercher dans viatorActivitiesRaw (données API Viator)
          const viatorMatch = viatorActivitiesRaw.find(v => areNamesSimilar(attr.name, v.name));
          if (viatorMatch) {
            if (viatorMatch.duration && viatorMatch.duration > 0) {
              attr.duration = viatorMatch.duration;
            }
            if (viatorMatch.estimatedCost && viatorMatch.estimatedCost > 0) {
              attr.estimatedCost = viatorMatch.estimatedCost;
            }
            attr.providerName = attr.providerName || 'Viator';
            suggestionEnriched++;
            continue;
          }

          // 2. Chercher dans viatorKnownProducts (base statique)
          const knownMatch = findKnownViatorProduct(attr.name);
          if (knownMatch) {
            if (knownMatch.duration && knownMatch.duration > 0) {
              attr.duration = knownMatch.duration;
            }
            if (knownMatch.price && knownMatch.price > 0) {
              attr.estimatedCost = knownMatch.price;
            }
            suggestionEnriched++;
            continue;
          }

          // 3. Pas de match Viator → garder les defaults (60min, 0€) + applyDurationRules déjà appliqué
        }
      }
    }

    // Post-enrichment check: mark items still at city center as estimated
    for (const dayAttrs of attractionsByDay) {
      for (const attr of dayAttrs) {
        if (attr.dataReliability === 'generated' &&
            isCoordsNearCenter(attr.latitude, attr.longitude, cityCenter)) {
          attr.dataReliability = 'estimated';
          console.warn(`[AI] UNRESOLVED coords: "${attr.name}" still at city center`);
        }
      }
    }

    // 100% GPS: Resolve any attraction still at (0,0) or city center via exhaustive API chain
    // NO jitter, NO random offsets — resolve or replace
    for (let i = 0; i < attractionsByDay.length; i++) {
      const day = claudeItinerary.days[i];
      const isDayTripDay = day?.isDayTrip && day?.dayTripDestination;
      const geoContextCity = isDayTripDay ? day.dayTripDestination! : preferences.destination;

      // Use pre-resolved day trip center (already in dayTripCenterMap)
      const fallbackCenter = isDayTripDay
        ? (dayTripCenterMap.get(day.dayTripDestination!) || cityCenter)
        : cityCenter;

      const dayAttrs = attractionsByDay[i];
      for (let j = dayAttrs.length - 1; j >= 0; j--) {
        const a = dayAttrs[j];
        const needsResolution = (a.latitude === 0 && a.longitude === 0)
          || (a.id.startsWith('claude-') && calculateDistance(a.latitude, a.longitude, fallbackCenter.lat, fallbackCenter.lng) < 0.05)
          || (a.dataReliability !== 'verified' && isCoordsNearCenter(a.latitude, a.longitude, fallbackCenter));

        if (needsResolution) {
          const resolved = await resolveCoordinates(a.name, geoContextCity, fallbackCenter, 'attraction');
          if (resolved) {
            // Propager les horaires d'ouverture réels si disponibles
            let resolvedOpeningHours = a.openingHours;
            if (resolved.operatingHours) {
              const parsedHours = parseSimpleOpeningHours(resolved.operatingHours);
              if (parsedHours) {
                resolvedOpeningHours = parsedHours;
              }
            }
            dayAttrs[j] = {
              ...a,
              latitude: resolved.lat,
              longitude: resolved.lng,
              dataReliability: 'verified' as const,
              openingHours: resolvedOpeningHours,
            };
          } else {
            // REMPLACEMENT: trouver une alternative vérifiée dans le pool
            const replacement = selectedAttractions.find(pool =>
              pool.latitude && pool.longitude &&
              pool.dataReliability === 'verified' &&
              !dayAttrs.some(existing => existing.id === pool.id) &&
              calculateDistance(pool.latitude, pool.longitude, fallbackCenter.lat, fallbackCenter.lng) < 30
            );
            if (replacement) {
              console.warn(`[AI] 🔄 REPLACED: "${a.name}" → "${replacement.name}" (coords non trouvables)`);
              dayAttrs[j] = { ...replacement, mustSee: a.mustSee };
            } else {
              // Dernier recours: supprimer plutôt que mentir
              console.error(`[AI] ❌ REMOVED: "${a.name}" — aucune coordonnée trouvable, aucun remplacement`);
              dayAttrs.splice(j, 1);
            }
          }
        }
        // Ensure all attractions have a Google Maps URL
        if (dayAttrs[j] && !dayAttrs[j].googleMapsUrl && dayAttrs[j].id?.startsWith('claude-')) {
          dayAttrs[j] = {
            ...dayAttrs[j],
            googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dayAttrs[j].name + ', ' + geoContextCity)}`,
          };
        }
      }

      // Day trip validation: filter out attractions that are in the base city (not near day trip destination)
      if (isDayTripDay && fallbackCenter.lat !== cityCenter.lat) {
        const MAX_DIST_FROM_DAY_TRIP_KM = 30; // attractions must be within 30km of day trip destination
        attractionsByDay[i] = dayAttrs.filter(a => {
          const distFromDayTrip = calculateDistance(a.latitude, a.longitude, fallbackCenter.lat, fallbackCenter.lng);
          const distFromBase = calculateDistance(a.latitude, a.longitude, cityCenter.lat, cityCenter.lng);
          // Keep if closer to day trip destination than to base city, or within range of day trip
          if (distFromDayTrip <= MAX_DIST_FROM_DAY_TRIP_KM) return true;
          if (distFromDayTrip < distFromBase) return true;
          return false;
        });
      }
    }
  } else {
    // Fallback: pré-allocation simple par rating
    attractionsByDay = preAllocateAttractions(
      selectedAttractions,
      preferences.durationDays,
      cityCenter
    );
  }

  // Post-traitement: corriger durées et coûts irréalistes, filtrer attractions non pertinentes
  const irrelevantPatterns = /\b(temple ganesh|temple hindou|hindu temple|salle de sport|gym|fitness|cinéma|cinema|arcade|bowling|landmark architecture|local architecture|architecture locale|city sightseeing|sightseeing tour|photo spot|photo opportunity|scenic view point|generic|unnamed)\b/i;
  // Concert halls, venues - on ne "visite" pas une salle de concert sans spectacle
  const venuePatterns = /\b(concertgebouw|concert hall|philharmonic|philharmonie|opera house|symphony|ziggo dome|heineken music hall|melkweg|paradiso|bimhuis|muziekgebouw|carré theatre|theatre|theater)\b/i;
  // Restaurants/bars/cafes should not be in the attraction pool - they belong in the meal system
  const restaurantPatterns = /\b(restaurant|ristorante|restaurante|restoran|bistrot|bistro|brasserie|trattoria|osteria|taverna|pizzeria|crêperie|creperie|bar à|wine bar|tapas bar|pub |café restaurant|grill|steakhouse|steak house|brouwerij|brewery|pancake|brunch|diner|food court|foodhall|ramen|sushi bar|burger|little buddha|le petit chef|blin queen)\b/i;
  // Generic location titles that aren't real attractions (e.g., "Amsterdam, Noord-Holland, Netherlands")
  const genericLocationPattern = /^[A-Z][a-zA-Z\s]+,\s*(Noord-Holland|Zuid-Holland|North Holland|South Holland|Netherlands|Pays-Bas|Nederland)/i;
  for (let i = 0; i < attractionsByDay.length; i++) {
    const before = attractionsByDay[i].length;
    attractionsByDay[i] = attractionsByDay[i]
      .filter(a => {
        if (a.mustSee) return true;
        if (irrelevantPatterns.test(a.name)) {
          return false;
        }
        if (venuePatterns.test(a.name)) {
          return false;
        }
        if (restaurantPatterns.test(a.name)) {
          return false;
        }
        if (genericLocationPattern.test(a.name)) {
          return false;
        }
        // Filtrer les attractions de type "gastronomy" qui sont des restaurants déguisés
        if (a.type === 'gastronomy' && !a.mustSee) {
          return false;
        }
        // Filtrer les noms trop génériques (pas un vrai lieu)
        const nameLower = a.name.toLowerCase().trim();
        if (nameLower.split(/\s+/).length <= 2 && /^(landmark|architecture|culture|history|nature|scenic|local|traditional|ancient|modern|famous|popular|beautiful)\s/i.test(nameLower)) {
          return false;
        }
        return true;
      })
      .map(a => fixAttractionCost(fixAttractionDuration(a)));
  }

  // NOTE: Le réordonnancement de diversité (éviter 2 activités consécutives du même type)
  // a été supprimé car il détruisait l'ordre géographique optimisé par reorderByProximity.
  // La diversité est déjà demandée dans le prompt Claude (règle 6c).
  // L'optimisation de distance dans tripDay.ts (optimizeAttractionOrder) gère l'ordre final.

  // ENFORCEMENT: Vérifier que tous les mustSee sont dans au moins un jour
  // Si un mustSee manque, le forcer dans le jour avec le moins d'attractions
  // Utilise une comparaison normalisée (sans accents) pour matcher "Colisée" = "Colosseum" etc.
  if (mustSeeNames.size > 0) {
    const stripAccents = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const scheduledNamesNormalized = attractionsByDay.flat().map(a => stripAccents(a.name));
    const missingMustSees = attractionPool.filter(a => {
      if (!a.mustSee) return false;
      const normalizedName = stripAccents(a.name);
      // Matching normalisé: exact ou inclusion bidirectionnelle
      return !scheduledNamesNormalized.some(sn =>
        sn === normalizedName || sn.includes(normalizedName) || normalizedName.includes(sn)
      );
    });
    for (const missing of missingMustSees) {
      // Trouver le jour avec le moins d'attractions (pas le premier ni le dernier si possible)
      let bestDay = 0;
      let minCount = Infinity;
      for (let d = 0; d < attractionsByDay.length; d++) {
        const count = attractionsByDay[d].length;
        // Préférer les jours intermédiaires
        const penalty = (d === 0 || d === attractionsByDay.length - 1) ? 2 : 0;
        if (count + penalty < minCount) {
          minCount = count + penalty;
          bestDay = d;
        }
      }
      attractionsByDay[bestDay].unshift(missing);
    }
  }

  // 7.5 Sélectionner le meilleur hébergement (hôtels + Airbnb si disponible)
  // Pré-filtrer par budget stratégique si disponible
  const maxBudgetPerNight = budgetStrategy.accommodationBudgetPerNight
    ? budgetStrategy.accommodationBudgetPerNight * 1.2  // 20% de tolérance
    : undefined;
  let accommodationCandidates = allAccommodationOptions;
  if (maxBudgetPerNight) {
    const budgetFiltered = allAccommodationOptions.filter(h => h.pricePerNight <= maxBudgetPerNight);
    if (budgetFiltered.length >= 2) {
      accommodationCandidates = budgetFiltered;
    }
  }
  const accommodation = selectBestHotel(accommodationCandidates, {
    budgetLevel: resolvedBudget.budgetLevel as 'economic' | 'moderate' | 'luxury',
    attractions: selectedAttractions,
    preferApartment: budgetStrategy.accommodationType.includes('airbnb'),
    cityCenter: cityCenter ? { lat: cityCenter.lat, lng: cityCenter.lng } : undefined,
    maxBudgetPerNight,
  });

  // 7.5b Validate hotel coordinates — if too close to city center, likely a default
  if (accommodation && cityCenter) {
    const hotelDistFromCenter = calculateDistance(
      accommodation.latitude, accommodation.longitude, cityCenter.lat, cityCenter.lng
    );
    if (hotelDistFromCenter < 0.2) { // < 200m from city center = probably a default
      try {
        const hotelGeo = await geocodeAddress(`${accommodation.name}, ${preferences.destination}`);
        if (hotelGeo && hotelGeo.lat && hotelGeo.lng) {
          accommodation.latitude = hotelGeo.lat;
          accommodation.longitude = hotelGeo.lng;
        } else {
          // Try Gemini fallback
          const geminiGeo = await geocodeWithGemini(accommodation.name, preferences.destination);
          if (geminiGeo) {
            accommodation.latitude = geminiGeo.lat;
            accommodation.longitude = geminiGeo.lng;
          }
        }
      } catch (e) {
        console.warn(`[AI] Hotel geocode error:`, e);
      }
    }
  }

  // 7.5c Validate hotel coordinates — if too far from city center, try to re-resolve
  if (accommodation && cityCenter) {
    const hotelDistFromCenter2 = calculateDistance(
      accommodation.latitude, accommodation.longitude, cityCenter.lat, cityCenter.lng
    );
    if (hotelDistFromCenter2 > 5) { // > 5km from city center
      console.warn(`[AI] Hotel "${accommodation.name}" is ${hotelDistFromCenter2.toFixed(1)}km from city center, attempting re-resolve...`);
      try {
        const hotelGeo2 = await geocodeAddress(`${accommodation.name}, ${preferences.destination}`);
        if (hotelGeo2 && hotelGeo2.lat && hotelGeo2.lng) {
          const newDist = calculateDistance(hotelGeo2.lat, hotelGeo2.lng, cityCenter.lat, cityCenter.lng);
          if (newDist < hotelDistFromCenter2) {
            accommodation.latitude = hotelGeo2.lat;
            accommodation.longitude = hotelGeo2.lng;
          }
        } else {
          const geminiGeo2 = await geocodeWithGemini(accommodation.name, preferences.destination);
          if (geminiGeo2) {
            const newDist = calculateDistance(geminiGeo2.lat, geminiGeo2.lng, cityCenter.lat, cityCenter.lng);
            if (newDist < hotelDistFromCenter2) {
              accommodation.latitude = geminiGeo2.lat;
              accommodation.longitude = geminiGeo2.lng;
            }
          }
        }
      } catch (e) {
        console.warn(`[AI] Hotel re-geocode error:`, e);
      }
    }
  }


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
  } else if (savings < -50) {
    // Dépassement : réduire food et activités
    const cutPerDay = Math.abs(savings) / preferences.durationDays;
    budgetStrategy.dailyActivityBudget = Math.max(0, budgetStrategy.dailyActivityBudget - Math.round(cutPerDay * 0.4));
  }

  // 8. Déterminer les jours de courses et préparer les recherches parallèles
  let groceryStore: GroceryStore | null = null;
  const groceryDays = new Set<number>(); // numéros de jours où ajouter les courses
  if (budgetStrategy?.groceryShoppingNeeded) {
    const firstGroceryDay = preferences.durationDays > 2 ? 2 : 1;
    groceryDays.add(firstGroceryDay);
    if (preferences.durationDays > 4) {
      const midDay = Math.ceil(preferences.durationDays / 2) + 1;
      groceryDays.add(midDay);
    }
  }

  // 9. PRÉ-FETCH RESTAURANTS + LUGGAGE + GROCERY EN PARALLÈLE
  const prefetchedRestaurants = new Map<string, Restaurant | null>();
  let prefetchedLuggageStoragesResult: LuggageStorage[] | null = null;
  {
    const accommodationCoords = {
      lat: accommodation?.latitude || cityCenter.lat,
      lng: accommodation?.longitude || cityCenter.lng,
    };

    const restaurantFetches: Array<{
      key: string;
      promise: Promise<Restaurant | null>;
    }> = [];

    // Pre-compute which days need grocery shopping (deterministic)
    let groceriesDonePrecomputed = !budgetStrategy?.groceryShoppingNeeded;

    for (let i = 0; i < preferences.durationDays; i++) {
      const dayNumber = i + 1;
      const dayAttrs = attractionsByDay[i] || [];
      const isDayTripDay = dayMetadata[i]?.isDayTrip;

      // Update groceries status for this day
      // On grocery day itself: breakfast/lunch = not available yet, dinner = available (shopping done during day)
      const isGroceryDay = groceryDays.has(dayNumber);

      for (const mealType of ['breakfast', 'lunch', 'dinner'] as const) {
        // Groceries: available if done on a previous day, or if it's grocery day AND it's dinner (shopping done by then)
        const groceriesAvailable = groceriesDonePrecomputed || (isGroceryDay && mealType === 'dinner');

        // Skip self-catered meals
        if (shouldSelfCater(mealType, dayNumber, budgetStrategy, false, preferences.durationDays, isDayTripDay, groceriesAvailable)) {
          continue;
        }

        // Compute approximate coords for this meal
        // IMPORTANT: filtrer les attractions avec des coordonnées aberrantes (>30km du centre)
        // avant le calcul du centroïde, pour que le restaurant soit proche des activités réelles
        const validAttrs = dayAttrs.filter(a => {
          if (!a.latitude || !a.longitude) return false;
          const dist = calculateDistance(a.latitude, a.longitude, cityCenter.lat, cityCenter.lng);
          if (dist > 30) {
            console.warn(`[AI] ⚠️ Attraction "${a.name}" exclue du centroïde: ${dist.toFixed(1)}km du centre`);
            return false;
          }
          return true;
        });

        let mealCoords: { lat: number; lng: number };
        if (mealType === 'breakfast') {
          mealCoords = accommodationCoords;
        } else if (mealType === 'lunch') {
          // Centroïde des attractions du matin (proches de l'activité précédente)
          const morningAttrs = validAttrs.slice(0, Math.ceil(validAttrs.length / 2));
          if (morningAttrs.length > 0) {
            // Prendre la DERNIÈRE attraction du matin (pas le centroïde) pour être au plus proche
            const lastMorning = morningAttrs[morningAttrs.length - 1];
            mealCoords = { lat: lastMorning.latitude, lng: lastMorning.longitude };
          } else {
            mealCoords = cityCenter;
          }
        } else {
          // Dinner: dernière attraction de l'après-midi (ou dernière attraction de la journée)
          const afternoonAttrs = validAttrs.slice(Math.ceil(validAttrs.length / 2));
          if (afternoonAttrs.length > 0) {
            const lastAfternoon = afternoonAttrs[afternoonAttrs.length - 1];
            mealCoords = { lat: lastAfternoon.latitude, lng: lastAfternoon.longitude };
          } else if (validAttrs.length > 0) {
            const lastValid = validAttrs[validAttrs.length - 1];
            mealCoords = { lat: lastValid.latitude, lng: lastValid.longitude };
          } else {
            mealCoords = cityCenter;
          }
        }

        const key = `${i}-${mealType}`;
        restaurantFetches.push({
          key,
          promise: findRestaurantForMeal(mealType, cityCenter, preferences, dayNumber, mealCoords),
        });
      }

      // Track groceries for next day
      if (groceryDays.has(dayNumber)) {
        groceriesDonePrecomputed = true;
      }
    }

    // Launch luggage storage + grocery store searches in parallel with restaurants
    const luggagePromise = searchLuggageStorage(preferences.destination, { latitude: cityCenter.lat, longitude: cityCenter.lng })
      .catch((err: unknown) => { console.warn('[AI] Luggage storage pre-fetch failed:', err); return [] as LuggageStorage[]; });

    const groceryPromise = budgetStrategy?.groceryShoppingNeeded
      ? searchGroceryStores(
          accommodationCoords,
          preferences.destination
        ).catch((err: unknown) => { console.warn('[AI] Erreur recherche supermarché:', err); return [] as GroceryStore[]; })
      : Promise.resolve([] as GroceryStore[]);

    // Await all in parallel: restaurants + luggage + grocery
    const [restaurantResults, luggageStorages, groceryStores] = await Promise.all([
      restaurantFetches.length > 0
        ? Promise.allSettled(restaurantFetches.map(f => f.promise))
        : Promise.resolve([]),
      luggagePromise,
      groceryPromise,
    ]);

    // Process restaurant results
    if (restaurantFetches.length > 0) {
      const usedIds = new Set<string>();
      restaurantFetches.forEach((fetch, idx) => {
        const result = (restaurantResults as PromiseSettledResult<Restaurant | null>[])[idx];
        const restaurant = result.status === 'fulfilled' ? result.value : null;

        // Deduplication: if this restaurant ID is already used, store null (will fallback to live fetch)
        if (restaurant?.id && usedIds.has(restaurant.id)) {
          prefetchedRestaurants.set(fetch.key, null);
        } else if (restaurant?.latitude && restaurant?.longitude && cityCenter) {
          // Pré-validation: rejeter les restaurants trop loin de la destination (>15km)
          const distFromCenter = calculateDistance(restaurant.latitude, restaurant.longitude, cityCenter.lat, cityCenter.lng);
          if (distFromCenter > 15) {
            console.warn(`[AI] Restaurant rejeté (${Math.round(distFromCenter)}km du centre): "${restaurant.name}"`);
            prefetchedRestaurants.set(fetch.key, null);
          } else {
            if (restaurant.id) {
              usedIds.add(restaurant.id);
              usedRestaurantIds.add(restaurant.id);
            }
            prefetchedRestaurants.set(fetch.key, restaurant);
          }
        } else {
          if (restaurant?.id) {
            usedIds.add(restaurant.id);
            usedRestaurantIds.add(restaurant.id);
          }
          prefetchedRestaurants.set(fetch.key, restaurant);
        }
      });
    }

    // Process grocery store results
    if (groceryStores.length > 0) {
      groceryStore = groceryStores[0];
    }

    // Luggage storages will be passed to generateDayWithScheduler
    prefetchedLuggageStoragesResult = luggageStorages.length > 0 ? luggageStorages : null;
  }

  // 10. Générer les jours avec le SCHEDULER (évite les chevauchements)
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

    // Récupérer les attractions pré-allouées pour ce jour
    const dayAttractions = attractionsByDay[i] || [];

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
      prefetchedRestaurants, // Restaurants pré-fetchés en parallèle
      prefetchedLuggageStorages: prefetchedLuggageStoragesResult, // Consigne bagages pré-fetchée
    });

    // Injecter les courses si ce jour est un jour de courses
    const dayItems = [...dayResult.items];
    if (groceryDays.has(dayNumber) && groceryStore) {
      // Trouver un bon créneau: après le check-in (jour 1) ou en fin d'après-midi
      // IMPORTANT: Si l'hôtel est loin du centre (>3km), placer les courses en fin de journée
      // après le retour à l'hôtel, pas au milieu des activités du centre-ville
      const groceryDuration = 40; // minutes
      let insertTime = '17:30'; // défaut: fin d'après-midi

      // Calculer la distance hôtel <-> centre-ville
      const hotelLat = accommodation?.latitude || cityCenter.lat;
      const hotelLng = accommodation?.longitude || cityCenter.lng;
      const hotelDistanceFromCenter = calculateDistance(hotelLat, hotelLng, cityCenter.lat, cityCenter.lng);
      const isHotelFarFromCenter = hotelDistanceFromCenter > 3; // >3km = considéré loin

      if (isFirstDay) {
        // Jour d'arrivée: courses après le check-in hôtel
        const checkinItem = dayItems.find(item => item.type === 'checkin' || (item.type === 'hotel' && item.title.includes('Check-in')));
        if (checkinItem && checkinItem.endTime) {
          const checkinEnd = new Date(checkinItem.endTime);
          insertTime = `${checkinEnd.getHours().toString().padStart(2, '0')}:${checkinEnd.getMinutes().toString().padStart(2, '0')}`;
        }
      } else if (isHotelFarFromCenter) {
        // Hôtel loin du centre: courses EN FIN DE JOURNÉE après retour à l'hôtel
        // Pas au milieu de la journée (sinon aller-retour inutile)
        // Trouver la dernière activité (hors restaurant dîner) pour placer les courses après
        const lastActivityBeforeDinner = [...dayItems]
          .filter(item => item.type === 'activity' && !item.title.toLowerCase().includes('dîner'))
          .sort((a, b) => {
            const aTime = a.endTime ? parseTime(dayDate, a.endTime).getTime() : 0;
            const bTime = b.endTime ? parseTime(dayDate, b.endTime).getTime() : 0;
            return bTime - aTime;
          })[0];

        if (lastActivityBeforeDinner?.endTime) {
          // Courses juste après la dernière activité (on rentre + courses)
          // Ajouter du temps de trajet depuis le centre vers l'hôtel (~30-45min)
          const lastEnd = parseTime(dayDate, lastActivityBeforeDinner.endTime);
          const travelTime = Math.round(hotelDistanceFromCenter * 3); // ~3min/km en transports
          const groceryStart = new Date(lastEnd.getTime() + travelTime * 60 * 1000);
          insertTime = `${groceryStart.getHours().toString().padStart(2, '0')}:${groceryStart.getMinutes().toString().padStart(2, '0')}`;
        } else {
          // Fallback: courses tard (19h) pour être sûr d'être rentré
          insertTime = '19:00';
        }
      } else {
        // Hôtel proche du centre: logique standard (avant le dîner)
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

    // POST-VALIDATION: Vérifier cohérence isDayTrip vs contenu réel
    const lastDay = days[days.length - 1];
    if (lastDay.isDayTrip && lastDay.dayTripDestination) {
      const destLower = lastDay.dayTripDestination.toLowerCase();
      const hasMatchingItem = lastDay.items.some(item => {
        const combined = `${item.title} ${item.locationName || ''} ${item.description || ''}`.toLowerCase();
        return combined.includes(destLower);
      });
      if (!hasMatchingItem) {
        console.warn(`[AI] Jour ${lastDay.dayNumber}: isDayTrip="${lastDay.dayTripDestination}" mais AUCUN item ne correspond → reset`);
        lastDay.isDayTrip = false;
        lastDay.dayTripDestination = undefined;
      }
    }

    // POST-VALIDATION: Si dernier jour avec uniquement logistique, override le thème
    if (isLastDay) {
      const activityItems = lastDay.items.filter(item => ['activity', 'restaurant'].includes(item.type));
      if (activityItems.length === 0) {
        lastDay.theme = `Départ - Retour à ${preferences.origin || 'la maison'}`;
        lastDay.dayNarrative = undefined;
        lastDay.isDayTrip = false;
        lastDay.dayTripDestination = undefined;
      }
    }

    // POST-VALIDATION: Vérifier que le thème correspond aux activités réelles
    if (lastDay.theme) {
      const activityTitles = lastDay.items
        .filter(it => it.type === 'activity')
        .map(it => it.title.toLowerCase());

      if (activityTitles.length > 0) {
        const genericWords = new Set(['centre', 'historique', 'premier', 'contact', 'quartier', 'journée', 'visite', 'découverte', 'exploration', 'romantique', 'entre', 'dans', 'avec', 'pour', 'jour', 'art', 'spiritualité', 'villas', 'jardins', 'exception', 'fontaines', 'quartiers', 'bohèmes']);
        const themeWords = lastDay.theme.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .split(/[\s\-–—&,]+/)
          .filter(w => w.length > 3 && !genericWords.has(w));

        const matchCount = themeWords.filter(tw =>
          activityTitles.some(at => at.normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(tw))
        ).length;

        if (themeWords.length > 0 && matchCount === 0) {
          const mainActivities = lastDay.items
            .filter(it => it.type === 'activity')
            .slice(0, 3)
            .map(it => it.title);
          // Format plus lisible: max 2 items + "et plus" au lieu d'une longue liste
          if (mainActivities.length > 2) {
            lastDay.theme = `${mainActivities[0]}, ${mainActivities[1]} et plus`;
          } else if (mainActivities.length > 0) {
            lastDay.theme = mainActivities.join(' & ');
          }
          // Si isDayTrip mais thème ne match pas, reset le day trip
          if (lastDay.isDayTrip) {
              lastDay.isDayTrip = false;
            lastDay.dayTripDestination = undefined;
          }
          lastDay.dayNarrative = undefined;
        }
      }
    }

    // Si ce jour a un vol tardif, le stocker pour le jour suivant
    // ET redistribuer les attractions non utilisées aux jours suivants
    pendingLateFlightData = dayResult.lateFlightForNextDay;
    if (pendingLateFlightData && i < preferences.durationDays - 1) {
      // Redistribuer les attractions du Jour 1 aux jours suivants
      // Car le Jour 1 est un jour de voyage et ne peut pas faire d'activités à destination
      const unusedAttractions = dayAttractions.filter(a => !tripUsedAttractionIds.has(a.id));
      if (unusedAttractions.length > 0) {
        // Répartir équitablement sur les jours restants
        const remainingDays = preferences.durationDays - 1 - i;
        for (let j = 0; j < unusedAttractions.length; j++) {
          const targetDayIndex = i + 1 + (j % remainingDays);
          if (targetDayIndex < preferences.durationDays) {
            attractionsByDay[targetDayIndex].push(unusedAttractions[j]);
          }
        }
      }
    }
  }

  // VALIDATION: Vol retour présent dans le dernier jour
  if (returnFlight && days.length > 0) {
    const lastDay = days[days.length - 1];
    const hasReturnFlight = lastDay.items.some(item => item.type === 'flight' && item.dayNumber === preferences.durationDays);
    if (!hasReturnFlight) {
      console.error(`[AI] ⚠️ Return flight ${returnFlight.flightNumber} missing from last day items, force-adding`);
      const rf = returnFlight;
      const rfPrice = rf.price || 0;
      const rfGroupSize = preferences.groupSize || 1;
      const rfPricePerPerson = rf.pricePerPerson || (rfPrice > 0 ? Math.round(rfPrice / rfGroupSize) : 0);
      const rfPriceDisplay = rfGroupSize > 1 && rfPricePerPerson > 0
        ? `${rfPricePerPerson}€/pers (${rfPrice}€ total)`
        : rfPrice > 0 ? `${rfPrice}€` : 'Prix non disponible';
      lastDay.items.push({
        id: generateId(),
        type: 'flight' as any,
        title: `Vol ${rf.flightNumber} → ${preferences.origin}`,
        description: `${rf.flightNumber} | ${formatFlightDuration(rf.duration)} | ${rf.stops === 0 ? 'Direct' : `${rf.stops} escale(s)`} | ${rfPriceDisplay}`,
        startTime: rf.departureTimeDisplay || formatTime(new Date(rf.departureTime)),
        endTime: rf.arrivalTimeDisplay || formatTime(new Date(rf.arrivalTime)),
        locationName: `${destAirport.code} → ${originAirport?.code || ''}`,
        latitude: destAirport.latitude,
        longitude: destAirport.longitude,
        estimatedCost: rfPrice,
        bookingUrl: rf.bookingUrl,
        dayNumber: preferences.durationDays,
        orderIndex: lastDay.items.length,
        dataReliability: 'verified' as any,
      });
    }
  }

  // DÉDUPLICATION CROSS-DAY: Supprimer les activités en doublon entre jours différents (garder la plus longue)
  const seenActivities = new Map<string, { dayIndex: number; itemIndex: number; durationMin: number; title: string }>();
  for (let d = 0; d < days.length; d++) {
    for (let i = 0; i < days[d].items.length; i++) {
      const item = days[d].items[i];
      if (item.type !== 'activity') continue;

      const title = item.title;
      // Calculer durée en minutes
      let durationMin = item.duration || 0;
      if (!durationMin && item.startTime && item.endTime) {
        const start = parseTime(days[d].date, item.startTime);
        const end = parseTime(days[d].date, item.endTime);
        durationMin = Math.max(0, (end.getTime() - start.getTime()) / 60000);
      }

      // Chercher un doublon parmi les activités déjà vues
      let foundDupeKey: string | null = null;
      for (const [seenTitle, seenData] of seenActivities) {
        if (areNamesSimilar(title, seenData.title)) {
          foundDupeKey = seenTitle;
          break;
        }
      }

      if (foundDupeKey) {
        const seenData = seenActivities.get(foundDupeKey)!;
        if (durationMin > seenData.durationMin) {
          // L'item actuel est plus long → supprimer l'ancien
          days[seenData.dayIndex].items.splice(seenData.itemIndex, 1);
          days[seenData.dayIndex].items.forEach((it, idx) => { it.orderIndex = idx; });
          // Ajuster les index dans seenActivities si nécessaire
          for (const [k, v] of seenActivities) {
            if (v.dayIndex === seenData.dayIndex && v.itemIndex > seenData.itemIndex) {
              v.itemIndex--;
            }
          }
          seenActivities.delete(foundDupeKey);
          seenActivities.set(title, { dayIndex: d, itemIndex: i, durationMin, title });
        } else {
          // L'ancien est plus long → supprimer l'item actuel
          days[d].items.splice(i, 1);
          days[d].items.forEach((it, idx) => { it.orderIndex = idx; });
          i--; // Ajuster l'index après splice
        }
      } else {
        seenActivities.set(title, { dayIndex: d, itemIndex: i, durationMin, title });
      }
    }
  }

  // VALIDATION FINALE MUST-SEE: Vérifier que tous les must-see demandés par l'utilisateur sont dans le trip final
  if (preferences.mustSee?.trim()) {
    const stripAccentsFinal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const mustSeeList = preferences.mustSee.split(',').map(s => stripAccentsFinal(s)).filter(s => s.length > 0);
    const allItemTitlesNormalized = days.flatMap(d => d.items.filter(i => i.type === 'activity').map(i => stripAccentsFinal(i.title)));
    const allTitlesJoined = allItemTitlesNormalized.join(' ');

    for (const ms of mustSeeList) {
      // Chercher par mots significatifs (>2 chars) du must-see
      const words = ms.split(/\s+/).filter(w => w.length > 2);
      const found = words.some(w => allTitlesJoined.includes(w));
      if (!found) {
        console.error(`[AI] ⚠️ MUST-SEE MANQUANT DU TRIP FINAL: "${ms}"`);
        // Chercher dans le pool et forcer l'ajout
        const poolMatch = attractionPool.find(a => {
          const norm = stripAccentsFinal(a.name);
          return words.some(w => norm.includes(w));
        });
        if (poolMatch) {
          // Trouver le jour intermédiaire le moins chargé
          let bestDayIdx = Math.min(1, days.length - 1);
          let minItems = Infinity;
          for (let d = 1; d < Math.max(2, days.length - 1); d++) {
            const actCount = days[d]?.items.filter(i => i.type === 'activity').length || 0;
            if (actCount < minItems) { minItems = actCount; bestDayIdx = d; }
          }
          const day = days[bestDayIdx];
          if (day) {
            const newItem: TripItem = {
              id: Math.random().toString(36).substring(2, 15),
              dayNumber: day.dayNumber,
              startTime: '10:00',
              endTime: '12:00',
              type: 'activity',
              title: poolMatch.name,
              description: poolMatch.description || '',
              locationName: `${poolMatch.name}, ${preferences.destination}`,
              latitude: poolMatch.latitude,
              longitude: poolMatch.longitude,
              estimatedCost: poolMatch.estimatedCost || 0,
              orderIndex: day.items.length,
              rating: poolMatch.rating,
              dataReliability: 'verified',
            };
            day.items.push(newItem);
          }
        }
      }
    }
  }

  // Validation post-génération : supprimer les séquences consigne→récupération incohérentes (< 2h)
  for (const day of days) {
    const luggageDropIdx = day.items.findIndex(i => i.title.includes('Dépôt bagages en consigne'));
    const luggagePickupIdx = day.items.findIndex(i => i.title.includes('Récupération bagages'));
    if (luggageDropIdx >= 0 && luggagePickupIdx >= 0) {
      const dropEnd = parseTime(day.date, day.items[luggageDropIdx].endTime);
      const pickupStart = parseTime(day.date, day.items[luggagePickupIdx].startTime);
      const gapMinutes = (pickupStart.getTime() - dropEnd.getTime()) / (60 * 1000);
      if (gapMinutes < 120) {
        day.items = day.items.filter((_, idx) => idx !== luggageDropIdx && idx !== luggagePickupIdx);
      }
    }
  }

  // POST-PROCESSING FINAL: Nettoyer les items problématiques dans tous les jours
  // Patterns pour items à supprimer
  const badItemPatterns = {
    // Concert halls et salles de spectacle (ne pas proposer en activité de jour)
    venues: /\b(concertgebouw|concert hall|philharmonic|philharmonie|opera house|symphony|ziggo dome|heineken music hall|melkweg|paradiso|bimhuis|muziekgebouw)\b/i,
    // Salles de spectacle/cabarets/shows (Moulin Rouge, etc.) - pas en journée
    showVenues: /\b(moulin rouge|lido|crazy horse|cabaret|burlesque|revue|show|spectacle|variété|follies|paradis latin)\b/i,
    // Restaurants Michelin étoilés (ne pas proposer comme activités)
    michelinRestaurants: /\b(l'ambroisie|ambroisie|l'arpège|arpège|le pré catelan|pré catelan|guy savoy|alain ducasse|le meurice|épicure|epicure|ledoyen|pavillon|cinq|le cinq|taillevent|astrance|alléno|alleno|pierre gagnaire)\b/i,
    // Titres génériques de lieux
    genericLocations: /^[A-Z][a-zA-Z\s]+,\s*(Noord-Holland|Zuid-Holland|North Holland|South Holland|Netherlands|Pays-Bas|Nederland)/i,
  };

  // Tracking pour doublons de croisières/food tours sur tout le voyage
  const cruiseKeywords = /\b(croisière|cruise|canal tour|boat tour|canal boat|bateau)\b/i;
  const foodTourKeywords = /\b(food tour|food walk|walking food|culinary tour|gastronomic tour)\b/i;
  let hasCruise = false;
  let hasFoodTour = false;

  // Helper pour vérifier si c'est une activité en journée (avant 18h)
  const isDaytimeActivity = (item: TripItem): boolean => {
    if (!item.startTime) return false;
    const hour = parseInt(item.startTime.split(':')[0], 10);
    return hour < 18;
  };

  for (const day of days) {
    const beforeCount = day.items.length;
    day.items = day.items.filter(item => {
      if (item.type !== 'activity') return true; // Keep non-activities

      const title = item.title || '';
      const description = item.description || '';
      const combined = `${title} ${description}`;

      // Filter concert halls/venues (anytime)
      if (badItemPatterns.venues.test(combined)) {
        return false;
      }

      // Filter show venues/cabarets ONLY during daytime (before 18h)
      // These are OK for evening activities
      if (isDaytimeActivity(item) && badItemPatterns.showVenues.test(combined)) {
        return false;
      }

      // Filter Michelin restaurants proposed as activities (not restaurant type)
      if (badItemPatterns.michelinRestaurants.test(combined)) {
        return false;
      }

      // Filter generic location titles
      if (badItemPatterns.genericLocations.test(title)) {
        return false;
      }

      // Filter duplicate cruises (keep only first one)
      if (cruiseKeywords.test(title)) {
        if (hasCruise) {
          return false;
        }
        hasCruise = true;
      }

      // Filter duplicate food tours (keep only first one)
      if (foodTourKeywords.test(title)) {
        if (hasFoodTour) {
          return false;
        }
        hasFoodTour = true;
      }

      return true;
    });

    if (day.items.length < beforeCount) {
      // Re-index orderIndex
      day.items.forEach((item, idx) => { item.orderIndex = idx; });
    }
  }

  // VALIDATION FINALE: Corriger les chevauchements de créneaux horaires
  for (const day of days) {
    // Trier par heure de début
    day.items.sort((a, b) => {
      const aMin = parseInt(a.startTime.split(':')[0]) * 60 + parseInt(a.startTime.split(':')[1] || '0');
      const bMin = parseInt(b.startTime.split(':')[0]) * 60 + parseInt(b.startTime.split(':')[1] || '0');
      return aMin - bMin;
    });

    for (let j = 1; j < day.items.length; j++) {
      const prev = day.items[j - 1];
      const curr = day.items[j];
      // Parse endTime en gérant le format "+1j" pour les vols overnight
      const prevEndClean = prev.endTime.replace(/\s*\(\+1j\)/, '');
      const currStartClean = curr.startTime.replace(/\s*\(\+1j\)/, '');
      const prevEndMin = parseInt(prevEndClean.split(':')[0]) * 60 + parseInt(prevEndClean.split(':')[1] || '0');
      const currStartMin = parseInt(currStartClean.split(':')[0]) * 60 + parseInt(currStartClean.split(':')[1] || '0');

      if (currStartMin < prevEndMin && prevEndMin > 0 && currStartMin >= 0) {
        const currEndClean = curr.endTime.replace(/\s*\(\+1j\)/, '');
        const currEndMin = parseInt(currEndClean.split(':')[0]) * 60 + parseInt(currEndClean.split(':')[1] || '0');
        const duration = Math.max(currEndMin - currStartMin, 15);
        const newStart = prevEndMin + 5;
        curr.startTime = `${Math.floor(newStart / 60).toString().padStart(2, '0')}:${(newStart % 60).toString().padStart(2, '0')}`;
        const newEnd = newStart + duration;
        curr.endTime = `${Math.floor(newEnd / 60).toString().padStart(2, '0')}:${(newEnd % 60).toString().padStart(2, '0')}`;
      }
    }
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  // Enrichir les restaurants avec descriptions et spécialités (batch par voyage)
  try {
    const allRestaurantItems = days.flatMap(day =>
      day.items.filter(item => item.type === 'restaurant' && item.title && !item.title.includes('Petit-déjeuner à l') && !item.title.includes('Pique-nique') && !item.title.includes('Dîner à l\'appartement'))
    );
    if (allRestaurantItems.length > 0) {
      // Cap à 12 restaurants pour limiter le temps Gemini sur les longs voyages
      const restaurantsToEnrich = allRestaurantItems.length > 12
        ? allRestaurantItems.slice(0, 12)
        : allRestaurantItems;
      if (allRestaurantItems.length > 12) {
      }

      const toEnrich = restaurantsToEnrich.map(item => ({
        name: item.title,
        address: item.locationName || '',
        cuisineTypes: item.description?.split(' | ')[0]?.split(', ') || ['local'],
        mealType: item.title.includes('Déjeuner') ? 'lunch' : item.title.includes('Dîner') ? 'dinner' : 'breakfast',
      }));

      const enriched = await enrichRestaurantsWithGemini(toEnrich, preferences.destination);

      for (const item of allRestaurantItems) {
        const data = enriched.get(item.title);
        if (data) {
          // Build rich description — filtrer les messages d'erreur de vérification
          const isErrorText = (t: string) => /n'est pas situ[eé]|trop g[eé]n[eé]rique|cette entr[eé]e|l'adresse fournie|veuillez/i.test(t);
          const parts: string[] = [];
          if (data.description && !isErrorText(data.description)) parts.push(data.description);
          if (data.specialties?.length) parts.push(`🍽️ ${data.specialties.join(', ')}`);
          if (data.tips && !isErrorText(data.tips)) parts.push(`💡 ${data.tips}`);
          // Keep existing rating info
          const ratingPart = item.description?.match(/⭐.*$/)?.[0];
          if (ratingPart) parts.push(ratingPart);
          item.description = parts.join(' | ');
        }
      }
    }
  } catch (error) {
    console.warn('[AI] Enrichissement restaurants échoué (non bloquant):', error);
  }

  // Post-processing Viator: attacher des liens Viator aux activités sans bookingUrl
  const elapsedMs = Date.now() - T0;
  if (isViatorConfigured() && elapsedMs < 255_000) {
    try {
      // Patterns d'activités gratuites par nature — skip Viator matching
      const FREE_ACTIVITY_PATTERNS = /\b(rambla|passeig|promenade|place|square|plaza|platz|piazza|pont|bridge|quartier|barrio|neighbourhood|parc|park|jardin|garden|plage|beach|marché|market|mercat|mercado|balade|walk|stroll)\b/i;

      const activitiesWithoutUrl = days.flatMap(day =>
        day.items.filter(item => {
          if (item.type !== 'activity' || item.bookingUrl || !item.title) return false;
          // Skip activités dont le titre est juste le nom de la ville (ex: "Amsterdam")
          // Claude génère parfois des activités vagues qui matchent avec des transferts aéroport
          const titleNorm = item.title.toLowerCase().trim();
          const destNorm = preferences.destination.toLowerCase().trim();
          if (titleNorm === destNorm || titleNorm === `visite de ${destNorm}` || titleNorm === `découverte de ${destNorm}`) {
            return false;
          }
          // Skip activités gratuites (cost = 0)
          if (item.estimatedCost === 0) {
            return false;
          }
          // Skip activités gratuites par nature (places, parcs, rues...)
          if (FREE_ACTIVITY_PATTERNS.test(item.title)) {
            return false;
          }
          return true;
        })
      );

      if (activitiesWithoutUrl.length > 0) {
        // Limiter à 8 requêtes Viator pour ne pas ralentir
        const toMatch = activitiesWithoutUrl.slice(0, 8);
        const viatorResults = await Promise.all(
          toMatch.map(item => {
            // Use activity title + destination for better matching
            const searchTerm = `${item.title} ${preferences.destination}`;
            return findViatorProduct(searchTerm, preferences.destination);
          })
        );

        let matched = 0;
        for (let i = 0; i < toMatch.length; i++) {
          const result = viatorResults[i];
          if (result) {
            // Viator = viatorUrl (experience premium) + bookingUrl (fallback si pas de lien officiel)
            toMatch[i].viatorUrl = result.url;
            toMatch[i].bookingUrl = result.url;
            if (!toMatch[i].estimatedCost && result.price > 0) {
              toMatch[i].estimatedCost = result.price;
            }
            // Stocker le prix Viator séparément (pour affichage carte produit)
            // estimatedCost = prix d'entrée officiel (budget), viatorPrice = prix tour Viator
            if (result.price > 0) {
              (toMatch[i] as any).viatorPrice = result.price;
            }
            // Stocker le titre Viator pour afficher le vrai nom de l'activité réservable
            if (result.title && result.title.toLowerCase() !== toMatch[i].title.toLowerCase()) {
              (toMatch[i] as any).viatorTitle = result.title;
            }
            // Stocker image, rating, review count pour affichage carte produit
            if (result.imageUrl) (toMatch[i] as any).viatorImageUrl = result.imageUrl;
            if (result.rating) (toMatch[i] as any).viatorRating = result.rating;
            if (result.reviewCount) (toMatch[i] as any).viatorReviewCount = result.reviewCount;

            // Propager la durée Viator et recalculer le planning si nécessaire
            // Viator est la source de vérité pour les activités réservables
            if (result.duration && result.duration > 0) {
              const item = toMatch[i];
              const currentDuration = item.duration || 30;
              const durationRatio = result.duration / Math.max(currentDuration, 30);
              const [sH = 0, sM = 0] = (item.startTime || '10:00').split(':').map(Number);

              // Warning informatif (pas de rejet)
              if (durationRatio > 2.5 || result.duration > 300) {
                console.warn(`[AI] Durée Viator notable: "${item.title}" ${result.duration}min (original ${currentDuration}min, ratio ${durationRatio.toFixed(1)}x)`);
              }

              item.viatorDuration = result.duration;

              // Recalculer endTime si la durée Viator est significativement différente (>15min)
              // Viator est la source de vérité — toujours appliquer sa durée au planning
              const effectiveDuration = result.duration;
              if (Math.abs(effectiveDuration - currentDuration) > 15 && item.startTime && item.endTime) {
                const startMinutes = sH * 60 + sM;
                const newEndMinutes = startMinutes + effectiveDuration;
                const newEndH = Math.floor(newEndMinutes / 60);
                const newEndM = newEndMinutes % 60;
                const newEndTime = `${String(newEndH).padStart(2, '0')}:${String(newEndM).padStart(2, '0')}`;

                const oldEndTime = item.endTime;
                item.endTime = newEndTime;
                item.duration = effectiveDuration;

                // Décaler les items suivants dans le même jour
                const day = days.find(d => d.items.some(it => it.id === item.id));
                if (day) {
                  const itemIndex = day.items.findIndex(it => it.id === item.id);
                  if (itemIndex >= 0 && itemIndex < day.items.length - 1) {
                    const [oldEndH, oldEndM] = oldEndTime.split(':').map(Number);
                    const shiftMinutes = (newEndH * 60 + newEndM) - (oldEndH * 60 + oldEndM);

                    if (shiftMinutes > 0) {
                      for (let j = itemIndex + 1; j < day.items.length; j++) {
                        const next = day.items[j];
                        if (next.startTime && next.endTime) {
                          const [nsH, nsM] = next.startTime.split(':').map(Number);
                          const [neH, neM] = next.endTime.split(':').map(Number);
                          const newStartMin = nsH * 60 + nsM + shiftMinutes;
                          const newEndMin = neH * 60 + neM + shiftMinutes;
                          next.startTime = `${String(Math.floor(newStartMin / 60)).padStart(2, '0')}:${String(newStartMin % 60).padStart(2, '0')}`;
                          next.endTime = `${String(Math.floor(newEndMin / 60)).padStart(2, '0')}:${String(newEndMin % 60).padStart(2, '0')}`;
                        }
                      }
                    }
                  }
                }
              }
            }

            matched++;
          }
          // Pas de fallback Tiqets — en attente API Distributor
        }
      }
    } catch (error) {
      console.warn('[AI] Viator post-processing error (non bloquant):', error);
    }
  } else if (elapsedMs >= 255_000) {
  }

  // Post-processing Impact/Omio: convertir les URLs Omio en liens affiliés trackés
  if (isImpactConfigured()) {
    try {
      const omioItems: TripItem[] = [];
      for (const day of days) {
        for (const item of day.items) {
          if (item.type === 'transport' && item.bookingUrl?.includes('omio.fr')) {
            omioItems.push(item);
          }
        }
      }

      if (omioItems.length > 0) {
        const omioUrls = omioItems.map(item => item.bookingUrl!);
        const trackingMap = await createTrackingLinks(omioUrls);

        let wrapped = 0;
        for (const item of omioItems) {
          const tracked = trackingMap.get(item.bookingUrl!);
          if (tracked) {
            item.originalOmioUrl = item.bookingUrl;
            item.bookingUrl = tracked;
            wrapped++;
          }
        }
      }
    } catch (error) {
      console.warn('[AI] Impact tracking post-processing error (non bloquant):', error);
    }
  }

  // Corriger les types d'items mal classés (restaurants en activité)
  const RESTAURANT_KEYWORDS = [
    'restaurant', 'cafe', 'café', 'bistro', 'pizzeria', 'trattoria',
    'brasserie', 'diner', 'eatery', 'grill', 'steakhouse', 'sushi',
    'tapas', 'bar', 'pub', 'tavern', 'cantina', 'osteria', 'bakery',
    'boulangerie', 'patisserie', 'coffee', 'brunch',
  ];

  // Anti-restaurant keywords: si présent, ne JAMAIS reclasser en restaurant
  const ACTIVITY_OVERRIDE_KEYWORDS = [
    'tour', 'excursion', 'croisière', 'cruise', 'sailing', 'voile',
    'kayak', 'vélo', 'bike', 'guide', 'visite guidée', 'guided',
    'experience', 'expérience', 'atelier', 'workshop', 'class', 'cours',
    'trek', 'hike', 'randonnée', 'snorkeling', 'surf', 'plongée',
    'spectacle', 'show', 'concert', 'flamenco', 'balade', 'walk',
    'discovering', 'découverte', 'exploration', 'safari', 'diving',
    'climbing', 'escalade', 'paddle', 'canoe', 'rafting',
    // Lieux / monuments / espaces publics — ne jamais reclasser
    'parc', 'park', 'parque', 'garden', 'jardin', 'jardí',
    'avenue', 'passeig', 'paseo', 'boulevard', 'rambla', 'via',
    'place', 'plaza', 'plaça', 'piazza', 'square', 'platz',
    'market', 'marché', 'mercat', 'mercado', 'mercato',
    'plage', 'playa', 'beach', 'platja', 'spiaggia',
    'zoo', 'aquarium', 'aquàrium',
    'musée', 'museum', 'museo', 'galerie', 'gallery',
    'église', 'church', 'iglesia', 'cathédrale', 'cathedral', 'basilica',
    'quartier', 'quarter', 'barrio', 'barri', 'district', 'neighborhood',
    'monument', 'fontaine', 'fountain', 'fuente', 'font',
    'torre', 'tower', 'mirador', 'viewpoint', 'lookout',
    'castle', 'château', 'castillo', 'castell', 'palace', 'palais', 'palau',
    'port', 'harbour', 'harbor', 'marina', 'pier',
  ];

  let typeFixCount = 0;
  for (const day of days) {
    for (const item of day.items) {
      const titleLower = (item.title || '').toLowerCase();

      // Si classé comme activité mais contient un mot-clé restaurant
      // MAIS PAS un mot-clé d'activité → reclasser
      if (item.type === 'activity') {
        // Ne JAMAIS reclasser un item vérifié (venant du pool SerpAPI/Google Places)
        // ou un item gratuit (un restaurant a toujours un coût > 0)
        if (item.dataReliability === 'verified' || item.estimatedCost === 0) continue;
        const hasRestaurantKw = RESTAURANT_KEYWORDS.some(kw => titleLower.includes(kw));
        const hasActivityKw = ACTIVITY_OVERRIDE_KEYWORDS.some(kw => titleLower.includes(kw));
        if (hasRestaurantKw && !hasActivityKw) {
          item.type = 'restaurant';
          typeFixCount++;
        }
      }
    }
  }
  if (typeFixCount > 0) {
  }

  // === 100% GPS PRECISION: Passe finale exhaustive ===
  // Vérifie TOUS les items non-vérifiés via chaîne complète (Travel Places → Nominatim → Gemini → SerpAPI)
  try {
    resetResolutionStats();

    // Collecter TOUS les items qui ont besoin de vérification
    const itemsToVerify: TripItem[] = [];

    for (const day of days) {
      for (const item of day.items) {
        // Skip flights et transports (coords aéroport = toujours verified)
        if (['flight', 'transport'].includes(item.type)) continue;

        // Item sans coords ou marqué non-verified
        const hasNoCoords = !item.latitude || !item.longitude;
        const isNearCenter = item.latitude && item.longitude && destCoords &&
          calculateDistance(item.latitude, item.longitude, destCoords.lat, destCoords.lng) < 0.2;
        const isNotVerified = item.dataReliability !== 'verified';

        // Items logistiques au centre-ville (check-in, checkout) → acceptable si hébergement n'a pas de coords
        const isLogistic = ['checkin', 'checkout', 'hotel'].includes(item.type);

        if ((hasNoCoords || (isNearCenter && isNotVerified)) && !isLogistic) {
          if (item.title && !item.title.includes('Centre-ville') && !item.title.includes('pique-nique')) {
            itemsToVerify.push(item);
          }
        }
      }
    }


    // Résolution par batch de 5 en parallèle (respecte rate limits tout en accélérant)
    let enrichedCount = 0;
    const BATCH_SIZE = 5;
    for (let i = 0; i < itemsToVerify.length; i += BATCH_SIZE) {
      const batch = itemsToVerify.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(async (item) => {
        const resolved = await resolveCoordinates(item.title, preferences.destination, destCoords, item.type as 'attraction' | 'restaurant');
        if (resolved) {
          const oldCoords = `${item.latitude?.toFixed(4)},${item.longitude?.toFixed(4)}`;
          item.latitude = resolved.lat;
          item.longitude = resolved.lng;
          item.dataReliability = 'verified';
          enrichedCount++;
        }
      }));
    }

    const stats = getResolutionStats();
    if (enrichedCount > 0) {
    }
  } catch (error) {
    console.warn('[AI] Enrichissement coordonnées échoué (non bloquant):', error);
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
        item.omioFlightUrl = generateFlightOmioLink(
          item.flight.departureCity || item.flight.departureAirportCode,
          item.flight.arrivalCity || item.flight.arrivalAirportCode,
          item.flight.departureTime.split('T')[0]
        );

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

  // Mapper le regime alimentaire pour le calcul carbone
  const carbonDietType = (() => {
    if (preferences.dietary?.includes('vegan')) return 'vegan';
    if (preferences.dietary?.includes('vegetarian')) return 'vegetarian';
    return 'tourist_default';
  })();

  const carbonData = calculateTripCarbon({
    flightDistanceKm: selectedTransport?.mode === 'plane' ? travelDistance : 0,
    returnFlight: true,
    passengers: preferences.groupSize,
    cabinClass: outboundFlight?.cabinClass || 'economy',
    nights: preferences.durationDays - 1,
    accommodationType: accommodation?.type === 'apartment' || accommodation?.type === 'bnb'
      ? 'apartment'
      : accommodation?.type === 'hostel' ? 'hostel' : 'hotel',
    accommodationStars: accommodation?.stars
      || (preferences.budgetLevel === 'luxury' ? 5
        : preferences.budgetLevel === 'comfort' ? 4 : 3),
    localTransportKm: preferences.durationDays * 15,
    dietType: carbonDietType,
    activityTypes: preferences.activities || [],
  });

  // Ajuster le CO2 si transport non-avion
  if (selectedTransport && selectedTransport.mode !== 'plane') {
    carbonData.flights = transportCO2;
    carbonData.total = carbonData.flights + carbonData.accommodation
      + carbonData.localTransport + carbonData.food + carbonData.activities;
    // Recalculer la note (seuils ADEME ajustes)
    if (carbonData.total < 200) carbonData.rating = 'A';
    else if (carbonData.total < 400) carbonData.rating = 'B';
    else if (carbonData.total < 700) carbonData.rating = 'C';
    else if (carbonData.total < 1200) carbonData.rating = 'D';
    else carbonData.rating = 'E';
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
      food: carbonData.food,
      activities: carbonData.activities,
      rating: carbonData.rating,
      equivalents: {
        treesNeeded: carbonData.equivalents.treesNeeded,
        carKmEquivalent: carbonData.equivalents.carKmEquivalent,
      },
      tips: carbonData.tips,
    },
    travelTips: travelTipsData || undefined,
    // Pool complet d'activités rankées (pour swap et insert day intelligent)
    attractionPool: selectedAttractions,
  };

  // VALIDATION ET CORRECTION AUTOMATIQUE
  // 1. Vérifie la cohérence logique (vol -> transfert -> hotel -> activités)
  const coherenceValidatedTrip = validateAndFixTrip(initialTrip);

  // 2. Vérifie la cohérence géographique (toutes les activités dans la destination)
  // Supprime automatiquement les lieux trop loin de la destination
  await validateTripGeography(coherenceValidatedTrip, cityCenter, true, preferences.destination);

  // Quality summary — 100% GPS precision target
  let verifiedCount = 0, estimatedCount = 0, generatedCount = 0, totalCount = 0;
  const unverifiedItems: string[] = [];
  for (const day of coherenceValidatedTrip.days) {
    for (const item of (day.items || [])) {
      if (['flight', 'transport'].includes(item.type)) continue; // Skip transport items
      totalCount++;
      if (item.dataReliability === 'verified') verifiedCount++;
      else if (item.dataReliability === 'estimated') {
        estimatedCount++;
        unverifiedItems.push(`${item.title} (estimated)`);
      } else if (item.dataReliability === 'generated') {
        generatedCount++;
        unverifiedItems.push(`${item.title} (generated)`);
      } else {
        estimatedCount++;
        unverifiedItems.push(`${item.title} (unmarked)`);
      }
    }
  }
  if (unverifiedItems.length > 0) {
    console.warn(`[AI] ⚠️ Items non-vérifiés:`, unverifiedItems);
  }

  return coherenceValidatedTrip;
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
