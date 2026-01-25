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
  Flight,
  ParkingOption,
  BudgetLevel,
  TransportOptionSummary,
} from './types';
import { findNearbyAirports, calculateDistance, AirportInfo, getCityCenterCoords } from './services/geocoding';
import { searchFlights, formatFlightDuration } from './services/flights';
import { selectBestParking, calculateParkingTime } from './services/parking';
import { searchRestaurants, selectBestRestaurant, estimateMealPrice } from './services/restaurants';
import { Attraction, estimateTravelTime, hasAttractionData } from './services/attractions';
import { selectAttractionsAsync } from './services/attractionsServer';
import { getDirections, generateGoogleMapsUrl, generateGoogleMapsSearchUrl, DirectionsResult } from './services/directions';
import { calculateTripCarbon } from './services/carbon';
import { compareTransportOptions, TransportOption } from './services/transport';
import { DayScheduler, formatTime as formatScheduleTime, parseTime } from './services/scheduler';
import { searchHotels, selectBestHotel } from './services/hotels';
import { validateAndFixTrip } from './services/coherenceValidator';
import { validateTripGeography } from './services/geoValidator';
import { searchLuggageStorage, selectBestStorage, needsLuggageStorage, LuggageStorage } from './services/luggageStorage';
import { calculateFlightScore, EARLY_MORNING_PENALTY } from './services/flightScoring';
import { createLocationTracker, TravelerLocation } from './services/locationTracker';
import { generateFlightLink, generateHotelLink, formatDateForUrl } from './services/linkGenerator';

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
 * Génère un voyage complet avec toute la logistique
 */
export async function generateTripWithAI(preferences: TripPreferences): Promise<Trip> {
  console.log('Generating trip with preferences:', preferences);

  // RESET: Nettoyer les trackers de la session précédente pour éviter les doublons inter-voyages
  usedRestaurantIds.clear();

  // 1. Trouver les coordonnées et aéroports
  const originAirports = findNearbyAirports(preferences.origin);
  const destAirports = findNearbyAirports(preferences.destination);

  // Coordonnées d'origine et destination
  // IMPORTANT: Utiliser getCityCenterCoords() comme fallback principal, PAS l'aéroport!
  // L'aéroport peut être à 15-30km du centre-ville (ex: BCN El Prat = 41.29, 2.07 vs centre = 41.38, 2.17)
  const originCityCenter = getCityCenterCoords(preferences.origin);
  const originCoords = preferences.originCoords || originCityCenter || (originAirports[0] ? {
    lat: originAirports[0].latitude,
    lng: originAirports[0].longitude,
  } : { lat: 48.8566, lng: 2.3522 }); // Paris par défaut

  // CORRECTION CRITIQUE: Utiliser le VRAI centre-ville, pas l'aéroport
  const destCityCenter = getCityCenterCoords(preferences.destination);
  const destCoords = preferences.destinationCoords || destCityCenter || (destAirports[0] ? {
    lat: destAirports[0].latitude,
    lng: destAirports[0].longitude,
  } : { lat: 41.3851, lng: 2.1734 }); // Barcelona par défaut

  console.log(`[AI] Centre-ville destination: ${preferences.destination} → ${destCoords.lat.toFixed(4)}, ${destCoords.lng.toFixed(4)}`);
  if (destCityCenter) {
    console.log(`[AI] ✓ Utilisation des coords centre-ville depuis getCityCenterCoords()`);
  } else {
    console.warn(`[AI] ⚠ Pas de centre-ville connu pour "${preferences.destination}", fallback utilisé`);
  }

  // 2. Comparer les options de transport
  console.log('Comparaison des options de transport...');
  const transportOptions = await compareTransportOptions({
    origin: preferences.origin,
    originCoords,
    destination: preferences.destination,
    destCoords,
    date: new Date(preferences.startDate),
    passengers: preferences.groupSize,
    preferences: {
      prioritize: preferences.budgetLevel === 'economic' ? 'price' :
                  preferences.budgetLevel === 'luxury' ? 'time' : 'balanced',
      forceIncludeMode: preferences.transport, // Forcer l'inclusion du mode choisi par l'utilisateur
    },
  });

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
  }));

  // Sélectionner la meilleure option (ou celle choisie par l'utilisateur via preferences.transport)
  let selectedTransport = transportOptions.find(t => t.recommended) || transportOptions[0];

  // Si l'utilisateur a spécifié un mode de transport, RESPECTER son choix
  if (preferences.transport) {
    const userPreferred = transportOptions.find(t => t.mode === preferences.transport);
    if (userPreferred) {
      selectedTransport = userPreferred;
      console.log(`Mode de transport choisi par l'utilisateur: ${preferences.transport}`);
    } else {
      // L'option demandée n'existe pas dans les résultats
      // Pour 'plane', c'est probablement parce que la distance est trop courte (< 300km)
      console.warn(`Mode de transport "${preferences.transport}" demandé mais non disponible pour cette destination`);
      console.warn(`Options disponibles: ${transportOptions.map(t => t.mode).join(', ')}`);
      // On garde quand même le mode recommandé mais on log clairement
    }
  }

  console.log(`Transport sélectionné: ${selectedTransport?.mode} (score: ${selectedTransport?.score}/10)`);

  // 3. Dates du voyage
  // IMPORTANT: Normaliser les dates pour éviter les problèmes de timezone
  // preferences.startDate peut être "2026-01-27T23:00:00.000Z" (UTC) qui donne le 28 en local
  // On extrait YYYY-MM-DD et on crée une date locale à midi pour éviter les décalages
  const startDate = normalizeToLocalDate(preferences.startDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + preferences.durationDays - 1);

  console.log(`[AI] Date de départ normalisée: ${startDate.toDateString()} (input: ${preferences.startDate})`);

  // 4. Si avion, rechercher les vols détaillés
  let outboundFlight: Flight | null = null;
  let returnFlight: Flight | null = null;
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
        preferences
      );

      outboundFlight = flightResult.outboundFlight;
      returnFlight = flightResult.returnFlight;
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
  if (preferences.needsParking !== false && selectedTransport?.mode === 'plane' && originAirport) {
    parking = selectBestParking(originAirport.code, preferences.durationDays, preferences.budgetLevel || 'moderate');
  }

  // 7. Vérifier si on a des données d'attractions pour cette destination
  // Note: Si pas en cache local, Claude sera appelé automatiquement via selectAttractionsAsync
  if (!hasAttractionData(preferences.destination)) {
    console.log(`Destination ${preferences.destination} pas en cache - recherche via Claude AI...`);
  }

  // 8. Sélectionner les attractions à faire (priorité aux demandes utilisateur)
  // LIMITE: 3-4 activités par jour pour remplir correctement les journées
  const maxAttractionsPerDay = 4;
  // Augmenter le nombre total d'attractions en fonction de la durée (2-3 par jour)
  const totalAttractions = Math.min(preferences.durationDays * maxAttractionsPerDay, 20);
  const totalAvailableMinutes = estimateTotalAvailableTime(preferences.durationDays, outboundFlight, returnFlight);

  // Utiliser la version async qui appelle les APIs externes si pas en cache local
  const selectedAttractions = await selectAttractionsAsync(preferences.destination, totalAvailableMinutes, {
    types: preferences.activities,
    mustSeeQuery: preferences.mustSee,
    prioritizeMustSee: true,
    maxPerDay: totalAttractions,
    cityCenter, // Pour Foursquare Places API
  });

  console.log(`Attractions sélectionnées (${selectedAttractions.length}): ${selectedAttractions.map(a => a.name).join(', ')}`);

  // 7. Pré-allouer les attractions aux jours (SANS RÉPÉTITION)
  const attractionsByDay = preAllocateAttractions(
    selectedAttractions,
    preferences.durationDays,
    cityCenter
  );

  // 7.5 Rechercher les hôtels disponibles
  console.log('Recherche des hôtels...');
  const accommodationOptions = await searchHotels(preferences.destination, {
    budgetLevel: preferences.budgetLevel as 'economic' | 'moderate' | 'luxury',
    cityCenter,
    checkInDate: startDate,
    checkOutDate: endDate,
    guests: preferences.groupSize,
  });
  const accommodation = selectBestHotel(accommodationOptions, {
    budgetLevel: preferences.budgetLevel as 'economic' | 'moderate' | 'luxury',
  });
  console.log(`Hôtel sélectionné: ${accommodation?.name || 'Aucun'}`);

  // 8. Générer les jours avec le SCHEDULER (évite les chevauchements)
  const days: TripDay[] = [];

  // ANTI-DOUBLON: Set partagé entre tous les jours pour éviter de répéter une attraction
  const tripUsedAttractionIds = new Set<string>();

  // Variable pour propager les vols tardifs au jour suivant
  let pendingLateFlightData: LateFlightArrivalData | undefined;

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
      lateFlightArrivalData: pendingLateFlightData, // Données du vol tardif du jour précédent
    });

    days.push({
      dayNumber,
      date: dayDate,
      items: dayResult.items,
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

  // Calculer le coût total
  const costBreakdown = calculateCostBreakdown(days, outboundFlight, returnFlight, parking, preferences);

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
    accommodationOptions: accommodationOptions.length > 0 ? accommodationOptions : undefined,
    totalEstimatedCost: Object.values(costBreakdown).reduce((a, b) => a + b, 0),
    costBreakdown,
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
  preferences: TripPreferences
): Promise<{
  outboundFlight: Flight | null;
  returnFlight: Flight | null;
  originAirport: AirportInfo;
  destAirport: AirportInfo;
}> {
  let bestOutboundFlight: Flight | null = null;
  let bestReturnFlight: Flight | null = null;
  let bestOriginAirport: AirportInfo = originAirports[0];
  let bestDestAirport: AirportInfo = destAirports[0];
  let bestTotalPrice = Infinity;

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

            if (totalPrice < bestTotalPrice || bestOutboundFlight === null) {
              bestTotalPrice = totalPrice;
              bestOutboundFlight = outbound;
              bestReturnFlight = returnFlight;
              bestOriginAirport = originAirport;
              bestDestAirport = destAirport;
              console.log(`→ Meilleure option: ${originAirport.code}→${destAirport.code} à ${totalPrice}€`);
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
    returnFlight: bestReturnFlight,
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
  const maxPerDay = 4; // Maximum 4 attractions par jour (pour mieux remplir la journee)
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

  // Distribution équitable: chaque jour reçoit des attractions uniques
  let currentDayIndex = 0;

  for (const attraction of availableAttractions) {
    // Vérifier que cette attraction n'a pas déjà été utilisée
    if (usedIds.has(attraction.id)) {
      continue;
    }

    // Trouver le prochain jour qui peut accueillir une attraction
    let attempts = 0;
    while (result[currentDayIndex].length >= maxPerDay && attempts < totalDays) {
      currentDayIndex = (currentDayIndex + 1) % totalDays;
      attempts++;
    }

    // Si tous les jours sont pleins, arrêter
    if (attempts >= totalDays) {
      break;
    }

    // Ajouter l'attraction au jour actuel
    result[currentDayIndex].push(attraction);
    usedIds.add(attraction.id);

    // Passer au jour suivant pour la prochaine attraction
    currentDayIndex = (currentDayIndex + 1) % totalDays;
  }

  console.log(`[Pre-allocation] ${usedIds.size} attractions uniques réparties sur ${totalDays} jours`);
  for (let d = 0; d < totalDays; d++) {
    console.log(`  Jour ${d + 1}: ${result[d].map(a => a.name).join(', ') || 'aucune'}`);
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

async function generateDayWithScheduler(params: {
  dayNumber: number;
  date: Date;
  isFirstDay: boolean;
  isLastDay: boolean;
  attractions: Attraction[];
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
  lateFlightArrivalData?: LateFlightArrivalData | null; // Vol tardif du jour précédent à traiter
}): Promise<{ items: TripItem[]; lateFlightForNextDay?: LateFlightArrivalData }> {
  const {
    dayNumber,
    date,
    isFirstDay,
    isLastDay,
    attractions,
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
    lateFlightArrivalData, // Vol tardif à traiter en début de journée
  } = params;

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
      dayStart = new Date(arrivalTime.getTime() + 50 * 60 * 1000); // +50min check-in
      console.log(`[Jour ${dayNumber}] Transport terrestre arrive à ${arrivalTime.toLocaleTimeString('fr-FR')}, activités possibles à partir de ${dayStart.toLocaleTimeString('fr-FR')}`);
    }
  }

  if (isLastDay) {
    if (returnFlight) {
      // Dernier jour avec vol: disponible jusqu'au check-out (3h30 avant depart)
      const departureTime = new Date(returnFlight.departureTime);
      const checkoutTime = new Date(departureTime.getTime() - 210 * 60 * 1000);

      // FIX BUG: Si checkout est AVANT dayStart, pas d'activités possibles
      // On ne doit JAMAIS étendre dayEnd au-delà du checkout pour éviter les conflits
      if (checkoutTime <= dayStart) {
        // Vol très matinal: pas d'activités, juste la logistique
        console.log(`[Jour ${dayNumber}] Vol matinal (départ ${departureTime.getHours()}h) - checkout ${checkoutTime.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})} <= dayStart ${dayStart.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})} → Pas d'activités`);
        dayEnd = dayStart; // Aucune activité possible
      } else {
        // Cas normal: activités jusqu'au checkout
        dayEnd = checkoutTime;
        console.log(`[Jour ${dayNumber}] Dernier jour - activités jusqu'à ${checkoutTime.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})} (checkout)`);
      }
    } else if (groundTransport) {
      // Dernier jour transport terrestre: check-out a 10h, activites jusqu'a 09:30
      const targetEnd = parseTime(date, '09:30'); // 30min avant checkout (10:00)

      // FIX: Si checkout est AVANT dayStart, pas d'activités
      if (targetEnd <= dayStart) {
        console.log(`[Jour ${dayNumber}] Transport matinal - checkout avant dayStart → Pas d'activités`);
        dayEnd = dayStart;
      } else {
        dayEnd = targetEnd;
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

  // === TRAITER UN VOL TARDIF DU JOUR PRÉCÉDENT ===
  // Si on a des données d'arrivée tardive à traiter (vol arrivé après 22h la veille)
  if (lateFlightArrivalData && !isFirstDay) {
    console.log(`[Jour ${dayNumber}] Traitement de l'arrivée tardive du vol de la veille`);
    const { flight: lateArrivalFlight, destAirport: lateDestAirport, accommodation: lateAccommodation } = lateFlightArrivalData;

    // Le vol est arrivé tard hier, donc on commence la journée par le transfert et check-in
    const flightArrival = new Date(lateArrivalFlight.arrivalTime);

    // Calculer l'heure de début effective (le lendemain matin, pas à 00:25!)
    // On commence à 08:00 car le voyageur a probablement dormi à l'aéroport/hôtel proche
    const transferStart = parseTime(date, '08:00');
    const transferEnd = new Date(transferStart.getTime() + 40 * 60 * 1000);

    const hotelCheckInTime = lateAccommodation?.checkInTime || '15:00';
    const [checkInHour, checkInMin] = hotelCheckInTime.split(':').map(Number);
    const hotelCheckInDate = new Date(date);
    hotelCheckInDate.setHours(checkInHour, checkInMin, 0, 0);

    // Transfert aéroport → centre-ville/hôtel
    const transferItem = scheduler.insertFixedItem({
      id: generateId(),
      title: 'Transfert Aéroport → Centre-ville',
      type: 'transport',
      startTime: transferStart,
      endTime: transferEnd,
    });
    if (transferItem) {
      locationTracker.landFlight(preferences.destination, formatScheduleTime(transferEnd));
      items.push(schedulerItemToTripItem(transferItem, dayNumber, orderIndex++, {
        description: preferences.carRental ? 'Récupérez votre voiture de location.' : 'Taxi ou transports en commun vers le centre-ville.',
        locationName: `${lateDestAirport.name} → Centre-ville`,
        latitude: cityCenter.lat,
        longitude: cityCenter.lng,
        estimatedCost: preferences.carRental ? 0 : 25 * Math.ceil(preferences.groupSize / 4),
      }));
    }

    // Check-in hôtel (à l'heure officielle ou après transfert si on arrive plus tard)
    const hotelCheckinStart = transferEnd > hotelCheckInDate ? transferEnd : hotelCheckInDate;
    const hotelCheckinEnd = new Date(hotelCheckinStart.getTime() + 20 * 60 * 1000);
    const hotelName = lateAccommodation?.name || 'Hébergement';

    // Si on arrive AVANT l'heure de check-in, on a du temps libre pour des activités
    // Le curseur reste à transferEnd pour que les activités soient générées AVANT le check-in
    const hasFreeMorning = transferEnd < hotelCheckInDate;
    if (hasFreeMorning) {
      const freeTime = (hotelCheckInDate.getTime() - transferEnd.getTime()) / (1000 * 60 * 60);
      console.log(`[Jour ${dayNumber}] VOL TARDIF: ${freeTime.toFixed(1)}h de temps libre entre transfert (${formatScheduleTime(transferEnd)}) et check-in (${formatScheduleTime(hotelCheckInDate)})`);
      // Le curseur reste à transferEnd, les activités seront ajoutées naturellement
      // Le check-in sera inséré comme item fixe à 15h, les activités iront autour
    }

    // Insérer le check-in comme item fixe (les activités avec addItem éviteront ce créneau)
    const hotelItem = scheduler.insertFixedItem({
      id: generateId(),
      title: `Check-in ${hotelName}`,
      type: 'hotel',
      startTime: hotelCheckinStart,
      endTime: hotelCheckinEnd,
    });
    if (hotelItem) {
      const hotelCheckOutDate = new Date(preferences.startDate);
      hotelCheckOutDate.setDate(hotelCheckOutDate.getDate() + preferences.durationDays - 1);
      const hotelBookingUrl = lateAccommodation?.name
        ? generateHotelLink(
            { name: lateAccommodation.name, city: preferences.destination },
            { checkIn: formatDateForUrl(preferences.startDate), checkOut: formatDateForUrl(hotelCheckOutDate) }
          )
        : undefined;

      items.push(schedulerItemToTripItem(hotelItem, dayNumber, orderIndex++, {
        description: lateAccommodation ? `${lateAccommodation.stars}⭐ | ${lateAccommodation.rating?.toFixed(1)}/10 | ${lateAccommodation.pricePerNight}€/nuit` : 'Déposez vos affaires et installez-vous.',
        locationName: lateAccommodation?.address || `Hébergement, ${preferences.destination}`,
        latitude: lateAccommodation?.latitude || cityCenter.lat + 0.005,
        longitude: lateAccommodation?.longitude || cityCenter.lng + 0.005,
        bookingUrl: hotelBookingUrl,
      }));
    }

    // Positionner le curseur correctement pour les activités
    if (hasFreeMorning) {
      // On a du temps libre entre transfert (08:40) et check-in (15:00)
      // Avancer le curseur juste après le transfert pour que les activités y soient ajoutées
      scheduler.advanceTo(transferEnd);
      console.log(`[Jour ${dayNumber}] Curseur avancé à ${formatScheduleTime(transferEnd)} pour activités matinales`);
    } else {
      // Pas de temps libre, avancer après le check-in
      scheduler.advanceTo(hotelCheckinEnd);
    }
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
      const originCityNorm = preferences.origin.toLowerCase().trim();
      const airportCityNorm = originAirport.city.toLowerCase().trim();
      const originDifferentFromAirport = !airportCityNorm.includes(originCityNorm) && !originCityNorm.includes(airportCityNorm);

      // Calculer le temps de trajet vers l'aéroport si villes différentes
      let travelTimeMinutes = 0;
      let distanceToAirport = 0;
      const originCoordsLocal = getCityCenterCoords(preferences.origin) || cityCenter;

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
        // Origine = ville de l'aéroport, on part directement pour l'aéroport
        transferToAirportStart = parking
          ? new Date(airportArrival.getTime() - calculateParkingTime(parking) * 60 * 1000)
          : airportArrival;
        originDepartureTime = transferToAirportStart;
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

        // Calculer les dates de vol pour les liens de réservation
        const tripEndDate = new Date(preferences.startDate);
        tripEndDate.setDate(tripEndDate.getDate() + preferences.durationDays - 1);

        // DATES FIXES: Utiliser linkGenerator pour générer l'URL avec les dates sélectionnées par l'utilisateur
        const flightBookingUrl = generateFlightLink(
          { origin: originAirport.code, destination: destAirport.code },
          { date: formatDateForUrl(preferences.startDate), returnDate: formatDateForUrl(tripEndDate) }
        );

        // Créer l'item et surcharger les heures avec les heures locales de l'aéroport
        const tripItem = schedulerItemToTripItem(flightItem, dayNumber, orderIndex++, {
          description: `${outboundFlight.flightNumber} | ${formatFlightDuration(outboundFlight.duration)} | ${outboundFlight.stops === 0 ? 'Direct' : `${outboundFlight.stops} escale(s)`}`,
          locationName: `${originAirport.code} → ${destAirport.code}`,
          latitude: (originAirport.latitude + destAirport.latitude) / 2,
          longitude: (originAirport.longitude + destAirport.longitude) / 2,
          estimatedCost: outboundFlight.price,
          bookingUrl: flightBookingUrl,
        });
        // IMPORTANT: Surcharger les heures formatées avec les heures d'affichage correctes
        tripItem.startTime = outboundFlightStartTime;
        tripItem.endTime = outboundFlightEndTime;
        items.push(tripItem);
      }

      // === DÉTECTION VOL TARDIF ===
      // Si le vol arrive après 22h, les activités post-arrivée dépassent minuit
      // et doivent être reportées au jour suivant
      const arrivalHour = flightArrival.getHours();
      const isLateNightFlight = arrivalHour >= 22 || arrivalHour < 5; // Arrive après 22h ou avant 5h

      if (isLateNightFlight) {
        console.log(`[Jour ${dayNumber}] VOL TARDIF détecté: arrivée à ${arrivalHour}h → Report des activités d'arrivée au jour suivant`);
        // Stocker les infos pour le jour suivant
        lateFlightForNextDay = {
          flight: outboundFlight,
          destAirport,
          accommodation,
        };
        // Ne pas générer les activités post-arrivée aujourd'hui
        // Le jour suivant les traitera via lateFlightArrivalData
      } else {
        // Vol normal (arrivée avant 22h) - générer les activités post-arrivée normalement

      // Transfert aéroport → centre-ville/hôtel
      const transferStart = new Date(flightArrival.getTime() + 30 * 60 * 1000);
      const transferEnd = new Date(transferStart.getTime() + 40 * 60 * 1000);

      // RÈGLE 2: Vérifier si on arrive AVANT le check-in de l'hôtel
      // Si oui, on doit déposer les bagages dans une consigne
      const hotelCheckInTime = accommodation?.checkInTime || '15:00';
      const [checkInHour, checkInMin] = hotelCheckInTime.split(':').map(Number);
      const hotelCheckInDate = new Date(date);
      hotelCheckInDate.setHours(checkInHour, checkInMin, 0, 0);

      // Calculer l'heure d'arrivée effective (après transfert)
      const arrivalTimeStr = `${transferEnd.getHours().toString().padStart(2, '0')}:${transferEnd.getMinutes().toString().padStart(2, '0')}`;

      // Vérifier si on a besoin d'une consigne (arrivée > 1h avant check-in)
      const needsStorage = needsLuggageStorage(arrivalTimeStr, hotelCheckInTime);

      let luggageStorage: LuggageStorage | null = null;
      if (needsStorage) {
        console.log(`[Jour ${dayNumber}] Arrivée à ${arrivalTimeStr}, check-in à ${hotelCheckInTime} → Consigne à bagages nécessaire`);
        const nearLocation = { latitude: cityCenter.lat, longitude: cityCenter.lng };
        const storages = await searchLuggageStorage(preferences.destination, nearLocation);
        luggageStorage = selectBestStorage(storages, nearLocation);

        if (luggageStorage) {
          console.log(`[Jour ${dayNumber}] Consigne sélectionnée: ${luggageStorage.name}`);
        }
      }

      if (luggageStorage) {
        // FLUX AVEC CONSIGNE: Aéroport → Consigne → Activités → Consigne → Hôtel

        // Transfert aéroport → consigne à bagages
        const transferItem = scheduler.insertFixedItem({
          id: generateId(),
          title: 'Transfert Aéroport → Consigne bagages',
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
            description: preferences.carRental ? 'Récupérez votre voiture et allez déposer vos bagages.' : 'Taxi ou transports vers la consigne.',
            locationName: `${destAirport.name} → ${luggageStorage.name}`,
            latitude: luggageStorage.latitude || cityCenter.lat,
            longitude: luggageStorage.longitude || cityCenter.lng,
            estimatedCost: preferences.carRental ? 0 : 25 * Math.ceil(preferences.groupSize / 4),
          }));
        }

        // Dépôt des bagages
        const luggageDepositStart = transferEnd;
        const luggageDepositEnd = new Date(luggageDepositStart.getTime() + 15 * 60 * 1000);
        const depositItem = scheduler.insertFixedItem({
          id: generateId(),
          title: `Dépôt bagages: ${luggageStorage.name}`,
          type: 'luggage',
          startTime: luggageDepositStart,
          endTime: luggageDepositEnd,
        });
        if (depositItem) {
          items.push(schedulerItemToTripItem(depositItem, dayNumber, orderIndex++, {
            description: `Consigne ${luggageStorage.type === 'station' ? 'gare' : luggageStorage.type === 'service' ? 'partenaire' : ''} | ${luggageStorage.pricePerDay}€/jour | ${luggageStorage.openingHours.open}-${luggageStorage.openingHours.close}`,
            locationName: luggageStorage.address,
            latitude: luggageStorage.latitude || cityCenter.lat,
            longitude: luggageStorage.longitude || cityCenter.lng,
            estimatedCost: luggageStorage.pricePerDay,
            bookingUrl: luggageStorage.bookingUrl,
          }));
        }

        // Avancer le curseur après le dépôt bagages
        scheduler.advanceTo(luggageDepositEnd);

        // === ACTIVITÉS ET DÉJEUNER ENTRE DÉPÔT ET RÉCUPÉRATION ===
        // Temps disponible: de maintenant jusqu'à 30min avant check-in hôtel

        const luggagePickupStart = new Date(hotelCheckInDate.getTime() - 30 * 60 * 1000);
        const luggagePickupEnd = hotelCheckInDate;

        // Calculer le temps disponible pour les activités
        const timeAvailableMs = luggagePickupStart.getTime() - scheduler.getCurrentTime().getTime();
        const hoursAvailable = timeAvailableMs / (1000 * 60 * 60);
        console.log(`[Jour ${dayNumber}] Temps disponible entre bagages et hôtel: ${hoursAvailable.toFixed(1)}h`);

        // Si on a plus de 2h, on peut faire des activités!
        if (hoursAvailable >= 2) {
          // Déjeuner si c'est l'heure (entre 11h30 et 14h)
          const currentHourForLunch = scheduler.getCurrentTime().getHours();
          const currentMinForLunch = scheduler.getCurrentTime().getMinutes();
          const lunchTimeOk = (currentHourForLunch >= 11 && currentMinForLunch >= 30) || currentHourForLunch >= 12;
          const notTooLate = currentHourForLunch < 14;

          if (lunchTimeOk && notTooLate && hoursAvailable >= 3) {
            const lunchEndTime = new Date(scheduler.getCurrentTime().getTime() + 90 * 60 * 1000); // 1h30
            if (lunchEndTime < luggagePickupStart) {
              const lunchItem = scheduler.addItem({
                id: generateId(),
                title: 'Déjeuner',
                type: 'restaurant',
                duration: 75,
                travelTime: 15,
              });
              if (lunchItem) {
                const restaurant = await findRestaurantForMeal('lunch', cityCenter, preferences, dayNumber, lastCoords);
                const restaurantCoords = {
                  lat: restaurant?.latitude || cityCenter.lat,
                  lng: restaurant?.longitude || cityCenter.lng,
                };
                // URL Google Maps fiable avec nom + adresse complète
                const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
                  (restaurant ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${restaurant.name}, ${restaurant.address}`)}` : undefined);

                items.push(schedulerItemToTripItem(lunchItem, dayNumber, orderIndex++, {
                  title: restaurant?.name || 'Déjeuner',
                  description: restaurant ? `${restaurant.cuisineTypes.join(', ')} | ⭐ ${restaurant.rating?.toFixed(1)}/5` : 'Découvrez la cuisine locale',
                  locationName: restaurant?.address || `Centre-ville, ${preferences.destination}`,
                  latitude: restaurantCoords.lat,
                  longitude: restaurantCoords.lng,
                  estimatedCost: estimateMealPrice(getBudgetPriceLevel(preferences.budgetLevel), 'lunch') * preferences.groupSize,
                  rating: restaurant?.rating,
                  googleMapsPlaceUrl: restaurantGoogleMapsUrl,
                }));
                lastCoords = restaurantCoords;
                console.log(`[Jour ${dayNumber}] Déjeuner ajouté entre bagages`);
              }
            }
          }

          // Activités entre le dépôt et la récupération
          for (const attraction of attractions) {
            // LOCATION TRACKING: Vérifier que l'utilisateur est bien à destination
            const locationValidation = locationTracker.validateActivity({
              city: preferences.destination,
              name: attraction.name,
            });
            if (!locationValidation.valid) {
              console.log(`[LocationTracker] Skip "${attraction.name}": ${locationValidation.reason}`);
              continue;
            }

            // Vérifier qu'on a le temps AVANT la récupération des bagages
            const travelTime = estimateTravelTime({ latitude: lastCoords.lat, longitude: lastCoords.lng } as Attraction, attraction);
            const activityEndTime = new Date(scheduler.getCurrentTime().getTime() + (travelTime + attraction.duration + 15) * 60 * 1000);

            if (activityEndTime > luggagePickupStart) {
              console.log(`[Jour ${dayNumber}] Plus de temps pour activités avant récupération bagages`);
              break;
            }

            const activityItem = scheduler.addItem({
              id: generateId(),
              title: attraction.name,
              type: 'activity',
              duration: attraction.duration,
              travelTime,
            });

            if (activityItem) {
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
              }));
              lastCoords = attractionCoords;
              console.log(`[Jour ${dayNumber}] Activité ajoutée: ${attraction.name}`);
            }
          }
        }

        // Programmer la récupération des bagages 30min avant check-in
        const pickupItem = scheduler.insertFixedItem({
          id: generateId(),
          title: `Récupération bagages: ${luggageStorage.name}`,
          type: 'luggage',
          startTime: luggagePickupStart,
          endTime: luggagePickupEnd,
        });
        if (pickupItem) {
          items.push(schedulerItemToTripItem(pickupItem, dayNumber, orderIndex++, {
            description: 'Récupérez vos bagages avant le check-in hôtel.',
            locationName: luggageStorage.address,
            latitude: luggageStorage.latitude || cityCenter.lat,
            longitude: luggageStorage.longitude || cityCenter.lng,
          }));
        }

        // Check-in hôtel (après récupération bagages)
        const hotelCheckinStart = luggagePickupEnd;
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
          // DATES FIXES: Utiliser linkGenerator pour générer l'URL hôtel avec les dates de séjour
          const hotelCheckOutDate = new Date(preferences.startDate);
          hotelCheckOutDate.setDate(hotelCheckOutDate.getDate() + preferences.durationDays - 1);
          const hotelBookingUrl = accommodation?.name
            ? generateHotelLink(
                { name: accommodation.name, city: preferences.destination },
                { checkIn: formatDateForUrl(preferences.startDate), checkOut: formatDateForUrl(hotelCheckOutDate) }
              )
            : undefined;

          items.push(schedulerItemToTripItem(hotelItem, dayNumber, orderIndex++, {
            description: accommodation ? `${accommodation.stars}⭐ | ${accommodation.rating?.toFixed(1)}/10 | ${accommodation.pricePerNight}€/nuit` : 'Déposez vos affaires et installez-vous.',
            locationName: accommodation?.address || `Hébergement, ${preferences.destination}`,
            latitude: accommodation?.latitude || cityCenter.lat + 0.005,
            longitude: accommodation?.longitude || cityCenter.lng + 0.005,
            bookingUrl: hotelBookingUrl,
          }));
        }

        // Ne pas avancer le curseur ici - les activités sont entre le dépôt et la récupération

      } else {
        // FLUX NORMAL (sans consigne): Aéroport → Hôtel → Activités

        const transferItem = scheduler.insertFixedItem({
          id: generateId(),
          title: 'Transfert Aéroport → Hôtel',
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
            description: preferences.carRental ? 'Récupérez votre voiture de location.' : 'Taxi ou transports en commun.',
            locationName: `${destAirport.name} → Centre-ville`,
            latitude: cityCenter.lat,
            longitude: cityCenter.lng,
            estimatedCost: preferences.carRental ? 0 : 25 * Math.ceil(preferences.groupSize / 4),
          }));
        }

        // Check-in hôtel - IMPORTANT: ne pas programmer avant l'heure officielle de check-in
        // L'heure de check-in minimum est celle de l'hôtel (généralement 14h-15h)
        const actualCheckInTime = new Date(date);
        actualCheckInTime.setHours(checkInHour, checkInMin, 0, 0);

        // Le check-in commence au plus tôt à l'heure officielle, ou après le transfert si on arrive plus tard
        const hotelCheckinStart = transferEnd > actualCheckInTime ? transferEnd : actualCheckInTime;
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
          // DATES FIXES: Utiliser linkGenerator pour générer l'URL hôtel avec les dates de séjour
          const hotelCheckOutDate2 = new Date(preferences.startDate);
          hotelCheckOutDate2.setDate(hotelCheckOutDate2.getDate() + preferences.durationDays - 1);
          const hotelBookingUrl2 = accommodation?.name
            ? generateHotelLink(
                { name: accommodation.name, city: preferences.destination },
                { checkIn: formatDateForUrl(preferences.startDate), checkOut: formatDateForUrl(hotelCheckOutDate2) }
              )
            : undefined;

          items.push(schedulerItemToTripItem(hotelItem, dayNumber, orderIndex++, {
            description: accommodation ? `${accommodation.stars}⭐ | ${accommodation.rating?.toFixed(1)}/10 | ${accommodation.pricePerNight}€/nuit` : 'Déposez vos affaires et installez-vous.',
            locationName: accommodation?.address || `Hébergement, ${preferences.destination}`,
            latitude: accommodation?.latitude || cityCenter.lat + 0.005,
            longitude: accommodation?.longitude || cityCenter.lng + 0.005,
            bookingUrl: hotelBookingUrl2,
          }));
        }

        // Avancer le curseur après le check-in hôtel
        scheduler.advanceTo(hotelCheckinEnd);
      }

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
      const hotelNameGround = accommodation?.name || 'Hébergement';
      const hotelItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `Check-in ${hotelNameGround}`,
        type: 'hotel',
        startTime: hotelStart,
        endTime: hotelEnd,
      });
      if (hotelItem) {
        // DATES FIXES: Utiliser linkGenerator pour générer l'URL hôtel avec les dates de séjour
        const hotelCheckOutDate3 = new Date(preferences.startDate);
        hotelCheckOutDate3.setDate(hotelCheckOutDate3.getDate() + preferences.durationDays - 1);
        const hotelBookingUrl3 = accommodation?.name
          ? generateHotelLink(
              { name: accommodation.name, city: preferences.destination },
              { checkIn: formatDateForUrl(preferences.startDate), checkOut: formatDateForUrl(hotelCheckOutDate3) }
            )
          : undefined;

        items.push(schedulerItemToTripItem(hotelItem, dayNumber, orderIndex++, {
          description: accommodation ? `${accommodation.stars}⭐ | ${accommodation.rating?.toFixed(1)}/10 | ${accommodation.pricePerNight}€/nuit` : 'Déposez vos affaires et installez-vous.',
          locationName: accommodation?.address || `Hébergement, ${preferences.destination}`,
          latitude: accommodation?.latitude || cityCenter.lat + 0.005,
          longitude: accommodation?.longitude || cityCenter.lng + 0.005,
          bookingUrl: hotelBookingUrl3,
        }));
      }

      scheduler.advanceTo(hotelEnd);
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
      // Transport terrestre: départ 08:00 + durée + 50min check-in
      const departureTime = parseTime(date, '08:00');
      const arrivalTime = new Date(departureTime.getTime() + groundTransport.totalDuration * 60 * 1000);
      minActivityStart = new Date(arrivalTime.getTime() + 50 * 60 * 1000);
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

  // Réinitialiser la position au centre-ville pour les activités
  lastCoords = cityCenter;

  // Petit-déjeuner (si avant 10h et pas jour 1 avec logistique)
  if (currentHour < 10 && !isFirstDay) {
    const breakfastItem = scheduler.addItem({
      id: generateId(),
      title: 'Petit-déjeuner',
      type: 'restaurant',
      duration: 45,
      travelTime: 10,
    });
    if (breakfastItem) {
      const restaurant = await findRestaurantForMeal('breakfast', cityCenter, preferences, dayNumber, lastCoords);
      const restaurantCoords = {
        lat: restaurant?.latitude || cityCenter.lat,
        lng: restaurant?.longitude || cityCenter.lng,
      };
      const googleMapsUrl = generateGoogleMapsUrl(lastCoords, restaurantCoords, 'walking');
      // URL Google Maps fiable avec nom + adresse complète
      const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
        (restaurant ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${restaurant.name}, ${restaurant.address}`)}` : undefined);

      items.push(schedulerItemToTripItem(breakfastItem, dayNumber, orderIndex++, {
        title: restaurant?.name || 'Petit-déjeuner',
        description: restaurant ? `${restaurant.cuisineTypes.join(', ')} | ⭐ ${restaurant.rating?.toFixed(1)}/5` : 'Petit-déjeuner local',
        locationName: restaurant?.address || `Centre-ville, ${preferences.destination}`,
        latitude: restaurantCoords.lat,
        longitude: restaurantCoords.lng,
        estimatedCost: estimateMealPrice(getBudgetPriceLevel(preferences.budgetLevel), 'breakfast') * preferences.groupSize,
        rating: restaurant?.rating,
        googleMapsUrl,
        googleMapsPlaceUrl: restaurantGoogleMapsUrl,
      }));
      lastCoords = restaurantCoords;
    }
  }

  // Activites du matin - SEULEMENT si on est deja sur place (pas le jour 1)
  // Le jour 1, on arrive generalement l'apres-midi, donc pas d'activites matin
  const cursorHour = scheduler.getCurrentTime().getHours();
  const canDoMorningActivities = !isFirstDay && cursorHour < 12;

  // IMPORTANT: Utiliser le Set partagé au niveau du voyage pour éviter les doublons
  // tripUsedAttractionIds est passé en paramètre et partagé entre tous les jours

  if (canDoMorningActivities) {
    for (const attraction of attractions.slice(0, Math.ceil(attractions.length / 2))) {
      // ANTI-DOUBLON: Skip si déjà utilisée (dans n'importe quel jour du voyage)
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

      // Verifier qu'on a le temps avant le dejeuner (12:30)
      const lunchTime = parseTime(date, '12:30');
      if (scheduler.getCurrentTime().getTime() + 30 * 60 * 1000 + attraction.duration * 60 * 1000 > lunchTime.getTime()) {
        break;
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
      tripUsedAttractionIds.add(attraction.id); // ANTI-DOUBLON (trip-level)
      const attractionCoords = {
        lat: attraction.latitude || cityCenter.lat + (Math.random() - 0.5) * 0.02,
        lng: attraction.longitude || cityCenter.lng + (Math.random() - 0.5) * 0.02,
      };
      // Générer le lien Google Maps avec itinéraire depuis le point précédent
      const googleMapsUrl = generateGoogleMapsUrl(lastCoords, attractionCoords, 'transit');
      items.push(schedulerItemToTripItem(activityItem, dayNumber, orderIndex++, {
        description: attraction.description,
        locationName: preferences.destination,
        latitude: attractionCoords.lat,
        longitude: attractionCoords.lng,
        estimatedCost: attraction.estimatedCost * preferences.groupSize,
        rating: attraction.rating,
        bookingUrl: attraction.bookingUrl,
        timeFromPrevious: travelTime,
        googleMapsUrl,
      }));
      lastCoords = attractionCoords;
    }
  }
  } // Fin du bloc canDoMorningActivities

  // Dejeuner (si entre 11h et 15h)
  const currentTimeForLunch = scheduler.getCurrentTime();
  if (currentTimeForLunch.getHours() >= 11 && currentTimeForLunch.getHours() < 15 && endHour >= 14) {
    const lunchItem = scheduler.addItem({
      id: generateId(),
      title: 'Déjeuner',
      type: 'restaurant',
      duration: 75,
      travelTime: 15,
    });
    if (lunchItem) {
      const restaurant = await findRestaurantForMeal('lunch', cityCenter, preferences, dayNumber, lastCoords);
      const restaurantCoords = {
        lat: restaurant?.latitude || cityCenter.lat,
        lng: restaurant?.longitude || cityCenter.lng,
      };
      const googleMapsUrl = generateGoogleMapsUrl(lastCoords, restaurantCoords, 'walking');
      // Utiliser l'URL Google Maps du restaurant si disponible (plus fiable avec nom + adresse)
      // Sinon générer une URL de recherche avec nom + ville
      const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
        (restaurant ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${restaurant.name}, ${restaurant.address}`)}` : undefined);

      items.push(schedulerItemToTripItem(lunchItem, dayNumber, orderIndex++, {
        title: restaurant?.name || 'Déjeuner',
        description: restaurant ? `${restaurant.cuisineTypes.join(', ')} | ⭐ ${restaurant.rating?.toFixed(1)}/5` : 'Déjeuner local',
        locationName: restaurant?.address || `Centre-ville, ${preferences.destination}`,
        latitude: restaurantCoords.lat,
        longitude: restaurantCoords.lng,
        estimatedCost: estimateMealPrice(getBudgetPriceLevel(preferences.budgetLevel), 'lunch') * preferences.groupSize,
        rating: restaurant?.rating,
        googleMapsUrl,
        googleMapsPlaceUrl: restaurantGoogleMapsUrl, // URL fiable avec nom + adresse complète
      }));
      lastCoords = restaurantCoords;
    }
  }

  // Activites de l'apres-midi
  // Jour 1: on fait TOUTES les attractions (car on arrive l'apres-midi)
  // Autres jours: on fait seulement la 2eme moitie (la 1ere a ete faite le matin)
  const afternoonAttractions = isFirstDay
    ? attractions  // Jour 1: toutes les attractions
    : attractions.slice(Math.ceil(attractions.length / 2));  // Autres jours: 2eme moitie

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
      break;
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
      tripUsedAttractionIds.add(attraction.id); // ANTI-DOUBLON (trip-level)
      const attractionCoords = {
        lat: attraction.latitude || cityCenter.lat + (Math.random() - 0.5) * 0.02,
        lng: attraction.longitude || cityCenter.lng + (Math.random() - 0.5) * 0.02,
      };
      // Générer le lien Google Maps avec itinéraire depuis le point précédent
      const googleMapsUrl = generateGoogleMapsUrl(lastCoords, attractionCoords, 'transit');
      items.push(schedulerItemToTripItem(activityItem, dayNumber, orderIndex++, {
        description: attraction.description,
        locationName: preferences.destination,
        latitude: attractionCoords.lat,
        longitude: attractionCoords.lng,
        estimatedCost: attraction.estimatedCost * preferences.groupSize,
        rating: attraction.rating,
        bookingUrl: attraction.bookingUrl,
        timeFromPrevious: travelTime,
        googleMapsUrl,
      }));
      lastCoords = attractionCoords;
    }
  }

  // === REMPLIR LE TEMPS LIBRE AVANT LE DÎNER (19h) ===
  // Si on finit les attractions trop tôt, ajouter des activités jusqu'à 19h
  const currentHourAfterAttractions = scheduler.getCurrentTime().getHours();
  const currentMinAfterAttractions = scheduler.getCurrentTime().getMinutes();
  const timeBeforeDinner = 19 * 60 - (currentHourAfterAttractions * 60 + currentMinAfterAttractions); // minutes avant 19h

  console.log(`[Jour ${dayNumber}] Après attractions: ${currentHourAfterAttractions}h${currentMinAfterAttractions}, temps avant dîner (19h): ${timeBeforeDinner}min, isLastDay: ${isLastDay}`);

  // Remplir si on a plus de 30min avant 19h et ce n'est pas le dernier jour
  if (timeBeforeDinner > 30 && !isLastDay) {
    console.log(`[Jour ${dayNumber}] ${timeBeforeDinner} min de temps libre avant dîner, ajout d'activités supplémentaires`);

    // Activités de remplissage variées (promenades, shopping, cafés, apéro)
    const fillActivities = [
      { title: `Quartier historique de ${preferences.destination}`, description: 'Promenade dans les ruelles typiques du centre historique', duration: 60 },
      { title: 'Shopping local', description: 'Découvrez les boutiques locales et artisanales', duration: 75 },
      { title: 'Pause café', description: 'Détente dans un café typique avec vue', duration: 45 },
      { title: `Marché de ${preferences.destination}`, description: 'Découvrez les produits locaux et l\'ambiance du marché', duration: 60 },
      { title: 'Parc et jardins', description: 'Promenade relaxante dans un espace vert', duration: 50 },
      { title: 'Point de vue panoramique', description: 'Vue imprenable sur la ville', duration: 40 },
      { title: 'Apéritif local', description: 'Terrasse et boissons locales pour l\'apéritif', duration: 60 },
      { title: `Place centrale de ${preferences.destination}`, description: 'Profitez de l\'ambiance de fin de journée', duration: 45 },
      { title: 'Galerie d\'art locale', description: 'Découverte d\'artistes locaux', duration: 50 },
      { title: 'Librairie-café', description: 'Pause culturelle dans une librairie locale', duration: 40 },
    ];

    // Ajouter des activités jusqu'à 19h (heure du dîner)
    const targetTime = parseTime(date, '19:00');
    let fillIndex = 0;

    // Boucler plusieurs fois sur les activités si nécessaire pour remplir jusqu'à 19h
    let loopCount = 0;
    const maxLoops = 3; // Maximum 3 tours pour éviter boucle infinie

    while (scheduler.getCurrentTime() < targetTime && loopCount < maxLoops) {
      const activity = fillActivities[fillIndex % fillActivities.length];
      const remainingTime = (targetTime.getTime() - scheduler.getCurrentTime().getTime()) / (1000 * 60);

      // Si pas assez de temps pour cette activité, essayer la suivante
      if (remainingTime < activity.duration + 15) {
        fillIndex++;
        if (fillIndex >= fillActivities.length * (loopCount + 1)) {
          loopCount++;
        }
        continue;
      }

      const fillItem = scheduler.addItem({
        id: generateId(),
        title: activity.title,
        type: 'activity',
        duration: activity.duration,
        travelTime: 15,
      });

      if (fillItem) {
        const activityCoords = {
          lat: cityCenter.lat + (Math.random() - 0.5) * 0.015,
          lng: cityCenter.lng + (Math.random() - 0.5) * 0.015,
        };
        const googleMapsUrl = generateGoogleMapsUrl(lastCoords, activityCoords, 'walking');
        items.push(schedulerItemToTripItem(fillItem, dayNumber, orderIndex++, {
          description: activity.description,
          locationName: `Centre-ville, ${preferences.destination}`,
          latitude: activityCoords.lat,
          longitude: activityCoords.lng,
          estimatedCost: activity.title.includes('Shopping') ? 50 * preferences.groupSize : 5 * preferences.groupSize,
          googleMapsUrl,
        }));
        lastCoords = activityCoords;
        console.log(`[Jour ${dayNumber}] Ajouté: ${activity.title} (remplissage)`);
      }

      fillIndex++;
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
      const restaurant = await findRestaurantForMeal('dinner', cityCenter, preferences, dayNumber, lastCoords);
      const restaurantCoords = {
        lat: restaurant?.latitude || cityCenter.lat,
        lng: restaurant?.longitude || cityCenter.lng,
      };
      const googleMapsUrl = generateGoogleMapsUrl(lastCoords, restaurantCoords, 'walking');
      // URL Google Maps fiable avec nom + adresse complète
      const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
        (restaurant ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${restaurant.name}, ${restaurant.address}`)}` : undefined);

      items.push(schedulerItemToTripItem(dinnerItem, dayNumber, orderIndex++, {
        title: restaurant?.name || 'Dîner',
        description: restaurant ? `${restaurant.cuisineTypes.join(', ')} | ⭐ ${restaurant.rating?.toFixed(1)}/5` : 'Dîner local',
        locationName: restaurant?.address || `Centre-ville, ${preferences.destination}`,
        latitude: restaurantCoords.lat,
        longitude: restaurantCoords.lng,
        estimatedCost: estimateMealPrice(getBudgetPriceLevel(preferences.budgetLevel), 'dinner') * preferences.groupSize,
        rating: restaurant?.rating,
        googleMapsUrl,
        googleMapsPlaceUrl: restaurantGoogleMapsUrl,
      }));
      lastCoords = restaurantCoords;
    }
  }

  // RÈGLE 3: Ajouter une activité après le dîner (promenade digestive ou nightlife)
  const currentTimeAfterDinnerCheck = scheduler.getCurrentTime();
  const hoursAfterDinner = currentTimeAfterDinnerCheck.getHours();
  console.log(`[Jour ${dayNumber}] Après dîner: ${hoursAfterDinner}h, hasNightlife: ${hasNightlife}, isLastDay: ${isLastDay}`);

  // Pour tous les jours (sauf le dernier), ajouter une activité après le dîner
  // On abaisse le seuil à 18h pour les cas où le dîner commence tôt
  if (!isLastDay && hoursAfterDinner >= 18 && hoursAfterDinner < 23) {
    const canFitActivity = scheduler.canFit(60, 10); // 60min + 10min trajet

    if (canFitActivity) {
      console.log(`[Jour ${dayNumber}] Ajout d'une promenade/activité après le dîner`);

      const eveningActivities = hasNightlife ? [
        { title: 'Bar à cocktails', description: 'Découvrez les meilleurs cocktails de la ville', duration: 90 },
        { title: 'Bar à tapas', description: 'Tapas et boissons dans un bar typique', duration: 75 },
        { title: 'Rooftop bar', description: 'Vue panoramique et ambiance décontractée', duration: 90 },
        { title: 'Bar à vin local', description: 'Dégustation de vins locaux', duration: 75 },
        { title: 'Jazz club', description: 'Musique live dans un club intime', duration: 90 },
      ] : [
        { title: `Promenade digestive à ${preferences.destination}`, description: 'Balade nocturne dans le centre historique illuminé', duration: 45 },
        { title: 'Glace artisanale', description: 'Pause gourmande dans une gelateria locale', duration: 30 },
        { title: `Place centrale de ${preferences.destination}`, description: 'Profitez de l\'ambiance nocturne de la ville', duration: 40 },
      ];

      const activity = eveningActivities[Math.floor(Math.random() * eveningActivities.length)];

      const eveningItem = scheduler.addItem({
        id: generateId(),
        title: activity.title,
        type: 'activity',
        duration: activity.duration,
        travelTime: 10,
      });

      if (eveningItem) {
        const activityCoords = {
          lat: cityCenter.lat + (Math.random() - 0.5) * 0.01,
          lng: cityCenter.lng + (Math.random() - 0.5) * 0.01,
        };
        const googleMapsUrl = generateGoogleMapsUrl(lastCoords, activityCoords, 'walking');
        items.push(schedulerItemToTripItem(eveningItem, dayNumber, orderIndex++, {
          description: activity.description,
          locationName: `Centre-ville, ${preferences.destination}`,
          latitude: activityCoords.lat,
          longitude: activityCoords.lng,
          estimatedCost: hasNightlife ? 30 * preferences.groupSize : 5 * preferences.groupSize,
          googleMapsUrl,
        }));
        lastCoords = activityCoords;
      }
    }
  }

  // RÈGLE 3 (suite): Activité SUPPLÉMENTAIRE si nightlife sélectionné
  if (hasNightlife && !isLastDay) {
    const currentTimeAfterDinner = scheduler.getCurrentTime();
    const canFitNightlife = scheduler.canFit(90, 15); // 90min activité + 15min trajet
    const isLateEnough = currentTimeAfterDinner.getHours() >= 21 ||
      (currentTimeAfterDinner.getHours() === 20 && currentTimeAfterDinner.getMinutes() >= 30);

    if (canFitNightlife && isLateEnough) {
      console.log(`[Jour ${dayNumber}] Ajout d'une activité nocturne (nightlife sélectionné)`);

      const nightlifeActivities = [
        { title: 'Bar à cocktails', description: 'Découvrez les meilleurs cocktails de la ville dans une ambiance locale' },
        { title: 'Bar à tapas', description: 'Tapas et boissons dans un bar typique' },
        { title: 'Rooftop bar', description: 'Vue panoramique et ambiance décontractée' },
        { title: 'Bar à vin local', description: 'Dégustation de vins locaux dans une cave traditionnelle' },
        { title: 'Promenade nocturne', description: 'Balade dans le quartier historique illuminé' },
        { title: 'Jazz club', description: 'Musique live dans un club intime' },
      ];

      // Sélectionner une activité aléatoire pour varier
      const nightActivity = nightlifeActivities[Math.floor(Math.random() * nightlifeActivities.length)];

      const nightlifeItem = scheduler.addItem({
        id: generateId(),
        title: nightActivity.title,
        type: 'activity',
        duration: 90,
        travelTime: 15,
      });

      if (nightlifeItem) {
        const activityCoords = {
          lat: cityCenter.lat + (Math.random() - 0.5) * 0.01,
          lng: cityCenter.lng + (Math.random() - 0.5) * 0.01,
        };
        const googleMapsUrl = generateGoogleMapsUrl(lastCoords, activityCoords, 'walking');
        items.push(schedulerItemToTripItem(nightlifeItem, dayNumber, orderIndex++, {
          description: nightActivity.description,
          locationName: `Centre-ville, ${preferences.destination}`,
          latitude: activityCoords.lat,
          longitude: activityCoords.lng,
          estimatedCost: 30 * preferences.groupSize, // ~30€/personne pour des boissons
          googleMapsUrl,
        }));
        lastCoords = activityCoords;
      }
    }
  }

  // === DERNIER JOUR: LOGISTIQUE RETOUR ===
  if (isLastDay) {
    if (returnFlight) {
      const flightDeparture = new Date(returnFlight.departureTime);
      const flightArrival = new Date(returnFlight.arrivalTime);

      // Check-out hôtel (3h30 avant vol)
      const checkoutStart = new Date(flightDeparture.getTime() - 210 * 60 * 1000);
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
          locationName: accommodation?.address || `Hébergement, ${preferences.destination}`,
          latitude: accommodation?.latitude || cityCenter.lat + 0.005,
          longitude: accommodation?.longitude || cityCenter.lng + 0.005,
        }));
      }

      // Transfert hôtel → aéroport
      const transferStart = checkoutEnd;
      const transferEnd = new Date(flightDeparture.getTime() - 120 * 60 * 1000);
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
        // DATES FIXES: Utiliser linkGenerator pour générer l'URL du vol retour avec la date sélectionnée
        const tripEndDate = new Date(preferences.startDate);
        tripEndDate.setDate(tripEndDate.getDate() + preferences.durationDays - 1);
        const returnFlightBookingUrl = generateFlightLink(
          { origin: destAirport.code, destination: originAirport.code },
          { date: formatDateForUrl(tripEndDate) }
        );

        // Créer l'item mais avec les heures d'affichage correctes
        const tripItem = schedulerItemToTripItem(flightItem, dayNumber, orderIndex++, {
          description: `${returnFlight.flightNumber} | ${formatFlightDuration(returnFlight.duration)} | ${returnFlight.stops === 0 ? 'Direct' : `${returnFlight.stops} escale(s)`}`,
          locationName: `${destAirport.code} → ${originAirport.code}`,
          latitude: (destAirport.latitude + originAirport.latitude) / 2,
          longitude: (destAirport.longitude + originAirport.longitude) / 2,
          estimatedCost: returnFlight.price,
          bookingUrl: returnFlightBookingUrl,
        });
        // Override les heures avec les heures locales de l'aéroport
        tripItem.startTime = returnFlightStartTime;
        tripItem.endTime = returnFlightEndTime;
        items.push(tripItem);
      }

      // Récupération parking
      if (parking) {
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
          locationName: accommodation?.address || `Hébergement, ${preferences.destination}`,
          latitude: accommodation?.latitude || cityCenter.lat + 0.005,
          longitude: accommodation?.longitude || cityCenter.lng + 0.005,
        }));
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
        items.push(schedulerItemToTripItem(transportItem, dayNumber, orderIndex++, {
          description: `Retour | ${groundTransport.totalPrice}€`,
          locationName: `${preferences.destination} → ${preferences.origin}`,
          latitude: cityCenter.lat,
          longitude: cityCenter.lng,
          estimatedCost: groundTransport.totalPrice,
          bookingUrl: groundTransport.bookingUrl,
        }));
      }
    }
  }

  // === CORRECTION AUTOMATIQUE DES CONFLITS ===
  // Étape 1: Pour le Jour 1 avec vol, supprimer toute activité AVANT l'arrivée
  if (isFirstDay && outboundFlight) {
    const arrivalTime = new Date(outboundFlight.arrivalTime);
    const itemsRemovedBeforeArrival = scheduler.removeItemsBefore(arrivalTime, ['flight', 'transport', 'checkin', 'parking', 'hotel']);
    if (itemsRemovedBeforeArrival > 0) {
      console.log(`[Jour ${dayNumber}] ${itemsRemovedBeforeArrival} item(s) supprimé(s) car planifiés avant l'arrivée du vol`);
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
  extra: Partial<TripItem>
): TripItem {
  // Extraire le nom du lieu et la ville depuis les données disponibles
  const placeName = extra.title || item.title;
  // Extraire la ville depuis locationName (format: "Adresse, Ville" ou "Centre-ville, Barcelona")
  const locationParts = extra.locationName?.split(',') || [];
  const city = locationParts.length > 0 ? locationParts[locationParts.length - 1].trim() : undefined;

  // Générer l'URL de recherche Google Maps par nom (BEAUCOUP plus fiable que GPS!)
  // Au lieu de coordonnées potentiellement fausses, Google Maps cherche le vrai lieu
  const googleMapsPlaceUrl = generateGoogleMapsSearchUrl(placeName, city);

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
    dataReliability: 'generated' as const, // Données générées par IA
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

    // Si tous ont été utilisés, réinitialiser mais garder le filtre cuisine!
    if (availableRestaurants.length === 0) {
      usedRestaurantIds.clear();
      availableRestaurants = filteredList; // BUG FIX: utiliser filteredList au lieu de restaurants
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
      'transit'
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

  items.push({
    id: generateId(),
    dayNumber,
    startTime: flightStartTime,
    endTime: flightEndTime,
    type: 'flight',
    title: `Vol ${outboundFlight.flightNumber} → ${preferences.destination}`,
    description: `${outboundFlight.flightNumber} | ${formatFlightDuration(outboundFlight.duration)} | ${outboundFlight.stops === 0 ? 'Direct' : `${outboundFlight.stops} escale(s)`}`,
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
  return date.toISOString().split('T')[0];
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatPriceLevel(level: 1 | 2 | 3 | 4): string {
  return '€'.repeat(level);
}

function getBudgetCabinClass(budgetLevel?: BudgetLevel): 'economy' | 'premium_economy' | 'business' | 'first' {
  switch (budgetLevel) {
    case 'luxury': return 'business';
    case 'comfort': return 'premium_economy';
    default: return 'economy';
  }
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

  // Calculer le score de chaque vol (inclut pénalité pour vols tôt le matin sur retour)
  const scoredFlights = flights.map(flight => {
    const timeScore = calculateFlightScore({
      id: flight.flightNumber || 'unknown',
      departureTime: flight.departureTime,
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
    const maxPrice = Math.max(...flights.map(f => f.price));
    const minPrice = Math.min(...flights.map(f => f.price));
    const priceRange = maxPrice - minPrice || 1;
    const priceScore = 100 - ((flight.price - minPrice) / priceRange) * 100;

    // Bonus pour vol direct
    const directBonus = flight.stops === 0 ? 10 : 0;

    // Score final combiné
    const finalScore = (timeScore * (1 - priceWeight)) + (priceScore * priceWeight) + directBonus;

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
  preferences: TripPreferences
): { flights: number; accommodation: number; food: number; activities: number; transport: number; parking: number; other: number } {
  const breakdown = {
    flights: (outboundFlight?.price || 0) + (returnFlight?.price || 0),
    accommodation: preferences.durationDays * getAccommodationCost(preferences.budgetLevel),
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
          // Si l'item hôtel a un coût estimé (ex: pricePerNight), le compter
          // Note: le coût principal est déjà dans accommodation, mais si l'item a un surplus
          // (taxes de séjour, etc.), on l'ajoute à other
          if (item.estimatedCost > 0) {
            breakdown.other += item.estimatedCost;
          }
          break;
        // 'flight', 'parking', 'checkin' sont déjà comptés directement
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
