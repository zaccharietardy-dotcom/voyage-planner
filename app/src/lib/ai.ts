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
import { findViatorProduct, searchViatorActivities, isViatorConfigured } from './services/viator';
import { findTiqetsProduct, getKnownTiqetsLink, isTiqetsRelevant } from './services/tiqets';
import { getMustSeeAttractions } from './services/attractions';

import { generateId, normalizeToLocalDate, formatDate, formatTime, formatPriceLevel, pickDirectionMode, getAccommodationBookingUrl, getHotelLocationName, getBudgetCabinClass, getBudgetPriceLevel, getReliableGoogleMapsPlaceUrl } from './tripUtils';
import { findBestFlights, selectFlightByBudget, LateFlightArrivalData } from './tripFlights';
import { fixAttractionDuration, fixAttractionCost, estimateTotalAvailableTime, preAllocateAttractions } from './tripAttractions';
import { shouldSelfCater, findRestaurantForMeal, usedRestaurantIds } from './tripMeals';
import { generateDayWithScheduler, getDayContext, TimeSlot, DayContext } from './tripDay';

/**
 * Génère un voyage complet avec toute la logistique
 */
export async function generateTripWithAI(preferences: TripPreferences): Promise<Trip> {
  const T0 = Date.now();
  const elapsed = () => `${((Date.now() - T0) / 1000).toFixed(1)}s`;
  console.log('Generating trip with preferences:', preferences);

  // RESET: Nettoyer les trackers de la session précédente pour éviter les doublons inter-voyages
  usedRestaurantIds.clear();

  // 1. Trouver les coordonnées et aéroports (avec fallback Nominatim async)
  console.log(`[PERF ${elapsed()}] Start geocoding`);
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

  console.log(`[PERF ${elapsed()}] Geocoding done`);
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
  console.log(`[PERF ${elapsed()}] Start parallel batch (attractions+hotels+tips+budget)`);
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
  console.log(`[PERF ${elapsed()}] Parallel batch done`);
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
      console.log('[AI] Aucun apartment trouvé dans Booking, utilisation des hôtels existants uniquement');
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

      console.log(`[PERF ${elapsed()}] Start flight search`);
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

  // Recherche spécifique des mustSee — ces attractions DOIVENT apparaître dans le voyage
  const mustSeeNames = new Set<string>();
  if (preferences.mustSee?.trim()) {
    console.log('[AI] Recherche des mustSee spécifiques...');
    console.log(`[PERF ${elapsed()}] Start must-see search`);
    const mustSeeAttractions = await searchMustSeeAttractions(
      preferences.mustSee,
      preferences.destination,
      cityCenter
    );
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
    console.log(`[AI] ${mustSeeNames.size} mustSee marquées: ${[...mustSeeNames].join(', ')}`);
  }

  console.log(`[AI] Pool SerpAPI: ${attractionPool.length} attractions`);

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
      console.log(`[AI] ✅ Injecté ${injectedCount} must-see curés: ${curatedMustSee.slice(0, injectedCount).map(a => a.name).join(', ')}`);
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

  // Mixer avec des activités Viator originales (food tours, kayak, etc.)
  if (isViatorConfigured()) {
    try {
      console.log('[AI] 🎭 Recherche activités Viator originales...');
      console.log(`[PERF ${elapsed()}] Start Viator search`);
      const viatorActivities = await searchViatorActivities(preferences.destination, cityCenter, {
        types: preferences.activities,
        limit: 20,
      });

      if (viatorActivities.length > 0) {
        // Filtrer les doublons (même nom qu'une attraction SerpAPI)
        const existingNames = new Set(attractionPool.map(a => a.name.toLowerCase()));
        const uniqueViator = viatorActivities.filter(v => {
          const vName = v.name.toLowerCase();
          return !existingNames.has(vName) &&
            ![...existingNames].some(n => n.includes(vName) || vName.includes(n));
        });

        // Prioriser : food tours, outdoor, experiences (pas culture/musées déjà couverts par SerpAPI)
        const experientialTypes = new Set(['gastronomy', 'adventure', 'nature', 'nightlife', 'wellness', 'beach']);
        const experiential = uniqueViator.filter(v => experientialTypes.has(v.type));
        const others = uniqueViator.filter(v => !experientialTypes.has(v.type));

        // Ajouter ~2 activités Viator par jour de voyage (expérientielles en priorité)
        const viatorToAdd = [...experiential, ...others].slice(0, Math.min(preferences.durationDays * 2, 8));

        if (viatorToAdd.length > 0) {
          attractionPool.push(...viatorToAdd);
          console.log(`[AI] ✅ ${viatorToAdd.length} activités Viator ajoutées (${experiential.length} expérientielles)`);
        }
      }
    } catch (error) {
      console.warn('[AI] Viator mixing error (non bloquant):', error);
    }
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
    console.log(`[PERF ${elapsed()}] Start Claude itinerary`);
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
          console.log(`[AI] Filtré attraction non pertinente: "${a.name}"`);
          return false;
        }
        if (venuePatterns.test(a.name)) {
          console.log(`[AI] Filtré salle de concert/venue: "${a.name}"`);
          return false;
        }
        if (restaurantPatterns.test(a.name)) {
          console.log(`[AI] Filtré restaurant dans le pool d'attractions: "${a.name}"`);
          return false;
        }
        if (genericLocationPattern.test(a.name)) {
          console.log(`[AI] Filtré titre générique de localisation: "${a.name}"`);
          return false;
        }
        // Filtrer les attractions de type "gastronomy" qui sont des restaurants déguisés
        if (a.type === 'gastronomy' && !a.mustSee) {
          console.log(`[AI] Filtré attraction gastronomie: "${a.name}" (type=${a.type})`);
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

  // Scoring diversité : réordonner pour éviter les activités consécutives du même type
  for (let i = 0; i < attractionsByDay.length; i++) {
    const dayAttrs = attractionsByDay[i];
    if (dayAttrs.length <= 2) continue;

    const reordered: Attraction[] = [];
    const remaining = [...dayAttrs];

    // Garder le premier (souvent mustSee)
    reordered.push(remaining.shift()!);

    while (remaining.length > 0) {
      const lastType = reordered[reordered.length - 1].type;
      // Chercher la prochaine attraction d'un type DIFFÉRENT
      const diffTypeIdx = remaining.findIndex(a => a.type !== lastType);
      if (diffTypeIdx >= 0) {
        reordered.push(remaining.splice(diffTypeIdx, 1)[0]);
      } else {
        // Tous du même type restant, ajouter tel quel
        reordered.push(remaining.shift()!);
      }
    }

    attractionsByDay[i] = reordered;
  }

  // ENFORCEMENT: Vérifier que tous les mustSee sont dans au moins un jour
  // Si un mustSee manque, le forcer dans le jour avec le moins d'attractions
  if (mustSeeNames.size > 0) {
    const scheduledNames = new Set(
      attractionsByDay.flat().map(a => a.name.toLowerCase())
    );
    const missingMustSees = attractionPool.filter(
      a => a.mustSee && !scheduledNames.has(a.name.toLowerCase())
    );
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
      console.log(`[AI] ⚠️ Must-see forcé: "${missing.name}" ajouté au jour ${bestDay + 1}`);
    }
  }

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

  console.log(`[PERF ${elapsed()}] Start day generation loop (${preferences.durationDays} days)`);
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
    console.log(`[PERF ${elapsed()}] Generating day ${dayNumber}`);
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

  // Validation post-génération : supprimer les séquences consigne→récupération incohérentes (< 2h)
  for (const day of days) {
    const luggageDropIdx = day.items.findIndex(i => i.title.includes('Dépôt bagages en consigne'));
    const luggagePickupIdx = day.items.findIndex(i => i.title.includes('Récupération bagages'));
    if (luggageDropIdx >= 0 && luggagePickupIdx >= 0) {
      const dropEnd = parseTime(day.date, day.items[luggageDropIdx].endTime);
      const pickupStart = parseTime(day.date, day.items[luggagePickupIdx].startTime);
      const gapMinutes = (pickupStart.getTime() - dropEnd.getTime()) / (60 * 1000);
      if (gapMinutes < 120) {
        console.log(`[Validation] Suppression consigne incohérente Jour ${day.dayNumber}: ${Math.round(gapMinutes)}min entre dépôt et récupération`);
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
        console.log(`[PostProcess] Supprimé venue: "${title}"`);
        return false;
      }

      // Filter show venues/cabarets ONLY during daytime (before 18h)
      // These are OK for evening activities
      if (isDaytimeActivity(item) && badItemPatterns.showVenues.test(combined)) {
        console.log(`[PostProcess] Supprimé spectacle en journée: "${title}" à ${item.startTime}`);
        return false;
      }

      // Filter Michelin restaurants proposed as activities (not restaurant type)
      if (badItemPatterns.michelinRestaurants.test(combined)) {
        console.log(`[PostProcess] Supprimé restaurant Michelin comme activité: "${title}"`);
        return false;
      }

      // Filter generic location titles
      if (badItemPatterns.genericLocations.test(title)) {
        console.log(`[PostProcess] Supprimé titre générique: "${title}"`);
        return false;
      }

      // Filter duplicate cruises (keep only first one)
      if (cruiseKeywords.test(title)) {
        if (hasCruise) {
          console.log(`[PostProcess] Supprimé croisière doublon: "${title}"`);
          return false;
        }
        hasCruise = true;
      }

      // Filter duplicate food tours (keep only first one)
      if (foodTourKeywords.test(title)) {
        if (hasFoodTour) {
          console.log(`[PostProcess] Supprimé food tour doublon: "${title}"`);
          return false;
        }
        hasFoodTour = true;
      }

      return true;
    });

    if (day.items.length < beforeCount) {
      console.log(`[PostProcess] Jour ${day.dayNumber}: ${beforeCount - day.items.length} item(s) supprimé(s)`);
      // Re-index orderIndex
      day.items.forEach((item, idx) => { item.orderIndex = idx; });
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

      console.log(`[PERF ${elapsed()}] Start Gemini enrichment`);
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

  // Post-processing Viator: attacher des liens Viator aux activités sans bookingUrl
  if (isViatorConfigured()) {
    try {
      const activitiesWithoutUrl = days.flatMap(day =>
        day.items.filter(item =>
          item.type === 'activity' && !item.bookingUrl && item.title
        )
      );

      if (activitiesWithoutUrl.length > 0) {
        console.log(`[AI] 🎭 Matching Viator pour ${activitiesWithoutUrl.length} activités sans lien...`);
        // Limiter à 10 requêtes Viator pour ne pas ralentir
        const toMatch = activitiesWithoutUrl.slice(0, 10);
        console.log(`[PERF ${elapsed()}] Start Viator matching`);
        const viatorResults = await Promise.all(
          toMatch.map(item => findViatorProduct(item.title, preferences.destination))
        );

        let matched = 0;
        for (let i = 0; i < toMatch.length; i++) {
          const result = viatorResults[i];
          if (result) {
            toMatch[i].bookingUrl = result.url;
            if (!toMatch[i].estimatedCost && result.price > 0) {
              toMatch[i].estimatedCost = result.price;
            }
            matched++;
          } else {
            // Fallback: Try Tiqets for museums and attractions without Viator match
            const knownTiqetsLink = getKnownTiqetsLink(toMatch[i].title);
            if (knownTiqetsLink) {
              toMatch[i].bookingUrl = knownTiqetsLink;
              console.log(`[AI] 🎫 Tiqets lien direct: ${toMatch[i].title}`);
              matched++;
            } else if (isTiqetsRelevant(toMatch[i].title, toMatch[i].type)) {
              const tiqetsResult = await findTiqetsProduct(toMatch[i].title, preferences.destination);
              if (tiqetsResult) {
                toMatch[i].bookingUrl = tiqetsResult.url;
                console.log(`[AI] 🎫 Tiqets recherche: ${toMatch[i].title}`);
                matched++;
              }
            }
          }
        }
        console.log(`[AI] ✅ ${matched}/${toMatch.length} activités matchées avec Viator/Tiqets`);
      }
    } catch (error) {
      console.warn('[AI] Viator post-processing error (non bloquant):', error);
    }
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

  console.log(`[PERF ${elapsed()}] ✅ Trip generation complete`);
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
