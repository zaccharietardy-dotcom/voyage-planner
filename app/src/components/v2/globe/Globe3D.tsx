'use client';

import { useRef, useMemo, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import { OrbitControls, Sphere, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Traveler, TripArc } from '@/lib/v2/mockData';
import { colors } from '@/lib/v2/theme';

// Convert lat/lng to 3D coordinates on sphere
function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);

  return new THREE.Vector3(x, y, z);
}

// Generate arc points between two coordinates
function generateArcPoints(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  radius: number,
  segments: number = 50
): THREE.Vector3[] {
  const startVec = latLngToVector3(start.lat, start.lng, radius);
  const endVec = latLngToVector3(end.lat, end.lng, radius);

  const points: THREE.Vector3[] = [];
  const angle = startVec.angleTo(endVec);
  const arcHeight = Math.min(angle * 0.5, 0.3);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = new THREE.Vector3().lerpVectors(startVec, endVec, t);
    const heightFactor = Math.sin(t * Math.PI) * arcHeight;
    point.normalize().multiplyScalar(radius + heightFactor);
    points.push(point);
  }

  return points;
}

// Atmosphere glow shader
const AtmosphereShader = {
  uniforms: {
    glowColor: { value: new THREE.Color(colors.accentPrimary) },
    viewVector: { value: new THREE.Vector3(0, 0, 1) },
    c: { value: 0.4 },
    p: { value: 4.0 },
  },
  vertexShader: `
    uniform vec3 viewVector;
    varying float intensity;
    void main() {
      vec3 vNormal = normalize(normalMatrix * normal);
      vec3 vNormel = normalize(normalMatrix * viewVector);
      intensity = pow(0.7 - dot(vNormal, vNormel), 2.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 glowColor;
    varying float intensity;
    void main() {
      vec3 glow = glowColor * intensity;
      gl_FragColor = vec4(glow, intensity * 0.6);
    }
  `,
};

// Earth Globe component with real texture
function Earth({ earthRef }: { earthRef: React.RefObject<THREE.Group | null> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const atmosphereRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  // Load Earth texture
  const earthTexture = useLoader(THREE.TextureLoader, '/textures/earth-dark.jpg');
  const bumpTexture = useLoader(THREE.TextureLoader, '/textures/earth-bump.jpg');

  // Auto rotation
  useFrame(() => {
    if (earthRef.current) {
      earthRef.current.rotation.y += 0.001;
    }
    if (atmosphereRef.current) {
      const material = atmosphereRef.current.material as THREE.ShaderMaterial;
      if (material.uniforms) {
        material.uniforms.viewVector.value = camera.position.clone().normalize();
      }
    }
  });

  return (
    <>
      {/* Earth sphere with texture */}
      <Sphere ref={meshRef} args={[2, 64, 64]}>
        <meshStandardMaterial
          map={earthTexture}
          bumpMap={bumpTexture}
          bumpScale={0.05}
          roughness={0.8}
          metalness={0.1}
        />
      </Sphere>

      {/* Atmosphere glow */}
      <Sphere ref={atmosphereRef} args={[2.15, 64, 64]}>
        <shaderMaterial
          attach="material"
          args={[AtmosphereShader]}
          transparent
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </Sphere>
    </>
  );
}

// Marker for traveler position - positioned relative to parent group
function TravelerMarker({
  traveler,
  radius,
  onClick,
  isSelected,
}: {
  traveler: Traveler;
  radius: number;
  onClick: (traveler: Traveler) => void;
  isSelected: boolean;
}) {
  const position = latLngToVector3(
    traveler.location.lat,
    traveler.location.lng,
    radius + 0.05
  );
  const pulseRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  // Pulse animation
  useFrame((state) => {
    if (pulseRef.current) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.3;
      pulseRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group position={position}>
      {/* Pulse effect */}
      {traveler.isOnline && (
        <mesh ref={pulseRef}>
          <sphereGeometry args={[0.04, 16, 16]} />
          <meshBasicMaterial
            color={colors.markerPulse}
            transparent
            opacity={0.4}
          />
        </mesh>
      )}

      {/* Main marker */}
      <mesh
        onClick={() => onClick(traveler)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[0.025, 16, 16]} />
        <meshBasicMaterial
          color={isSelected ? colors.accentPrimary : colors.markerColor}
        />
      </mesh>

      {/* Avatar popup on hover/select */}
      {(hovered || isSelected) && (
        <Html
          position={[0, 0.15, 0]}
          center
          style={{
            pointerEvents: 'none',
            transform: 'translateY(-50%)',
          }}
        >
          <div className="bg-[#12121a]/90 backdrop-blur-lg rounded-lg p-2 border border-[#2a2a38] shadow-lg min-w-[120px]">
            <div className="flex items-center gap-2">
              <img
                src={traveler.avatar}
                alt={traveler.name}
                className="w-8 h-8 rounded-full border-2 border-indigo-500"
              />
              <div>
                <p className="text-white text-xs font-medium">{traveler.name}</p>
                <p className="text-gray-400 text-[10px]">{traveler.location.name}</p>
              </div>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

// Animated arc between destinations - also attached to rotating group
function TripArcLine({
  arc,
  radius,
}: {
  arc: TripArc;
  radius: number;
}) {
  const points = useMemo(
    () => generateArcPoints(arc.from, arc.to, radius),
    [arc, radius]
  );
  const lineRef = useRef<any>(null);
  const [dashOffset, setDashOffset] = useState(0);

  useFrame(() => {
    if (arc.animated) {
      setDashOffset((prev) => (prev + 0.01) % 1);
    }
  });

  return (
    <Line
      ref={lineRef}
      points={points}
      color={arc.color || colors.arcColor}
      lineWidth={2}
      transparent
      opacity={0.7}
      dashed={arc.animated}
      dashSize={0.1}
      dashOffset={dashOffset}
    />
  );
}

// Particle system along arcs
function ArcParticles({
  arc,
  radius,
}: {
  arc: TripArc;
  radius: number;
}) {
  const points = useMemo(
    () => generateArcPoints(arc.from, arc.to, radius, 100),
    [arc, radius]
  );
  const particleRef = useRef<THREE.Mesh>(null);
  const [progress, setProgress] = useState(0);

  useFrame(() => {
    if (arc.animated) {
      setProgress((prev) => (prev + 0.005) % 1);
      if (particleRef.current) {
        const index = Math.floor(progress * (points.length - 1));
        const point = points[index];
        particleRef.current.position.copy(point);
      }
    }
  });

  if (!arc.animated) return null;

  return (
    <mesh ref={particleRef}>
      <sphereGeometry args={[0.02, 8, 8]} />
      <meshBasicMaterial color={colors.accentGlow} />
    </mesh>
  );
}

// Stars background
function Stars() {
  const starsRef = useRef<THREE.Points>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(3000);
    for (let i = 0; i < 1000; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const r = 50 + Math.random() * 50;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  useFrame(() => {
    if (starsRef.current) {
      starsRef.current.rotation.y += 0.0001;
    }
  });

  return (
    <points ref={starsRef} geometry={geometry}>
      <pointsMaterial size={0.1} color="#ffffff" transparent opacity={0.6} />
    </points>
  );
}

// Main Globe Scene
function GlobeScene({
  travelers,
  arcs,
  selectedTraveler,
  onTravelerSelect,
}: {
  travelers: Traveler[];
  arcs: TripArc[];
  selectedTraveler: Traveler | null;
  onTravelerSelect: (traveler: Traveler | null) => void;
}) {
  const globeRadius = 2;
  // Shared ref for the rotating Earth group - markers are children of this group
  const earthGroupRef = useRef<THREE.Group>(null);

  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 3, 5]} intensity={1} />
      <pointLight position={[-5, -3, -5]} intensity={0.3} color="#6366f1" />

      <Stars />

      {/* Rotating group containing Earth and all markers/arcs */}
      <group ref={earthGroupRef}>
        <Earth earthRef={earthGroupRef} />

        {/* Traveler markers - inside the rotating group */}
        {travelers.map((traveler) => (
          <TravelerMarker
            key={traveler.id}
            traveler={traveler}
            radius={globeRadius}
            onClick={onTravelerSelect}
            isSelected={selectedTraveler?.id === traveler.id}
          />
        ))}

        {/* Trip arcs - inside the rotating group */}
        {arcs.map((arc) => (
          <group key={arc.id}>
            <TripArcLine arc={arc} radius={globeRadius} />
            <ArcParticles arc={arc} radius={globeRadius} />
          </group>
        ))}
      </group>

      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={3}
        maxDistance={10}
        rotateSpeed={0.5}
        zoomSpeed={0.5}
        autoRotate={false}
      />
    </>
  );
}

// Exported Globe component
export interface Globe3DProps {
  travelers: Traveler[];
  arcs: TripArc[];
  onTravelerSelect?: (traveler: Traveler | null) => void;
  selectedTraveler?: Traveler | null;
  className?: string;
}

export function Globe3D({
  travelers,
  arcs,
  onTravelerSelect,
  selectedTraveler = null,
  className = '',
}: Globe3DProps) {
  const handleTravelerSelect = useCallback(
    (traveler: Traveler | null) => {
      onTravelerSelect?.(traveler);
    },
    [onTravelerSelect]
  );

  return (
    <div className={`w-full h-full ${className}`}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <GlobeScene
          travelers={travelers}
          arcs={arcs}
          selectedTraveler={selectedTraveler}
          onTravelerSelect={handleTravelerSelect}
        />
      </Canvas>
    </div>
  );
}

export default Globe3D;
