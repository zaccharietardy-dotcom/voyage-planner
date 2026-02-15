'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Pause, SkipForward, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Trip } from '@/lib/types';
import { TripMap } from '@/components/trip/TripMap';

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

async function applyBest3DQuality(
  Cesium: any,
  viewer: any,
  hasIonToken: boolean,
  compatibilityMode: boolean
) {
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, compatibilityMode ? 1.1 : 1.5);
  viewer.scene.highDynamicRange = !compatibilityMode;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.shadows = !compatibilityMode;

  if (viewer.shadowMap) {
    viewer.shadowMap.enabled = !compatibilityMode;
    viewer.shadowMap.softShadows = !compatibilityMode;
    viewer.shadowMap.size = compatibilityMode ? 1024 : 2048;
  }

  if (!hasIonToken) return;

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
      photorealisticTileset.maximumScreenSpaceError = compatibilityMode ? 2.4 : 1.2;
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
    const existingLayers: any[] = [];
    for (let i = 0; i < imageryLayers.length; i += 1) {
      existingLayers.push(imageryLayers.get(i));
    }

    const osmProvider = new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
      credit: 'OpenStreetMap',
    });
    const osmLayer = imageryLayers.addImageryProvider(osmProvider, 0);

    existingLayers.forEach((layer) => {
      if (layer && layer !== osmLayer) {
        imageryLayers.remove(layer, false);
      }
    });
  } catch (error) {
    console.info('[TripFlythrough] OSM imagery fallback unavailable', error);
  }
}

function detectWebGLSupport(): { webgl1: boolean; webgl2: boolean } {
  try {
    const canvas = document.createElement('canvas');

    const gl2 = canvas.getContext('webgl2');
    const hasWebgl2 = !!gl2;
    if (gl2) gl2.getExtension('WEBGL_lose_context')?.loseContext();

    const gl1 = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const hasWebgl1 = !!gl1;
    if (gl1) (gl1 as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();

    return { webgl1: hasWebgl1, webgl2: hasWebgl2 };
  } catch {
    return { webgl1: false, webgl2: false };
  }
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function normalizeBearing(degrees: number): number {
  return (degrees + 360) % 360;
}

function getBearingDegrees(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): number {
  const startLatRad = toRadians(startLat);
  const endLatRad = toRadians(endLat);
  const deltaLngRad = toRadians(endLng - startLng);

  const y = Math.sin(deltaLngRad) * Math.cos(endLatRad);
  const x =
    Math.cos(startLatRad) * Math.sin(endLatRad) -
    Math.sin(startLatRad) * Math.cos(endLatRad) * Math.cos(deltaLngRad);

  return normalizeBearing((Math.atan2(y, x) * 180) / Math.PI);
}

function haversineDistanceKm(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(endLat - startLat);
  const dLng = toRadians(endLng - startLng);
  const lat1 = toRadians(startLat);
  const lat2 = toRadians(endLat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function getCinematicFlightProfile(waypoints: Waypoint[], index: number) {
  const current = waypoints[index];
  const next = waypoints[Math.min(index + 1, waypoints.length - 1)] || current;

  const segmentDistanceKm = haversineDistanceKm(
    current.lat,
    current.lng,
    next.lat,
    next.lng
  );

  const headingDeg =
    waypoints.length > 1
      ? getBearingDegrees(current.lat, current.lng, next.lat, next.lng)
      : 0;

  const altitude = Math.min(3200, Math.max(850, segmentDistanceKm * 950));
  const duration = Math.min(4.2, Math.max(1.8, segmentDistanceKm * 1.1));
  const maxHeight = Math.max(altitude * 1.8, altitude + 700);

  let pitchDeg = -50;
  if (segmentDistanceKm > 2.5) pitchDeg = -36;
  else if (segmentDistanceKm > 1.2) pitchDeg = -42;

  return {
    headingDeg,
    pitchDeg,
    altitude,
    duration,
    maxHeight,
  };
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
  const markersRef = useRef<Map<number, any>>(new Map());
  const polylineRef = useRef<any>(null);
  const fallbackItems = useMemo(() => trip.days.flatMap((day) => day.items || []), [trip]);

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

  // Load Cesium widget CSS (required for proper viewer layout)
  useEffect(() => {
    if (!isOpen) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/cesium/Widgets/widgets.css';
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, [isOpen]);

  // Extract waypoints from trip (activities only, exclude flights/transport)
  const extractWaypoints = useCallback((): Waypoint[] => {
    const waypoints: Waypoint[] = [];

    for (const day of trip.days) {
      for (const item of day.items) {
        const lat = Number(item.latitude);
        const lng = Number(item.longitude);

        // Only include activities with valid GPS coordinates
        if (
          item.type === 'activity' &&
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Math.abs(lat) > 0.01 &&
          Math.abs(lng) > 0.01
        ) {
          waypoints.push({
            id: item.id,
            name: item.title,
            lat,
            lng,
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

    setError(null);
    setIsLoaded(false);
    setIsPlaying(false);
    setCurrentIndex(0);
    markersRef.current.clear();
    polylineRef.current = null;

    let mounted = true;
    let resizeObserver: ResizeObserver | null = null;
    let rafId: number | null = null;
    let removeRenderErrorListener: (() => void) | null = null;

    const resizeViewer = () => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed?.()) return;
      viewer.resize();
      viewer.scene.requestRender();
    };

    async function initCesium() {
      try {
        const webglSupport = detectWebGLSupport();
        if (!webglSupport.webgl1 && !webglSupport.webgl2) {
          setError('Visualisation 3D indisponible: WebGL désactivé sur cet appareil/navigateur.');
          return;
        }

        (window as any).CESIUM_BASE_URL = '/cesium';

        const CesiumModule = await import('cesium');
        cesiumRef.current = CesiumModule;

        if (!mounted || !containerRef.current) return;

        const Cesium = CesiumModule;
        const ionToken = (process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || '').trim();
        const hasIonToken = ionToken.length > 0;
        const compatibilityMode = !webglSupport.webgl2;
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
          showRenderLoopErrors: false,
          skyBox: false,
          // Disable default async Ion imagery to prevent C[0] null crash
          baseLayer: false,
          // Pause render loop until we add a synchronous base layer
          useDefaultRenderLoop: false,
        };

        const viewerProfiles: Array<{
          name: string;
          requestWebgl1?: boolean;
          powerPreference?: 'default' | 'high-performance';
          useTerrain?: boolean;
          useSkyAtmosphere?: boolean;
          antialias?: boolean;
          msaaSamples?: number;
        }> = [];
        if (webglSupport.webgl2) {
          viewerProfiles.push({
            name: 'webgl2',
            requestWebgl1: false,
            powerPreference: 'high-performance',
            useTerrain: true,
            useSkyAtmosphere: true,
            antialias: false,
            msaaSamples: 1,
          });
        }
        if (webglSupport.webgl1) {
          viewerProfiles.push({
            name: 'webgl1',
            requestWebgl1: true,
            powerPreference: 'default',
            useTerrain: true,
            useSkyAtmosphere: true,
            antialias: false,
          });
        }
        if (webglSupport.webgl2) {
          viewerProfiles.push({
            name: 'minimal-webgl2',
            requestWebgl1: false,
            powerPreference: 'default',
            useTerrain: false,
            useSkyAtmosphere: false,
            antialias: false,
          });
        }
        if (webglSupport.webgl1) {
          viewerProfiles.push({
            name: 'minimal-webgl1',
            requestWebgl1: true,
            powerPreference: 'default',
            useTerrain: false,
            useSkyAtmosphere: false,
            antialias: false,
          });
        }

        let viewer: any | null = null;
        let lastViewerError: unknown = null;

        for (const profile of viewerProfiles) {
          try {
            const viewerOptions: any = {
              ...commonViewerOptions,
            };

            if (profile.requestWebgl1 !== undefined) {
              viewerOptions.contextOptions = {
                requestWebgl1: profile.requestWebgl1,
                webgl: {
                  alpha: false,
                  depth: true,
                  stencil: false,
                  antialias: profile.antialias ?? false,
                  premultipliedAlpha: false,
                  preserveDrawingBuffer: false,
                  powerPreference: profile.powerPreference ?? 'default',
                  failIfMajorPerformanceCaveat: false,
                },
              };
            }

            if (typeof profile.msaaSamples === 'number') {
              viewerOptions.msaaSamples = profile.msaaSamples;
            }

            if (profile.useSkyAtmosphere) {
              viewerOptions.skyAtmosphere = new Cesium.SkyAtmosphere();
            }

            viewer = new Cesium.Viewer(containerRef.current, viewerOptions);
            viewerRef.current = viewer;

            // Add synchronous OSM base layer BEFORE starting the render loop
            viewer.imageryLayers.addImageryProvider(
              new Cesium.OpenStreetMapImageryProvider({
                url: 'https://tile.openstreetmap.org/',
                credit: 'OpenStreetMap',
              })
            );

            // Load terrain async (safe: globe renders fine without it)
            if (profile.useTerrain && hasIonToken) {
              try {
                viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain());
              } catch (terrainError) {
                console.warn('[TripFlythrough] Terrain setup failed, continuing.', terrainError);
              }
            }

            // NOW start the render loop (base layer is ready)
            viewer.useDefaultRenderLoop = true;
            console.info(`[TripFlythrough] Cesium initialized with ${profile.name}`);
            break;
          } catch (profileError) {
            lastViewerError = profileError;
            console.warn(`[TripFlythrough] Failed to init with ${profile.name}`, profileError);
          }
        }

        if (!viewer) {
          throw lastViewerError ?? new Error('Unable to initialize Cesium viewer');
        }
        console.info('[TripFlythrough] CHECKPOINT: viewer created, applying styles...');

        try {
          const imageryLayers = viewer.imageryLayers;
          const baseLayer = imageryLayers.get(0);
          if (baseLayer) {
            baseLayer.brightness = 0.6;
            baseLayer.contrast = 1.1;
            baseLayer.saturation = 0.5;
          }

          viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0a0a12');
          viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0a12');
          viewer.scene.globe.depthTestAgainstTerrain = true;
          viewer.scene.fog.enabled = true;
          viewer.scene.fog.density = compatibilityMode ? 0.00025 : 0.00035;
          viewer.scene.fxaa = !compatibilityMode;
          if (viewer.scene.postProcessStages?.fxaa) {
            viewer.scene.postProcessStages.fxaa.enabled = !compatibilityMode;
          }
        } catch (styleError) {
          console.warn('[TripFlythrough] Scene styling failed, continuing.', styleError);
        }

        console.info('[TripFlythrough] CHECKPOINT: styles applied, loading quality...');
        try {
          await applyBest3DQuality(Cesium, viewer, hasIonToken, compatibilityMode);
        } catch (qualityError) {
          console.warn('[TripFlythrough] 3D quality boost failed, continuing.', qualityError);
        }
        console.info('[TripFlythrough] CHECKPOINT: quality done, setting up render error handler...');

        try {
          let renderErrorCount = 0;
          const MAX_RENDER_ERRORS = 3;
          const onRenderError = (_scene: any, renderError: unknown) => {
            renderErrorCount += 1;
            console.warn(`[TripFlythrough] Render error ${renderErrorCount}/${MAX_RENDER_ERRORS}`, renderError);
            if (!mounted) return;
            if (renderErrorCount < MAX_RENDER_ERRORS) return;
            const currentViewer = viewerRef.current;
            if (currentViewer && !currentViewer.isDestroyed?.()) {
              currentViewer.destroy();
            }
            viewerRef.current = null;
            setIsLoaded(false);
            setError('Le rendu 3D a échoué sur cet appareil. Carte 2D affichée à la place.');
          };
          viewer.scene.renderError.addEventListener(onRenderError);
          removeRenderErrorListener = () => {
            try {
              viewer.scene.renderError.removeEventListener(onRenderError);
            } catch {
              // no-op
            }
          };
        } catch (renderHookError) {
          console.warn('[TripFlythrough] Render error hook failed, continuing.', renderHookError);
        }

        console.info('[TripFlythrough] CHECKPOINT: render handler set, extracting waypoints...');
        // Extract waypoints
        const waypoints = extractWaypoints();
        waypointsRef.current = waypoints;

        if (waypoints.length > 0) {
          try {
            // Add route polyline
            if (waypoints.length > 1) {
              const positions = waypoints.map((w) =>
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
                id: `waypoint-${waypoint.id}-${index}`,
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
              markersRef.current.set(index, marker);
            });

            // Fly to first waypoint
            const firstWaypoint = waypoints[0];
            const firstFlightProfile = getCinematicFlightProfile(waypoints, 0);
            const firstFlightOptions: any = {
              destination: Cesium.Cartesian3.fromDegrees(
                firstWaypoint.lng,
                firstWaypoint.lat,
                firstFlightProfile.altitude
              ),
              orientation: {
                heading: Cesium.Math.toRadians(firstFlightProfile.headingDeg),
                pitch: Cesium.Math.toRadians(firstFlightProfile.pitchDeg),
                roll: 0,
              },
              duration: firstFlightProfile.duration,
              maximumHeight: firstFlightProfile.maxHeight,
              pitchAdjustHeight: Math.max(3500, firstFlightProfile.maxHeight * 0.8),
            };
            if (Cesium.EasingFunction?.CUBIC_IN_OUT) {
              firstFlightOptions.easingFunction = Cesium.EasingFunction.CUBIC_IN_OUT;
            }
            viewer.camera.flyTo(firstFlightOptions);
          } catch (waypointError) {
            console.warn('[TripFlythrough] Waypoint overlay initialization failed, keeping base 3D viewer.', waypointError);
          }
        } else {
          console.info('[TripFlythrough] No activity waypoints found for this trip, showing base 3D globe only.');
        }

        console.info('[TripFlythrough] CHECKPOINT: waypoints done, setting loaded...');
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
        const currentViewer = viewerRef.current;
        if (currentViewer && !currentViewer.isDestroyed?.()) {
          currentViewer.destroy();
        }
        viewerRef.current = null;

        console.error('Failed to initialize Cesium:', err);
        if (err instanceof Error && err.stack) {
          console.error('[TripFlythrough] Stack trace:', err.stack);
        }
        const rawMessage = err instanceof Error ? err.message : String(err);
        const lowerMessage = rawMessage.toLowerCase();
        if (lowerMessage.includes('cesiumwidget') || lowerMessage.includes('webgl')) {
          setError('3D indisponible sur cet appareil. Carte 2D affichée à la place.');
        } else {
          const shortReason = rawMessage.slice(0, 140);
          setError(`Échec du chargement de la visualisation 3D (${shortReason}). Carte 2D affichée à la place.`);
        }
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
      if (removeRenderErrorListener) {
        removeRenderErrorListener();
        removeRenderErrorListener = null;
      }
      window.removeEventListener('resize', resizeViewer);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
      markersRef.current.clear();
      polylineRef.current = null;
    };
  }, [isOpen, extractWaypoints]);

  // Highlight current waypoint
  const highlightWaypoint = useCallback((index: number) => {
    const Cesium = cesiumRef.current;
    if (!Cesium || !viewerRef.current) return;

    markersRef.current.forEach((marker, waypointIndex) => {
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

    const flightProfile = getCinematicFlightProfile(waypoints, index);
    const flightOptions: any = {
      destination: Cesium.Cartesian3.fromDegrees(
        waypoint.lng,
        waypoint.lat,
        flightProfile.altitude
      ),
      orientation: {
        heading: Cesium.Math.toRadians(flightProfile.headingDeg),
        pitch: Cesium.Math.toRadians(flightProfile.pitchDeg),
        roll: 0,
      },
      duration: flightProfile.duration / speed,
      maximumHeight: flightProfile.maxHeight,
      pitchAdjustHeight: Math.max(3500, flightProfile.maxHeight * 0.8),
    };
    if (Cesium.EasingFunction?.QUADRATIC_IN_OUT) {
      flightOptions.easingFunction = Cesium.EasingFunction.QUADRATIC_IN_OUT;
    }
    viewer.camera.flyTo(flightOptions);

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
        <div className="absolute inset-0 bg-black/80 p-4 md:p-6 overflow-y-auto">
          <div className="mx-auto max-w-5xl rounded-xl border border-white/20 bg-black/70 p-4 text-white">
            <p className="text-sm text-red-300">{error}</p>
            {fallbackItems.length > 0 && (
              <div className="mt-3 h-[60vh] min-h-[320px] rounded-lg overflow-hidden border border-white/20 bg-white">
                <TripMap items={fallbackItems} isVisible />
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button variant="outline" onClick={onClose}>
                Fermer
              </Button>
            </div>
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
        .cesium-widget-errorPanel {
          display: none !important;
        }
      `}</style>
    </div>,
    document.body
  );
}
