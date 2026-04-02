import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { colors } from '@/lib/theme';
import type { TripDay, TripItem, TripItemType } from '@/lib/types/trip';

interface Props {
  days: TripDay[];
  onMarkerPress?: (item: TripItem) => void;
}

const TYPE_COLORS: Record<TripItemType, string> = {
  activity: colors.activity,
  restaurant: colors.restaurant,
  hotel: colors.hotel,
  transport: colors.transport,
  flight: colors.flight,
  parking: '#6B7280',
  checkin: colors.hotel,
  checkout: colors.hotel,
  luggage: '#F59E0B',
  free_time: '#22C55E',
};

const DAY_COLORS = ['#c5a059', '#60a5fa', '#f472b6', '#4ade80', '#a78bfa', '#fb923c', '#22d3ee', '#e879f9'];

export function TripMap({ days, onMarkerPress }: Props) {
  const [activeDay, setActiveDay] = useState<number | null>(null);

  const visibleDays = activeDay !== null ? days.filter((d) => d.dayNumber === activeDay) : days;

  // Collect all markers
  const markers = visibleDays.flatMap((day) =>
    day.items
      .filter((item) => item.latitude && item.longitude && item.latitude !== 0)
      .map((item) => ({ ...item, _dayNumber: day.dayNumber })),
  );

  // Calculate initial region
  const lats = markers.map((m) => m.latitude);
  const lngs = markers.map((m) => m.longitude);
  const initialRegion = markers.length > 0 ? {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: Math.max(0.02, (Math.max(...lats) - Math.min(...lats)) * 1.3),
    longitudeDelta: Math.max(0.02, (Math.max(...lngs) - Math.min(...lngs)) * 1.3),
  } : { latitude: 48.8566, longitude: 2.3522, latitudeDelta: 0.1, longitudeDelta: 0.1 };

  // Polyline for active day
  const polylineCoords = activeDay !== null
    ? markers.map((m) => ({ latitude: m.latitude, longitude: m.longitude }))
    : [];

  return (
    <View style={{ flex: 1 }}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        userInterfaceStyle="dark"
      >
        {markers.map((item) => {
          const dayColor = DAY_COLORS[((item._dayNumber - 1) % DAY_COLORS.length)];
          return (
            <Marker
              key={item.id}
              coordinate={{ latitude: item.latitude, longitude: item.longitude }}
              onPress={() => onMarkerPress?.(item)}
            >
              <View style={{
                width: 28, height: 28, borderRadius: 8,
                backgroundColor: TYPE_COLORS[item.type] || colors.activity,
                borderWidth: 3, borderColor: dayColor,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4,
              }}>
                <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
                  {item._dayNumber}
                </Text>
              </View>
            </Marker>
          );
        })}

        {polylineCoords.length > 1 && (
          <Polyline
            coordinates={polylineCoords}
            strokeColor={colors.gold}
            strokeWidth={2}
            lineDashPattern={[6, 4]}
          />
        )}
      </MapView>

      {/* Day selector overlay */}
      <View style={{
        position: 'absolute', bottom: 16, left: 0, right: 0,
      }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          <Pressable
            onPress={() => setActiveDay(null)}
            style={{
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
              backgroundColor: activeDay === null ? colors.gold : 'rgba(15,23,42,0.9)',
              borderWidth: 1, borderColor: activeDay === null ? colors.gold : 'rgba(255,255,255,0.1)',
            }}
          >
            <Text style={{ color: activeDay === null ? colors.bg : colors.text, fontSize: 12, fontWeight: '700' }}>
              Tous
            </Text>
          </Pressable>
          {days.map((day) => {
            const isActive = activeDay === day.dayNumber;
            const dayColor = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
            return (
              <Pressable
                key={day.dayNumber}
                onPress={() => setActiveDay(isActive ? null : day.dayNumber)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
                  backgroundColor: isActive ? dayColor : 'rgba(15,23,42,0.9)',
                  borderWidth: 1, borderColor: isActive ? dayColor : 'rgba(255,255,255,0.1)',
                }}
              >
                <Text style={{ color: isActive ? '#fff' : colors.textSecondary, fontSize: 12, fontWeight: '700' }}>
                  J{day.dayNumber}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
