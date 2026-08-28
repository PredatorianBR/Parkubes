import React, { useRef, useContext } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MatchContext } from '../MatchContext';
import { VisualState } from '../types';

interface CharacterProps {
  groupRef: React.RefObject<THREE.Group>;
  staminaFillRef?: React.RefObject<HTMLDivElement>;
  staminaGroupRef?: React.RefObject<HTMLDivElement>;
  overlayContent?: React.ReactNode;
  visualStateRef?: React.MutableRefObject<Partial<VisualState> | null | undefined>;
  stunned?: boolean;
  isCharging?: boolean;
  isRolling?: boolean;
  isStumbling?: boolean;
  isRunning?: boolean;
  isMoving?: boolean;
  moveSpeed?: number;
  isGrounded?: boolean;
  landingFactor?: number;
  stunTimerRef?: React.MutableRefObject<number>;
  rollTimerRef?: React.MutableRefObject<number>;
  isHiding?: boolean;
  staminaRef?: React.MutableRefObject<number>;
  currentSurface?: number;
  fallDistance?: number;
  justLanded?: boolean;
  isClimbing?: boolean;
  isLadderSliding?: boolean;
  isNearLadder?: boolean;
  isLadderHanging?: boolean;
  isLadderMounting?: boolean;
  waterExitTimerRef?: React.MutableRefObject<number>;
  ladderFaceAngle?: number;
  isWallClimbing?: boolean;
  wallClimbProgress?: number;
  color?: string; // Optional coloring
}

const ParticleEffects: React.FC<{
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

  // Initialize particles pool
  React.useEffect(() => {
    particles.current = new Array(maxParticles).fill(0).map(() => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      color: new THREE.Color(),
      scale: 0,
      active: false,
    }));
  }, []);

  const spawnParticle = (
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    color: string,
    scale: number,
    life: number,
  ) => {
    const p = particles.current.find((p) => !p.active);
    if (p) {
      p.active = true;
      p.pos.copy(pos);
      p.vel.copy(vel);
      p.life = life;
      p.color.set(color);
      p.scale = scale;
    }
  };

  const wasInWater = useRef(false);
  const wetTimer = useRef(0);
  const lastBreathCycle = useRef(0);
  const swimPhase = useRef(0);

  useFrame((state, delta) => {
    if (!meshRef.current || !playerGroup.current) return;

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

    // SPAWN LOGIC

    // 1. Running Particles
    if (isRunning && isGrounded && Math.random() < 0.6) {
      const offset = new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8);
      const spawnPos = playerGroup.current.position.clone().add(offset);

      let color = '#a8a29e';
      if (currentSurface === 0) color = '#4ade80';
      else if (currentSurface === 1) color = '#60a5fa';
      else if (currentSurface === 3) color = '#d6d3d1';

      spawnParticle(
        spawnPos,
        new THREE.Vector3(
          (Math.random() - 0.5) * 1.5,
          Math.random() * 1.5 + 0.5,
          (Math.random() - 0.5) * 1.5,
        ),
        color,
        0.2 + Math.random() * 0.2,
        0.6 + Math.random() * 0.4,
      );
    }

    // 1.5 Roll Dust Particles
    if (isRolling && isGrounded && Math.random() < 0.5) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.3 + Math.random() * 0.4;
      const offset = new THREE.Vector3(Math.cos(angle) * radius, 0.1, Math.sin(angle) * radius);
      const spawnPos = playerGroup.current.position.clone().add(offset);

      let color = '#a8a29e';
      if (currentSurface === 0) color = '#86efac';
      else if (currentSurface === 1) color = '#60a5fa';
      else if (currentSurface === 3) color = '#e7e5e4';

      spawnParticle(
        spawnPos,
        new THREE.Vector3(
          Math.cos(angle) * (1.5 + Math.random() * 2),
          Math.random() * 2.5 + 1,
          Math.sin(angle) * (1.5 + Math.random() * 2),
        ),
        color,
        0.12 + Math.random() * 0.1,
        0.4 + Math.random() * 0.3,
      );
    }

    // 2. Sweat Particles
    if (staminaRef && staminaRef.current < 25 && Math.random() < 0.15) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.72 + Math.random() * 0.1;
      const headOffset = new THREE.Vector3(
        Math.cos(angle) * radius,
        3.2 + (Math.random() - 0.5) * 0.8, // Face/head height range
        Math.sin(angle) * radius,
      );
      const spawnPos = playerGroup.current.position.clone().add(headOffset);
      spawnParticle(
        spawnPos,
        new THREE.Vector3(Math.cos(angle) * 0.2, -3, Math.sin(angle) * 0.2),
        '#38bdf8',
        0.25 + Math.random() * 0.15,
        0.6,
      );
    }

    // 3. Landing Particles
    if (justLanded) {
      if (fallDistance > 1.5) {
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
          const offset = new THREE.Vector3(
            (Math.random() - 0.5) * spread,
            0,
            (Math.random() - 0.5) * spread,
          );
          const spawnPos = playerGroup.current.position.clone().add(offset);

          spawnParticle(
            spawnPos,
            new THREE.Vector3(
              (Math.random() - 0.5) * 3,
              Math.random() * 3,
              (Math.random() - 0.5) * 3,
            ),
            color,
            scaleBase + Math.random() * 0.15,
            0.6,
          );
        }
      }
    }

    // 4. Water Splash & Dripping
    const playerY = playerGroup.current.position.y;
    const isOverWater = currentSurface === 1;
    const isInWater = isOverWater && playerY < -0.5;

    if (isInWater && !wasInWater.current) {
      // Splash
      for (let i = 0; i < 30; i++) {
        const offset = new THREE.Vector3(
          (Math.random() - 0.5) * 1.2,
          0,
          (Math.random() - 0.5) * 1.2,
        );
        const spawnPos = playerGroup.current.position.clone().add(offset);
        spawnPos.y = -0.15;

        spawnParticle(
          spawnPos,
          new THREE.Vector3(
            (Math.random() - 0.5) * 3,
            Math.random() * 4 + 2,
            (Math.random() - 0.5) * 3,
          ),
          '#60a5fa',
          0.2 + Math.random() * 0.2,
          0.8,
        );
      }

      // Ripple Ring
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const spawnPos = playerGroup.current.position.clone().addScaledVector(dir, 0.2);
        spawnPos.y = -0.15;
        const rippleVel = dir.clone().multiplyScalar(3.0 + Math.random() * 2.0);
        rippleVel.y = 0.2;

        spawnParticle(
          spawnPos,
          rippleVel,
          '#93c5fd',
          0.25 + Math.random() * 0.15,
          0.4 + Math.random() * 0.2,
        );
      }
    }

    if (wasInWater.current && !isInWater) {
      wetTimer.current = 3.0;

      // Water exit splash burst
      for (let i = 0; i < 20; i++) {
        const offset = new THREE.Vector3(
          (Math.random() - 0.5) * 1.0,
          0,
          (Math.random() - 0.5) * 1.0,
        );
        const spawnPos = playerGroup.current.position.clone().add(offset);
        spawnPos.y = 0.1;

        spawnParticle(
          spawnPos,
          new THREE.Vector3(
            (Math.random() - 0.5) * 4,
            Math.random() * 5 + 2,
            (Math.random() - 0.5) * 4,
          ),
          '#93c5fd',
          0.25 + Math.random() * 0.25,
          0.8,
        );
      }

      // Exit Ripple
      for (let i = 0; i < 18; i++) {
        const angle = (i / 18) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const spawnPos = playerGroup.current.position.clone().addScaledVector(dir, 0.2);
        spawnPos.y = -0.15;
        const rippleVel = dir.clone().multiplyScalar(2.0 + Math.random() * 1.5);
        rippleVel.y = 0.1;

        spawnParticle(
          spawnPos,
          rippleVel,
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

      // Trigger splash on peaks of the side-to-side stroke
      if ((cycle > 0.8 && prevCycle <= 0.8) || (cycle < -0.8 && prevCycle >= -0.8)) {
        const side = cycle > 0 ? 1 : -1;
        const rotY = playerGroup.current.rotation.y;
        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
        const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);

        // Arm splash point (front-side)
        const armPos = playerGroup.current.position
          .clone()
          .addScaledVector(forward, 0.4)
          .addScaledVector(right, side * 0.6);
        armPos.y = -0.15;

        // Leg splash point (back-side)
        const legPos = playerGroup.current.position
          .clone()
          .addScaledVector(forward, -0.6)
          .addScaledVector(right, -side * 0.4);
        legPos.y = -0.15;

        // Spawn multiple small particles for each "hit"
        for (let i = 0; i < 5; i++) {
          const offset = new THREE.Vector3(
            (Math.random() - 0.5) * 0.3,
            0,
            (Math.random() - 0.5) * 0.3,
          );
          spawnParticle(
            armPos.clone().add(offset),
            new THREE.Vector3(
              (Math.random() - 0.5) * 1.5,
              Math.random() * 2 + 1,
              (Math.random() - 0.5) * 1.5,
            ),
            '#93c5fd',
            0.2 + Math.random() * 0.2,
            0.5 + Math.random() * 0.3,
          );
        }

        for (let i = 0; i < 4; i++) {
          const offset = new THREE.Vector3(
            (Math.random() - 0.5) * 0.3,
            0,
            (Math.random() - 0.5) * 0.3,
          );
          spawnParticle(
            legPos.clone().add(offset),
            new THREE.Vector3(
              (Math.random() - 0.5) * 1,
              Math.random() * 1.5 + 0.5,
              (Math.random() - 0.5) * 1,
            ),
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
        const radius = 0.75 + Math.random() * 0.15; // Exterior radius (model is 0.7)
        const h = Math.random() * 3.8; // Full body height

        const offset = new THREE.Vector3(Math.cos(angle) * radius, h, Math.sin(angle) * radius);

        const spawnPos = playerGroup.current.position.clone().add(offset);

        // Outward horizontal velocity + downward flow
        const vel = new THREE.Vector3(
          Math.cos(angle) * 0.8,
          -3 - Math.random() * 3,
          Math.sin(angle) * 0.8,
        );

        spawnParticle(
          spawnPos,
          vel,
          '#38bdf8',
          0.2 + Math.random() * 0.15,
          0.5 + Math.random() * 0.3,
        );
      }
    }

    // 6. Tired Breath (Fumacinha) - Driven by prop Ref
    if (isTiredBreathingRef?.current) {
      const breathCycle = Math.sin(state.clock.getElapsedTime() * 8.0);

      // Trigger puff on rising edge
      if (breathCycle > 0.8 && lastBreathCycle.current <= 0.8) {
        const rotY = playerGroup.current.rotation.y;
        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
        // Mouth is roughly at y=2.9, forward 0.85 (model radius 0.7)
        const mouthOffset = new THREE.Vector3(0, 2.9, 0).addScaledVector(forward, 0.85);
        const spawnPos = playerGroup.current.position.clone().add(mouthOffset);

        spawnParticle(
          spawnPos,
          forward
            .clone()
            .multiplyScalar(0.8)
            .add(new THREE.Vector3(0, 0.4, 0)),
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
    let idx = 0;
    particles.current.forEach((p) => {
      if (p.active) {
        p.life -= delta;
        p.vel.y -= 8.0 * delta; // Gravity
        p.pos.addScaledVector(p.vel, delta);

        if (p.life <= 0 || p.pos.y < -2) {
          p.active = false;
          dummy.scale.set(0, 0, 0);
        } else {
          const s = p.scale * (p.life / 0.5);
          dummy.position.copy(p.pos);
          dummy.scale.set(s, s, s);
          dummy.rotation.set(Math.random(), Math.random(), Math.random());
          meshRef.current.setColorAt(idx, p.color);
        }
      } else {
        dummy.scale.set(0, 0, 0);
      }
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(idx, dummy.matrix);
      idx++;
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, maxParticles]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial transparent opacity={0.8} />
    </instancedMesh>
  );
};

export const MatchTimerOverlay: React.FC = () => {
  const { timer } = useContext(MatchContext);
  return <>{timer}</>;
};

export const Character: React.FC<CharacterProps> = ({
  groupRef,
  staminaFillRef,
  staminaGroupRef,
  overlayContent,
  visualStateRef,
  stunned: _stunned = false,
  isCharging: _isCharging = false,
  isRolling: _isRolling = false,
  isStumbling: _isStumbling = false,
  isRunning: _isRunning = false,
  isMoving: _isMoving = false,
  moveSpeed: _moveSpeed = 0,
  isGrounded: _isGrounded = true,
  landingFactor: _landingFactor = 0,
  stunTimerRef,
  rollTimerRef,
  isHiding: _isHiding = false,
  staminaRef,
  currentSurface: _currentSurface = 0,
  fallDistance: _fallDistance = 0,
  justLanded: _justLanded = false,
  isClimbing: _isClimbing = false,
  isLadderSliding: _isLadderSliding = false,
  isNearLadder: _isNearLadder = false,
  isLadderHanging: _isLadderHanging = false,
  isLadderMounting: _isLadderMounting = false,
  ladderFaceAngle: _ladderFaceAngle = 0,
  isWallClimbing: _isWallClimbing = false,
  wallClimbProgress: _wallClimbProgress = 0,
  waterExitTimerRef,
  color = '#1f91db', // Default character color (blue)
}) => {
  const stunIndicatorRef = useRef<HTMLDivElement>(null!);
  const bodyColorNormal = new THREE.Color(color).clone().multiplyScalar(0.8).getStyle();
  const headColor = color;
  const bodyColor = bodyColorNormal;

  // Internal refs for animation parts
  const modelGroup = useRef<THREE.Group>(null!);
  const headMesh = useRef<THREE.Mesh>(null!);
  const bodyMesh = useRef<THREE.Mesh>(null!);
  const eyesMesh = useRef<THREE.Group>(null!);

  // Animation State Refs
  const idleTimer = useRef(0);
  const walkPhase = useRef(0);
  const baseYRef = useRef(0);
  const baseRotX = useRef(0);
  const baseRotZ = useRef(0);
  const baseRotYModel = useRef(0);
  const idleState = useRef(0);
  const idleTargetRotY = useRef(0);

  // Roll Recovery Animation
  const wasRolling = useRef(false);
  const rollRecoveryTimer = useRef(0);
  const ROLL_RECOVERY_DURATION = 0.35;

  // Tired Breath State
  const tiredBreathCount = useRef(0);
  const isTiredBreathing = useRef(false);
  const lastBreathCycle = useRef(0);

  // Water Exit Animation State
  const wasInWaterAnim = useRef(false);
  const waterExitTimer = useRef(0);

  // Eye Blink State
  const blinkTimer = useRef(0);
  const nextBlinkTime = useRef(2 + Math.random() * 4);
  const blinkPhase = useRef(0); // 0 = open, 1 = closing, 2 = opening

  // Stun bounce
  const stunLandBounce = useRef(0);
  const wasStunned = useRef(false);

  // Charge anticipation
  const chargeTimer = useRef(0);
  const wasCharging = useRef(false);

  // Head independent animation
  const headRotX = useRef(0);
  const headScaleY = useRef(1);

  // Wall Climb Animation State
  const wallClimbPhase = useRef(0);
  const wallClimbAnimTime = useRef(0);
  const wasWallClimbing = useRef(false);
  const wallClimbRecoveryTimer = useRef(0);

  useFrame((state, delta) => {
    try {
      const vs = visualStateRef?.current || {};
    const stunned = vs.stunned ?? _stunned;
    const isCharging = vs.isCharging ?? _isCharging;
    const isRolling = vs.isRolling ?? _isRolling;
    const isStumbling = vs.isStumbling ?? _isStumbling;
    const isRunning = vs.isRunning ?? _isRunning;
    const isMoving = vs.isMoving ?? _isMoving;
    const moveSpeed = vs.moveSpeed ?? _moveSpeed;
    const isGrounded = vs.isGrounded ?? _isGrounded;
    const landingFactor = vs.landingFactor ?? _landingFactor;
    const isHiding = vs.isHiding ?? _isHiding;
    const currentSurface = vs.currentSurface ?? _currentSurface;
    const fallDistance = vs.fallDistance ?? _fallDistance;
    const isClimbing = vs.isClimbing ?? _isClimbing;
    const isLadderSliding = vs.isLadderSliding ?? _isLadderSliding;
    const isNearLadder = vs.isNearLadder ?? _isNearLadder;
    const isLadderHanging = vs.isLadderHanging ?? _isLadderHanging;
    const isLadderMounting = vs.isLadderMounting ?? _isLadderMounting;
    const ladderFaceAngle = vs.ladderFaceAngle ?? _ladderFaceAngle;
    const isWallClimbing = vs.isWallClimbing ?? _isWallClimbing;
    const wallClimbProgress = vs.wallClimbProgress ?? _wallClimbProgress;

    const stunTimeLeft = stunTimerRef?.current || 0;
    const time = state.clock.getElapsedTime();

    // ANIMATION PHASES
    const GET_UP_DURATION = 0.7;
    const isGettingUp =
      stunned && !isStumbling && stunTimeLeft <= GET_UP_DURATION && stunTimeLeft > 0;
    const isLyingDownAnim = stunned && !isStumbling && stunTimeLeft > GET_UP_DURATION;

    // --- EYE BLINK LOGIC ---
    let eyeBlinkScale = 1.0;
    blinkTimer.current += delta;
    if (blinkPhase.current === 0) {
      // Waiting to blink
      if (blinkTimer.current >= nextBlinkTime.current) {
        blinkPhase.current = 1;
        blinkTimer.current = 0;
      }
    } else if (blinkPhase.current === 1) {
      // Closing (0.06s)
      const p = Math.min(blinkTimer.current / 0.06, 1);
      eyeBlinkScale = 1.0 - p * 0.9; // close to 0.1
      if (p >= 1) {
        blinkPhase.current = 2;
        blinkTimer.current = 0;
      }
    } else if (blinkPhase.current === 2) {
      // Opening (0.08s)
      const p = Math.min(blinkTimer.current / 0.08, 1);
      eyeBlinkScale = 0.1 + p * 0.9;
      if (p >= 1) {
        blinkPhase.current = 0;
        blinkTimer.current = 0;
        nextBlinkTime.current = 2 + Math.random() * 5; // 2-7s between blinks
      }
    }

    // --- IDLE ANIMATION LOGIC ---
    let headRotYTarget = 0;
    let bodyRotZ = 0;
    let breathingScale = 1.0;
    let heavyBreathingRotX = 0;
    let targetHeadRotX = 0;
    let idleBobY = 0;

    if (
      isGrounded &&
      !isMoving &&
      !isRunning &&
      !stunned &&
      !isRolling &&
      !isStumbling &&
      !isCharging &&
      !isHiding &&
      !isClimbing &&
      !isLadderSliding &&
      !isNearLadder
    ) {
      idleTimer.current += delta;

      const currentStamina = staminaRef?.current ?? 100;
      const isLowStamina = currentStamina < 30;

      // Tired Breath State Logic
      if (isLowStamina && !isTiredBreathing.current) {
        isTiredBreathing.current = true;
        tiredBreathCount.current = 0;
      }

      if (isTiredBreathing.current) {
        const breathCycle = Math.sin(time * 8.0);
        if (breathCycle > 0.8 && lastBreathCycle.current <= 0.8) {
          tiredBreathCount.current++;
        }
        lastBreathCycle.current = breathCycle;

        if (!isLowStamina && tiredBreathCount.current >= 3) {
          isTiredBreathing.current = false;
        }
      } else {
        lastBreathCycle.current = 0;
      }

      // Breathing Animation
      const breathSpeed = isTiredBreathing.current ? 8.0 : 2.5;
      const breathAmp = isTiredBreathing.current ? 0.06 : 0.02;

      breathingScale = 1.0 + Math.sin(time * breathSpeed) * breathAmp;

      if (isTiredBreathing.current) {
        heavyBreathingRotX = Math.sin(time * breathSpeed) * 0.15 + 0.1;
      }

      // Micro-bounce: subtle alive-feeling vertical rhythm
      idleBobY = Math.sin(time * 2.2) * 0.025 + Math.sin(time * 3.7) * 0.012;

      // Subtle body sway (organic drift)
      bodyRotZ = Math.sin(time * 0.8) * 0.008 + Math.sin(time * 1.3 + 2.0) * 0.005;

      // State Machine with more variety
      if (idleState.current === 0) {
        // Breathing/Resting
        if (idleTimer.current > 0.5 + Math.random() * 1.5) {
          if (!isTiredBreathing.current) {
            const roll = Math.random();
            if (roll < 0.35)
              idleState.current = 1; // Look around
            else if (roll < 0.65)
              idleState.current = 2; // Shift weight
            else idleState.current = 3; // Stretch
            idleTimer.current = 0;
            if (idleState.current === 1) idleTargetRotY.current = (Math.random() - 0.5) * 1.2;
          }
        }
      } else if (idleState.current === 1) {
        // Look Around
        // Smooth easeInOut for head turn
        const tp = Math.min(idleTimer.current / 0.6, 1);
        const eased = tp < 0.5 ? 2 * tp * tp : 1 - Math.pow(-2 * tp + 2, 2) / 2;
        const returnPhase = Math.max(0, (idleTimer.current - 0.8) / 0.5);
        const returnEased = returnPhase < 1 ? returnPhase * returnPhase : 1;
        const lookAmount = eased * (1 - returnEased);
        headRotYTarget = idleTargetRotY.current * lookAmount;
        // Subtle head tilt matching the look direction
        targetHeadRotX = Math.sin(lookAmount * Math.PI * 0.5) * 0.05;
        if (idleTimer.current > 1.6) {
          idleState.current = 0;
          idleTimer.current = 0;
        }
      } else if (idleState.current === 2) {
        // Shift Weight
        const tp = Math.min(idleTimer.current / 0.5, 1);
        const eased = Math.sin(tp * Math.PI);
        bodyRotZ += eased * 0.06 * (Math.random() > 0.5 ? 1 : -1);
        if (idleTimer.current > 1.2) {
          idleState.current = 0;
          idleTimer.current = 0;
        }
      } else if (idleState.current === 3) {
        // Stretch (new!)
        const tp = Math.min(idleTimer.current / 0.4, 1);
        const stretchUp = Math.sin(tp * Math.PI);
        idleBobY += stretchUp * 0.12;
        // Lean back slightly during stretch
        targetHeadRotX = -stretchUp * 0.08;
        bodyRotZ += Math.sin(tp * Math.PI * 2) * 0.02;
        if (idleTimer.current > 1.0) {
          idleState.current = 0;
          idleTimer.current = 0;
        }
      }
    } else {
      idleTimer.current = 0;
      idleState.current = 0;
    }

    // --- WATER EXIT ANIMATION ---
    const inWaterNow = currentSurface === 1 && isGrounded;
    if (wasInWaterAnim.current && !inWaterNow) {
      waterExitTimer.current = 3.0; // Consistência com o efeito visual de 3s
      if (waterExitTimerRef) waterExitTimerRef.current = 3.0;
    }
    wasInWaterAnim.current = inWaterNow;

    if (waterExitTimer.current > 0) {
      waterExitTimer.current -= delta;
      if (waterExitTimerRef) waterExitTimerRef.current = waterExitTimer.current;
    }

    // --- SQUASH / CROUCH LOGIC ---
    // Charging: progressive squash with anticipation
    let chargeCrouch = 0;
    if (isCharging) {
      chargeTimer.current += delta;
      wasCharging.current = true;
      // Progressive squash (ramps up over 0.15s)
      const ramp = Math.min(chargeTimer.current / 0.15, 1);
      const eased = ramp * ramp; // quadratic ease in
      chargeCrouch = 0.35 * eased + 0.1; // 0.1 → 0.45 progressively
      // Anticipation vibration (increases with charge time)
      const vibAmp = 0.012 * Math.min(chargeTimer.current / 0.1, 1);
      chargeCrouch += Math.sin(time * 45) * vibAmp;
    } else {
      if (wasCharging.current) {
        chargeTimer.current = 0;
        wasCharging.current = false;
      }
    }
    const baseCrouch = chargeCrouch;
    let moveSquash = 0;

    // Improved Landing: damped multi-bounce oscillation
    const heavyLanding = fallDistance > 2.0;
    const landingIntensity = heavyLanding ? 0.7 : 0.3;
    let landingSquash = 0;
    if (landingFactor > 0) {
      // Damped bounce: multiple oscillations that decay
      const bounceFreq = 3.0; // number of bounces
      // Wait, landingFactor goes from 1 at land to 0. So invert for decay.
      const elapsed = 1 - landingFactor; // 0 at land → 1 at end
      const dampedBounce =
        Math.abs(Math.sin(elapsed * Math.PI * bounceFreq)) * Math.exp(-elapsed * 4);
      landingSquash = dampedBounce * landingIntensity;
    }

    // Initialize animation targets
    let targetRotY = 0;
    let bobY = idleBobY;
    let targetRotX = heavyBreathingRotX;
    let targetRotZ = bodyRotZ;
    let targetZOffset = 0;
    let targetPivotY = 0;
    let rotLerpSpeed = delta * 15;
    let headBobLag = 0; // head independent vertical lag

    // --- MOVEMENT ANIMATION ---
    if (isMoving && isGrounded && !stunned && !isRolling) {
      const speedFact = Math.min(moveSpeed / 6, 1.5);
      const inWater = currentSurface === 1;

      if (inWater) {
        // --- SWIMMING ANIMATION (Enhanced) ---
        const swimFreq = 9;
        walkPhase.current += delta * swimFreq * speedFact;
        const t = walkPhase.current;

        // Body tilts forward more expressively
        targetRotX = 0.55 * speedFact;

        // Enhanced stroke rhythm: asymmetric wave (fast pull, slow glide)
        const strokeCycle = Math.sin(t) + 0.3 * Math.sin(t * 2);
        targetRotZ = strokeCycle * 0.08;

        // Subtle undulating vertical bob (wave-like)
        bobY += Math.sin(t * 0.5) * 0.06 + Math.sin(t * 1.1) * 0.03;

        // More pronounced yaw wiggle with asymmetry
        targetRotY = Math.sin(t) * 0.05 + Math.sin(t * 2.2) * 0.015;
        headRotYTarget = -targetRotY * 1.3;

        // Head counter-tilt (rolls opposite to body)
        targetHeadRotX = -0.15 * speedFact;
      } else {
        // --- GROUND WALK/RUN ANIMATION (Enhanced) ---
        const freq = isRunning ? 16 : 10;
        walkPhase.current += delta * freq * speedFact;
        const t = walkPhase.current;

        // 1. Vertical hop with anticipation dip
        const rawDip = Math.pow(Math.abs(Math.cos(t)), 3);
        const anticipationDip = Math.pow(Math.abs(Math.sin(t)), 5) * (isRunning ? 0.08 : 0.04);
        bobY = (1 - rawDip) * (isRunning ? 0.45 : 0.35) - anticipationDip;

        // 2. Landing squash (more pronounced when running)
        moveSquash = rawDip * (isRunning ? 0.07 : 0.04);

        // 3. Waddle sway (more exaggerated when running)
        targetRotZ = Math.sin(t) * (isRunning ? 0.16 : 0.12);

        // 4. Side shift for weight transfer (wider for run)
        const sideShift = Math.sin(t) * (isRunning ? 0.16 : 0.1);
        if (modelGroup.current) {
          modelGroup.current.position.x = THREE.MathUtils.lerp(
            modelGroup.current.position.x,
            sideShift,
            delta * 18,
          );
        }

        // 5. Forward lean (running leans more)
        targetRotX = (isRunning ? 0.18 : 0.05) * speedFact;

        // 6. Horizontal wiggle
        targetRotY = Math.sin(t) * (isRunning ? 0.1 : 0.07);

        // 7. Head counter-sway (more independent)
        headRotYTarget = -targetRotY * 1.4;

        // 8. Head vertical lag (head bounces less than body)
        headBobLag = bobY * 0.2; // head absorbs 20% of the bob

        // 9. Body Z-stretch when running (elongated in movement direction)
        if (isRunning) {
          targetZOffset = 0.08 * speedFact; // subtle forward shift
        }
      }

      rotLerpSpeed = delta * 22;
    } else if (
      isGrounded &&
      isNearLadder &&
      !isMoving &&
      !isClimbing &&
      !isLadderSliding &&
      !isLadderHanging &&
      !isLadderMounting
    ) {
      // --- NEAR LADDER: STAND STILL AND LOOK AT LADDER ---
      const time = state.clock.getElapsedTime();
      idleTimer.current += delta;

      // Breathing while looking up
      idleBobY = Math.sin(time * 2) * 0.05;

      // Look at the ladder (conditional: look down if on roof, slightly up if on ground)
      const isOnRoof = groupRef.current && groupRef.current.position.y > 3.0;
      if (isOnRoof) {
        targetHeadRotX = 0.45; // Looking down
      } else {
        targetHeadRotX = -0.18; // Slightly upward towards top
      }

      // Calculate relative angle to look at the ladder
      if (groupRef.current) {
        const currentBodyRotY = groupRef.current.rotation.y % (Math.PI * 2);

        // On roof, we need to look in the opposite direction of faceAngle (faceAngle points INTO the wall)
        let targetAngle = ladderFaceAngle;
        if (isOnRoof) {
          targetAngle += Math.PI;
        }

        // Calculate relative angle to look at the ladder (Target - Current)
        let diff = targetAngle - currentBodyRotY;

        // Normalize angle
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        // Permitir rotação mais ampla para olhar para a escada
        headRotYTarget = THREE.MathUtils.clamp(diff, -1.8, 1.8);
      }

      rotLerpSpeed = delta * 12;
    } else if (isLadderSliding) {
      // --- LADDER SLIDE DOWN ANIMATION ---
      // Straight rigid slide, facing the wall, subtle vibration from friction
      const slideTime = state.clock.getElapsedTime();

      // Corpo fica reto na descida
      targetRotX = 0;

      // Subtle vibration from friction against ladder rails
      const vibFreq = 25;
      const vibAmp = 0.015;
      targetRotZ = Math.sin(slideTime * vibFreq) * vibAmp;
      targetRotY = Math.sin(slideTime * vibFreq * 0.7) * vibAmp * 0.5;

      // Sem encolher (esticado)
      moveSquash = -0.02;

      // Afastar um pouco da parede para não fundir a cabeça
      targetZOffset = -0.25;

      // Head looks down during descent (increased for better visibility)
      targetHeadRotX = 0.5;

      // No bob — straight slide
      bobY = 0;

      rotLerpSpeed = delta * 20;
    } else if (isClimbing && !isGrounded) {
      // --- CLIMBING ANIMATION (Upward/Hanging) ---
      const freq = 14;
      // Only advance the climb animation if actually moving (not just hanging)
      if (!isLadderHanging) {
        walkPhase.current += delta * freq;
      }
      const t = walkPhase.current;

      // Asymmetric pull-up: sharp up, smooth settle
      const pullCycle = Math.sin(t);
      const sharpPull = pullCycle > 0 ? Math.pow(pullCycle, 0.6) : -Math.pow(-pullCycle, 2);

      // Wiggle with asymmetric weight shift
      targetRotZ = sharpPull * 0.18;

      // Body straight, not leaning back
      targetRotX = 0;

      // Stretched and elongated, less squash on pull
      moveSquash = -0.05;

      // Pull away from wall for head room
      targetZOffset = -0.3;

      // Vertical bob with sharp pull up
      const pullBob = pullCycle > 0 ? pullCycle * 0.15 : pullCycle * 0.05;
      bobY = pullBob;

      if (isLadderMounting) {
        // MOUNTING TRANSITION — Enhanced with multi-phase animation
        const mountTime = state.clock.getElapsedTime();

        // Phase 1: Lean and reach over the edge
        targetRotX = -0.55; // Deep forward lean over the ledge
        targetHeadRotX = 0.6; // Look down at the ladder

        // Progressive committed weight shift
        moveSquash = 0.25;
        targetRotZ = Math.sin(mountTime * 12) * 0.04; // Effort wobble

        // Move body over the edge
        targetZOffset = 0.3;

        // Dip down as weight transfers
        bobY = -0.25;

        // Urgency twitch
        headRotYTarget = Math.sin(mountTime * 15) * 0.03;
      } else if (isLadderHanging) {
        idleTimer.current += delta;
        const time = state.clock.getElapsedTime();

        // Randomly trigger looking around
        if (idleTimer.current > 1.5 + Math.random() * 2.0) {
          const roll = Math.random();
          if (roll < 0.5)
            idleState.current = 1; // Look around
          else idleState.current = 0; // Just hang and look up
          idleTimer.current = 0;
          if (idleState.current === 1) idleTargetRotY.current = (Math.random() - 0.5) * 1.8;
        }

        if (idleState.current === 1) {
          // Eased look around animation
          const tp = Math.min(idleTimer.current / 0.8, 1);
          const eased = tp < 0.5 ? 2 * tp * tp : 1 - Math.pow(-2 * tp + 2, 2) / 2;
          const returnPhase = Math.max(0, (idleTimer.current - 1.5) / 0.8);
          const returnEased = returnPhase < 1 ? returnPhase * returnPhase : 1;
          const lookAmount = eased * (1 - returnEased);

          headRotYTarget = idleTargetRotY.current * lookAmount;
          // Lower head while looking around
          targetHeadRotX = -0.5 + lookAmount * 0.6;
        } else {
          targetHeadRotX = -0.5; // Look up intensely
          headRotYTarget = 0;
        }

        // Subtle breathing and sway while hanging
        bobY += Math.sin(time * 2.5) * 0.02;
        targetRotZ += Math.sin(time * 0.5) * 0.01;
      } else {
        // Moving on ladder: look up intensely
        targetHeadRotX = -0.5;
        headRotYTarget = 0;
      }

      rotLerpSpeed = delta * 20;
    } else if (isWallClimbing && !isGrounded) {
      // --- WALL CLIMB / MANTLE ANIMATION ---
      // Multi-phase: reach up → pull / scramble → heave over
      wallClimbAnimTime.current += delta;
      wasWallClimbing.current = true;
      const t = wallClimbAnimTime.current;
      const progress = wallClimbProgress;

      // Phase 1: REACH (0-30%) — arms up, lean into wall, stretched tall
      if (progress < 0.3) {
        const phaseP = progress / 0.3;
        const eased = Math.sin(phaseP * Math.PI * 0.5); // ease-out

        // Lean into the wall aggressively
        targetRotX = 0.35 * eased;
        // Arms reaching up — indicated by stretching tall
        moveSquash = -0.15 * eased; // negative = stretch
        // Head looks up at the ledge
        targetHeadRotX = -0.4 * eased;
        // Slight urgency wobble
        targetRotZ = Math.sin(t * 18) * 0.03 * eased;
        // Bob up as reaching
        bobY = 0.1 * eased;
      }
      // Phase 2: PULL (30-70%) — heaving body up, scrambling against wall
      else if (progress < 0.7) {
        const phaseP = (progress - 0.3) / 0.4;
        const pullEased = Math.sin(phaseP * Math.PI); // bell curve

        // Sharp alternating pull motions
        const scrambCycle = Math.sin(t * 22);
        targetRotZ = scrambCycle * 0.22 * (1 - phaseP * 0.5);

        // Body tilts forward as pulling over edge
        targetRotX = 0.35 - phaseP * 0.55;

        // Squash/stretch with each pull
        moveSquash = -0.1 + pullEased * 0.2;

        // Violent effort bob
        bobY = 0.15 + Math.sin(t * 16) * 0.08 * (1 - phaseP);

        // Head alternates looking up and at wall
        targetHeadRotX = -0.3 + scrambCycle * 0.15;

        // Slight forward surge
        targetZOffset = 0.15 * pullEased;
      }
      // Phase 3: HEAVE OVER (70-100%) — body crests the ledge
      else {
        const phaseP = (progress - 0.7) / 0.3;
        const eased = 1 - Math.pow(1 - phaseP, 2); // ease-out

        // Body pivots over the ledge
        targetRotX = -0.2 + eased * 0.3;
        targetPivotY = 0.3 * (1 - eased);

        // Final stretch
        moveSquash = 0.1 * (1 - eased);

        // Head looks forward/down as cresting
        targetHeadRotX = 0.15 * eased;

        // Settle wobble
        targetRotZ = Math.sin(t * 8) * 0.04 * (1 - eased);

        bobY = 0.1 * (1 - eased);
        targetZOffset = 0.15 * (1 - eased);
      }

      rotLerpSpeed = delta * 25;
    } else {
      // Reset wall climbing animation when not climbing
      if (wasWallClimbing.current) {
        wasWallClimbing.current = false;
        wallClimbRecoveryTimer.current = 0.25;
        wallClimbAnimTime.current = 0;
        wallClimbPhase.current = 0;
      }
      if (modelGroup.current) {
        modelGroup.current.position.x = THREE.MathUtils.lerp(
          modelGroup.current.position.x,
          0,
          delta * 12,
        );
      }
      walkPhase.current = THREE.MathUtils.lerp(walkPhase.current, 0, delta * 6);
    }

    // --- WATER EXIT SHAKE-OFF OVERLAY (Enhanced) ---
    if (waterExitTimer.current > 0 && !stunned && !isRolling) {
      const WATER_EXIT_DURATION = 3.0;
      const progress = 1.0 - waterExitTimer.current / WATER_EXIT_DURATION;

      // Phase 1: Rapid dog-shake (0-60%)
      if (progress < 0.6) {
        const shakeP = progress / 0.6;
        const shakeDecay = Math.pow(1.0 - shakeP, 1.5);
        const shakeFreq = 22; // faster shake
        const shakeAmp = 0.18 * shakeDecay;

        targetRotZ += Math.sin(shakeP * shakeFreq) * shakeAmp;
        targetRotY += Math.sin(shakeP * shakeFreq * 1.3) * shakeAmp * 0.4;

        // Head shakes faster and wider than body
        headRotYTarget += Math.sin(shakeP * shakeFreq * 1.6) * shakeAmp * 0.8;

        // Squash/stretch during shake
        moveSquash += Math.abs(Math.sin(shakeP * shakeFreq)) * 0.04 * shakeDecay;
      }

      // Phase 2: Settle with body rise (60-100%)
      if (progress >= 0.5 && progress < 0.85) {
        const riseP = (progress - 0.5) / 0.35;
        bobY += Math.sin(riseP * Math.PI) * 0.2;
      }

      // Phase 3: Final gentle wobble
      if (progress >= 0.7) {
        const settleP = (progress - 0.7) / 0.3;
        const settleDecay = 1 - settleP;
        targetRotZ += Math.sin(settleP * 8) * 0.03 * settleDecay;
      }
    }

    // Combine Squash components
    let totalSquash = baseCrouch + landingSquash + moveSquash;

    if (isStumbling) {
      totalSquash = 0.4;
    } else if (isLyingDownAnim) {
      // Bounce on impact when first lying down
      if (!wasStunned.current) {
        stunLandBounce.current = 1.0;
        wasStunned.current = true;
      }
      if (stunLandBounce.current > 0) {
        stunLandBounce.current = Math.max(0, stunLandBounce.current - delta * 3);
        const bounceP = stunLandBounce.current;
        totalSquash = 0.4 + Math.abs(Math.sin(bounceP * Math.PI * 2.5)) * 0.15 * bounceP;
      } else {
        totalSquash = 0.4;
      }
    } else if (isGettingUp) {
      // Effortful get-up with overshoot
      const progress = 1 - stunTimeLeft / GET_UP_DURATION;
      // Overshoot curve: goes past target then settles
      const overshoot = Math.sin(progress * Math.PI) + Math.sin(progress * Math.PI * 2) * 0.15;
      totalSquash = overshoot * 0.45;
    } else if (isRolling) {
      const timer = rollTimerRef?.current || 0;
      const duration = 0.6;
      const p = THREE.MathUtils.clamp(1 - timer / duration, 0, 1);
      const bellCurve = Math.sin(p * Math.PI);
      totalSquash = 0.15 + bellCurve * 0.35;
    } else if (isHiding) {
      // Hiding: deep crouch with slow nervous breathing and tremble
      const hideBreath = Math.sin(time * 1.8) * 0.015; // slow, subtle breathing
      const tremble = Math.sin(time * 18) * 0.008 + Math.sin(time * 23) * 0.005; // nervous tremble
      totalSquash = 0.6 + hideBreath + tremble;
    } else if (isClimbing) {
      totalSquash = 0.25 + moveSquash;
    } else if (isLadderSliding) {
      totalSquash = 0.12 + moveSquash;
    } else if (isWallClimbing) {
      // Wall climbing uses moveSquash set by the wall climb animation phases
      totalSquash = moveSquash;
    }

    // Reset stun tracking
    if (!stunned) {
      wasStunned.current = false;
      stunLandBounce.current = 0;
    }

    const BODY_HEIGHT = 2.4;
    const HEAD_SIZE = 1.6;

    const targetScaleY = (1.0 - totalSquash) * breathingScale;
    const targetScaleXZ = 1.0 + totalSquash * 0.5;

    const standardBodyY = BODY_HEIGHT / 2 - totalSquash * 0.5;
    const standardHeadY = BODY_HEIGHT + HEAD_SIZE / 2 - totalSquash * 1.5;

    // --- ROTATION & PIVOT LOGIC ---
    let applyRoll = false;

    // Roll Recovery (elastic bounce after roll ends)
    if (wasRolling.current && !isRolling) {
      rollRecoveryTimer.current = ROLL_RECOVERY_DURATION;
      wasRolling.current = false;
    }
    if (isRolling) {
      wasRolling.current = true;
    }
    if (rollRecoveryTimer.current > 0) {
      rollRecoveryTimer.current -= delta;
      if (rollRecoveryTimer.current < 0) rollRecoveryTimer.current = 0;
    }

    if (stunned) {
      if (isStumbling) {
        targetRotX = Math.PI / 4;
        // Side-to-side stumble sway
        targetRotZ += Math.sin(time * 12) * 0.15;
        targetPivotY = 0;
        rotLerpSpeed = delta * 15;
      } else if (isLyingDownAnim) {
        targetRotX = Math.PI / 2;
        targetPivotY = 0.1;
        targetZOffset = -0.6; // Pull back to avoid clipping into walls
        // Subtle breathing while lying down
        targetRotZ += Math.sin(time * 2) * 0.02;
        rotLerpSpeed = delta * 10;
        // Head droops forward
        targetHeadRotX = 0.2;
      } else if (isGettingUp) {
        // Effortful get-up: slight overshoot past vertical
        const progress = 1 - stunTimeLeft / GET_UP_DURATION;
        const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
        // Overshoot: go slightly past 0 then come back
        const overshootAngle = eased > 0.8 ? Math.sin(((eased - 0.8) / 0.2) * Math.PI) * -0.08 : 0;
        targetRotX = THREE.MathUtils.lerp(Math.PI / 2, 0, eased) + overshootAngle;
        targetPivotY = THREE.MathUtils.lerp(0.1, 0, eased);
        // Wobble during get-up
        targetRotZ += Math.sin(time * 8) * 0.04 * (1 - eased);
        rotLerpSpeed = delta * 5;
      }
    } else if (isRolling) {
      applyRoll = true;
      const timer = rollTimerRef?.current || 0;
      const duration = 0.6;
      const progress = THREE.MathUtils.clamp(1 - timer / duration, 0, 1);

      const eased =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      targetRotX = eased * Math.PI * 2;

      const arcHeight = Math.sin(progress * Math.PI);
      targetPivotY = 0.4 + arcHeight * 0.6;

      targetRotZ += Math.sin(progress * Math.PI * 3) * 0.08;
    } else if (rollRecoveryTimer.current > 0 && !stunned) {
      const rp = 1 - rollRecoveryTimer.current / ROLL_RECOVERY_DURATION;
      const springFreq = 12;
      const damping = Math.exp(-rp * 4);
      const oscillation = Math.sin(rp * springFreq) * damping;
      targetRotX = oscillation * 0.25;
      targetRotZ += oscillation * 0.06;
      bobY += Math.abs(oscillation) * 0.15;
      rotLerpSpeed = delta * 30;
    } else if (wallClimbRecoveryTimer.current > 0 && !stunned && !isWallClimbing) {
      // Wall climb recovery: staggered landing after mantling a ledge
      wallClimbRecoveryTimer.current -= delta;
      if (wallClimbRecoveryTimer.current < 0) wallClimbRecoveryTimer.current = 0;
      const rp = 1 - wallClimbRecoveryTimer.current / 0.25;
      const springFreq = 10;
      const damping = Math.exp(-rp * 5);
      const oscillation = Math.sin(rp * springFreq) * damping;
      // Forward tilt then spring back
      targetRotX = oscillation * 0.18;
      targetRotZ += Math.sin(rp * springFreq * 1.3) * 0.04 * damping;
      bobY += Math.abs(oscillation) * 0.1;
      // Head snaps forward then settles
      targetHeadRotX = oscillation * 0.1;
      rotLerpSpeed = delta * 25;
    } else if (isCharging) {
      // Head looks up in anticipation of jump
      targetHeadRotX = -0.12;
    }

    // Apply Lerps
    const squashLerpSpeed = delta * 20;

    // Floating Animation (Water) - dual-frequency for organic feel
    let floatingY = 0;
    let floatingRotX = 0;
    let floatingRotZ = 0;
    if (currentSurface === 1 && isGrounded && !isMoving && !isRolling && !stunned) {
      // Primary wave + secondary harmonic for natural ocean feel
      floatingY = Math.sin(time * 1.8) * 0.09 + Math.sin(time * 2.9 + 1.5) * 0.04;
      floatingRotZ = Math.sin(time * 1.2) * 0.018 + Math.sin(time * 2.1 + 0.7) * 0.008;
      floatingRotX = Math.sin(time * 1.5 + 1.0) * 0.012 + Math.sin(time * 2.4 + 2.0) * 0.006;
      // Gentle head independent sway while floating
      headRotYTarget += Math.sin(time * 0.7) * 0.04;
    }

    // Apply Container Rotation and Position
    if (modelGroup.current) {
      if (applyRoll) {
        modelGroup.current.rotation.x = targetRotX;
        baseRotX.current = targetRotX;
        baseYRef.current = THREE.MathUtils.lerp(baseYRef.current, targetPivotY, delta * 20);
      } else {
        if (baseRotX.current > Math.PI) baseRotX.current -= Math.PI * 2;
        baseRotX.current = THREE.MathUtils.lerp(baseRotX.current, targetRotX, rotLerpSpeed);
        baseRotZ.current = THREE.MathUtils.lerp(baseRotZ.current, targetRotZ, rotLerpSpeed);
        baseRotYModel.current = THREE.MathUtils.lerp(
          baseRotYModel.current,
          targetRotY,
          rotLerpSpeed,
        );
        modelGroup.current.rotation.x = baseRotX.current + floatingRotX;
        modelGroup.current.rotation.z = baseRotZ.current + floatingRotZ;
        modelGroup.current.rotation.y = baseRotYModel.current;
        baseYRef.current = THREE.MathUtils.lerp(baseYRef.current, targetPivotY, rotLerpSpeed);
      }

      modelGroup.current.position.y = baseYRef.current + bobY + floatingY;
      modelGroup.current.position.z = THREE.MathUtils.lerp(
        modelGroup.current.position.z,
        targetZOffset,
        delta * 15,
      );
    }

    // 2. Update Internal Parts
    const targetHeadLocalY = standardHeadY - targetPivotY;
    const targetBodyLocalY = standardBodyY - targetPivotY;

    if (bodyMesh.current) {
      bodyMesh.current.scale.y = THREE.MathUtils.lerp(
        bodyMesh.current.scale.y,
        targetScaleY,
        squashLerpSpeed,
      );
      bodyMesh.current.scale.x = THREE.MathUtils.lerp(
        bodyMesh.current.scale.x,
        targetScaleXZ,
        squashLerpSpeed,
      );
      bodyMesh.current.scale.z = THREE.MathUtils.lerp(
        bodyMesh.current.scale.z,
        targetScaleXZ,
        squashLerpSpeed,
      );
      bodyMesh.current.position.y = THREE.MathUtils.lerp(
        bodyMesh.current.position.y,
        targetBodyLocalY,
        squashLerpSpeed,
      );
    }
    if (headMesh.current) {
      // Head position with vertical lag compensation
      const headTargetY = targetHeadLocalY - headBobLag;
      headMesh.current.position.y = THREE.MathUtils.lerp(
        headMesh.current.position.y,
        headTargetY,
        squashLerpSpeed,
      );
      // Head independent rotation (Y = look direction, X = tilt)
      headMesh.current.rotation.y = THREE.MathUtils.lerp(
        headMesh.current.rotation.y,
        headRotYTarget,
        delta * 10,
      );
      headRotX.current = THREE.MathUtils.lerp(headRotX.current, targetHeadRotX, delta * 8);
      headMesh.current.rotation.x = headRotX.current;
      // Head squash compensation (stays rounder when body squishes)
      const headSquashComp = 1.0 + totalSquash * 0.12;
      headScaleY.current = THREE.MathUtils.lerp(headScaleY.current, headSquashComp, delta * 15);
      headMesh.current.scale.y = headScaleY.current;
    }
    if (eyesMesh.current) {
      const eyeTargetY = targetHeadLocalY + 0.1 - headBobLag;
      eyesMesh.current.position.y = THREE.MathUtils.lerp(
        eyesMesh.current.position.y,
        eyeTargetY,
        squashLerpSpeed,
      );
      // Sync Eyes Rotation with Head
      eyesMesh.current.rotation.y = THREE.MathUtils.lerp(
        eyesMesh.current.rotation.y,
        headRotYTarget,
        delta * 10,
      );
      eyesMesh.current.rotation.x = headRotX.current;
      // Eye blink: scale Y of the eyes group
      eyesMesh.current.scale.y = THREE.MathUtils.lerp(
        eyesMesh.current.scale.y,
        eyeBlinkScale,
        delta * 40,
      );
    }

    if (headMesh.current) {
      const hMat = headMesh.current.material as THREE.MeshStandardMaterial;
      if (hMat) hMat.color.set(stunned ? '#9ca3af' : color);
    }
    if (bodyMesh.current) {
      const bMat = bodyMesh.current.material as THREE.MeshStandardMaterial;
      if (bMat) bMat.color.set(stunned ? '#4b5563' : bodyColorNormal);
    }
    if (stunIndicatorRef.current) {
      stunIndicatorRef.current.style.display = stunned ? 'block' : 'none';
    }
  } catch (err) {
    console.error('Error in Character useFrame:', err);
  }
  });

  return (
    <>
      <ParticleEffects
        visualStateRef={visualStateRef}
        isRunning={_isRunning}
        isMoving={_isMoving}
        isGrounded={_isGrounded}
        currentSurface={_currentSurface}
        staminaRef={staminaRef}
        playerGroup={groupRef}
        stunned={_stunned}
        fallDistance={_fallDistance}
        justLanded={_justLanded}
        isTiredBreathingRef={isTiredBreathing}
        isRolling={_isRolling}
        moveSpeed={_moveSpeed}
      />
      <group ref={groupRef}>
        {/* UI Elements */}
        {overlayContent && (
          <Html
            position={[0, 5.7, 0]}
            center
            style={{ pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 101 }}
          >
            {overlayContent}
          </Html>
        )}

        {/* Stun Indicator - Show during the entire stun sequence */}
        <Html position={[0, 5.0, 0]} center style={{ pointerEvents: 'none', zIndex: 100 }}>
          <div ref={stunIndicatorRef} style={{ display: 'none' }} className="text-xl animate-spin">
            💫
          </div>
        </Html>

        {/* Stamina Bar */}
        {staminaGroupRef && staminaFillRef && (
          <Html position={[0, 4.4, 0]} center style={{ pointerEvents: 'none', zIndex: 90 }}>
            <div
              ref={staminaGroupRef}
              style={{
                width: '60px',
                height: '8px',
                background: '#1f2937',
                border: '1px solid rgba(0,0,0,0.5)',
                borderRadius: '4px',
                overflow: 'hidden',
                display: 'none',
              }}
            >
              <div
                ref={staminaFillRef}
                style={{
                  width: '100%',
                  height: '100%',
                  background: _stunned ? '#9ca3af' : '#fbbf24',
                  transition: 'width 0.1s linear, background-color 0.2s',
                }}
              />
            </div>
          </Html>
        )}

        <group ref={modelGroup}>
          {/* Head - Slightly smaller width/depth */}
          <mesh ref={headMesh} position={[0, 3.2, 0]} castShadow receiveShadow renderOrder={2}>
            <boxGeometry args={[1.4, 1.6, 1.4]} />
            <meshStandardMaterial color={headColor} />

            {/* X-Ray Silhouette */}
            <mesh renderOrder={1}>
              <boxGeometry args={[1.4, 1.6, 1.4]} />
              <meshBasicMaterial
                color="#00e5ff"
                depthTest={false}
                depthWrite={false}
                transparent={false}
              />
            </mesh>
          </mesh>
          {/* Body - Slightly smaller width/depth */}
          <mesh ref={bodyMesh} position={[0, 1.2, 0]} castShadow receiveShadow renderOrder={2}>
            <boxGeometry args={[1.4, 2.4, 1.4]} />
            <meshStandardMaterial color={bodyColor} />

            {/* X-Ray Silhouette */}
            <mesh renderOrder={1}>
              <boxGeometry args={[1.4, 2.4, 1.4]} />
              <meshBasicMaterial
                color="#00e5ff"
                depthTest={false}
                depthWrite={false}
                transparent={false}
              />
            </mesh>
          </mesh>
          {/* Eyes */}
          <group ref={eyesMesh} position={[0, 3.2, 0]}>
            <mesh
              position={[0.36, 0, 0.72]}
              castShadow={false}
              receiveShadow={false}
              renderOrder={3}
            >
              <boxGeometry args={[0.3, 0.3, 0.1]} />
              <meshStandardMaterial color="white" emissive="black" emissiveIntensity={0} />

              {/* X-Ray Eye */}
              <mesh renderOrder={1.1} castShadow={false} receiveShadow={false}>
                <boxGeometry args={[0.3, 0.3, 0.1]} />
                <meshBasicMaterial
                  color="#ffffff"
                  depthTest={false}
                  depthWrite={false}
                  transparent={false}
                />
              </mesh>
            </mesh>
            <mesh
              position={[-0.36, 0, 0.72]}
              castShadow={false}
              receiveShadow={false}
              renderOrder={3}
            >
              <boxGeometry args={[0.3, 0.3, 0.1]} />
              <meshStandardMaterial color="white" emissive="black" emissiveIntensity={0} />

              {/* X-Ray Eye */}
              <mesh renderOrder={1.1} castShadow={false} receiveShadow={false}>
                <boxGeometry args={[0.3, 0.3, 0.1]} />
                <meshBasicMaterial
                  color="#ffffff"
                  depthTest={false}
                  depthWrite={false}
                  transparent={false}
                />
              </mesh>
            </mesh>
          </group>
        </group>
      </group>
    </>
  );
};
