import { NextRequest, NextResponse } from 'next/server';
import { searchAirbnbListings, isAirbnbApiConfigured } from '@/lib/services/airbnb';
import { searchViatorActivities, isViatorConfigured } from '@/lib/services/viator';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, destination, checkIn, checkOut, guests, cityCenter } = body;

  if (type === 'airbnb') {
    const configured = isAirbnbApiConfigured();
    if (!configured) {
      // Generate fallback search link
      const searchUrl = `https://www.airbnb.com/s/${encodeURIComponent(destination)}/homes?checkin=${checkIn}&checkout=${checkOut}&adults=${guests || 2}&price_max=100&room_types%5B%5D=Entire%20home%2Fapt`;
      return NextResponse.json({
        configured: false,
        fallbackUrl: searchUrl,
        message: 'API Airbnb non configuree (RAPIDAPI_KEY manquante). Lien de recherche genere.',
      });
    }

    try {
      const results = await searchAirbnbListings(destination, checkIn, checkOut, {
        guests: guests || 2,
        maxPricePerNight: 100,
        limit: 5,
        cityCenter: cityCenter || undefined,
      });

      return NextResponse.json({
        configured: true,
        count: results.length,
        listings: results.map(r => ({
          name: r.name,
          pricePerNight: r.pricePerNight,
          bookingUrl: r.bookingUrl,
          latitude: r.latitude,
          longitude: r.longitude,
          rating: r.rating,
        })),
      });
    } catch (error: any) {
      return NextResponse.json({ configured: true, error: error.message }, { status: 500 });
    }
  }

  if (type === 'viator') {
    const configured = isViatorConfigured();
    if (!configured) {
      return NextResponse.json({
        configured: false,
        message: 'API Viator non configuree (VIATOR_API_KEY manquante).',
      });
    }

    try {
      const results = await searchViatorActivities(
        destination,
        cityCenter || { lat: 13.7563, lng: 100.5018 }, // Bangkok default
        { limit: 10 },
      );

      return NextResponse.json({
        configured: true,
        count: results.length,
        activities: results.map(a => ({
          name: a.name,
          type: a.type,
          duration: a.duration,
          estimatedCost: a.estimatedCost,
          bookingUrl: a.bookingUrl,
          rating: a.rating,
          reviewCount: (a as any).reviewCount,
          imageUrl: (a as any).imageUrl,
        })),
      });
    } catch (error: any) {
      return NextResponse.json({ configured: true, error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'type must be "airbnb" or "viator"' }, { status: 400 });
}
