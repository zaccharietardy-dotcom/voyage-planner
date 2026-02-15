'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Pause, SkipForward, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Trip } from '@/lib/types';

const GOOGLE_PHOTOREALISTIC_ION_ASSET_ID = 2275207;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

async function applyBest3DQuality(Cesium: any, viewer: any, hasIonToken: boolean) {
  if (!hasIonToken) return;

  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);
  viewer.scene.highDynamicRange = true;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.shadows = true;

  if (viewer.shadowMap) {
    viewer.shadowMap.enabled = true;
    viewer.shadowMap.softShadows = true;
    viewer.shadowMap.size = 2048;
  }

  try {
    let photorealisticTileset: any = null;
    if (typeof Cesium.createGooglePhotorealistic3DTileset === 'function') {
      photorealisticTileset = await withTimeout(
        Cesium.createGooglePhotorealistic3DTileset(),
        6000
      );
    } else if (Cesium.Cesium3DTileset?.fromIonAssetId) {
      photorealisticTileset = await withTimeout(
        Cesium.Cesium3DTileset.fromIonAssetId(GOOGLE_PHOTOREALISTIC_ION_ASSET_ID),
        6000
      );
    }

    if (photorealisticTileset) {
      photorealisticTileset.maximumScreenSpaceError = 1.2;
      photorealisticTileset.dynamicScreenSpaceError = true;
      photorealisticTileset.preloadFlightDestinations = true;
      viewer.scene.primitives.add(photorealisticTileset);
      return;
    }
  } catch (error) {
    console.info('[TripFlythrough] Photorealistic tiles unavailable, fallback to OSM 3D buildings', error);
  }

  try {
    if (typeof Cesium.createOsmBuildingsAsync === 'function') {
      const osmBuildings = await withTimeout(Cesium.createOsmBuildingsAsync(), 4000);
      viewer.scene.primitives.add(osmBuildings);
    }
  } catch (error) {
    console.info('[TripFlythrough] OSM buildings unavailable', error);
  }
}

function applySafeBaseImagery(Cesium: any, viewer: any) {
  try {
    const imageryLayers = viewer.imageryLayers;
    imageryLayers.removeAll();
    const osmProvider = new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
      credit: 'OpenStreetMap',
    });
    imageryLayers.addImageryProvider(osmProvider);
  } catch (error) {
    console.info('[TripFlythrough] OSM imagery fallback unavailable', error);
  }
}

interface TripFlythroughProps {
  trip: Trip;
  isOpen: boolean;
  onClose: () => void;
}

interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  dayNumber: number;
  type: string;
}

export function TripFlythrough({ trip, isOpen, onClose }: TripFlythroughProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speed, setSpeed] = useState(1); // 1x, 2x, 4x
  const animationRef = useRef<NodeJS.Timeout | null>(null);
  const waypointsRef = useRef<Waypoint[]>([]);
  const markersRef = useRef<Map<string, any>>(new Map());
  const polylineRef = useRef<any>(null);

  useEffect(() => {
    setHasMounted(true);
    return () => setHasMounted(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // Extract waypoints from trip (activities only, exclude flights/transport)
  const extractWaypoints = useCallback((): Waypoint[] => {
    const waypoints: Waypoint[] = [];

    for (const day of trip.days) {
      for (const item of day.items) {
        // Only include activities with valid GPS coordinates
        if (
          item.type === 'activity' &&
          item.latitude &&
          item.longitude &&
          Math.abs(item.latitude) > 0.01 &&
          Math.abs(item.longitude) > 0.01
        ) {
          waypoints.push({
            id: item.id,
            name: item.title,
            lat: item.latitude,
            lng: item.longitude,
            dayNumber: item.dayNumber,
            type: item.type,
          });
        }
      }
    }

    return waypoints;
  }, [trip]);

  // Initialize Cesium viewer
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    let resizeObserver: ResizeObserver | null = null;
    let rafId: number | null = null;

    const resizeViewer = () => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed?.()) return;
      viewer.resize();
      viewer.scene.requestRender();
    };

    async function initCesium() {
      try {
        (window as any).CESIUM_BASE_URL = '/cesium';

        const CesiumModule = await import('cesium');
        cesiumRef.current = CesiumModule;

        if (!mounted || !containerRef.current) return;

        const Cesium = CesiumModule;
        const ionToken = (process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || '').trim();
        const hasIonToken = ionToken.length > 0;
        Cesium.Ion.defaultAccessToken = ionToken;

        const commonViewerOptions: any = {
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
        };

        let viewer: any;
        try {
          viewer = new Cesium.Viewer(containerRef.current, {
            ...commonViewerOptions,
            terrain: hasIonToken ? Cesium.Terrain.fromWorldTerrain() : undefined,
            skyAtmosphere: new Cesium.SkyAtmosphere(),
          });
        } catch (error) {
          console.info('[TripFlythrough] Advanced viewer init failed, retrying minimal viewer', error);
          viewer = new Cesium.Viewer(containerRef.current, commonViewerOptions);
        }

        applySafeBaseImagery(Cesium, viewer);

        // Dark theme
        const imageryLayers = viewer.imageryLayers;
        const baseLayer = imageryLayers.get(0);
        if (baseLayer) {
          baseLayer.brightness = 0.6;
          baseLayer.contrast = 1.1;
          baseLayer.saturation = 0.5;
        }

        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0a0a12');
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0a12');
        void applyBest3DQuality(Cesium, viewer, hasIonToken);

        // Extract waypoints
        const waypoints = extractWaypoints();
        waypointsRef.current = waypoints;

        if (waypoints.length === 0) {
          setError('Aucune activité avec coordonnées GPS trouvée');
          return;
        }

        // Add route polyline
        if (waypoints.length > 1) {
          const positions = waypoints.map(w =>
            Cesium.Cartesian3.fromDegrees(w.lng, w.lat, 50)
          );

          polylineRef.current = viewer.entities.add({
            polyline: {
              positions: positions,
              width: 3,
              material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.2,
                color: Cesium.Color.fromCssColorString('#fbbf24').withAlpha(0.8),
              }),
            },
          });
        }

        // Add waypoint markers
        waypoints.forEach((waypoint, index) => {
          const isFirst = index === 0;
          const marker = viewer.entities.add({
            id: `waypoint-${waypoint.id}`,
            position: Cesium.Cartesian3.fromDegrees(waypoint.lng, waypoint.lat, 100),
            point: {
              pixelSize: isFirst ? 14 : 10,
              color: Cesium.Color.fromCssColorString('#60a5fa'),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            },
            label: {
              text: `${index + 1}`,
              font: '700 11px sans-serif',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            },
          });
          markersRef.current.set(waypoint.id, marker);
        });

        // Fly to first waypoint
        const firstWaypoint = waypoints[0];
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            firstWaypoint.lng,
            firstWaypoint.lat,
            1100
          ),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-38),
            roll: 0,
          },
          duration: 2,
        });

        viewerRef.current = viewer;
        setIsLoaded(true);

        window.addEventListener('resize', resizeViewer);
        if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
          resizeObserver = new ResizeObserver(() => {
            resizeViewer();
          });
          resizeObserver.observe(containerRef.current);
        }

        rafId = window.requestAnimationFrame(() => {
          resizeViewer();
          window.requestAnimationFrame(() => resizeViewer());
        });

      } catch (err) {
        console.error('Failed to initialize Cesium:', err);
        setError('Échec du chargement de la visualisation 3D');
      }
    }

    initCesium();

    return () => {
      mounted = false;
      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener('resize', resizeViewer);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [isOpen, extractWaypoints]);

  // Highlight current waypoint
  const highlightWaypoint = useCallback((index: number) => {
    const Cesium = cesiumRef.current;
    if (!Cesium || !viewerRef.current) return;

    const waypoints = waypointsRef.current;

    markersRef.current.forEach((marker, waypointId) => {
      const waypointIndex = waypoints.findIndex(w => w.id === waypointId);
      const isCurrent = waypointIndex === index;

      marker.point.pixelSize = isCurrent ? 14 : 10;
      marker.point.color = isCurrent
        ? Cesium.Color.fromCssColorString('#f59e0b')
        : Cesium.Color.fromCssColorString('#60a5fa');
    });
  }, []);

  // Fly to waypoint
  const flyToWaypoint = useCallback((index: number) => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    const waypoints = waypointsRef.current;

    if (!Cesium || !viewer || index >= waypoints.length) {
      setIsPlaying(false);
      return;
    }

    const waypoint = waypoints[index];
    setCurrentIndex(index);
    highlightWaypoint(index);

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        waypoint.lng,
        waypoint.lat,
        950
      ),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-35),
        roll: 0,
      },
      duration: 2 / speed,
    });

    // Schedule next waypoint
    if (isPlaying) {
      const pauseDuration = 2500 / speed;
      animationRef.current = setTimeout(() => {
        const nextIndex = index + 1;
        if (nextIndex < waypoints.length) {
          flyToWaypoint(nextIndex);
        } else {
          setIsPlaying(false);
          setCurrentIndex(0);
        }
      }, pauseDuration);
    }
  }, [speed, isPlaying, highlightWaypoint]);

  // Play/Pause
  const togglePlay = useCallback(() => {
    if (!isLoaded) return;

    if (isPlaying) {
      setIsPlaying(false);
      if (animationRef.current) {
        clearTimeout(animationRef.current);
        animationRef.current = null;
      }
    } else {
      setIsPlaying(true);
      flyToWaypoint(currentIndex);
    }
  }, [isPlaying, isLoaded, currentIndex, flyToWaypoint]);

  // Skip to next
  const skipNext = useCallback(() => {
    if (!isLoaded) return;

    if (animationRef.current) {
      clearTimeout(animationRef.current);
      animationRef.current = null;
    }

    const waypoints = waypointsRef.current;
    const nextIndex = (currentIndex + 1) % waypoints.length;

    if (isPlaying) {
      flyToWaypoint(nextIndex);
    } else {
      setCurrentIndex(nextIndex);
      highlightWaypoint(nextIndex);
      flyToWaypoint(nextIndex);
    }
  }, [isLoaded, currentIndex, isPlaying, flyToWaypoint, highlightWaypoint]);

  // Change speed
  const cycleSpeed = useCallback(() => {
    const speeds = [1, 2, 4];
    const currentIdx = speeds.indexOf(speed);
    const nextSpeed = speeds[(currentIdx + 1) % speeds.length];
    setSpeed(nextSpeed);
  }, [speed]);

  const currentWaypoint = waypointsRef.current[currentIndex];
  const progress = waypointsRef.current.length > 0
    ? ((currentIndex + 1) / waypointsRef.current.length) * 100
    : 0;

  if (!isOpen || !hasMounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black">
      {/* Cesium container */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ background: '#0a0a0f' }}
      />

      {/* Loading overlay */}
      {!isLoaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white">Chargement de la visualisation 3D...</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center text-red-400">
            <p>{error}</p>
            <Button variant="outline" onClick={onClose} className="mt-4">
              Fermer
            </Button>
          </div>
        </div>
      )}

      {/* Controls overlay */}
      {isLoaded && !error && (
        <>
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-20 h-10 w-10 rounded-lg border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur hover:bg-black/80"
            aria-label="Fermer"
          >
            <X className="mx-auto h-5 w-5" />
          </button>

          {/* Info panel */}
          {currentWaypoint && (
            <div className="absolute top-4 left-4 z-20 max-w-md rounded-lg border border-white/20 bg-black/60 p-4 text-white shadow-lg backdrop-blur">
              <div className="text-sm text-gray-400">Jour {currentWaypoint.dayNumber}</div>
              <div className="text-lg font-semibold">{currentWaypoint.name}</div>
              <div className="mt-1 text-xs text-gray-400">
                {currentIndex + 1} / {waypointsRef.current.length}
              </div>
            </div>
          )}

          {/* Controls panel */}
          <div className="absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/20 bg-black/60 px-6 py-3 shadow-lg backdrop-blur">
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePlay}
              className="h-10 w-10 text-white hover:bg-white/20"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={skipNext}
              className="h-10 w-10 text-white hover:bg-white/20"
              aria-label="Suivant"
            >
              <SkipForward className="h-5 w-5" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={cycleSpeed}
              className="h-10 gap-1.5 text-white hover:bg-white/20"
            >
              <Gauge className="h-4 w-4" />
              <span className="text-sm font-medium">{speed}x</span>
            </Button>

            {/* Progress bar */}
            <div className="ml-4 w-48">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Cesium styles */}
      <style jsx global>{`
        .cesium-viewer-bottom {
          display: none !important;
        }
        .cesium-credit-logoContainer,
        .cesium-credit-textContainer,
        .cesium-widget-credits {
          display: none !important;
        }
      `}</style>
    </div>,
    document.body
  );
}
