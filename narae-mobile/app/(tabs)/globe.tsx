import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Compass } from 'lucide-react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { fetchMyTrips } from '@/lib/api/trips';
import { colors, fonts } from '@/lib/theme';

const DESTINATION_COORDS: Record<string, [number, number]> = {
  'Paris': [48.8566, 2.3522], 'Tokyo': [35.6762, 139.6503], 'Rome': [41.9028, 12.4964],
  'Londres': [51.5074, -0.1278], 'London': [51.5074, -0.1278], 'New York': [40.7128, -74.006],
  'Barcelone': [41.3874, 2.1686], 'Barcelona': [41.3874, 2.1686], 'Amsterdam': [52.3676, 4.9041],
  'Berlin': [52.52, 13.405], 'Lisbonne': [38.7223, -9.1393], 'Lisbon': [38.7223, -9.1393],
  'Prague': [50.0755, 14.4378], 'Vienne': [48.2082, 16.3738], 'Istanbul': [41.0082, 28.9784],
  'Marrakech': [31.6295, -7.9811], 'Dubai': [25.2048, 55.2708], 'Bangkok': [13.7563, 100.5018],
  'S\u00e9oul': [37.5665, 126.978], 'Seoul': [37.5665, 126.978], 'Ath\u00e8nes': [37.9838, 23.7275],
  'Kyoto': [35.0116, 135.7681], 'Osaka': [34.6937, 135.5023], 'Milan': [45.4642, 9.19],
  'Florence': [43.7696, 11.2558], 'Venise': [45.4408, 12.3155], 'Nice': [43.7102, 7.262],
  'Lyon': [45.764, 4.8357], 'Marseille': [43.2965, 5.3698], 'Bordeaux': [44.8378, -0.5792],
};

function findTripCoords(trip: any): { lat: number; lng: number } | null {
  const days = trip.data?.days;
  if (!Array.isArray(days)) return null;
  for (const day of days) {
    if (!Array.isArray(day.items)) continue;
    for (const item of day.items) {
      if (item.latitude && item.longitude && item.latitude !== 0) {
        return { lat: item.latitude, lng: item.longitude };
      }
    }
  }
  return null;
}

export default function GlobeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { data: trips } = useApi(
    () => (user?.id ? fetchMyTrips() : Promise.resolve([])),
    [user?.id ?? null],
  );

  const destinations = (trips ?? [])
    .map((t: any) => {
      const coords = findTripCoords(t);
      const fallback = DESTINATION_COORDS[t.destination];
      const lat = coords?.lat ?? fallback?.[0];
      const lng = coords?.lng ?? fallback?.[1];
      if (!lat || !lng) return null;
      return { id: t.id, destination: t.destination, latitude: lat, longitude: lng };
    })
    .filter(Boolean);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFillObject}
        initialRegion={{ latitude: 46.6, longitude: 2.5, latitudeDelta: 20, longitudeDelta: 20 }}
        userInterfaceStyle="dark"
      >
        {destinations.map((d: any) => (
          <Marker
            key={d.id}
            coordinate={{ latitude: d.latitude, longitude: d.longitude }}
            onPress={() => router.push(`/trip/${d.id}`)}
          >
            <View style={{
              width: 56, height: 56, borderRadius: 28,
              backgroundColor: 'rgba(10,22,40,0.9)',
              borderWidth: 3, borderColor: colors.gold,
              alignItems: 'center', justifyContent: 'center',
              shadowColor: colors.gold, shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.4, shadowRadius: 12,
            }}>
              <Compass size={22} color={colors.gold} />
            </View>
            <Text style={{
              color: colors.text, fontSize: 10, fontFamily: fonts.sansBold,
              textAlign: 'center', marginTop: 4,
            }}>{d.destination}</Text>
          </Marker>
        ))}
      </MapView>

      {/* Header overlay */}
      <View style={{
        position: 'absolute', top: 60, left: 20, right: 20,
        flexDirection: 'row', alignItems: 'center', gap: 10,
      }}>
        <View style={{
          paddingHorizontal: 16, paddingVertical: 10,
          borderRadius: 999, backgroundColor: 'rgba(2,6,23,0.7)',
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
          flexDirection: 'row', alignItems: 'center', gap: 8,
        }}>
          <Compass size={16} color={colors.gold} />
          <Text style={{ color: colors.gold, fontSize: 12, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 2 }}>
            Narae Globe
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <View style={{
          paddingHorizontal: 12, paddingVertical: 8,
          borderRadius: 999, backgroundColor: 'rgba(2,6,23,0.7)',
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
        }}>
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold }}>
            {destinations.length} voyage{destinations.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
    </View>
  );
}
