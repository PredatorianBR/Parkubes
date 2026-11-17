import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { VisualState } from '../types';

const scratchSpawnPos = new THREE.Vector3();
const scratchVel = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchForward = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const scratchArmPos = new THREE.Vector3();
const scratchLegPos = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export const ParticleEffects: React.FC<{
  visible?: boolean;
  isRunning: boolean;
  isMoving: boolean;
  isGrounded: boolean;
  currentSurface: number;
  staminaRef?: React.MutableRefObject<number>;
  playerGroup: React.RefObject<THREE.Group>;
  stunned: boolean;
  fallDistance: number;
  justLanded: boolean;
  isTiredBreathingRef?: React.MutableRefObject<boolean>;
  isRolling: boolean;
  moveSpeed: number;
  visualStateRef?: React.MutableRefObject<Partial<VisualState> | null | undefined>;
}> = ({
  visible = true,
  isRunning: _isRunning,
  isMoving: _isMoving,
  isGrounded: _isGrounded,
  currentSurface: _currentSurface,
  staminaRef,
  playerGroup,
  stunned: _stunned,
  fallDistance: _fallDistance,
  justLanded: _justLanded,
  isTiredBreathingRef,
  isRolling: _isRolling,
  moveSpeed: _moveSpeed,
  visualStateRef,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const particles = useRef<
    {
      pos: THREE.Vector3;
      vel: THREE.Vector3;
      life: number;
      color: THREE.Color;
      scale: number;
      active: boolean;
    }[]
  >([]);
  const dummy = React.useMemo(() => new THREE.Object3D(), []);
  const maxParticles = 200;
  const hadActiveRef = useRef(false);

  // Initialize particles pool & zero out initial instance matrices
  React.useEffect(() => {
    particles.current = new Array(maxParticles).fill(0).map(() => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      color: new THREE.Color(),
      scale: 0,
      active: false,
    }));
    if (meshRef.current) {
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      for (let i = 0; i < maxParticles; i++) {
        meshRef.current.setMatrixAt(i, dummy.matrix);
      }
      meshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [dummy]);

  const spawnParticle = (
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    color: string,
    scale: number,
    life: number,
  ) => {
    const pool = particles.current;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (!p.active) {
        p.active = true;
        p.pos.copy(pos);
        p.vel.copy(vel);
        p.life = life;
        p.color.set(color);
        p.scale = scale;
        return;
      }
    }
  };

  const wasInWater = useRef(false);
  const wetTimer = useRef(0);
  const lastBreathCycle = useRef(0);
  const swimPhase = useRef(0);

  useFrame((state, delta) => {
    if (!meshRef.current || !playerGroup.current) return;
    const isVisible = visible && playerGroup.current.visible !== false;
    meshRef.current.visible = isVisible;
    if (!isVisible) return;

    const vs = visualStateRef?.current || {};
    const isRunning = vs.isRunning ?? _isRunning;
    const isMoving = vs.isMoving ?? _isMoving;
    const isGrounded = vs.isGrounded ?? _isGrounded;
    const currentSurface = vs.currentSurface ?? _currentSurface;
    const stunned = vs.stunned ?? _stunned;
    const fallDistance = vs.fallDistance ?? _fallDistance;
    const justLanded = vs.justLanded ?? _justLanded;
    const isRolling = vs.isRolling ?? _isRolling;
    const moveSpeed = vs.moveSpeed ?? _moveSpeed;
    const playerPos = playerGroup.current.position;

    // 1. Running Particles
    if (isRunning && isGrounded && Math.random() < 0.6) {
      scratchSpawnPos.set(
        playerPos.x + (Math.random() - 0.5) * 0.8,
        playerPos.y,
        playerPos.z + (Math.random() - 0.5) * 0.8,
      );

      let color = '#a8a29e';
      if (currentSurface === 0) color = '#4ade80';
      else if (currentSurface === 1) color = '#60a5fa';
      else if (currentSurface === 3) color = '#d6d3d1';

      scratchVel.set(
        (Math.random() - 0.5) * 1.5,
        Math.random() * 1.5 + 0.5,
        (Math.random() - 0.5) * 1.5,
      );
      spawnParticle(
        scratchSpawnPos,
        scratchVel,
        color,
        0.2 + Math.random() * 0.2,
        0.6 + Math.random() * 0.4,
      );
    }

    // 1.5 Roll Dust Particles
    if (isRolling && isGrounded && Math.random() < 0.5) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.3 + Math.random() * 0.4;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      scratchSpawnPos.set(
        playerPos.x + cosA * radius,
        playerPos.y + 0.1,
        playerPos.z + sinA * radius,
      );

      let color = '#a8a29e';
      if (currentSurface === 0) color = '#86efac';
      else if (currentSurface === 1) color = '#60a5fa';
      else if (currentSurface === 3) color = '#e7e5e4';

      const horizSpeed = 1.5 + Math.random() * 2;
      scratchVel.set(cosA * horizSpeed, Math.random() * 2.5 + 1, sinA * horizSpeed);
      spawnParticle(
        scratchSpawnPos,
        scratchVel,
        color,
        0.12 + Math.random() * 0.1,
        0.4 + Math.random() * 0.3,
      );
    }

    // 2. Sweat Particles
    if (staminaRef && staminaRef.current < 25 && Math.random() < 0.15) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.72 + Math.random() * 0.1;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      scratchSpawnPos.set(
        playerPos.x + cosA * radius,
        playerPos.y + 3.2 + (Math.random() - 0.5) * 0.8,
        playerPos.z + sinA * radius,
      );
      scratchVel.set(cosA * 0.2, -3, sinA * 0.2);
      spawnParticle(scratchSpawnPos, scratchVel, '#38bdf8', 0.25 + Math.random() * 0.15, 0.6);
    }

    // 3. Landing Particles
    if (justLanded && fallDistance > 1.5) {
      let count = currentSurface === 1 ? 15 : 12;
      let scaleBase = 0.25;
      let spread = 0.8;
      let color = '#a8a29e';

      if (currentSurface === 0) color = '#4ade80';
      else if (currentSurface === 1) color = '#60a5fa';
      else if (currentSurface === 3) color = '#d6d3d1';

      if (stunned) {
        count = 30;
        scaleBase = 0.45;
        spread = 1.2;
        color = '#78716c';
      }

      for (let i = 0; i < count; i++) {
        scratchSpawnPos.set(
          playerPos.x + (Math.random() - 0.5) * spread,
          playerPos.y,
          playerPos.z + (Math.random() - 0.5) * spread,
        );
        scratchVel.set((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3);
        spawnParticle(scratchSpawnPos, scratchVel, color, scaleBase + Math.random() * 0.15, 0.6);
      }
    }

    // 4. Water Splash & Dripping
    const playerY = playerPos.y;
    const isOverWater = currentSurface === 1;
    const isInWater = isOverWater && playerY < -0.5;

    if (isInWater && !wasInWater.current) {
      for (let i = 0; i < 30; i++) {
        scratchSpawnPos.set(
          playerPos.x + (Math.random() - 0.5) * 1.2,
          -0.15,
          playerPos.z + (Math.random() - 0.5) * 1.2,
        );
        scratchVel.set(
          (Math.random() - 0.5) * 3,
          Math.random() * 4 + 2,
          (Math.random() - 0.5) * 3,
        );
        spawnParticle(scratchSpawnPos, scratchVel, '#60a5fa', 0.2 + Math.random() * 0.2, 0.8);
      }

      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2;
        scratchDir.set(Math.cos(angle), 0, Math.sin(angle));
        scratchSpawnPos.copy(playerPos).addScaledVector(scratchDir, 0.2);
        scratchSpawnPos.y = -0.15;
        const speed = 3.0 + Math.random() * 2.0;
        scratchVel.set(scratchDir.x * speed, 0.2, scratchDir.z * speed);
        spawnParticle(
          scratchSpawnPos,
          scratchVel,
          '#93c5fd',
          0.25 + Math.random() * 0.15,
          0.4 + Math.random() * 0.2,
        );
      }
    }

    if (wasInWater.current && !isInWater) {
      wetTimer.current = 3.0;

      for (let i = 0; i < 20; i++) {
        scratchSpawnPos.set(
          playerPos.x + (Math.random() - 0.5) * 1.0,
          0.1,
          playerPos.z + (Math.random() - 0.5) * 1.0,
        );
        scratchVel.set(
          (Math.random() - 0.5) * 4,
          Math.random() * 5 + 2,
          (Math.random() - 0.5) * 4,
        );
        spawnParticle(scratchSpawnPos, scratchVel, '#93c5fd', 0.25 + Math.random() * 0.25, 0.8);
      }

      for (let i = 0; i < 18; i++) {
        const angle = (i / 18) * Math.PI * 2;
        scratchDir.set(Math.cos(angle), 0, Math.sin(angle));
        scratchSpawnPos.copy(playerPos).addScaledVector(scratchDir, 0.2);
        scratchSpawnPos.y = -0.15;
        const speed = 2.0 + Math.random() * 1.5;
        scratchVel.set(scratchDir.x * speed, 0.1, scratchDir.z * speed);
        spawnParticle(
          scratchSpawnPos,
          scratchVel,
          '#93c5fd',
          0.2 + Math.random() * 0.1,
          0.3 + Math.random() * 0.2,
        );
      }
    }

    // 4.5 Swimming Splashes
    if (isInWater && isMoving && !stunned) {
      const speedFact = Math.min(moveSpeed / 6, 1.5);
      swimPhase.current += delta * 9 * speedFact;
      const t = swimPhase.current;

      const cycle = Math.sin(t);
      const prevCycle = Math.sin(t - delta * 9 * speedFact);

      if ((cycle > 0.8 && prevCycle <= 0.8) || (cycle < -0.8 && prevCycle >= -0.8)) {
        const side = cycle > 0 ? 1 : -1;
        const rotY = playerGroup.current.rotation.y;
        scratchForward.set(0, 0, 1).applyAxisAngle(WORLD_UP, rotY);
        scratchRight.set(1, 0, 0).applyAxisAngle(WORLD_UP, rotY);

        scratchArmPos
          .copy(playerPos)
          .addScaledVector(scratchForward, 0.4)
          .addScaledVector(scratchRight, side * 0.6);
        scratchArmPos.y = -0.15;

        scratchLegPos
          .copy(playerPos)
          .addScaledVector(scratchForward, -0.6)
          .addScaledVector(scratchRight, -side * 0.4);
        scratchLegPos.y = -0.15;

        for (let i = 0; i < 5; i++) {
          scratchSpawnPos.set(
            scratchArmPos.x + (Math.random() - 0.5) * 0.3,
            -0.15,
            scratchArmPos.z + (Math.random() - 0.5) * 0.3,
          );
          scratchVel.set(
            (Math.random() - 0.5) * 1.5,
            Math.random() * 2 + 1,
            (Math.random() - 0.5) * 1.5,
          );
          spawnParticle(
            scratchSpawnPos,
            scratchVel,
            '#93c5fd',
            0.2 + Math.random() * 0.2,
            0.5 + Math.random() * 0.3,
          );
        }

        for (let i = 0; i < 4; i++) {
          scratchSpawnPos.set(
            scratchLegPos.x + (Math.random() - 0.5) * 0.3,
            -0.15,
            scratchLegPos.z + (Math.random() - 0.5) * 0.3,
          );
          scratchVel.set(
            (Math.random() - 0.5) * 1,
            Math.random() * 1.5 + 0.5,
            (Math.random() - 0.5) * 1,
          );
          spawnParticle(
            scratchSpawnPos,
            scratchVel,
            '#93c5fd',
            0.15 + Math.random() * 0.15,
            0.4 + Math.random() * 0.3,
          );
        }
      }
    } else {
      swimPhase.current = 0;
    }

    wasInWater.current = isInWater;

    // 5. Dripping Logic
    if (wetTimer.current > 0) {
      wetTimer.current -= delta;
      if (Math.random() < 0.4) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.75 + Math.random() * 0.15;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        scratchSpawnPos.set(
          playerPos.x + cosA * radius,
          playerPos.y + Math.random() * 3.8,
          playerPos.z + sinA * radius,
        );
        scratchVel.set(cosA * 0.8, -3 - Math.random() * 3, sinA * 0.8);
        spawnParticle(
          scratchSpawnPos,
          scratchVel,
          '#38bdf8',
          0.2 + Math.random() * 0.15,
          0.5 + Math.random() * 0.3,
        );
      }
    }

    // 6. Tired Breath
    if (isTiredBreathingRef?.current) {
      const breathCycle = Math.sin(state.clock.getElapsedTime() * 8.0);
      if (breathCycle > 0.8 && lastBreathCycle.current <= 0.8) {
        const rotY = playerGroup.current.rotation.y;
        scratchForward.set(0, 0, 1).applyAxisAngle(WORLD_UP, rotY);
        scratchSpawnPos.copy(playerPos).addScaledVector(scratchForward, 0.85);
        scratchSpawnPos.y += 2.9;
        scratchVel.copy(scratchForward).multiplyScalar(0.8);
        scratchVel.y += 0.4;

        spawnParticle(
          scratchSpawnPos,
          scratchVel,
          '#f3f4f6',
          0.2 + Math.random() * 0.15,
          0.8,
        );
      }
      lastBreathCycle.current = breathCycle;
    } else {
      lastBreathCycle.current = 0;
    }

    // UPDATE PARTICLES
    const pool = particles.current;
    let hasAnyActive = false;
    let colorDirty = false;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (p.active) {
        hasAnyActive = true;
        p.life -= delta;
        p.vel.y -= 8.0 * delta;
        p.pos.addScaledVector(p.vel, delta);

        if (p.life <= 0 || p.pos.y < -2) {
          p.active = false;
          dummy.scale.set(0, 0, 0);
        } else {
          const s = p.scale * (p.life / 0.5);
          dummy.position.copy(p.pos);
          dummy.scale.set(s, s, s);
          dummy.rotation.set(Math.random(), Math.random(), Math.random());
          meshRef.current.setColorAt(i, p.color);
          colorDirty = true;
        }
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      } else if (hadActiveRef.current) {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      }
    }

    if (hasAnyActive || hadActiveRef.current) {
      meshRef.current.instanceMatrix.needsUpdate = true;
      if (colorDirty && meshRef.current.instanceColor) {
        meshRef.current.instanceColor.needsUpdate = true;
      }
    }
    hadActiveRef.current = hasAnyActive;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, maxParticles]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial transparent opacity={0.8} />
    </instancedMesh>
  );
};
