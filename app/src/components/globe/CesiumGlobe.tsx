'use client';

import { useEffect, useRef, useState } from 'react';
import { Compass, Minus, Plus } from 'lucide-react';
import { GlobeWaypoint, Traveler, TripArc } from '@/lib/globe/types';

const colors = { arcColor: '#d4a853' };
const INITIAL_CAMERA = { lng: 2.3522, lat: 48.8566, height: 20000000 };

// Create a simple dot marker (fallback when no image)
function createMarkerCanvas(Cesium: any, isSelected: boolean, isOnline: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = 48;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const centerX = size / 2;
  const centerY = size / 2;
  const radius = isSelected ? 10 : 8;

  // Outer glow
  if (isOnline) {
    const gradient = ctx.createRadialGradient(centerX, centerY, radius, centerX, centerY, radius + 8);
    gradient.addColorStop(0, 'rgba(251, 191, 36, 0.4)');
    gradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  // White outline
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Inner circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fillStyle = isSelected ? '#6366f1' : '#fbbf24';
  ctx.fill();

  // Inner highlight
  ctx.beginPath();
  ctx.arc(centerX - 2, centerY - 2, radius / 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.fill();

  return canvas;
}

// Create an image marker (circular photo with white border)
function createImageMarkerCanvas(img: HTMLImageElement, isSelected: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const centerX = size / 2;
  const centerY = size / 2;
  const radius = isSelected ? 26 : 22;
  const borderWidth = 3;

  // Shadow/glow
  ctx.shadowColor = isSelected ? 'rgba(99, 102, 241, 0.6)' : 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + borderWidth, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowBlur = 0;

  // White border
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + borderWidth, 0, Math.PI * 2);
  ctx.fillStyle = isSelected ? '#6366f1' : '#ffffff';
  ctx.fill();

  // Clip circle for image
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.clip();

  // Draw image (cover fill)
  const imgRatio = img.width / img.height;
  let drawW = size, drawH = size, drawX = 0, drawY = 0;
  if (imgRatio > 1) {
    drawH = size;
    drawW = size * imgRatio;
    drawX = -(drawW - size) / 2;
  } else {
    drawW = size;
    drawH = size / imgRatio;
    drawY = -(drawH - size) / 2;
  }
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();

  return canvas;
}

// Cache for loaded images
const imageCache = new Map<string, HTMLImageElement>();

function loadImage(url: string): Promise<HTMLImageElement> {
  if (imageCache.has(url)) return Promise.resolve(imageCache.get(url)!);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(url, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Major world cities for labels
const MAJOR_CITIES = [
  { name: 'Paris', lat: 48.8566, lng: 2.3522, population: 11000000 },
  { name: 'London', lat: 51.5074, lng: -0.1278, population: 9000000 },
  { name: 'New York', lat: 40.7128, lng: -74.0060, population: 8300000 },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503, population: 37400000 },
  { name: 'Berlin', lat: 52.5200, lng: 13.4050, population: 3600000 },
  { name: 'Rome', lat: 41.9028, lng: 12.4964, population: 2800000 },
  { name: 'Madrid', lat: 40.4168, lng: -3.7038, population: 3200000 },
  { name: 'Barcelona', lat: 41.3851, lng: 2.1734, population: 1600000 },
  { name: 'Amsterdam', lat: 52.3676, lng: 4.9041, population: 870000 },
  { name: 'Dubai', lat: 25.2048, lng: 55.2708, population: 3400000 },
  { name: 'Singapore', lat: 1.3521, lng: 103.8198, population: 5700000 },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093, population: 5300000 },
  { name: 'Los Angeles', lat: 34.0522, lng: -118.2437, population: 4000000 },
  { name: 'San Francisco', lat: 37.7749, lng: -122.4194, population: 880000 },
  { name: 'Bangkok', lat: 13.7563, lng: 100.5018, population: 10500000 },
  { name: 'Hong Kong', lat: 22.3193, lng: 114.1694, population: 7500000 },
  { name: 'Istanbul', lat: 41.0082, lng: 28.9784, population: 15500000 },
  { name: 'Moscow', lat: 55.7558, lng: 37.6173, population: 12500000 },
  { name: 'São Paulo', lat: -23.5505, lng: -46.6333, population: 12300000 },
  { name: 'Buenos Aires', lat: -34.6037, lng: -58.3816, population: 3100000 },
  { name: 'Cairo', lat: 30.0444, lng: 31.2357, population: 20900000 },
  { name: 'Mumbai', lat: 19.0760, lng: 72.8777, population: 20700000 },
  { name: 'Beijing', lat: 39.9042, lng: 116.4074, population: 21500000 },
  { name: 'Seoul', lat: 37.5665, lng: 126.9780, population: 9700000 },
  { name: 'Mexico City', lat: 19.4326, lng: -99.1332, population: 21800000 },
  { name: 'Lagos', lat: 6.5244, lng: 3.3792, population: 14800000 },
  { name: 'Johannesburg', lat: -26.2041, lng: 28.0473, population: 5800000 },
  { name: 'Cape Town', lat: -33.9249, lng: 18.4241, population: 4600000 },
  { name: 'Marrakech', lat: 31.6295, lng: -7.9811, population: 930000 },
  { name: 'Lisbon', lat: 38.7223, lng: -9.1393, population: 500000 },
  { name: 'Vienna', lat: 48.2082, lng: 16.3738, population: 1900000 },
  { name: 'Prague', lat: 50.0755, lng: 14.4378, population: 1300000 },
  { name: 'Budapest', lat: 47.4979, lng: 19.0402, population: 1750000 },
  { name: 'Athens', lat: 37.9838, lng: 23.7275, population: 3150000 },
  { name: 'Dublin', lat: 53.3498, lng: -6.2603, population: 1400000 },
  { name: 'Copenhagen', lat: 55.6761, lng: 12.5683, population: 800000 },
  { name: 'Stockholm', lat: 59.3293, lng: 18.0686, population: 975000 },
  { name: 'Oslo', lat: 59.9139, lng: 10.7522, population: 700000 },
  { name: 'Helsinki', lat: 60.1699, lng: 24.9384, population: 650000 },
  { name: 'Reykjavik', lat: 64.1466, lng: -21.9426, population: 130000 },
];

export interface CesiumGlobeProps {
  travelers: Traveler[];
  arcs: TripArc[];
  onTravelerSelect?: (traveler: Traveler | null) => void;
  onWaypointSelect?: (waypoint: GlobeWaypoint | null) => void;
  selectedTraveler?: Traveler | null;
  selectedTripPoints?: GlobeWaypoint[];
  selectedWaypointId?: string | null;
  className?: string;
}

export function CesiumGlobe({
  travelers,
  arcs,
  onTravelerSelect,
  onWaypointSelect,
  selectedTraveler = null,
  selectedTripPoints = [],
  selectedWaypointId = null,
  className = '',
}: CesiumGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const waypointRef = useRef<Map<string, any>>(new Map());

  // Initialize Cesium
  useEffect(() => {
    let mounted = true;

    async function initCesium() {
      try {
        // Set Cesium base URL for assets (must be before import)
        (window as any).CESIUM_BASE_URL = '/cesium';

        // Dynamic import of Cesium
        const CesiumModule = await import('cesium');
        cesiumRef.current = CesiumModule;

        if (!mounted || !containerRef.current) return;

        const Cesium = CesiumModule;

        // Set access token
        Cesium.Ion.defaultAccessToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || '';

        // Create viewer with dark theme settings
        const viewer = new Cesium.Viewer(containerRef.current, {
          terrain: Cesium.Terrain.fromWorldTerrain(),
          animation: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          vrButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          navigationHelpButton: false,
          navigationInstructionsInitiallyVisible: false,
          skyBox: false,
          skyAtmosphere: new Cesium.SkyAtmosphere(),
          contextOptions: {
            webgl: {
              alpha: true,
            },
          },
        });

        // Dark theme - visible but muted
        const imageryLayers = viewer.imageryLayers;
        const baseLayer = imageryLayers.get(0);
        if (baseLayer) {
          baseLayer.brightness = 0.55; // Slightly brighter
          baseLayer.contrast = 1.15;
          baseLayer.saturation = 0.45; // Muted colors
          baseLayer.gamma = 0.95;
        }

        // Labels overlay - only show when very close (street level)
        const osmLabels = await Cesium.IonImageryProvider.fromAssetId(3);
        const labelsLayer = imageryLayers.addImageryProvider(osmLabels);
        labelsLayer.alpha = 0.5;
        labelsLayer.brightness = 0.6;
        // Make labels only visible at low altitude (under 50km)
        labelsLayer.minificationFilter = Cesium.TextureMinificationFilter.LINEAR;
        labelsLayer.magnificationFilter = Cesium.TextureMagnificationFilter.LINEAR;

        // Dark background
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#050508');
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0a12');
        viewer.scene.globe.showGroundAtmosphere = true;

        // Subtle atmosphere
        if (viewer.scene.skyAtmosphere) {
          viewer.scene.skyAtmosphere.brightnessShift = 0.2;
          viewer.scene.skyAtmosphere.saturationShift = -0.2;
        }

        // Dynamic labels visibility based on zoom
        viewer.camera.changed.addEventListener(() => {
          const height = viewer.camera.positionCartographic.height;
          // Only show road labels when under 50km altitude
          if (labelsLayer) {
            labelsLayer.alpha = height < 50000 ? 0.7 : height < 200000 ? 0.3 : 0;
          }
        });

        // Set initial camera position (wide Earth framing)
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            INITIAL_CAMERA.lng,
            INITIAL_CAMERA.lat,
            INITIAL_CAMERA.height
          ),
        });

        // Spin animation when zoomed out
        let lastTime = Date.now();
        const spinRate = 0.05;

        viewer.clock.onTick.addEventListener(() => {
          const now = Date.now();
          const delta = (now - lastTime) / 1000;
          lastTime = now;

          const cameraHeight = viewer.camera.positionCartographic.height;
          if (cameraHeight > 5000000) {
            viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -spinRate * delta * (Math.PI / 180));
          }
        });

        // Add city labels - only mega cities visible from far, others need zoom
        MAJOR_CITIES.forEach((city) => {
          // Only show top 15 mega cities from far away
          const isMegaCity = city.population > 10000000;
          const isLargeCity = city.population > 5000000;

          const fontSize = isMegaCity ? 14 : isLargeCity ? 12 : 11;

          viewer.entities.add({
            id: `city-${city.name}`,
            position: Cesium.Cartesian3.fromDegrees(city.lng, city.lat, 0),
            label: {
              text: city.name,
              font: `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`,
              fillColor: Cesium.Color.WHITE.withAlpha(0.85),
              outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              // Much stricter zoom requirements - need to zoom more to see labels
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
                0,
                isMegaCity ? 4000000 : isLargeCity ? 2500000 : 1500000
              ),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        });

        viewerRef.current = viewer;
        setIsLoaded(true);

      } catch (err) {
        console.error('Failed to initialize Cesium:', err);
        setError('Échec du chargement du globe 3D');
      }
    }

    initCesium();

    return () => {
      mounted = false;
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // Add traveler markers
  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!isLoaded || !viewerRef.current || !Cesium) return;

    const viewer = viewerRef.current;

    // Clear existing markers
    markersRef.current.forEach((entity) => {
      viewer.entities.remove(entity);
    });
    markersRef.current.clear();

    // Add markers for each traveler (with image if available)
    const addMarker = (traveler: Traveler, markerImage: HTMLCanvasElement) => {
      const isSelected = selectedTraveler?.id === traveler.id;
      const hasImage = !!traveler.imageUrl;

      const entity = viewer.entities.add({
        id: `traveler-${traveler.id}`,
        position: Cesium.Cartesian3.fromDegrees(
          traveler.location.lng,
          traveler.location.lat,
          100
        ),
        billboard: {
          image: markerImage,
          scale: hasImage ? (isSelected ? 0.9 : 0.75) : (isSelected ? 0.6 : 0.5),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: traveler.name,
          font: '600 11px -apple-system, BlinkMacSystemFont, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, hasImage ? 8 : 4),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000000),
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          traveler: traveler,
        },
      });

      markersRef.current.set(traveler.id, entity);
    };

    travelers.forEach((traveler) => {
      const isSelected = selectedTraveler?.id === traveler.id;

      if (traveler.imageUrl) {
        // Try to load image, fallback to dot marker
        loadImage(traveler.imageUrl).then((img) => {
          addMarker(traveler, createImageMarkerCanvas(img, isSelected));
        }).catch(() => {
          addMarker(traveler, createMarkerCanvas(Cesium, isSelected, traveler.isOnline ?? false));
        });
      } else {
        addMarker(traveler, createMarkerCanvas(Cesium, isSelected, traveler.isOnline ?? false));
      }
    });

    // Click handler for markers
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: any) => {
      const pickedObject = viewer.scene.pick(click.position);
      if (Cesium.defined(pickedObject) && pickedObject.id?.properties?.waypoint) {
        const waypoint = pickedObject.id.properties.waypoint.getValue();
        onWaypointSelect?.(waypoint);
        return;
      }

      if (Cesium.defined(pickedObject) && pickedObject.id?.properties?.traveler) {
        const traveler = pickedObject.id.properties.traveler.getValue();
        onTravelerSelect?.(traveler);
        onWaypointSelect?.(null);
      } else {
        onTravelerSelect?.(null);
        onWaypointSelect?.(null);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      handler.destroy();
    };
  }, [isLoaded, travelers, selectedTraveler, onTravelerSelect, onWaypointSelect]);

  // Add selected trip waypoints (clickable points of interest)
  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!isLoaded || !viewerRef.current || !Cesium) return;

    const viewer = viewerRef.current;

    waypointRef.current.forEach((entity) => {
      viewer.entities.remove(entity);
    });
    waypointRef.current.clear();

    if (!selectedTripPoints.length) return;

    const visiblePoints = selectedTripPoints
      .filter((point) => (
        Number.isFinite(point.lat)
        && Number.isFinite(point.lng)
        && Math.abs(point.lat) <= 90
        && Math.abs(point.lng) <= 180
      ))
      .slice(0, 40);

    visiblePoints.forEach((point, index) => {
      const isSelected = selectedWaypointId === point.id;
      const entity = viewer.entities.add({
        id: `waypoint-${point.id}`,
        position: Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 120),
        point: {
          pixelSize: isSelected ? 14 : 10,
          color: isSelected
            ? Cesium.Color.fromCssColorString('#f59e0b')
            : Cesium.Color.fromCssColorString('#38bdf8'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        label: {
          text: `${index + 1}`,
          font: '700 10px -apple-system, BlinkMacSystemFont, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.9),
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2200000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          waypoint: point,
        },
      });

      waypointRef.current.set(point.id, entity);
    });
  }, [isLoaded, selectedTripPoints, selectedWaypointId]);

  // Add trip arcs
  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!isLoaded || !viewerRef.current || !Cesium) return;

    const viewer = viewerRef.current;

    // Remove existing arcs
    const existingArcs = viewer.entities.values.filter((e: any) => e.id?.startsWith('arc-'));
    existingArcs.forEach((e: any) => viewer.entities.remove(e));

    // Add arcs
    arcs.forEach((arc) => {
      const focusedTravelerId = selectedTraveler?.id || null;
      const isFocused = focusedTravelerId ? arc.travelerId === focusedTravelerId : true;
      const isDimmed = focusedTravelerId ? arc.travelerId !== focusedTravelerId : false;
      const hasLongDistance = (arc.distanceKm || 0) > 1200 || arc.isLongHaul;

      const positions = Cesium.Cartesian3.fromDegreesArrayHeights([
        arc.from.lng, arc.from.lat, 100000,
        (arc.from.lng + arc.to.lng) / 2, (arc.from.lat + arc.to.lat) / 2, 500000,
        arc.to.lng, arc.to.lat, 100000,
      ]);

      viewer.entities.add({
        id: `arc-${arc.id}`,
        polyline: {
          positions: positions,
          width: isFocused ? 3.2 : 1.4,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: isFocused ? 0.28 : 0.1,
            color: Cesium.Color.fromCssColorString(
              hasLongDistance
                ? '#fb923c'
                : (arc.color || colors.arcColor)
            ).withAlpha(isDimmed ? 0.2 : 0.92),
          }),
          arcType: Cesium.ArcType.NONE,
        },
      });
    });
  }, [isLoaded, arcs, selectedTraveler]);

  // Fly to selected traveler
  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!isLoaded || !viewerRef.current || !selectedTraveler || !Cesium) return;

    const viewer = viewerRef.current;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        selectedTraveler.location.lng,
        selectedTraveler.location.lat,
        1000000
      ),
      duration: 2,
    });
  }, [isLoaded, selectedTraveler]);

  // Fly to selected waypoint (photo/monument hotspot)
  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!isLoaded || !viewerRef.current || !selectedWaypointId || !Cesium) return;

    const point = selectedTripPoints.find((item) => item.id === selectedWaypointId);
    if (!point) return;

    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 350000),
      duration: 1.4,
    });
  }, [isLoaded, selectedWaypointId, selectedTripPoints]);

  const handleZoomIn = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const cameraHeight = viewer.camera.positionCartographic.height;
    viewer.camera.zoomIn(cameraHeight * 0.28);
  };

  const handleZoomOut = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const cameraHeight = viewer.camera.positionCartographic.height;
    viewer.camera.zoomOut(cameraHeight * 0.32);
  };

  const handleResetView = () => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        INITIAL_CAMERA.lng,
        INITIAL_CAMERA.lat,
        INITIAL_CAMERA.height
      ),
      duration: 1.6,
    });
  };

  return (
    <div className={`relative w-full h-full ${className}`}>
      {/* Loading state */}
      {!isLoaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0f] z-10">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Chargement du globe...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0f] z-10">
          <div className="text-center text-red-400">
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Cesium container */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ background: '#0a0a0f' }}
      />

      {/* Navigation controls */}
      {isLoaded && !error && (
        <div className="absolute right-4 top-4 z-20 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleZoomIn}
            className="h-10 w-10 rounded-lg border border-white/20 bg-black/45 text-white shadow-md backdrop-blur hover:bg-black/70"
            aria-label="Zoom avant"
          >
            <Plus className="mx-auto h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="h-10 w-10 rounded-lg border border-white/20 bg-black/45 text-white shadow-md backdrop-blur hover:bg-black/70"
            aria-label="Zoom arrière"
          >
            <Minus className="mx-auto h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            className="h-10 w-10 rounded-lg border border-white/20 bg-black/45 text-white shadow-md backdrop-blur hover:bg-black/70"
            aria-label="Recentrer le globe"
          >
            <Compass className="mx-auto h-4 w-4" />
          </button>
        </div>
      )}

      {/* Custom styles to hide Cesium branding and match dark theme */}
      <style jsx global>{`
        .cesium-viewer {
          font-family: inherit;
        }
        .cesium-viewer-bottom {
          display: none !important;
        }
        .cesium-credit-logoContainer {
          display: none !important;
        }
        .cesium-credit-textContainer {
          display: none !important;
        }
        .cesium-widget-credits {
          display: none !important;
        }
        .cesium-viewer .cesium-widget-credits {
          display: none !important;
        }
      `}</style>
    </div>
  );
}

export default CesiumGlobe;
