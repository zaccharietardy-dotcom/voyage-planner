import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// GET /api/globe - Get geolocated trips for globe visualization
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // Get own trips
    const { data: ownTrips } = await supabase
      .from('trips')
      .select('id, title, destination, start_date, duration_days, data, preferences, owner_id')
      .eq('owner_id', user.id);

    // Get following IDs
    const { data: followData } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id);

    const followingIds = followData?.map(f => f.following_id) || [];

    // Get followed users' public trips
    let followedTrips: any[] = [];
    if (followingIds.length > 0) {
      const { data } = await supabase
        .from('trips')
        .select(`
          id, title, destination, start_date, duration_days, data, preferences, owner_id,
          owner:owner_id (id, display_name, avatar_url, username)
        `)
        .in('owner_id', followingIds)
        .eq('visibility', 'public');
      followedTrips = data || [];
    }

    // Get photos for these trips
    const allTripIds = [
      ...(ownTrips?.map(t => t.id) || []),
      ...followedTrips.map(t => t.id),
    ];

    let photos: any[] = [];
    if (allTripIds.length > 0) {
      const { data } = await supabase
        .from('trip_photos')
        .select('id, trip_id, storage_path, thumbnail_path, latitude, longitude, location_name, caption')
        .in('trip_id', allTripIds)
        .eq('visibility', 'public')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);
      photos = data || [];
    }

    // Extract geo data from trips
    const extractGeoFromTrip = (trip: any) => {
      const data = trip.data || {};
      const prefs = trip.preferences || data.preferences || {};
      const points: { lat: number; lng: number; name: string; type: string }[] = [];

      // Destination coords from preferences
      if (prefs.destinationCoords) {
        points.push({
          lat: prefs.destinationCoords.lat,
          lng: prefs.destinationCoords.lng,
          name: trip.destination,
          type: 'destination',
        });
      }

      // Extract coords from day items
      const days = data.days || [];
      for (const day of days) {
        for (const item of (day.items || [])) {
          if (item.latitude && item.longitude) {
            points.push({
              lat: item.latitude,
              lng: item.longitude,
              name: item.locationName || item.title,
              type: item.type,
            });
          }
        }
      }

      return points;
    };

    const globeTrips = [
      ...(ownTrips || []).map(trip => ({
        id: trip.id,
        title: trip.title || trip.destination,
        destination: trip.destination,
        ownerId: trip.owner_id,
        isOwn: true,
        points: extractGeoFromTrip(trip),
        photos: photos.filter(p => p.trip_id === trip.id),
      })),
      ...followedTrips.map(trip => ({
        id: trip.id,
        title: trip.title || trip.destination,
        destination: trip.destination,
        ownerId: trip.owner_id,
        owner: trip.owner,
        isOwn: false,
        points: extractGeoFromTrip(trip),
        photos: photos.filter(p => p.trip_id === trip.id),
      })),
    ].filter(t => t.points.length > 0);

    return NextResponse.json({ trips: globeTrips });
  } catch (error) {
    console.error('Globe error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
