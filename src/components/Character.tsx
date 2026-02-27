
import React, { useRef } from 'react';
import { Billboard, Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface CharacterProps {
    groupRef: React.RefObject<THREE.Group>;
    staminaFillRef?: React.RefObject<HTMLDivElement>;
    staminaGroupRef?: React.RefObject<HTMLDivElement>;
    overlayContent?: React.ReactNode;
    stunned?: boolean;
    isCharging?: boolean;
    isRolling?: boolean;
    isStumbling?: boolean;
    isClimbing?: boolean;
    isRunning?: boolean;
    isMoving?: boolean;
    moveSpeed?: number; // Added
    isGrounded?: boolean; // Added Prop
    landingFactor?: number;
    stepUpFactor?: number; // 0 to 1
    stunTimerRef?: React.MutableRefObject<number>;
    rollTimerRef?: React.MutableRefObject<number>;
    isHiding?: boolean;
    staminaRef?: React.MutableRefObject<number>;
    currentSurface?: number;
    fallDistance?: number;
    justLanded?: boolean;
}

const ParticleEffects: React.FC<{
    isRunning: boolean;
    isMoving: boolean;
    isGrounded: boolean;
    currentSurface: number;
    staminaRef?: React.MutableRefObject<number>;
    landingFactor: number;
    playerGroup: React.RefObject<THREE.Group>;
    stunned: boolean;
    fallDistance: number;
    justLanded: boolean;
    isTiredBreathingRef?: React.MutableRefObject<boolean>; // Changed to Ref
}> = ({ isRunning, isMoving, isGrounded, currentSurface, staminaRef, landingFactor, playerGroup, stunned, fallDistance, justLanded, isTiredBreathingRef }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null!);
    const particles = useRef<{ pos: THREE.Vector3; vel: THREE.Vector3; life: number; color: THREE.Color; scale: number; active: boolean }[]>([]);
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
            active: false
        }));
    }, []);

    const spawnParticle = (pos: THREE.Vector3, vel: THREE.Vector3, color: string, scale: number, life: number) => {
        const p = particles.current.find(p => !p.active);
        if (p) {
            p.active = true;
            p.pos.copy(pos);
            p.vel.copy(vel);
            p.life = life;
            p.color.set(color);
            p.scale = scale;
        }
    };

    const prevLanding = useRef(0);
    const wasInWater = useRef(false);
    const wetTimer = useRef(0);
    const lastBreathCycle = useRef(0); // Only keep cycle tracker

    useFrame((state, delta) => {
        if (!meshRef.current || !playerGroup.current) return;

        // SPAWN LOGIC

        // 1. Running Particles
        if (isRunning && isGrounded && Math.random() < 0.3) {
            const offset = new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
            const spawnPos = playerGroup.current.position.clone().add(offset);

            let color = '#a8a29e';
            if (currentSurface === 0) color = '#4ade80';
            else if (currentSurface === 1) color = '#60a5fa';
            else if (currentSurface === 3) color = '#d6d3d1';

            spawnParticle(
                spawnPos,
                new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2 + 0.5, (Math.random() - 0.5) * 2),
                color,
                0.1 + Math.random() * 0.1,
                0.5 + Math.random() * 0.5
            );
        }

        // 2. Sweat Particles
        if (staminaRef && staminaRef.current < 25 && Math.random() < 0.1) {
            const headOffset = new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.8, (Math.random() - 0.5) * 0.6);
            const spawnPos = playerGroup.current.position.clone().add(headOffset);
            spawnParticle(
                spawnPos,
                new THREE.Vector3(0, -3, 0),
                '#38bdf8',
                0.4, // Increased from 0.25
                0.5
            );
        }

        // 3. Landing Particles
        if (justLanded) {
            if (fallDistance > 1.5) {
                let count = currentSurface === 1 ? 15 : 12;
                let scaleBase = 0.25; // Increased from 0.1
                let spread = 0.8;
                let color = '#a8a29e';

                if (currentSurface === 0) color = '#4ade80';
                else if (currentSurface === 1) color = '#60a5fa';
                else if (currentSurface === 3) color = '#d6d3d1';

                if (stunned) {
                    count = 30;
                    scaleBase = 0.45; // Increased from 0.25
                    spread = 1.2;
                    color = '#78716c';
                }

                for (let i = 0; i < count; i++) {
                    const offset = new THREE.Vector3((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread);
                    const spawnPos = playerGroup.current.position.clone().add(offset);

                    spawnParticle(
                        spawnPos,
                        new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3),
                        color,
                        scaleBase + Math.random() * 0.15,
                        0.6
                    );
                }
            }
        }
        prevLanding.current = landingFactor;

        // 4. Water Splash & Dripping
        const playerY = playerGroup.current.position.y;
        const isOverWater = currentSurface === 1;
        const isInWater = isOverWater && playerY < -0.5;

        if (isInWater && !wasInWater.current) {
            for (let i = 0; i < 30; i++) {
                const offset = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2);
                const spawnPos = playerGroup.current.position.clone().add(offset);
                spawnPos.y = -0.5;

                spawnParticle(
                    spawnPos,
                    new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 4 + 2, (Math.random() - 0.5) * 3),
                    '#60a5fa',
                    0.2 + Math.random() * 0.2,
                    0.8
                );
            }
        }

        if (wasInWater.current && !isInWater) {
            wetTimer.current = 2.0;
        }
        wasInWater.current = isInWater;

        // 5. Dripping Logic
        if (wetTimer.current > 0) {
            wetTimer.current -= delta;
            if (Math.random() < 0.3) {
                const offset = new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 1.2, (Math.random() - 0.5) * 0.8);
                const spawnPos = playerGroup.current.position.clone().add(offset);
                spawnParticle(
                    spawnPos,
                    new THREE.Vector3(0, -4, 0),
                    '#38bdf8',
                    0.15,
                    0.4
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
                const mouthOffset = new THREE.Vector3(0, 1.4, 0).addScaledVector(forward, 0.3);
                const spawnPos = playerGroup.current.position.clone().add(mouthOffset);

                spawnParticle(
                    spawnPos,
                    forward.clone().multiplyScalar(1.2).add(new THREE.Vector3(0, 0.5, 0)),
                    '#f3f4f6',
                    0.4 + Math.random() * 0.2, // Increased from 0.15 + 0.1
                    0.8
                );
            }
            lastBreathCycle.current = breathCycle;
        } else {
            lastBreathCycle.current = 0;
        }

        // UPDATE PARTICLES
        let idx = 0;
        particles.current.forEach(p => {
            if (p.active) {
                p.life -= delta;
                p.vel.y -= 8.0 * delta; // Gravity
                p.pos.addScaledVector(p.vel, delta);

                if (p.life <= 0 || p.pos.y < -2) {
                    p.active = false;
                    dummy.scale.set(0, 0, 0);
                } else {
                    const s = p.scale * (p.life / 0.5); // Fade out scale
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

export const Character: React.FC<CharacterProps> = ({
    groupRef,
    staminaFillRef,
    staminaGroupRef,
    overlayContent,
    stunned = false,
    isCharging = false,
    isRolling = false,
    isStumbling = false,
    isClimbing = false,
    isRunning = false,
    isMoving = false,
    moveSpeed = 0, // Default 0
    isGrounded = true, // Default true
    landingFactor = 0,
    stepUpFactor = 0,
    stunTimerRef,
    rollTimerRef,
    isHiding = false,
    staminaRef,
    currentSurface = 0,
    fallDistance = 0,
    justLanded = false
}) => {
    const headColor = stunned ? '#9ca3af' : '#3b82f6';
    const bodyColor = stunned ? '#4b5563' : '#1d4ed8';

    // Internal refs for animation parts
    const modelGroup = useRef<THREE.Group>(null!);
    const headMesh = useRef<THREE.Mesh>(null!);
    const bodyMesh = useRef<THREE.Mesh>(null!);
    const eyesMesh = useRef<THREE.Group>(null!);

    // Animation State Refs
    const idleTimer = useRef(0);
    const walkPhase = useRef(0); // For movement sync
    const baseYRef = useRef(0); // Track base height to avoid infinite growth
    const idleState = useRef(0); // 0: Breath, 1: Look, 2: Shift
    const idleTargetRotY = useRef(0);

    // Tired Breath State
    const tiredBreathCount = useRef(0);
    const isTiredBreathing = useRef(false);
    const lastBreathCycle = useRef(0);

    useFrame((state, delta) => {
        const stunTimeLeft = stunTimerRef?.current || 0;
        const time = state.clock.getElapsedTime();

        // ANIMATION PHASES
        const GET_UP_DURATION = 0.7;
        const isGettingUp = stunned && !isStumbling && stunTimeLeft <= GET_UP_DURATION && stunTimeLeft > 0;
        const isLyingDownAnim = stunned && !isStumbling && stunTimeLeft > GET_UP_DURATION;

        // --- IDLE ANIMATION LOGIC ---
        let headRotY = 0;
        let bodyRotZ = 0;
        let breathingScale = 1.0;
        let heavyBreathingRotX = 0;

        if (isGrounded && !isMoving && !isRunning && !isClimbing && !stunned && !isRolling && !isStumbling && !isCharging && !isHiding) {
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
                // Heavy breathing: Lean forward and back slightly
                heavyBreathingRotX = Math.sin(time * breathSpeed) * 0.15 + 0.1; // Bias forward
            }

            // State Machine
            if (idleState.current === 0) { // Breathing
                if (idleTimer.current > 0.5 + Math.random() * 1.5) {
                    // If tired breathing, don't look around
                    if (!isTiredBreathing.current) {
                        idleState.current = Math.random() > 0.5 ? 1 : 2;
                        idleTimer.current = 0;
                        if (idleState.current === 1) idleTargetRotY.current = (Math.random() - 0.5) * 1.0;
                    }
                }
            } else if (idleState.current === 1) { // Look Around
                const hRotY = THREE.MathUtils.lerp(0, idleTargetRotY.current, Math.sin(Math.min(idleTimer.current, 1.0) * Math.PI));
                headRotY = hRotY;
                if (idleTimer.current > 1.5) {
                    idleState.current = 0;
                    idleTimer.current = 0;
                }
            } else if (idleState.current === 2) { // Shift Weight
                bodyRotZ = Math.sin(Math.min(idleTimer.current, 1.0) * Math.PI) * 0.05;
                if (idleTimer.current > 1.0) {
                    idleState.current = 0;
                    idleTimer.current = 0;
                }
            }
        } else {
            idleTimer.current = 0;
            idleState.current = 0;
        }

        // --- SQUASH / CROUCH LOGIC ---
        const baseCrouch = isCharging ? 0.4 : 0;
        let moveSquash = 0;

        // Improved Landing Squash: Elastic bounce with volume preservation
        const heavyLanding = fallDistance > 2.0;
        const landingIntensity = heavyLanding ? 0.7 : 0.3; // Deeper squash for heavy falls

        // Elastic bounce curve
        const landingSquash = Math.max(0, Math.sin(landingFactor * Math.PI)) * landingIntensity;

        // Initialize animation targets
        let targetRotY = 0;
        let bobY = 0;
        let targetRotX = heavyBreathingRotX;
        let targetRotZ = bodyRotZ;
        let targetZOffset = 0;
        let targetPivotY = 0;
        let rotLerpSpeed = delta * 15; // Initialize early for use in movement block

        if (isStumbling) {
            // Logic handled below
        } else if (isHiding) {
            // Logic handled below
        }

        // --- REWRITTEN MOVEMENT SYSTEM (PENGUIN STYLE) ---
        if (isMoving && isGrounded && !stunned && !isRolling) {
            // Calculate a normalized speed factor (0 to ~1.8)
            const speedFact = Math.min(moveSpeed / 6, 1.8);
            const freq = isRunning ? 18 : 12;
            walkPhase.current += delta * freq * speedFact;

            const t = walkPhase.current;

            // 1. Vertical Bobbing (Bounce while walking)
            // Using abs(sin) for a bounce effect against the ground
            bobY = Math.abs(Math.sin(t)) * (isRunning ? 0.7 : 0.4);

            // 2. Waddle Sway (Extreme Z-axis tilt)
            // Changed to sin to start at neutral (0) instead of max (1)
            targetRotZ = Math.sin(t) * (isRunning ? 0.5 : 0.35);

            // 3. Side Shift (Physical weight transfer on X)
            // Changed to sin to sync with sway and start at neutral
            const sideShift = Math.sin(t) * (isRunning ? 0.4 : 0.25);
            if (modelGroup.current) {
                modelGroup.current.position.x = THREE.MathUtils.lerp(modelGroup.current.position.x, sideShift, delta * 20);
            }

            // 4. Forward Lean (Rotation X)
            targetRotX = (isRunning ? 0.5 : 0.2) * speedFact;

            // 5. Horizontal Wiggle (Rotation Y)
            targetRotY = Math.sin(t) * (isRunning ? 0.35 : 0.2);

            // 6. Squash & Stretch (Synced with impact at t=n*PI)
            // Changed to positive Cosine so that t=0 (impact) is max squash
            moveSquash = Math.cos(t * 2) * (isRunning ? 0.25 : 0.15);

            // Head response to the waddle
            headRotY = -targetRotY * 1.5;

            rotLerpSpeed = delta * 25;
        } else {
            // Reset positions and reset phase when stopping
            if (modelGroup.current) {
                modelGroup.current.position.x = THREE.MathUtils.lerp(modelGroup.current.position.x, 0, delta * 15);
            }
            walkPhase.current = THREE.MathUtils.lerp(walkPhase.current, 0, delta * 5);
        }

        // Combine Squash components
        let totalSquash = baseCrouch + landingSquash + moveSquash;

        if (isStumbling) {
            totalSquash = 0.4;
        } else if (isLyingDownAnim) {
            totalSquash = 0.0;
        } else if (isGettingUp) {
            const progress = 1 - (stunTimeLeft / GET_UP_DURATION);
            totalSquash = Math.sin(progress * Math.PI) * 0.5;
        } else if (isRolling) {
            totalSquash = 0.3;
        } else if (isClimbing) {
            totalSquash = -0.1;
        } else if (isHiding) {
            totalSquash = 0.6;
        }

        const BODY_HEIGHT = 2.4;
        const HEAD_SIZE = 1.6;

        const targetScaleY = (1.0 - totalSquash) * breathingScale;
        const targetScaleXZ = 1.0 + (totalSquash * 0.5);

        const standardBodyY = (BODY_HEIGHT / 2) - (totalSquash * 0.5);
        const standardHeadY = (BODY_HEIGHT + HEAD_SIZE / 2) - (totalSquash * 1.5);

        // --- ROTATION & PIVOT LOGIC ---
        let applyRoll = false;

        if (stunned) {
            if (isStumbling) {
                targetRotX = Math.PI / 4;
                targetPivotY = 0;
                rotLerpSpeed = delta * 15;
            } else if (isLyingDownAnim) {
                targetRotX = Math.PI / 2;
                targetPivotY = 0.1;
                rotLerpSpeed = delta * 10;
            } else if (isGettingUp) {
                targetRotX = 0;
                targetPivotY = 0;
                rotLerpSpeed = delta * 3;
            }
        } else if (isRolling) {
            applyRoll = true;
            const timer = rollTimerRef?.current || 0;
            const duration = 0.6;
            const progress = THREE.MathUtils.clamp(1 - (timer / duration), 0, 1);
            targetRotX = progress * Math.PI * 2;
            targetPivotY = 0.8;
        } else if (isClimbing) {
            targetRotX = -0.2;
            targetRotZ = Math.sin(time * 15) * 0.1;
            bobY = Math.sin(time * 20) * 0.05;
            targetZOffset = -0.1;
        } else if (stepUpFactor > 0) {
            targetRotX = Math.sin(stepUpFactor * Math.PI) * 0.35;
            targetZOffset = Math.sin(stepUpFactor * Math.PI) * 0.2;
            rotLerpSpeed = delta * 20;
        }

        // Apply Lerps
        const squashLerpSpeed = delta * 20;

        // Floating Animation (Water)
        let floatingY = 0;
        if (currentSurface === 1 && isGrounded && !isClimbing && !isRolling && !stunned) {
            floatingY = Math.sin(time * 2.0) * 0.06;
        }

        // Apply Container Rotation and Position
        if (modelGroup.current) {
            if (applyRoll) {
                modelGroup.current.rotation.x = targetRotX;
                baseYRef.current = THREE.MathUtils.lerp(baseYRef.current, targetPivotY, delta * 20);
            } else {
                if (modelGroup.current.rotation.x > Math.PI) modelGroup.current.rotation.x -= Math.PI * 2;
                modelGroup.current.rotation.x = THREE.MathUtils.lerp(modelGroup.current.rotation.x, targetRotX, rotLerpSpeed);
                modelGroup.current.rotation.z = THREE.MathUtils.lerp(modelGroup.current.rotation.z, targetRotZ, rotLerpSpeed);
                modelGroup.current.rotation.y = THREE.MathUtils.lerp(modelGroup.current.rotation.y, targetRotY, rotLerpSpeed);
                baseYRef.current = THREE.MathUtils.lerp(baseYRef.current, targetPivotY, rotLerpSpeed);
            }

            modelGroup.current.position.y = baseYRef.current + bobY + floatingY;
            modelGroup.current.position.z = THREE.MathUtils.lerp(modelGroup.current.position.z, targetZOffset, delta * 15);
        }

        // 2. Update Internal Parts
        const targetHeadLocalY = standardHeadY - targetPivotY;
        const targetBodyLocalY = standardBodyY - targetPivotY;

        if (bodyMesh.current) {
            bodyMesh.current.scale.y = THREE.MathUtils.lerp(bodyMesh.current.scale.y, targetScaleY, squashLerpSpeed);
            bodyMesh.current.scale.x = THREE.MathUtils.lerp(bodyMesh.current.scale.x, targetScaleXZ, squashLerpSpeed);
            bodyMesh.current.scale.z = THREE.MathUtils.lerp(bodyMesh.current.scale.z, targetScaleXZ, squashLerpSpeed);
            bodyMesh.current.position.y = THREE.MathUtils.lerp(bodyMesh.current.position.y, targetBodyLocalY, squashLerpSpeed);
        }
        if (headMesh.current) {
            headMesh.current.position.y = THREE.MathUtils.lerp(headMesh.current.position.y, targetHeadLocalY, squashLerpSpeed);
            // Apply Head Look Rotation
            headMesh.current.rotation.y = THREE.MathUtils.lerp(headMesh.current.rotation.y, headRotY, delta * 10);
        }
        if (eyesMesh.current) {
            eyesMesh.current.position.y = THREE.MathUtils.lerp(eyesMesh.current.position.y, targetHeadLocalY + 0.1, squashLerpSpeed);
            // Sync Eyes Rotation with Head
            eyesMesh.current.rotation.y = THREE.MathUtils.lerp(eyesMesh.current.rotation.y, headRotY, delta * 10);
        }
    });

    // Reduced width/depth from 0.8 to 0.7 to minimize wall clipping during rotation
    return (
        <>
            <ParticleEffects
                isRunning={isRunning || false}
                isMoving={isMoving || false}
                isGrounded={isGrounded || false}
                currentSurface={currentSurface || 0}
                staminaRef={staminaRef}
                landingFactor={landingFactor || 0}
                playerGroup={groupRef}
                stunned={stunned || false}
                fallDistance={fallDistance || 0}
                justLanded={justLanded || false}
                isTiredBreathingRef={isTiredBreathing}
            />
            <group ref={groupRef}>
                {/* UI Elements */}
                {overlayContent && (
                    <Html position={[0, 8.0, 0]} center style={{ pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 101 }}>
                        {overlayContent}
                    </Html>
                )}

                {/* Stun Indicator - Show during the entire stun sequence */}
                {stunned && (
                    <Html position={[0, 4.6, 0]} center style={{ pointerEvents: 'none', zIndex: 100 }}>
                        <div className="text-xl animate-spin">💫</div>
                    </Html>
                )}

                {/* Stamina Bar */}
                {staminaGroupRef && staminaFillRef && (
                    <Html position={[0, 5.0, 0]} center style={{ pointerEvents: 'none', zIndex: 90 }}>
                        <div
                            ref={staminaGroupRef}
                            style={{
                                width: '60px',
                                height: '8px',
                                background: '#1f2937',
                                border: '1px solid rgba(0,0,0,0.5)',
                                borderRadius: '4px',
                                overflow: 'hidden',
                                display: 'none'
                            }}
                        >
                            <div
                                ref={staminaFillRef}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    background: stunned ? '#9ca3af' : '#fbbf24',
                                    transition: 'width 0.1s linear, background-color 0.2s'
                                }}
                            />
                        </div>
                    </Html>
                )}

                <group ref={modelGroup}>
                    {/* Head - Slightly smaller width/depth */}
                    <mesh ref={headMesh} position={[0, 3.2, 0]} castShadow receiveShadow>
                        <boxGeometry args={[1.4, 1.6, 1.4]} />
                        <meshStandardMaterial color={headColor} />
                    </mesh>
                    {/* Body - Slightly smaller width/depth */}
                    <mesh ref={bodyMesh} position={[0, 1.2, 0]} castShadow receiveShadow>
                        <boxGeometry args={[1.4, 2.4, 1.4]} />
                        <meshStandardMaterial color={bodyColor} />
                    </mesh>
                    {/* Eyes */}
                    <group ref={eyesMesh} position={[0, 3.2, 0]}>
                        <mesh position={[0.36, 0, 0.72]} castShadow>
                            <boxGeometry args={[0.3, 0.3, 0.1]} />
                            <meshStandardMaterial color="white" emissive="black" emissiveIntensity={0} />
                        </mesh>
                        <mesh position={[-0.36, 0, 0.72]} castShadow>
                            <boxGeometry args={[0.3, 0.3, 0.1]} />
                            <meshStandardMaterial color="white" emissive="black" emissiveIntensity={0} />
                        </mesh>
                    </group>
                </group>
            </group>
        </>
    );
};
