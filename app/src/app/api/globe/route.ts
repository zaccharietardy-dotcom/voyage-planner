import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getAcceptedCloseFriendIds } from '@/lib/server/closeFriends';
import { calculateDistance } from '@/lib/services/geocoding';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface GlobeTripRow {
  id: string;
  title: string | null;
  destination: string | null;
  owner_id: string;
  visibility: 'public' | 'friends' | 'private' | null;
  data: unknown;
  preferences: unknown;
}

interface GlobeProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  username: string | null;
}

interface GlobePhotoRow {
  id: string;
  trip_id: string;
  storage_path: string | null;
  thumbnail_path: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
}

interface TripGeoPoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  type: string;
  dayNumber?: number;
  order?: number;
  imageUrl?: string;
  tripPhotoId?: string;
}

interface TripPhotoPoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  imageUrl?: string;
}

const ROUTE_DEDUP_THRESHOLD_KM = 0.2;
const PHOTO_MATCH_THRESHOLD_KM = 0.35;
const PHOTO_STANDALONE_MIN_KM = 0.6;

function isValidCoord(lat: number | undefined, lng: number | undefined): boolean {
  return typeof lat === 'number'
    && typeof lng === 'number'
    && Number.isFinite(lat)
    && Number.isFinite(lng)
    && Math.abs(lat) <= 90
    && Math.abs(lng) <= 180;
}

function normalizePointName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
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

    const closeFriendIds = await getAcceptedCloseFriendIds(supabase, user.id);

    // Get followed users' public/friends trips (service role bypasses RLS)
    const { data: followedTrips } = await sc
      .from('trips')
      .select('id, title, destination, start_date, duration_days, data, preferences, owner_id, visibility')
      .in('owner_id', followingIds)
      .in('visibility', ['public', 'friends']);

    if (!followedTrips?.length) {
      return NextResponse.json({ trips: [] });
    }

    const visibleTrips = (followedTrips as GlobeTripRow[]).filter((trip) => {
      if (trip.visibility === 'public') return true;
      if (trip.visibility === 'friends') return closeFriendIds.has(trip.owner_id);
      return false;
    });

    if (visibleTrips.length === 0) {
      return NextResponse.json({ trips: [] });
    }

    // Fetch owner profiles separately (join fails with service role)
    const ownerIds = [...new Set(visibleTrips.map((t) => t.owner_id))];
    const { data: profiles } = await sc
      .from('profiles')
      .select('id, display_name, avatar_url, username')
      .in('id', ownerIds);
    const profileMap: Record<string, GlobeProfileRow> = {};
    (profiles as GlobeProfileRow[] | null)?.forEach((p) => { profileMap[p.id] = p; });

    // Get photos for these trips
    const tripIds = visibleTrips.map((t) => t.id);
    const { data: photos } = await sc
      .from('trip_photos')
      .select('id, trip_id, storage_path, thumbnail_path, latitude, longitude, location_name')
      .in('trip_id', tripIds);

    // Build cover map and per-trip photo geo points
    const coverMap: Record<string, string> = {};
    const photoPointsByTrip: Record<string, TripPhotoPoint[]> = {};
    const typedPhotos: GlobePhotoRow[] = photos || [];
    if (typedPhotos.length > 0) {
      const seen = new Set<string>();
      for (const p of typedPhotos) {
        const path = p.thumbnail_path || p.storage_path;
        let imageUrl: string | undefined;
        if (path) {
          const { data: urlData } = sc.storage.from('trip-photos').getPublicUrl(path);
          imageUrl = urlData?.publicUrl || undefined;
        }

        if (!seen.has(p.trip_id)) {
          seen.add(p.trip_id);
          if (imageUrl) {
            coverMap[p.trip_id] = imageUrl;
          }
        }

        if (isValidCoord(p.latitude ?? undefined, p.longitude ?? undefined)) {
          photoPointsByTrip[p.trip_id] ??= [];
          photoPointsByTrip[p.trip_id].push({
            id: p.id,
            lat: p.latitude as number,
            lng: p.longitude as number,
            name: p.location_name || 'Photo',
            imageUrl,
          });
        }
      }
    }

    // Extract geo data from trips
    const extractGeoFromTrip = (trip: GlobeTripRow): TripGeoPoint[] => {
      const data = (trip.data || {}) as {
        preferences?: { destinationCoords?: { lat?: number; lng?: number } };
        days?: Array<{
          dayNumber?: number;
          items?: Array<{
            id?: string;
            latitude?: number;
            longitude?: number;
            locationName?: string;
            title?: string;
            type?: string;
          }>;
        }>;
      };
      const prefs = (trip.preferences || data.preferences || {}) as {
        destinationCoords?: { lat?: number; lng?: number };
      };
      const rawPoints: TripGeoPoint[] = [];
      let pointOrder = 0;

      // Destination coords from preferences
      if (
        prefs.destinationCoords
        && isValidCoord(prefs.destinationCoords.lat, prefs.destinationCoords.lng)
      ) {
        const destLat = prefs.destinationCoords.lat as number;
        const destLng = prefs.destinationCoords.lng as number;
        rawPoints.push({
          id: `${trip.id}-destination`,
          lat: destLat,
          lng: destLng,
          name: trip.destination || trip.title || 'Destination',
          type: 'destination',
          order: pointOrder++,
        });
      }

      // Extract coords from day items
      const days = data.days || [];
      for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
        const day = days[dayIndex];
        for (const item of (day.items || [])) {
          if (isValidCoord(item.latitude, item.longitude)) {
            rawPoints.push({
              id: item.id || `${trip.id}-point-${pointOrder}`,
              lat: item.latitude as number,
              lng: item.longitude as number,
              name: item.locationName || item.title || 'Point',
              type: item.type || 'activity',
              dayNumber: day.dayNumber || dayIndex + 1,
              order: pointOrder++,
            });
          }
        }
      }

      // Remove near-duplicates while preserving route order.
      const deduped: TripGeoPoint[] = [];
      for (const point of rawPoints) {
        const prev = deduped[deduped.length - 1];
        if (!prev) {
          deduped.push(point);
          continue;
        }

        const nearPrev = calculateDistance(prev.lat, prev.lng, point.lat, point.lng) <= ROUTE_DEDUP_THRESHOLD_KM;
        const sameName = normalizePointName(prev.name) === normalizePointName(point.name);
        const sameType = prev.type === point.type;

        if (nearPrev && (sameName || sameType)) {
          continue;
        }
        deduped.push(point);
      }

      // Attach photo thumbnails to nearest points.
      const tripPhotoPoints = [...(photoPointsByTrip[trip.id] || [])];
      const remainingPhotoPoints: TripPhotoPoint[] = [];

      for (const photo of tripPhotoPoints) {
        let nearestPointIndex = -1;
        let nearestDistance = Infinity;

        for (let i = 0; i < deduped.length; i += 1) {
          const point = deduped[i];
          const distanceKm = calculateDistance(point.lat, point.lng, photo.lat, photo.lng);
          if (distanceKm < nearestDistance) {
            nearestDistance = distanceKm;
            nearestPointIndex = i;
          }
        }

        if (nearestPointIndex >= 0 && nearestDistance <= PHOTO_MATCH_THRESHOLD_KM) {
          const matched = deduped[nearestPointIndex];
          if (!matched.imageUrl && photo.imageUrl) {
            matched.imageUrl = photo.imageUrl;
            matched.tripPhotoId = photo.id;
          }
        } else {
          remainingPhotoPoints.push(photo);
        }
      }

      // Add standalone photo spots only when not close to route points.
      for (const photo of remainingPhotoPoints) {
        const tooCloseToExisting = deduped.some((point) =>
          calculateDistance(point.lat, point.lng, photo.lat, photo.lng) <= PHOTO_STANDALONE_MIN_KM
        );

        if (!tooCloseToExisting) {
          deduped.push({
            id: `${trip.id}-photo-${photo.id}`,
            lat: photo.lat,
            lng: photo.lng,
            name: photo.name || 'Spot photo',
            type: 'photo',
            order: pointOrder++,
            imageUrl: photo.imageUrl,
            tripPhotoId: photo.id,
          });
        }
      }

      deduped.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      return deduped.slice(0, 60);
    };

    const globeTrips = visibleTrips.map((trip) => ({
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
