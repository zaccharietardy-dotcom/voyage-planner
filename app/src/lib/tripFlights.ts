import { Flight, BudgetLevel, TripPreferences } from './types';
import { AirportInfo, calculateDistance } from './services/geocoding';
import { searchFlights } from './services/flights';
import { calculateFlightScore, EARLY_MORNING_PENALTY } from './services/flightScoring';
import { Accommodation } from './types';
import { formatDate, getBudgetCabinClass } from './tripUtils';

export interface LateFlightArrivalData {
  flight: Flight;
  destAirport: AirportInfo;
  accommodation: Accommodation | null;
}

/**
 * Recherche les meilleurs vols parmi tous les aéroports
 */
export async function findBestFlights(
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

export function selectFlightByBudget(flights: Flight[], budgetLevel?: BudgetLevel, flightType: 'outbound' | 'return' = 'outbound'): Flight | null {
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

