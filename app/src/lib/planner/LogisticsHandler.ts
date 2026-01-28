/**
 * LogisticsHandler - Gère toute la logistique de transport
 *
 * Responsabilités:
 * - Jour 1: trajet aéroport, parking, enregistrement, vol aller, transfert, hôtel
 * - Dernier jour: checkout, transfert, vol retour, récupération parking
 * - Vol overnight: report transfert/hôtel au jour suivant
 * - Transport terrestre: trajet voiture/train
 */

import {
  TripItem,
  Flight,
  ParkingOption,
  Accommodation,
  TripPreferences,
} from '../types';
import { AirportInfo, getCityCenterCoords, calculateDistance } from '../services/geocoding';
import { DayScheduler, formatTime, parseTime } from '../services/scheduler';
import { formatFlightDuration } from '../services/flights';
import { calculateParkingTime } from '../services/parking';
import { TransportOption } from '../services/transport';
import { generateFlightLink, generateHotelLink, formatDateForUrl } from '../services/linkGenerator';
import { LogisticsResult, LateFlightData, PlannerContext, DayType, Coordinates } from './types';

// ============================================
// Helpers
// ============================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function normalizeToLocalDate(dateInput: Date | string): Date {
  let dateStr: string;
  if (typeof dateInput === 'string') {
    dateStr = dateInput.split('T')[0];
  } else {
    const year = dateInput.getFullYear();
    const month = String(dateInput.getMonth() + 1).padStart(2, '0');
    const day = String(dateInput.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function getHotelLocationName(accommodation: Accommodation | null, destination: string): string {
  if (accommodation?.name) {
    return `${accommodation.name}, ${destination}`;
  }
  return `Hébergement, ${destination}`;
}

/** Convertit un ScheduleItem en TripItem */
function toTripItem(
  slot: { start: Date; end: Date },
  dayNumber: number,
  orderIndex: number,
  data: {
    id: string;
    type: TripItem['type'];
    title: string;
    description: string;
    locationName: string;
    latitude: number;
    longitude: number;
    estimatedCost?: number;
    bookingUrl?: string;
    flight?: Flight;
    parking?: ParkingOption;
  }
): TripItem {
  return {
    id: data.id,
    dayNumber,
    startTime: formatTime(slot.start),
    endTime: formatTime(slot.end),
    type: data.type,
    title: data.title,
    description: data.description,
    locationName: data.locationName,
    latitude: data.latitude,
    longitude: data.longitude,
    orderIndex,
    estimatedCost: data.estimatedCost,
    bookingUrl: data.bookingUrl,
    flight: data.flight,
    parking: data.parking,
  };
}

function formatPriceDisplay(price: number | undefined, pricePerPerson: number | undefined, groupSize: number): string {
  const safePrice = price || 0;
  const safeGroup = groupSize || 1;
  const safePP = pricePerPerson || (safePrice > 0 ? Math.round(safePrice / safeGroup) : 0);
  if (safeGroup > 1 && safePP > 0) {
    return `${safePP}€/pers (${safePrice}€ total)`;
  }
  return safePrice > 0 ? `${safePrice}€` : 'Prix non disponible';
}

// ============================================
// Main Handler
// ============================================

export class LogisticsHandler {
  private context: PlannerContext;
  private orderIndex = 0;

  constructor(context: PlannerContext) {
    this.context = context;
  }

  /**
   * Gère la logistique du jour 1 (départ)
   * Retourne les items logistiques et l'heure de début des activités
   */
  handleDeparture(
    scheduler: DayScheduler,
    date: Date,
    dayNumber: number,
  ): LogisticsResult {
    const { outboundFlight, groundTransport, originAirport, destAirport, parking, accommodation, preferences } = this.context;
    const items: TripItem[] = [];
    this.orderIndex = 0;
    const tripStartDate = normalizeToLocalDate(preferences.startDate);

    if (outboundFlight) {
      return this.handleFlightDeparture(scheduler, date, dayNumber, tripStartDate);
    }

    if (groundTransport) {
      return this.handleGroundDeparture(scheduler, date, dayNumber, tripStartDate);
    }

    // Pas de transport: activités dès 8h
    return {
      items: [],
      activitiesStartTime: parseTime(date, '08:00'),
      activitiesEndTime: parseTime(date, this.context.dayEndHour),
      arrivedAtDestination: true,
    };
  }

  /**
   * Gère la logistique du dernier jour (retour)
   */
  handleReturn(
    scheduler: DayScheduler,
    date: Date,
    dayNumber: number,
  ): LogisticsResult {
    const { returnFlight, groundTransport } = this.context;

    if (returnFlight) {
      return this.handleFlightReturn(scheduler, date, dayNumber);
    }

    if (groundTransport) {
      return this.handleGroundReturn(scheduler, date, dayNumber);
    }

    return {
      items: [],
      activitiesStartTime: parseTime(date, '08:00'),
      activitiesEndTime: parseTime(date, this.context.dayEndHour),
      arrivedAtDestination: true,
    };
  }

  /**
   * Gère l'arrivée d'un vol overnight (reporté du jour précédent)
   */
  handleOvernightArrival(
    scheduler: DayScheduler,
    date: Date,
    dayNumber: number,
    lateFlightData: LateFlightData,
  ): LogisticsResult {
    const items: TripItem[] = [];
    this.orderIndex = 0;
    const { preferences } = this.context;
    const { flight, destAirport, accommodation } = lateFlightData;
    const cityCenter = this.context.cityCenter;

    const flightArrival = new Date(flight.arrivalTime);

    // Transfert aéroport → hôtel
    const transferStart = new Date(flightArrival.getTime() + 30 * 60 * 1000);
    const transferEnd = new Date(transferStart.getTime() + 40 * 60 * 1000);

    const transferItem = scheduler.insertFixedItem({
      id: generateId(),
      title: 'Transfert Aéroport → Centre-ville',
      type: 'transport',
      startTime: transferStart,
      endTime: transferEnd,
    });
    if (transferItem) {
      items.push(toTripItem(transferItem.slot, dayNumber, this.orderIndex++, {
        id: transferItem.id,
        type: 'transport',
        title: transferItem.title,
        description: preferences.carRental ? 'Récupérez votre voiture de location.' : 'Taxi ou transports en commun.',
        locationName: `${destAirport.name} → Centre-ville`,
        latitude: cityCenter.lat,
        longitude: cityCenter.lng,
        estimatedCost: preferences.carRental ? 0 : 25 * Math.ceil((preferences.groupSize || 1) / 4),
      }));
    }

    // Check-in hôtel
    const hotelStart = transferEnd;
    const hotelEnd = new Date(hotelStart.getTime() + 20 * 60 * 1000);
    const hotelName = accommodation?.name || 'Hébergement';

    const hotelItem = scheduler.insertFixedItem({
      id: generateId(),
      title: `Check-in ${hotelName}`,
      type: 'hotel',
      startTime: hotelStart,
      endTime: hotelEnd,
    });
    if (hotelItem) {
      const tripStartDate = normalizeToLocalDate(preferences.startDate);
      const hotelCheckOutDate = new Date(tripStartDate);
      hotelCheckOutDate.setDate(hotelCheckOutDate.getDate() + preferences.durationDays - 1);

      items.push(toTripItem(hotelItem.slot, dayNumber, this.orderIndex++, {
        id: hotelItem.id,
        type: 'hotel',
        title: hotelItem.title,
        description: accommodation
          ? `${accommodation.stars}⭐ | ${accommodation.rating?.toFixed(1)}/10 | ${accommodation.pricePerNight}€/nuit`
          : 'Déposez vos affaires et installez-vous.',
        locationName: getHotelLocationName(accommodation, preferences.destination),
        latitude: accommodation?.latitude || cityCenter.lat + 0.005,
        longitude: accommodation?.longitude || cityCenter.lng + 0.005,
        bookingUrl: accommodation?.name
          ? generateHotelLink(
              { name: accommodation.name, city: preferences.destination },
              { checkIn: formatDateForUrl(tripStartDate), checkOut: formatDateForUrl(hotelCheckOutDate) }
            )
          : undefined,
      }));
    }

    scheduler.advanceTo(hotelEnd);

    return {
      items,
      activitiesStartTime: hotelEnd,
      activitiesEndTime: parseTime(date, this.context.dayEndHour),
      arrivedAtDestination: true,
    };
  }

  // ============================================
  // Private: Flight Departure (Day 1)
  // ============================================

  private handleFlightDeparture(
    scheduler: DayScheduler,
    date: Date,
    dayNumber: number,
    tripStartDate: Date,
  ): LogisticsResult {
    const { outboundFlight, originAirport, destAirport, parking, accommodation, preferences } = this.context;
    if (!outboundFlight) throw new Error('No outbound flight');

    const items: TripItem[] = [];
    this.orderIndex = 0;
    const cityCenter = this.context.cityCenter;

    const flightDeparture = new Date(outboundFlight.departureTime);
    const flightArrival = new Date(outboundFlight.arrivalTime);
    const airportArrival = new Date(flightDeparture.getTime() - 2 * 60 * 60 * 1000);

    // Trajet origine → aéroport (si villes différentes)
    const originCityNorm = preferences.origin.toLowerCase().trim();
    const airportCityNorm = originAirport.city.toLowerCase().trim();
    const originDifferentFromAirport = !airportCityNorm.includes(originCityNorm) && !originCityNorm.includes(airportCityNorm);

    if (originDifferentFromAirport) {
      const originCoords = getCityCenterCoords(preferences.origin) || { lat: originAirport.latitude, lng: originAirport.longitude };
      const distance = calculateDistance(originCoords.lat, originCoords.lng, originAirport.latitude, originAirport.longitude);
      const effectiveSpeed = distance > 200 ? 150 : 100;
      const travelMinutes = Math.max(60, Math.round((distance / effectiveSpeed) * 60) + 30);
      const travelCost = distance > 200 ? 70 : Math.round(distance * 0.15);

      const transferEnd = parking
        ? new Date(airportArrival.getTime() - calculateParkingTime(parking) * 60 * 1000)
        : airportArrival;
      const transferStart = new Date(transferEnd.getTime() - travelMinutes * 60 * 1000);

      const item = scheduler.insertFixedItem({
        id: generateId(),
        title: `Trajet ${preferences.origin} → ${originAirport.city}`,
        type: 'transport',
        startTime: transferStart,
        endTime: transferEnd,
      });
      if (item) {
        items.push(toTripItem(item.slot, dayNumber, this.orderIndex++, {
          id: item.id,
          type: 'transport',
          title: item.title,
          description: distance > 150
            ? `Train ou covoiturage vers l'aéroport (${Math.round(distance)}km)`
            : `Voiture ou navette vers l'aéroport (${Math.round(distance)}km)`,
          locationName: `${preferences.origin} → ${originAirport.name}`,
          latitude: originAirport.latitude,
          longitude: originAirport.longitude,
          estimatedCost: travelCost,
        }));
      }
    }

    // Parking
    if (parking) {
      const parkingTime = calculateParkingTime(parking);
      const parkingStart = new Date(airportArrival.getTime() - parkingTime * 60 * 1000);
      const item = scheduler.insertFixedItem({
        id: generateId(),
        title: `Parking: ${parking.name}`,
        type: 'parking',
        startTime: parkingStart,
        endTime: airportArrival,
        data: { parking },
      });
      if (item) {
        items.push(toTripItem(item.slot, dayNumber, this.orderIndex++, {
          id: item.id,
          type: 'parking',
          title: item.title,
          description: `Garez votre voiture. Prix: ${parking.totalPrice}€`,
          locationName: parking.address,
          latitude: parking.latitude,
          longitude: parking.longitude,
          estimatedCost: parking.totalPrice,
          parking,
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
      items.push(toTripItem(checkinItem.slot, dayNumber, this.orderIndex++, {
        id: checkinItem.id,
        type: 'checkin',
        title: checkinItem.title,
        description: `Arrivez 2h avant. Terminal: ${originAirport.name}`,
        locationName: originAirport.name,
        latitude: originAirport.latitude,
        longitude: originAirport.longitude,
      }));
    }

    // Vol aller
    const flightStartTime = outboundFlight.departureTimeDisplay || formatTime(flightDeparture);
    const flightEndTime = outboundFlight.arrivalTimeDisplay || formatTime(flightArrival);

    const flightItem = scheduler.insertFixedItem({
      id: generateId(),
      title: `Vol ${outboundFlight.flightNumber} → ${preferences.destination}`,
      type: 'flight',
      startTime: flightDeparture,
      endTime: flightArrival,
      data: { flight: outboundFlight },
    });
    if (flightItem) {
      const priceDisplay = formatPriceDisplay(outboundFlight.price, outboundFlight.pricePerPerson, preferences.groupSize || 1);
      const bookingUrl = outboundFlight.bookingUrl || generateFlightLink(
        { origin: originAirport.code, destination: destAirport.code },
        { date: formatDateForUrl(tripStartDate), passengers: preferences.groupSize }
      );

      const tripItem = toTripItem(flightItem.slot, dayNumber, this.orderIndex++, {
        id: flightItem.id,
        type: 'flight',
        title: flightItem.title,
        description: `${outboundFlight.flightNumber} | ${formatFlightDuration(outboundFlight.duration)} | ${outboundFlight.stops === 0 ? 'Direct' : `${outboundFlight.stops} escale(s)`} | ${priceDisplay}`,
        locationName: `${originAirport.code} → ${destAirport.code}`,
        latitude: (originAirport.latitude + destAirport.latitude) / 2,
        longitude: (originAirport.longitude + destAirport.longitude) / 2,
        estimatedCost: outboundFlight.price,
        bookingUrl,
        flight: outboundFlight,
      });
      // Override heures avec heures locales
      tripItem.startTime = flightStartTime;
      tripItem.endTime = flightEndTime;
      items.push(tripItem);
    }

    // Déterminer si vol overnight
    const depDay = new Date(flightDeparture.getFullYear(), flightDeparture.getMonth(), flightDeparture.getDate());
    const arrDay = new Date(flightArrival.getFullYear(), flightArrival.getMonth(), flightArrival.getDate());
    const isOvernight = arrDay.getTime() > depDay.getTime();

    if (isOvernight) {
      // Vol overnight: pas d'activités, report au jour suivant
      console.log(`[Logistics] Vol overnight: arrivée le lendemain`);
      return {
        items,
        activitiesStartTime: parseTime(date, this.context.dayEndHour),
        activitiesEndTime: parseTime(date, this.context.dayEndHour),
        lateFlightForNextDay: {
          flight: outboundFlight,
          destAirport,
          accommodation,
        },
        arrivedAtDestination: false,
      };
    }

    // Vol normal: ajouter transfert + hôtel après arrivée
    const arrivalHour = flightArrival.getHours();
    const isLateNight = arrivalHour >= 22 || arrivalHour < 5;

    const transferStart = new Date(flightArrival.getTime() + 30 * 60 * 1000);
    const transferEnd = new Date(transferStart.getTime() + 40 * 60 * 1000);

    const transferItem = scheduler.insertFixedItem({
      id: generateId(),
      title: isLateNight ? 'Transfert Aéroport → Hôtel' : 'Transfert Aéroport → Centre-ville',
      type: 'transport',
      startTime: transferStart,
      endTime: transferEnd,
    });
    if (transferItem) {
      items.push(toTripItem(transferItem.slot, dayNumber, this.orderIndex++, {
        id: transferItem.id,
        type: 'transport',
        title: transferItem.title,
        description: preferences.carRental ? 'Récupérez votre voiture de location.' : 'Taxi ou transports en commun.',
        locationName: `${destAirport.name} → ${isLateNight ? 'Hôtel' : 'Centre-ville'}`,
        latitude: cityCenter.lat,
        longitude: cityCenter.lng,
        estimatedCost: preferences.carRental ? 0 : (isLateNight ? 35 : 25) * Math.ceil((preferences.groupSize || 1) / 4),
      }));
    }

    // Check-in hôtel
    const hotelCheckInTime = accommodation?.checkInTime || '15:00';
    const hotelEnd = new Date(transferEnd.getTime() + 20 * 60 * 1000);
    const hotelName = accommodation?.name || 'Hébergement';

    // Pour les arrivées tardives ou si le transfert arrive après le check-in
    if (isLateNight || transferEnd.getHours() >= 14) {
      const hotelItem = scheduler.insertFixedItem({
        id: generateId(),
        title: isLateNight ? `Check-in tardif ${hotelName}` : `Check-in ${hotelName}`,
        type: 'hotel',
        startTime: transferEnd,
        endTime: hotelEnd,
      });
      if (hotelItem) {
        const hotelCheckOutDate = new Date(tripStartDate);
        hotelCheckOutDate.setDate(hotelCheckOutDate.getDate() + preferences.durationDays - 1);

        items.push(toTripItem(hotelItem.slot, dayNumber, this.orderIndex++, {
          id: hotelItem.id,
          type: 'hotel',
          title: hotelItem.title,
          description: accommodation
            ? `${accommodation.stars}⭐ | ${accommodation.rating?.toFixed(1)}/10 | ${accommodation.pricePerNight}€/nuit`
            : 'Déposez vos affaires et installez-vous.',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodation?.latitude || cityCenter.lat + 0.005,
          longitude: accommodation?.longitude || cityCenter.lng + 0.005,
          bookingUrl: accommodation?.name
            ? generateHotelLink(
                { name: accommodation.name, city: preferences.destination },
                { checkIn: formatDateForUrl(tripStartDate), checkOut: formatDateForUrl(hotelCheckOutDate) }
              )
            : undefined,
        }));
      }
    }

    // Calculer l'heure de début des activités
    const activitiesStart = isLateNight
      ? parseTime(date, this.context.dayEndHour) // Pas d'activités si arrivée tardive
      : new Date(Math.max(hotelEnd.getTime(), transferEnd.getTime()));

    return {
      items,
      activitiesStartTime: activitiesStart,
      activitiesEndTime: parseTime(date, this.context.dayEndHour),
      arrivedAtDestination: !isLateNight,
    };
  }

  // ============================================
  // Private: Ground Departure (Day 1, train/car)
  // ============================================

  private handleGroundDeparture(
    scheduler: DayScheduler,
    date: Date,
    dayNumber: number,
    tripStartDate: Date,
  ): LogisticsResult {
    const { groundTransport, accommodation, preferences } = this.context;
    if (!groundTransport) throw new Error('No ground transport');

    const items: TripItem[] = [];
    this.orderIndex = 0;
    const cityCenter = this.context.cityCenter;

    const departureTime = parseTime(date, '08:00');
    const arrivalTime = new Date(departureTime.getTime() + groundTransport.totalDuration * 60 * 1000);

    const modeLabels: Record<string, string> = { train: 'Train', bus: 'Bus', car: 'Voiture', combined: 'Transport combiné' };
    const modeIcons: Record<string, string> = { train: '🚄', bus: '🚌', car: '🚗', combined: '🔄' };

    const transportItem = scheduler.insertFixedItem({
      id: generateId(),
      title: `${modeIcons[groundTransport.mode] || '🚊'} ${modeLabels[groundTransport.mode] || 'Transport'} → ${preferences.destination}`,
      type: 'transport',
      startTime: departureTime,
      endTime: arrivalTime,
    });
    if (transportItem) {
      items.push(toTripItem(transportItem.slot, dayNumber, this.orderIndex++, {
        id: transportItem.id,
        type: 'transport',
        title: transportItem.title,
        description: `Aller | ${groundTransport.totalPrice}€`,
        locationName: `${preferences.origin} → ${preferences.destination}`,
        latitude: cityCenter.lat,
        longitude: cityCenter.lng,
        estimatedCost: groundTransport.totalPrice,
        bookingUrl: groundTransport.bookingUrl,
      }));
    }

    // Check-in hôtel après arrivée
    const hotelStart = new Date(arrivalTime.getTime() + 20 * 60 * 1000);
    const hotelEnd = new Date(hotelStart.getTime() + 30 * 60 * 1000);
    const hotelName = accommodation?.name || 'Hébergement';

    const hotelItem = scheduler.insertFixedItem({
      id: generateId(),
      title: `Check-in ${hotelName}`,
      type: 'hotel',
      startTime: hotelStart,
      endTime: hotelEnd,
    });
    if (hotelItem) {
      const hotelCheckOutDate = new Date(tripStartDate);
      hotelCheckOutDate.setDate(hotelCheckOutDate.getDate() + preferences.durationDays - 1);

      items.push(toTripItem(hotelItem.slot, dayNumber, this.orderIndex++, {
        id: hotelItem.id,
        type: 'hotel',
        title: hotelItem.title,
        description: accommodation
          ? `${accommodation.stars}⭐ | ${accommodation.rating?.toFixed(1)}/10 | ${accommodation.pricePerNight}€/nuit`
          : 'Déposez vos affaires.',
        locationName: getHotelLocationName(accommodation, preferences.destination),
        latitude: accommodation?.latitude || cityCenter.lat + 0.005,
        longitude: accommodation?.longitude || cityCenter.lng + 0.005,
      }));
    }

    scheduler.advanceTo(hotelEnd);

    return {
      items,
      activitiesStartTime: hotelEnd,
      activitiesEndTime: parseTime(date, this.context.dayEndHour),
      arrivedAtDestination: true,
    };
  }

  // ============================================
  // Private: Flight Return (Last Day)
  // ============================================

  private handleFlightReturn(
    scheduler: DayScheduler,
    date: Date,
    dayNumber: number,
  ): LogisticsResult {
    const { returnFlight, destAirport, originAirport, parking, accommodation, preferences } = this.context;
    if (!returnFlight) throw new Error('No return flight');

    const items: TripItem[] = [];
    this.orderIndex = 0;
    const tripStartDate = normalizeToLocalDate(preferences.startDate);
    const cityCenter = this.context.cityCenter;

    const flightDeparture = new Date(returnFlight.departureTime);
    const flightArrival = new Date(returnFlight.arrivalTime);

    // Checkout: 3h30 avant le vol
    const checkoutStart = new Date(flightDeparture.getTime() - 210 * 60 * 1000);
    const checkoutEnd = new Date(checkoutStart.getTime() + 30 * 60 * 1000);
    const hotelName = accommodation?.name || 'Hébergement';

    const checkoutItem = scheduler.insertFixedItem({
      id: generateId(),
      title: `Check-out ${hotelName}`,
      type: 'checkout',
      startTime: checkoutStart,
      endTime: checkoutEnd,
    });
    if (checkoutItem) {
      items.push(toTripItem(checkoutItem.slot, dayNumber, this.orderIndex++, {
        id: checkoutItem.id,
        type: 'checkout',
        title: checkoutItem.title,
        description: 'Libérez votre hébergement.',
        locationName: getHotelLocationName(accommodation, preferences.destination),
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
      items.push(toTripItem(transferItem.slot, dayNumber, this.orderIndex++, {
        id: transferItem.id,
        type: 'transport',
        title: transferItem.title,
        description: preferences.carRental ? 'Rendez votre voiture.' : 'Taxi ou transports.',
        locationName: `Centre-ville → ${destAirport.name}`,
        latitude: destAirport.latitude,
        longitude: destAirport.longitude,
        estimatedCost: preferences.carRental ? 0 : 25 * Math.ceil((preferences.groupSize || 1) / 4),
      }));
    }

    // Vol retour
    const flightStartTime = returnFlight.departureTimeDisplay || formatTime(flightDeparture);
    const flightEndTime = returnFlight.arrivalTimeDisplay || formatTime(flightArrival);

    const flightItem = scheduler.insertFixedItem({
      id: generateId(),
      title: `Vol ${returnFlight.flightNumber} → ${preferences.origin}`,
      type: 'flight',
      startTime: flightDeparture,
      endTime: flightArrival,
      data: { flight: returnFlight },
    });
    if (flightItem) {
      const priceDisplay = formatPriceDisplay(returnFlight.price, returnFlight.pricePerPerson, preferences.groupSize || 1);
      const tripEndDate = new Date(tripStartDate);
      tripEndDate.setDate(tripEndDate.getDate() + preferences.durationDays - 1);
      const bookingUrl = returnFlight.bookingUrl || generateFlightLink(
        { origin: destAirport.code, destination: originAirport.code },
        { date: formatDateForUrl(tripEndDate), passengers: preferences.groupSize }
      );

      const tripItem = toTripItem(flightItem.slot, dayNumber, this.orderIndex++, {
        id: flightItem.id,
        type: 'flight',
        title: flightItem.title,
        description: `${returnFlight.flightNumber} | ${formatFlightDuration(returnFlight.duration)} | ${returnFlight.stops === 0 ? 'Direct' : `${returnFlight.stops} escale(s)`} | ${priceDisplay}`,
        locationName: `${destAirport.code} → ${originAirport.code}`,
        latitude: (destAirport.latitude + originAirport.latitude) / 2,
        longitude: (destAirport.longitude + originAirport.longitude) / 2,
        estimatedCost: returnFlight.price,
        bookingUrl,
        flight: returnFlight,
      });
      tripItem.startTime = flightStartTime;
      tripItem.endTime = flightEndTime;
      items.push(tripItem);
    }

    // Récupération parking (si vol arrive le même jour)
    if (parking) {
      const returnDepDay = new Date(flightDeparture.getFullYear(), flightDeparture.getMonth(), flightDeparture.getDate());
      const returnArrDay = new Date(flightArrival.getFullYear(), flightArrival.getMonth(), flightArrival.getDate());
      if (returnArrDay.getTime() === returnDepDay.getTime()) {
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
          items.push(toTripItem(parkingItem.slot, dayNumber, this.orderIndex++, {
            id: parkingItem.id,
            type: 'parking',
            title: parkingItem.title,
            description: 'Navette et récupération de votre véhicule.',
            locationName: parking.address,
            latitude: parking.latitude,
            longitude: parking.longitude,
            parking,
          }));
        }
      }
    }

    // Les activités sont possibles de 8h jusqu'au checkout
    return {
      items,
      activitiesStartTime: parseTime(date, '08:00'),
      activitiesEndTime: checkoutStart,
      arrivedAtDestination: true,
    };
  }

  // ============================================
  // Private: Ground Return (Last Day)
  // ============================================

  private handleGroundReturn(
    scheduler: DayScheduler,
    date: Date,
    dayNumber: number,
  ): LogisticsResult {
    const { groundTransport, accommodation, preferences } = this.context;
    if (!groundTransport) throw new Error('No ground transport');

    const items: TripItem[] = [];
    this.orderIndex = 0;
    const cityCenter = this.context.cityCenter;

    // Checkout
    const checkoutStart = parseTime(date, '10:00');
    const checkoutEnd = new Date(checkoutStart.getTime() + 30 * 60 * 1000);
    const hotelName = accommodation?.name || 'Hébergement';

    const checkoutItem = scheduler.insertFixedItem({
      id: generateId(),
      title: `Check-out ${hotelName}`,
      type: 'checkout',
      startTime: checkoutStart,
      endTime: checkoutEnd,
    });
    if (checkoutItem) {
      items.push(toTripItem(checkoutItem.slot, dayNumber, this.orderIndex++, {
        id: checkoutItem.id,
        type: 'checkout',
        title: checkoutItem.title,
        description: 'Libérez votre hébergement.',
        locationName: getHotelLocationName(accommodation, preferences.destination),
        latitude: accommodation?.latitude || cityCenter.lat + 0.005,
        longitude: accommodation?.longitude || cityCenter.lng + 0.005,
      }));
    }

    // Transport retour
    const transportStart = parseTime(date, '14:00');
    const transportEnd = new Date(transportStart.getTime() + groundTransport.totalDuration * 60 * 1000);
    const modeLabels: Record<string, string> = { train: 'Train', bus: 'Bus', car: 'Voiture', combined: 'Transport combiné' };
    const modeIcons: Record<string, string> = { train: '🚄', bus: '🚌', car: '🚗', combined: '🔄' };

    const transportItem = scheduler.insertFixedItem({
      id: generateId(),
      title: `${modeIcons[groundTransport.mode] || '🚊'} ${modeLabels[groundTransport.mode] || 'Transport'} → ${preferences.origin}`,
      type: 'transport',
      startTime: transportStart,
      endTime: transportEnd,
    });
    if (transportItem) {
      items.push(toTripItem(transportItem.slot, dayNumber, this.orderIndex++, {
        id: transportItem.id,
        type: 'transport',
        title: transportItem.title,
        description: `Retour | ${groundTransport.totalPrice}€`,
        locationName: `${preferences.destination} → ${preferences.origin}`,
        latitude: cityCenter.lat,
        longitude: cityCenter.lng,
        estimatedCost: groundTransport.totalPrice,
        bookingUrl: groundTransport.bookingUrl,
      }));
    }

    return {
      items,
      activitiesStartTime: parseTime(date, '08:00'),
      activitiesEndTime: parseTime(date, '09:30'), // 30min avant checkout
      arrivedAtDestination: true,
    };
  }
}
