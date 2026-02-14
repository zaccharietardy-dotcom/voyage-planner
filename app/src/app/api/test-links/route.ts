import { NextRequest, NextResponse } from 'next/server';
import { searchAirbnbListings, isAirbnbApiConfigured, isValidAirbnbRoomUrl } from '@/lib/services/airbnb';
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
        diagnostics: {
          source: 'fallback-search-url',
          providerHost: process.env.RAPIDAPI_AIRBNB_HOST || 'airbnb19.p.rapidapi.com',
        },
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
        diagnostics: {
          source: 'rapidapi-airbnb19',
          providerHost: process.env.RAPIDAPI_AIRBNB_HOST || 'airbnb19.p.rapidapi.com',
          returned: results.length,
          validRoomUrls: results.filter(r => isValidAirbnbRoomUrl(r.bookingUrl)).length,
          invalidRoomUrls: results.filter(r => !isValidAirbnbRoomUrl(r.bookingUrl)).length,
        },
        listings: results.map(r => ({
          name: r.name,
          pricePerNight: r.pricePerNight,
          bookingUrl: r.bookingUrl,
          latitude: r.latitude,
          longitude: r.longitude,
          rating: r.rating,
        })),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ configured: true, error: message }, { status: 500 });
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
          reviewCount: typeof (a as { reviewCount?: unknown }).reviewCount === 'number'
            ? ((a as { reviewCount: number }).reviewCount)
            : 0,
          imageUrl: typeof (a as { imageUrl?: unknown }).imageUrl === 'string'
            ? ((a as { imageUrl: string }).imageUrl)
            : undefined,
        })),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ configured: true, error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'type must be "airbnb" or "viator"' }, { status: 400 });
}
