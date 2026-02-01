import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/globe - Get trips from followed users for globe visualization
export async function GET() {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const sc = getServiceClient();

    // Get following IDs
    const { data: followData } = await sc
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id);

    const followingIds = followData?.map(f => f.following_id) || [];

    if (followingIds.length === 0) {
      return NextResponse.json({ trips: [] });
    }

    // Get followed users' public/friends trips (service role bypasses RLS)
    const { data: followedTrips } = await sc
      .from('trips')
      .select('id, title, destination, start_date, duration_days, data, preferences, owner_id, visibility')
      .in('owner_id', followingIds)
      .in('visibility', ['public', 'friends']);

    if (!followedTrips?.length) {
      return NextResponse.json({ trips: [] });
    }

    // Fetch owner profiles separately (join fails with service role)
    const ownerIds = [...new Set(followedTrips.map(t => t.owner_id))];
    const { data: profiles } = await sc
      .from('profiles')
      .select('id, display_name, avatar_url, username')
      .in('id', ownerIds);
    const profileMap: Record<string, any> = {};
    profiles?.forEach(p => { profileMap[p.id] = p; });

    // Get photos for these trips
    const tripIds = followedTrips.map(t => t.id);
    const { data: photos } = await sc
      .from('trip_photos')
      .select('id, trip_id, storage_path, thumbnail_path, latitude, longitude, location_name')
      .in('trip_id', tripIds);

    // Build cover URL map (first photo per trip)
    const coverMap: Record<string, string> = {};
    if (photos?.length) {
      const seen = new Set<string>();
      for (const p of photos) {
        if (!seen.has(p.trip_id)) {
          seen.add(p.trip_id);
          const path = p.thumbnail_path || p.storage_path;
          if (path) {
            const { data: urlData } = sc.storage.from('trip-photos').getPublicUrl(path);
            coverMap[p.trip_id] = urlData?.publicUrl || '';
          }
        }
      }
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

    const globeTrips = followedTrips.map(trip => ({
      id: trip.id,
      title: trip.title || trip.destination,
      destination: trip.destination,
      ownerId: trip.owner_id,
      owner: profileMap[trip.owner_id] || null,
      points: extractGeoFromTrip(trip),
      cover_url: coverMap[trip.id] || null,
    })).filter(t => t.points.length > 0);

    return NextResponse.json({ trips: globeTrips });
  } catch (error) {
    console.error('Globe error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
