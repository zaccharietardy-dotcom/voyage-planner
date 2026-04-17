/**
 * Pipeline V4 — Step 4: Build Trip from validated data
 *
 * Converts validated items + drives + hotels into TripDay[]/TripItem[]
 * in the exact same format as Pipeline V3.
 */

import type { Trip, TripDay, TripItem, TripPreferences, Accommodation } from '../types';
import type { ValidatedItem, ValidatedDrive, HubHotelResult, LLMTripDesign } from './types';
import {
  addOutboundTransportItem,
  addReturnTransportItem,
} from '../pipeline/utils/transport-items';
function uuidv4(): string {
  return 'v4-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function timeToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addMinutes(time: string, minutes: number): string {
  return minToTime(timeToMin(time) + minutes);
}

// ---------------------------------------------------------------------------
// Build TripItem from ValidatedItem
// ---------------------------------------------------------------------------

function isGooglePlacesBackedSource(source: ValidatedItem['source']): boolean {
  return source === 'google_places' || source === 'catalog' || source === 'catalog_auto_injected';
}

function buildActivityItem(
  item: ValidatedItem,
  orderIndex: number,
  startTime?: string,
): TripItem {
  const start = startTime || item.original.startTime || '10:00';
  const duration = item.original.duration || 60;
  const placeBacked = isGooglePlacesBackedSource(item.source);

  return {
    id: `v4-${item.dayNumber}-${orderIndex}-${uuidv4().slice(0, 8)}`,
    dayNumber: item.dayNumber,
    startTime: start,
    endTime: addMinutes(start, duration),
    type: 'activity',
    title: item.replacedWith || item.original.name,
    description: item.original.tip || `${item.original.name}`,
    locationName: item.replacedWith || item.original.name,
    latitude: item.coords.lat,
    longitude: item.coords.lng,
    orderIndex,
    duration,
    estimatedCost: item.original.estimatedCost || 0,
    rating: item.rating,
    reviewCount: item.reviewCount,
    imageUrl: item.photos?.[0],
    photoGallery: item.photos,
    openingHours: item.openingHours,
    openingHoursByDay: item.openingHoursByDay,
    website: item.website,
    googleMapsPlaceUrl: item.googleMapsUrl
      || (item.googlePlaceId
        ? `https://www.google.com/maps/place/?q=place_id:${item.googlePlaceId}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.original.name)}`),
    dataReliability: item.validated ? 'verified' : 'estimated',
    geoSource: placeBacked ? 'place' : 'geocode',
    geoConfidence: placeBacked ? 'high' : item.source === 'nominatim' ? 'medium' : 'low',
    llmContextTip: item.original.tip,
  };
}

function inferMealTypeFromStartTime(startTime: string): 'breakfast' | 'lunch' | 'dinner' {
  const [hStr, mStr] = startTime.split(':');
  const mins = (Number(hStr) || 12) * 60 + (Number(mStr) || 0);
  if (mins < 10 * 60 + 30) return 'breakfast';   // before 10:30
  if (mins < 17 * 60) return 'lunch';            // 10:30–17:00
  return 'dinner';                                // 17:00+
}

function buildRestaurantItem(
  item: ValidatedItem,
  orderIndex: number,
  startTime?: string,
): TripItem {
  const start = startTime || item.original.startTime || '12:30';
  const mealType = item.original.mealType || inferMealTypeFromStartTime(start);
  const duration = item.original.duration || (mealType === 'breakfast' ? 45 : mealType === 'lunch' ? 75 : 90);
  const mealLabel = mealType === 'breakfast' ? 'Petit-déjeuner' : mealType === 'lunch' ? 'Déjeuner' : 'Dîner';
  const displayName = item.replacedWith || item.original.name;
  const placeBacked = isGooglePlacesBackedSource(item.source);

  return {
    id: `v4-meal-${item.dayNumber}-${mealType}-${uuidv4().slice(0, 8)}`,
    dayNumber: item.dayNumber,
    startTime: start,
    endTime: addMinutes(start, duration),
    type: 'restaurant',
    title: `${mealLabel} — ${displayName}`,
    description: item.original.tip || `${mealLabel} à ${displayName}`,
    locationName: displayName,
    latitude: item.coords.lat,
    longitude: item.coords.lng,
    orderIndex,
    duration,
    mealType,
    estimatedCost: item.original.estimatedCost || (mealType === 'breakfast' ? 10 : mealType === 'lunch' ? 20 : 30),
    rating: item.rating,
    reviewCount: item.reviewCount,
    imageUrl: item.photos?.[0],
    restaurant: item.restaurant || {
      id: `v4-resto-${uuidv4().slice(0, 8)}`,
      name: displayName,
      latitude: item.coords.lat,
      longitude: item.coords.lng,
      rating: item.rating || 0,
      reviewCount: item.reviewCount || 0,
      priceLevel: item.priceLevel,
      address: item.original.address || '',
      googleMapsUrl: item.googleMapsUrl,
    } as any,
    restaurantAlternatives: item.restaurantAlternatives,
    googleMapsPlaceUrl: item.googleMapsUrl
      || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(displayName)}`,
    openingHours: item.openingHours,
    openingHoursByDay: item.openingHoursByDay,
    dataReliability: item.validated ? 'verified' : 'estimated',
    geoSource: placeBacked ? 'place' : 'geocode',
    geoConfidence: placeBacked ? 'high' : 'medium',
    llmContextTip: item.original.tip,
    qualityFlags: item.source === 'unverified' ? ['self_meal_fallback'] : [],
  };
}

function buildDriveItem(
  drive: ValidatedDrive,
  orderIndex: number,
  startTime: string,
): TripItem {
  return {
    id: `v4-drive-${drive.dayNumber}-${orderIndex}-${uuidv4().slice(0, 8)}`,
    dayNumber: drive.dayNumber,
    startTime,
    endTime: addMinutes(startTime, drive.realDurationMin),
    type: 'transport',
    title: `${drive.original.from} → ${drive.original.to}`,
    description: `${drive.realDistanceKm}km, ${drive.realDurationMin}min en voiture`,
    locationName: drive.original.to,
    latitude: drive.toCoords.lat,
    longitude: drive.toCoords.lng,
    orderIndex,
    duration: drive.realDurationMin,
    estimatedCost: 0,
    transportMode: 'car',
    transportRole: drive.realDistanceKm > 100 ? 'longhaul' : 'inter_item',
    distanceFromPrevious: drive.realDistanceKm,
    timeFromPrevious: drive.realDurationMin,
    routePolylineFromPrevious: drive.polyline,
    googleMapsPlaceUrl: drive.googleMapsUrl,
    dataReliability: 'verified',
  };
}

function buildCheckinItem(
  hotel: Accommodation,
  dayNumber: number,
  orderIndex: number,
  time: string = '17:00',
): TripItem {
  return {
    id: `v4-checkin-${dayNumber}`,
    dayNumber,
    startTime: time,
    endTime: addMinutes(time, 15),
    type: 'checkin',
    title: `Check-in — ${hotel.name}`,
    description: `Arrivée et installation`,
    locationName: hotel.name,
    latitude: hotel.latitude || 0,
    longitude: hotel.longitude || 0,
    orderIndex,
    duration: 15,
    estimatedCost: 0,
    imageUrl: hotel.photos?.[0],
    accommodation: hotel,
  };
}

function buildCheckoutItem(
  hotel: Accommodation,
  dayNumber: number,
  orderIndex: number,
  time: string = '10:30',
): TripItem {
  return {
    id: `v4-checkout-${dayNumber}`,
    dayNumber,
    startTime: time,
    endTime: addMinutes(time, 30),
    type: 'checkout',
    title: `Check-out — ${hotel.name}`,
    description: `Libérer la chambre`,
    locationName: hotel.name,
    latitude: hotel.latitude || 0,
    longitude: hotel.longitude || 0,
    orderIndex,
    duration: 30,
    estimatedCost: 0,
  };
}

// ---------------------------------------------------------------------------
// Build complete Trip
// ---------------------------------------------------------------------------

export function buildTrip(
  design: LLMTripDesign,
  validatedItems: ValidatedItem[],
  validatedDrives: ValidatedDrive[],
  hotels: HubHotelResult[],
  preferences: TripPreferences,
): Trip {
  const startDate = preferences.startDate ? new Date(preferences.startDate) : new Date();
  const days: TripDay[] = [];

  // Index hotels by city first to avoid daily hotel churn for the same hub.
  const hotelByCity = new Map<string, Accommodation>();
  for (const hr of hotels) {
    const cityKey = hr.hub.city?.trim().toLowerCase();
    if (!hr.hotel || !cityKey) continue;
    if (!hotelByCity.has(cityKey)) {
      hotelByCity.set(cityKey, hr.hotel);
    }
  }
  const hotelByDay = new Map<number, Accommodation>();
  for (const llmDay of design.days) {
    const cityKey = llmDay.hub?.trim().toLowerCase();
    if (!cityKey) continue;
    const cityHotel = hotelByCity.get(cityKey);
    if (cityHotel) {
      hotelByDay.set(llmDay.day, cityHotel);
    }
  }

  // Find the "main" hotel (first one or most used)
  const mainHotel = hotels.find(h => h.hotel)?.hotel || null;

  for (const llmDay of design.days) {
    const dayDate = new Date(startDate);
    dayDate.setDate(dayDate.getDate() + llmDay.day - 1);

    const dayItems: TripItem[] = [];
    const dayValidatedItems = validatedItems.filter(i => i.dayNumber === llmDay.day);
    const dayDrives = validatedDrives.filter(d => d.dayNumber === llmDay.day);

    let orderIndex = 0;
    let currentTime = '08:30';

    // Check if previous day had a different hotel → checkout
    const prevDayHotel = hotelByDay.get(llmDay.day - 1);
    const thisDayHotel = hotelByDay.get(llmDay.day);
    if (prevDayHotel && prevDayHotel !== thisDayHotel && llmDay.day > 1) {
      dayItems.push(buildCheckoutItem(prevDayHotel, llmDay.day, orderIndex++));
      currentTime = '11:00';
    }
    if (llmDay.day === design.days.length && thisDayHotel) {
      dayItems.push(buildCheckoutItem(thisDayHotel, llmDay.day, orderIndex++));
      currentTime = '11:00';
    }

    // Insert drives that happen at start of day (longhaul from origin or between cities)
    const earlyDrives = dayDrives.filter(d => {
      // First drive of day 1, or intercity drives
      return d.realDistanceKm > 30;
    });

    for (const drive of earlyDrives) {
      // Place drive at current time if it's the first thing (day 1 from origin)
      if (llmDay.day === 1 && drive.original.from.toLowerCase().includes(preferences.origin?.toLowerCase() || '???')) {
        dayItems.push(buildDriveItem(drive, orderIndex++, currentTime));
        currentTime = addMinutes(currentTime, drive.realDurationMin + 15); // 15min buffer
      }
    }

    // Place items in LLM order, recalculating times with real durations
    for (const item of dayValidatedItems) {
      // Use LLM startTime as baseline but adjust if we're running late
      const llmStart = timeToMin(item.original.startTime || currentTime);
      const currentMin = timeToMin(currentTime);
      const actualStart = Math.max(llmStart, currentMin);

      if (actualStart > 22 * 60) break; // Don't schedule past 22:00

      const startTimeStr = minToTime(actualStart);

      if (item.original.type === 'activity') {
        dayItems.push(buildActivityItem(item, orderIndex++, startTimeStr));
      } else {
        dayItems.push(buildRestaurantItem(item, orderIndex++, startTimeStr));
      }

      currentTime = addMinutes(startTimeStr, item.original.duration || 60);

      // Add small buffer between items (10min walk/transition)
      currentTime = addMinutes(currentTime, 10);
    }

    // Checkin only when hotel changes (or first day) to avoid repeated daily check-ins.
    if (thisDayHotel && (llmDay.day === 1 || thisDayHotel !== prevDayHotel)) {
      const checkinTime = timeToMin(currentTime) < 17 * 60 ? '17:00' : currentTime;
      dayItems.push(buildCheckinItem(thisDayHotel, llmDay.day, orderIndex++, checkinTime));
    }

    // End-of-day drive (return to origin on last day)
    const returnDrives = dayDrives.filter(d =>
      d.original.to.toLowerCase().includes(preferences.origin?.toLowerCase() || '???')
    );
    for (const drive of returnDrives) {
      const returnTime = timeToMin(currentTime) < 17 * 60 ? '17:00' : currentTime;
      dayItems.push(buildDriveItem(drive, orderIndex++, returnTime));
    }

    // Sort by startTime
    dayItems.sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
    // Fix orderIndex
    dayItems.forEach((item, idx) => { item.orderIndex = idx; });

    // Calculate daily budget
    let actCost = 0, foodCost = 0, transCost = 0;
    for (const item of dayItems) {
      const cost = Number(item.estimatedCost || 0);
      if (item.type === 'activity') actCost += cost;
      else if (item.type === 'restaurant') foodCost += cost;
      else if (item.type === 'transport') transCost += cost;
    }

    days.push({
      dayNumber: llmDay.day,
      date: dayDate,
      items: dayItems,
      theme: llmDay.theme,
      dayNarrative: llmDay.narrative,
      dailyBudget: { activities: actCost, food: foodCost, transport: transCost, total: actCost + foodCost + transCost },
    });
  }

  // Inject outbound/return transport items with affiliate links.
  // V4 doesn't currently fetch real flight data, so pass null + null:
  // the utility falls back to generating Aviasales/Omio search URLs from preferences.
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  if (firstDay) {
    const fallbackCoordsOutbound = firstDay.items.find((it) => it.latitude && it.longitude)
      ? { lat: firstDay.items.find((it) => it.latitude)!.latitude, lng: firstDay.items.find((it) => it.longitude)!.longitude }
      : { lat: 48.85, lng: 2.35 };
    addOutboundTransportItem(firstDay, null, null, preferences, fallbackCoordsOutbound);
  }
  if (lastDay && lastDay !== firstDay) {
    const fallbackCoordsReturn = lastDay.items.find((it) => it.latitude && it.longitude)
      ? { lat: lastDay.items.find((it) => it.latitude)!.latitude, lng: lastDay.items.find((it) => it.longitude)!.longitude }
      : { lat: 48.85, lng: 2.35 };
    addReturnTransportItem(lastDay, null, null, preferences, fallbackCoordsReturn);
  }

  // Calculate total cost
  const accommodationCost = hotels.reduce((sum, h) => sum + (h.hotel?.pricePerNight || 0), 0);
  const totalCost = days.reduce((sum, d) => sum + (d.dailyBudget?.total || 0), 0) + accommodationCost;

  const trip: Trip = {
    id: uuidv4(),
    createdAt: new Date(),
    updatedAt: new Date(),
    preferences,
    days,
    accommodation: mainHotel || undefined,
    accommodationOptions: hotels.map(h => h.hotel).filter((h): h is Accommodation => h !== null),
    totalEstimatedCost: totalCost,
    costBreakdown: {
      flights: 0,
      accommodation: accommodationCost,
      food: days.reduce((sum, d) => sum + (d.dailyBudget?.food || 0), 0),
      activities: days.reduce((sum, d) => sum + (d.dailyBudget?.activities || 0), 0),
      transport: days.reduce((sum, d) => sum + (d.dailyBudget?.transport || 0), 0),
      parking: 0,
      other: 0,
    },
    qualityMetrics: {
      score: 0, // Will be computed by contracts
      invariantsPassed: true,
      violations: [],
    },
    pipelineVersion: 'v4-llm-first',
  };

  return trip;
}
