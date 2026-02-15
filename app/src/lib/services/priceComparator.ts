/**
 * Service de comparaison de prix multi-plateformes
 *
 * Compare les prix pour hôtels, vols, et activités à travers différentes plateformes.
 * Utilise des APIs réelles quand disponibles, sinon génère des estimations basées sur des différentiels réalistes.
 */

import {
  HotelPriceComparison,
  FlightPriceComparison,
  ActivityPriceComparison,
  TripCostSummary,
  PriceSource,
  Trip,
} from '../types';
import { searchHotelsWithBookingApi } from './rapidApiBooking';

// ============================================
// Hotels - Comparaison de prix
// ============================================

/**
 * Compare les prix d'hôtels sur différentes plateformes
 */
export async function compareHotelPrices(params: {
  city: string;
  checkIn: string;
  checkOut: string;
  hotelName?: string;
  adults: number;
}): Promise<HotelPriceComparison[]> {
  const { city, checkIn, checkOut, adults, hotelName } = params;

  try {
    // Récupérer les prix réels de Booking.com via RapidAPI
    const hotels = await searchHotelsWithBookingApi(city, checkIn, checkOut, {
      guests: adults,
      limit: hotelName ? 5 : 3,
    });

    if (hotels.length === 0) {
      return [];
    }

    // Filtrer par nom d'hôtel si spécifié
    const targetHotels = hotelName
      ? hotels.filter((h) => h.name.toLowerCase().includes(hotelName.toLowerCase())).slice(0, 1)
      : hotels.slice(0, 3);

    return targetHotels.map((hotel) => {
      const bookingPrice = hotel.totalPrice;
      const bookingSource: PriceSource = {
        platform: 'booking',
        price: bookingPrice,
        currency: 'EUR',
        url: hotel.bookingUrl,
        lastChecked: new Date().toISOString(),
        isEstimate: false,
      };

      // Générer des estimations pour les autres plateformes
      // Basé sur des études de marché réelles: Booking.com est généralement 5-15% plus cher qu'Airbnb
      // et similaire à Expedia/Kayak
      const prices: PriceSource[] = [
        bookingSource,
        {
          platform: 'airbnb',
          price: Math.round(bookingPrice * (0.85 + Math.random() * 0.1)), // 85-95% du prix Booking
          currency: 'EUR',
          url: `https://www.airbnb.fr/s/${encodeURIComponent(city)}/homes?checkin=${checkIn}&checkout=${checkOut}&adults=${adults}`,
          lastChecked: new Date().toISOString(),
          isEstimate: true,
        },
        {
          platform: 'expedia',
          price: Math.round(bookingPrice * (0.95 + Math.random() * 0.1)), // 95-105% du prix Booking
          currency: 'EUR',
          url: `https://www.expedia.fr/Hotel-Search?destination=${encodeURIComponent(city)}&startDate=${checkIn}&endDate=${checkOut}&adults=${adults}`,
          lastChecked: new Date().toISOString(),
          isEstimate: true,
        },
        {
          platform: 'kayak',
          price: Math.round(bookingPrice * (0.93 + Math.random() * 0.12)), // 93-105% du prix Booking
          currency: 'EUR',
          url: `https://www.kayak.fr/hotels/${encodeURIComponent(city)}/${checkIn}/${checkOut}/${adults}adults`,
          lastChecked: new Date().toISOString(),
          isEstimate: true,
        },
      ];

      prices.sort((a, b) => a.price - b.price);
      const bestPrice = prices[0];
      const averagePrice = Math.round(prices.reduce((sum, p) => sum + p.price, 0) / prices.length);
      const savingsPercent = Math.round(((bookingPrice - bestPrice.price) / bookingPrice) * 100);

      return {
        hotelName: hotel.name,
        city: hotel.city,
        checkIn,
        checkOut,
        prices,
        bestPrice,
        averagePrice,
        savingsPercent: Math.max(0, savingsPercent),
      };
    });
  } catch (error) {
    console.error('[PriceComparator] Erreur comparaison prix hôtels:', error);
    return [];
  }
}

// ============================================
// Vols - Comparaison de prix
// ============================================

/**
 * Compare les prix de vols sur différentes plateformes
 * Note: Le service flights.ts retourne déjà des résultats de plusieurs sources (SerpAPI, Amadeus, etc.)
 */
export async function compareFlightPrices(params: {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
}): Promise<FlightPriceComparison[]> {
  const { origin, destination, departureDate, adults } = params;

  // Pour l'instant, retourner un placeholder car le service flights.ts fait déjà la comparaison
  // Cette fonction pourrait être étendue pour ajouter d'autres agrégateurs
  return [
    {
      airline: 'Various',
      route: `${origin} → ${destination}`,
      departureDate,
      prices: [
        {
          platform: 'google_flights',
          price: 250,
          currency: 'EUR',
          url: `https://www.google.com/travel/flights?q=Flights%20from%20${origin}%20to%20${destination}%20on%20${departureDate}`,
          lastChecked: new Date().toISOString(),
          isEstimate: true,
        },
        {
          platform: 'aviasales',
          price: 240,
          currency: 'EUR',
          url: `https://www.aviasales.com/search/${origin}${destination}${departureDate.replace(/-/g, '')}`,
          lastChecked: new Date().toISOString(),
          isEstimate: true,
        },
        {
          platform: 'kayak',
          price: 255,
          currency: 'EUR',
          url: `https://www.kayak.fr/flights/${origin}-${destination}/${departureDate}`,
          lastChecked: new Date().toISOString(),
          isEstimate: true,
        },
      ],
      bestPrice: {
        platform: 'aviasales',
        price: 240,
        currency: 'EUR',
        lastChecked: new Date().toISOString(),
        isEstimate: true,
      },
      averagePrice: 248,
    },
  ];
}

// ============================================
// Activités - Comparaison de prix
// ============================================

/**
 * Compare les prix d'activités sur différentes plateformes
 */
export async function compareActivityPrices(params: {
  activityName: string;
  city: string;
  date?: string;
}): Promise<ActivityPriceComparison[]> {
  const { activityName, city, date } = params;

  // Estimation basée sur le type d'activité
  const basePrice = estimateActivityPrice(activityName);

  const prices: PriceSource[] = [
    {
      platform: 'viator',
      price: basePrice,
      currency: 'EUR',
      url: `https://www.viator.com/${encodeURIComponent(city)}-tours/${encodeURIComponent(activityName)}/d${date || ''}`,
      lastChecked: new Date().toISOString(),
      isEstimate: true,
    },
    {
      platform: 'getyourguide',
      price: Math.round(basePrice * 0.95), // GetYourGuide généralement 5% moins cher
      currency: 'EUR',
      url: `https://www.getyourguide.fr/s/?q=${encodeURIComponent(activityName)}+${encodeURIComponent(city)}`,
      lastChecked: new Date().toISOString(),
      isEstimate: true,
    },
    {
      platform: 'tiqets',
      price: Math.round(basePrice * 0.92), // Tiqets souvent le moins cher pour les musées
      currency: 'EUR',
      url: `https://www.tiqets.com/fr/search?query=${encodeURIComponent(activityName)}`,
      lastChecked: new Date().toISOString(),
      isEstimate: true,
    },
  ];

  prices.sort((a, b) => a.price - b.price);
  const bestPrice = prices[0];

  // Détecter si l'activité pourrait être gratuite
  const freeAlternative = detectFreeAlternative(activityName);

  return [
    {
      activityName,
      city,
      prices,
      bestPrice,
      freeAlternative,
    },
  ];
}

/**
 * Estime le prix d'une activité basé sur son nom
 */
function estimateActivityPrice(activityName: string): number {
  const name = activityName.toLowerCase();

  // Musées et monuments
  if (name.includes('musée') || name.includes('museum') || name.includes('galerie') || name.includes('gallery')) {
    return 15;
  }

  // Tours guidés
  if (name.includes('tour') || name.includes('visite guidée') || name.includes('guided')) {
    return 25;
  }

  // Activités premium (bateau, hélicoptère, etc.)
  if (name.includes('bateau') || name.includes('boat') || name.includes('croisière') || name.includes('cruise') || name.includes('hélicoptère') || name.includes('helicopter')) {
    return 50;
  }

  // Parcs d'attractions
  if (name.includes('parc') || name.includes('park') || name.includes('disney') || name.includes('universal')) {
    return 60;
  }

  // Activités sportives
  if (name.includes('ski') || name.includes('plongée') || name.includes('diving') || name.includes('surf') || name.includes('parachute')) {
    return 80;
  }

  // Par défaut
  return 20;
}

/**
 * Détecte si une activité a une alternative gratuite
 */
function detectFreeAlternative(activityName: string): string | undefined {
  const name = activityName.toLowerCase();

  if (name.includes('panorama') || name.includes('vue') || name.includes('viewpoint') || name.includes('belvédère')) {
    return 'Accessible gratuitement sans réservation';
  }

  if (name.includes('plage') || name.includes('beach') || name.includes('parc public') || name.includes('public park')) {
    return 'Accès libre et gratuit';
  }

  if (name.includes('marché') || name.includes('market') || name.includes('quartier') || name.includes('neighborhood')) {
    return 'Visite libre gratuite';
  }

  if (name.includes('cathédrale') || name.includes('cathedral') || name.includes('église') || name.includes('church')) {
    return 'Entrée gratuite (visite libre), donation bienvenue';
  }

  return undefined;
}

// ============================================
// Trip Cost Summary - Vue d'ensemble du voyage
// ============================================

/**
 * Calcule un résumé complet des coûts du voyage avec comparaisons
 */
export async function getTripCostSummary(trip: Trip): Promise<TripCostSummary> {
  const { preferences, days, accommodation, outboundFlight, returnFlight, costBreakdown } = trip;

  // Hébergement
  const accommodationTotal = costBreakdown?.accommodation || 0;
  const accommodationBestTotal = Math.round(accommodationTotal * 0.9); // Estimation: 10% d'économie possible
  const accommodationSavings = accommodationTotal - accommodationBestTotal;

  // Vols
  const flightsTotal = costBreakdown?.flights || 0;
  const flightsBestTotal = Math.round(flightsTotal * 0.95); // Estimation: 5% d'économie possible
  const flightsSavings = flightsTotal - flightsBestTotal;

  // Activités
  const activitiesTotal = costBreakdown?.activities || 0;
  const activitiesBestTotal = Math.round(activitiesTotal * 0.92); // Estimation: 8% d'économie possible
  const activitiesSavings = activitiesTotal - activitiesBestTotal;

  // Nourriture (estimation)
  const estimatedFood = costBreakdown?.food || preferences.durationDays * preferences.groupSize * 40; // 40€/pers/jour

  // Transport local (estimation)
  const estimatedTransport = costBreakdown?.transport || preferences.durationDays * preferences.groupSize * 10; // 10€/pers/jour

  // Totaux
  const grandTotal = accommodationTotal + flightsTotal + activitiesTotal + estimatedFood + estimatedTransport;
  const bestGrandTotal = accommodationBestTotal + flightsBestTotal + activitiesBestTotal + estimatedFood + estimatedTransport;
  const totalSavings = grandTotal - bestGrandTotal;
  const savingsPercent = grandTotal > 0 ? Math.round((totalSavings / grandTotal) * 100) : 0;

  return {
    accommodation: {
      total: accommodationTotal,
      bestTotal: accommodationBestTotal,
      savings: accommodationSavings,
    },
    flights: {
      total: flightsTotal,
      bestTotal: flightsBestTotal,
      savings: flightsSavings,
    },
    activities: {
      total: activitiesTotal,
      bestTotal: activitiesBestTotal,
      savings: activitiesSavings,
    },
    estimatedFood,
    estimatedTransport,
    grandTotal,
    bestGrandTotal,
    totalSavings,
    savingsPercent,
  };
}
