import { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { ChevronUp } from 'lucide-react-native';
import { colors, fonts } from '@/lib/theme';
import type { TripDay, TripItem, TripItemType } from '@/lib/types/trip';

interface Props {
  days: TripDay[];
  onMarkerPress?: (item: TripItem) => void;
  activeDay?: number | null;
  onDayChange?: (day: number | null) => void;
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

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function TripMap({ days, onMarkerPress, activeDay: controlledDay, onDayChange }: Props) {
  const [localDay, setLocalDay] = useState<number | null>(null);
  const activeDay = controlledDay !== undefined ? controlledDay : localDay;
  const setActiveDay = (day: number | null) => {
    if (onDayChange) onDayChange(day);
    else setLocalDay(day);
  };
  const { height: screenH } = useWindowDimensions();

  const visibleDays = activeDay !== null ? days.filter((d) => d.dayNumber === activeDay) : days;

  let activityIndex = 0;
  const markers = visibleDays.flatMap((day) => {
    let dayIdx = 0;
    return day.items
      .filter((item) => item.latitude && item.longitude && item.latitude !== 0)
      .map((item) => {
        dayIdx++;
        activityIndex++;
        return { ...item, _dayNumber: day.dayNumber, _activityIndex: activeDay !== null ? dayIdx : activityIndex };
      });
  });

  const lats = markers.map((m) => m.latitude);
  const lngs = markers.map((m) => m.longitude);
  const initialRegion = markers.length > 0 ? {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: Math.max(0.02, (Math.max(...lats) - Math.min(...lats)) * 1.3),
    longitudeDelta: Math.max(0.02, (Math.max(...lngs) - Math.min(...lngs)) * 1.3),
  } : { latitude: 48.8566, longitude: 2.3522, latitudeDelta: 0.1, longitudeDelta: 0.1 };

  const polylineCoords = activeDay !== null
    ? markers.map((m) => ({ latitude: m.latitude, longitude: m.longitude }))
    : [];

  // Direction arrows — placed at 40% along each segment (closer to origin, avoids overlap with destination marker)
  // Only shown on segments > ~200m to avoid clutter on short walks
  const MIN_ARROW_DISTANCE = 0.002; // ~200m in degrees
  const arrowMarkers = polylineCoords.length > 1
    ? polylineCoords.slice(0, -1).flatMap((coord, idx) => {
          const next = polylineCoords[idx + 1];
          const dLat = Math.abs(next.latitude - coord.latitude);
          const dLng = Math.abs(next.longitude - coord.longitude);
          if (dLat < MIN_ARROW_DISTANCE && dLng < MIN_ARROW_DISTANCE) return []; // skip short segments
          // Place at 40% from origin (not 50%) to avoid overlap with destination marker
          const t = 0.4;
          const lat = coord.latitude + (next.latitude - coord.latitude) * t;
          const lng = coord.longitude + (next.longitude - coord.longitude) * t;
          const angle = bearing(coord.latitude, coord.longitude, next.latitude, next.longitude);
          return [{ key: `arrow-${idx}`, latitude: lat, longitude: lng, angle }];
        })
    : [];

  const mapRef = useRef<MapView>(null);

  // Animate to fit markers with proper padding for bottom sheet
  useEffect(() => {
    if (!mapRef.current || markers.length === 0) return;
    const coords = markers.map((m) => ({ latitude: m.latitude, longitude: m.longitude }));
    // Bottom padding accounts for bottom sheet (~52% of screen)
    const bottomPad = Math.round(screenH * 0.52);
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 40, bottom: bottomPad, left: 40 },
      animated: true,
    });
  }, [activeDay, markers.length, screenH]);

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
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
                width: 30, height: 30, borderRadius: 10, borderCurve: 'continuous',
                backgroundColor: TYPE_COLORS[item.type] || colors.activity,
                borderWidth: 2.5, borderColor: dayColor,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: dayColor, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6,
              }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900', fontFamily: fonts.sansBold }}>
                  {item._activityIndex}
                </Text>
              </View>
            </Marker>
          );
        })}

        {polylineCoords.length > 1 && (
          <Polyline
            coordinates={polylineCoords}
            strokeColor={colors.gold}
            strokeWidth={3}
            lineDashPattern={[10, 6]}
          />
        )}

        {/* Direction arrows */}
        {arrowMarkers.map((arrow) => (
          <Marker
            key={arrow.key}
            coordinate={{ latitude: arrow.latitude, longitude: arrow.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={arrow.angle}
          >
            <View style={{
              width: 22, height: 22, borderRadius: 11,
              backgroundColor: 'rgba(2,6,23,0.85)',
              borderWidth: 1.5, borderColor: colors.gold,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <ChevronUp size={12} color={colors.gold} strokeWidth={3} />
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Day selector overlay */}
      <View style={{ position: 'absolute', bottom: '52%', left: 0, right: 0 }}>
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
