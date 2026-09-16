import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SoundDirectionIndicatorProps {
  playerPos: React.MutableRefObject<THREE.Vector3>;
  aiPos: React.MutableRefObject<THREE.Vector3>;
  aiNoiseLevelRef: React.MutableRefObject<number>;
  hasVisualContactRef?: React.MutableRefObject<boolean>;
}

// Generate geometry for an acoustic arc (curved sound wave segment) pointing along +Z
function createArcGeometry(radius: number, thickness: number, angleRad: number, segments: number = 36): THREE.BufferGeometry {
  const innerRadius = radius - thickness / 2;
  const outerRadius = radius + thickness / 2;
  const halfAngle = angleRad / 2;

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const a = -halfAngle + (i / segments) * angleRad;
    const sinA = Math.sin(a);
    const cosA = Math.cos(a);

    // Outer vertex (x, y=0, z)
    positions.push(sinA * outerRadius, 0, cosA * outerRadius);
    // Inner vertex (x, y=0, z)
    positions.push(sinA * innerRadius, 0, cosA * innerRadius);

    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// Generate geometry for an acoustic fan/wedge on ground pointing along +Z
function createFanGeometry(minRadius: number, maxRadius: number, angleRad: number, segments: number = 36): THREE.BufferGeometry {
  const halfAngle = angleRad / 2;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const a = -halfAngle + (i / segments) * angleRad;
    const sinA = Math.sin(a);
    const cosA = Math.cos(a);

    positions.push(sinA * maxRadius, 0, cosA * maxRadius);
    positions.push(sinA * minRadius, 0, cosA * minRadius);

    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// Generate geometry for a directional acoustic chevron / arrow pointing along +Z
function createChevronGeometry(tipZ: number, width: number, depth: number): THREE.BufferGeometry {
  const baseZ = tipZ - depth;
  const notchZ = baseZ + depth * 0.45;

  const positions = [
    0, 0, tipZ,           // 0: tip
    width / 2, 0, baseZ,  // 1: right outer
    0, 0, notchZ,         // 2: center notch
    -width / 2, 0, baseZ, // 3: left outer
  ];

  const indices = [
    0, 1, 2,
    0, 2, 3,
  ];

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export const SoundDirectionIndicator: React.FC<SoundDirectionIndicatorProps> = ({
  playerPos,
  aiPos,
  aiNoiseLevelRef,
}) => {
  const rootGroup = useRef<THREE.Group>(null!);
  const fanRef = useRef<THREE.Mesh>(null!);
  const wave1Ref = useRef<THREE.Mesh>(null!);
  const wave2Ref = useRef<THREE.Mesh>(null!);
  const wave3Ref = useRef<THREE.Mesh>(null!);
  const chevron1Ref = useRef<THREE.Mesh>(null!);
  const chevron2Ref = useRef<THREE.Mesh>(null!);

  // Timing and imprecise direction state
  const soundLifeTimer = useRef(0);
  const maxSoundDuration = 1.8;
  const currentJitter = useRef(0);
  const targetJitter = useRef(0);
  const smoothedAngle = useRef(0);
  const soundIntensity = useRef(0);
  const waveAnimTime = useRef(0);
  const lastSoundTime = useRef(0);

  // Wide cone arc ~60 degrees (1.05 rad) representing acoustic direction with natural imprecision
  const arcAngle = 1.05;

  const geomFan = useMemo(() => createFanGeometry(1.4, 4.8, arcAngle * 1.1), [arcAngle]);
  const geomWave1 = useMemo(() => createArcGeometry(2.2, 0.40, arcAngle), [arcAngle]);
  const geomWave2 = useMemo(() => createArcGeometry(3.3, 0.45, arcAngle * 1.15), [arcAngle]);
  const geomWave3 = useMemo(() => createArcGeometry(4.5, 0.50, arcAngle * 1.30), [arcAngle]);
  const geomChevron1 = useMemo(() => createChevronGeometry(3.9, 1.4, 0.8), []);
  const geomChevron2 = useMemo(() => createChevronGeometry(2.7, 1.1, 0.65), []);

  useFrame((_state, delta) => {
    if (!rootGroup.current) return;

    const noiseLevel = aiNoiseLevelRef.current || 0;
    const distToAi = playerPos.current.distanceTo(aiPos.current);
    const isHeard = noiseLevel > 0 && distToAi <= noiseLevel;

    if (isHeard) {
      // Refresh sound timer when noise is heard
      soundLifeTimer.current = maxSoundDuration;

      // Calculate intensity (closer and louder = stronger)
      const distRatio = Math.min(1, distToAi / Math.max(1, noiseLevel));
      soundIntensity.current = Math.max(0.6, 1.0 - distRatio * 0.5);

      // Periodically update imprecise angular jitter (e.g. ±18 degrees / ±0.32 rad)
      const now = performance.now();
      if (now - lastSoundTime.current > 350) {
        lastSoundTime.current = now;
        targetJitter.current = (Math.random() - 0.5) * 0.64;
      }
    }

    if (soundLifeTimer.current > 0) {
      soundLifeTimer.current -= delta;

      // Dynamic animation speed based on proximity: closer = much faster pulsing
      const effectiveNoise = Math.max(1, noiseLevel > 0 ? noiseLevel : 14.0);
      const proximity = THREE.MathUtils.clamp(1.0 - distToAi / effectiveNoise, 0, 1);
      // Speed scales from 3.0 (far) up to 15.0 (close)
      const dynamicAnimSpeed = THREE.MathUtils.lerp(3.0, 15.0, Math.pow(proximity, 1.1));
      waveAnimTime.current += delta * dynamicAnimSpeed;

      // Smooth jitter interpolation
      currentJitter.current = THREE.MathUtils.lerp(
        currentJitter.current,
        targetJitter.current,
        delta * 4.0,
      );

      // Calculate true vector from player to AI in XZ
      const dx = aiPos.current.x - playerPos.current.x;
      const dz = aiPos.current.z - playerPos.current.z;
      const trueAngle = Math.atan2(dx, dz);

      // Imprecise angle
      const impreciseTargetAngle = trueAngle + currentJitter.current;

      // Smooth angle interpolation handling wrap-around
      const diff = Math.atan2(
        Math.sin(impreciseTargetAngle - smoothedAngle.current),
        Math.cos(impreciseTargetAngle - smoothedAngle.current),
      );
      smoothedAngle.current += diff * Math.min(1, delta * 10.0);

      // Position at ground floor level (behind/under characters, but drawn over buildings)
      rootGroup.current.position.set(
        playerPos.current.x,
        playerPos.current.y + 0.05,
        playerPos.current.z,
      );
      rootGroup.current.rotation.y = smoothedAngle.current;

      // Overall opacity fade out curve
      const lifeFactor = Math.max(0, soundLifeTimer.current / maxSoundDuration);
      const overallFade = Math.pow(lifeFactor, 0.5) * soundIntensity.current;

      rootGroup.current.visible = overallFade > 0.01;

      // Dynamic pulsating ripple animation for the 3 arcs
      const t = waveAnimTime.current;
      const pulse1 = (Math.sin(t) + 1) / 2;
      const pulse2 = (Math.sin(t - 1.1) + 1) / 2;
      const pulse3 = (Math.sin(t - 2.2) + 1) / 2;
      const chevronPulse = (Math.sin(t * 1.5) + 1) / 2;

      if (fanRef.current) {
        const mat = fanRef.current.material as THREE.MeshBasicMaterial;
        mat.opacity = THREE.MathUtils.clamp(overallFade * 0.35, 0, 0.5);
      }

      if (wave1Ref.current) {
        const mat = wave1Ref.current.material as THREE.MeshBasicMaterial;
        mat.opacity = THREE.MathUtils.clamp(overallFade * (0.7 + pulse1 * 0.3), 0, 1.0);
        const s = 1.0 + pulse1 * 0.08;
        wave1Ref.current.scale.set(s, 1, s);
      }

      if (wave2Ref.current) {
        const mat = wave2Ref.current.material as THREE.MeshBasicMaterial;
        mat.opacity = THREE.MathUtils.clamp(overallFade * (0.65 + pulse2 * 0.35), 0, 1.0);
        const s = 1.0 + pulse2 * 0.10;
        wave2Ref.current.scale.set(s, 1, s);
      }

      if (wave3Ref.current) {
        const mat = wave3Ref.current.material as THREE.MeshBasicMaterial;
        mat.opacity = THREE.MathUtils.clamp(overallFade * (0.60 + pulse3 * 0.40), 0, 1.0);
        const s = 1.0 + pulse3 * 0.12;
        wave3Ref.current.scale.set(s, 1, s);
      }

      if (chevron1Ref.current) {
        const mat = chevron1Ref.current.material as THREE.MeshBasicMaterial;
        mat.opacity = THREE.MathUtils.clamp(overallFade * (0.85 + chevronPulse * 0.15), 0, 1.0);
        const s = 1.0 + chevronPulse * 0.08;
        chevron1Ref.current.scale.set(s, 1, s);
      }

      if (chevron2Ref.current) {
        const mat = chevron2Ref.current.material as THREE.MeshBasicMaterial;
        mat.opacity = THREE.MathUtils.clamp(overallFade * 0.9, 0, 1.0);
      }
    } else {
      rootGroup.current.visible = false;
    }
  });

  return (
    <group ref={rootGroup} visible={false}>
      {/* Translucent Acoustic Fan/Wedge */}
      <mesh ref={fanRef} geometry={geomFan} renderOrder={0.5}>
        <meshBasicMaterial
          color="#ffb703"
          transparent
          opacity={0.35}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Innermost Acoustic Wave - Bright Yellow */}
      <mesh ref={wave1Ref} geometry={geomWave1} renderOrder={0.5}>
        <meshBasicMaterial
          color="#fff000"
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Middle Acoustic Wave - Bright Amber */}
      <mesh ref={wave2Ref} geometry={geomWave2} renderOrder={0.5}>
        <meshBasicMaterial
          color="#ffb703"
          transparent
          opacity={0.90}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Outer Acoustic Wave - Deep Warm Orange */}
      <mesh ref={wave3Ref} geometry={geomWave3} renderOrder={0.5}>
        <meshBasicMaterial
          color="#fb8500"
          transparent
          opacity={0.85}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Main Front Directional Chevron (Large) */}
      <mesh ref={chevron1Ref} geometry={geomChevron1} renderOrder={0.5}>
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={1.0}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Secondary Trailing Directional Chevron */}
      <mesh ref={chevron2Ref} geometry={geomChevron2} renderOrder={0.5}>
        <meshBasicMaterial
          color="#ffea00"
          transparent
          opacity={0.9}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};
