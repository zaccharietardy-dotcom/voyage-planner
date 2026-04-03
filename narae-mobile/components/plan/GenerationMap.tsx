import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import { Compass, MapPin, Route } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import type { PipelineMapSnapshot } from '@/lib/types/pipeline';

interface Props {
  snapshot?: PipelineMapSnapshot | null;
  destination: string;
  origin?: string;
}

const MARKER_COLORS = {
  origin: '#60a5fa',
  destination: colors.gold,
  activity: '#7dd3fc',
  hotel: '#c084fc',
  restaurant: '#fb923c',
  day_trip: '#4ade80',
} as const;

const STAGE_COPY = {
  fetched: {
    label: 'Collecte des lieux',
    hint: 'Premiers points d’intérêt et hôtels en approche',
  },
  clustered: {
    label: 'Assemblage du parcours',
    hint: 'Les journées prennent forme sur la carte',
  },
} as const;

function getInitialRegion(snapshot?: PipelineMapSnapshot | null) {
  const points = snapshot?.markers ?? [];

  if (points.length === 0) {
    return {
      latitude: 46.2276,
      longitude: 2.2137,
      latitudeDelta: 18,
      longitudeDelta: 18,
    };
  }

  const latitudes = points.map((marker) => marker.latitude);
  const longitudes = points.map((marker) => marker.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return {
    latitude: snapshot?.center.latitude ?? (minLat + maxLat) / 2,
    longitude: snapshot?.center.longitude ?? (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.25, (maxLat - minLat) * 1.7),
    longitudeDelta: Math.max(0.25, (maxLng - minLng) * 1.7),
  };
}

function getMarkerLabel(title: string, dayNumber?: number) {
  if (dayNumber) return `J${dayNumber}`;
  return title.trim().slice(0, 1).toUpperCase() || '•';
}

export function GenerationMap({ snapshot, destination, origin }: Props) {
  const region = useMemo(() => getInitialRegion(snapshot), [snapshot]);
  const stageMeta = snapshot ? STAGE_COPY[snapshot.stage] : null;

  if (!snapshot) {
    return (
      <View style={styles.card}>
        <LinearGradient
          colors={['rgba(10,17,40,0.98)', 'rgba(7,14,31,0.96)', 'rgba(2,6,23,0.98)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.placeholderGlowTop} />
        <View style={styles.placeholderGlowBottom} />

        <View style={styles.placeholderHeader}>
          <View style={styles.stageBadge}>
            <Compass size={13} color={colors.gold} />
            <Text style={styles.stageBadgeText}>Préparation de la carte</Text>
          </View>
          <Text style={styles.placeholderTitle}>{destination}</Text>
          <Text style={styles.placeholderSubtitle}>
            Les premiers repères vont apparaître ici au fil de la génération.
          </Text>
        </View>

        <View style={styles.routePreview}>
          <View style={styles.routeNode}>
            <MapPin size={15} color="#60a5fa" />
            <Text style={styles.routeLabel}>{origin?.trim() || 'Départ'}</Text>
          </View>
          <View style={styles.routeLineWrap}>
            <View style={styles.routeLine} />
            <Route size={16} color="rgba(197,160,89,0.65)" />
          </View>
          <View style={styles.routeNode}>
            <MapPin size={15} color={colors.gold} />
            <Text style={styles.routeLabel}>{destination}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        region={region}
        userInterfaceStyle="dark"
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        {snapshot.polylines?.map((polyline) => (
          <Polyline
            key={polyline.id}
            coordinates={polyline.coordinates}
            strokeColor="rgba(197,160,89,0.85)"
            strokeWidth={3}
            lineDashPattern={[8, 6]}
          />
        ))}

        {snapshot.markers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={{
              latitude: marker.latitude,
              longitude: marker.longitude,
            }}
            tracksViewChanges={false}
          >
            <View
              style={[
                styles.marker,
                {
                  backgroundColor: MARKER_COLORS[marker.kind],
                  borderColor: marker.kind === 'destination' ? 'rgba(255,255,255,0.45)' : 'rgba(2,6,23,0.7)',
                },
              ]}
            >
              <Text style={styles.markerText}>{getMarkerLabel(marker.title, marker.dayNumber)}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      <LinearGradient
        colors={['rgba(2,6,23,0.05)', 'rgba(2,6,23,0.16)', 'rgba(2,6,23,0.82)']}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.overlayTop}>
        <View style={styles.stageBadge}>
          <Compass size={13} color={colors.gold} />
          <Text style={styles.stageBadgeText}>{stageMeta?.label}</Text>
        </View>
        <Text style={styles.overlayTitle}>{destination}</Text>
        <Text style={styles.overlaySubtitle}>{stageMeta?.hint}</Text>
      </View>

      <View style={styles.overlayBottom}>
        <View style={styles.bottomChip}>
          <MapPin size={13} color="#60a5fa" />
          <Text style={styles.bottomChipText}>{origin?.trim() || 'Départ'}</Text>
        </View>
        <View style={styles.bottomChip}>
          <MapPin size={13} color={colors.gold} />
          <Text style={styles.bottomChipText}>{destination}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radius['3xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#06101f',
  },
  placeholderGlowTop: {
    position: 'absolute',
    top: -40,
    right: -20,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: 'rgba(197,160,89,0.18)',
  },
  placeholderGlowBottom: {
    position: 'absolute',
    bottom: -80,
    left: -40,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: 'rgba(96,165,250,0.12)',
  },
  placeholderHeader: {
    paddingHorizontal: 20,
    paddingTop: 22,
    gap: 8,
  },
  stageBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(2,6,23,0.74)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  stageBadgeText: {
    color: colors.gold,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  placeholderTitle: {
    color: colors.text,
    fontSize: 28,
    fontFamily: fonts.display,
  },
  placeholderSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sans,
    lineHeight: 20,
    maxWidth: 260,
  },
  routePreview: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 18,
  },
  routeNode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(2,6,23,0.54)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  routeLabel: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
  },
  routeLineWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 14,
  },
  routeLine: {
    width: 96,
    height: 1,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: 'rgba(197,160,89,0.45)',
  },
  overlayTop: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    gap: 8,
  },
  overlayTitle: {
    color: colors.text,
    fontSize: 26,
    fontFamily: fonts.display,
    textShadowColor: 'rgba(2,6,23,0.75)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 14,
  },
  overlaySubtitle: {
    color: 'rgba(241,245,249,0.86)',
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    maxWidth: 260,
    textShadowColor: 'rgba(2,6,23,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
  overlayBottom: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    gap: 10,
  },
  bottomChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(2,6,23,0.74)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  bottomChipText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontFamily: fonts.sansSemiBold,
  },
  marker: {
    minWidth: 32,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  markerText: {
    color: '#020617',
    fontSize: 10,
    fontFamily: fonts.sansBold,
  },
});
