
import React, { useRef } from 'react';
import { Billboard, Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface CharacterProps {
  groupRef: React.RefObject<THREE.Group>;
  staminaFillRef?: React.RefObject<THREE.Mesh>;
  staminaGroupRef?: React.RefObject<THREE.Group>;
  overlayContent?: React.ReactNode;
  stunned?: boolean;
  isCharging?: boolean;
  isRolling?: boolean;
  isStumbling?: boolean; 
  isClimbing?: boolean; 
  isRunning?: boolean;
  isMoving?: boolean; 
  isGrounded?: boolean; // Added Prop
  landingFactor?: number;
  stepUpFactor?: number; // 0 to 1
  stunTimerRef?: React.MutableRefObject<number>;
  rollTimerRef?: React.MutableRefObject<number>;
  isHiding?: boolean;
}

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
  isGrounded = true, // Default true
  landingFactor = 0,
  stepUpFactor = 0,
  stunTimerRef,
  rollTimerRef,
  isHiding = false
}) => {
  const headColor = stunned ? '#9ca3af' : '#3b82f6';
  const bodyColor = stunned ? '#4b5563' : '#1d4ed8';
  
  // Internal refs for animation parts
  const modelGroup = useRef<THREE.Group>(null!);
  const headMesh = useRef<THREE.Mesh>(null!);
  const bodyMesh = useRef<THREE.Mesh>(null!);
  const eyesMesh = useRef<THREE.Group>(null!);
  
  useFrame((state, delta) => {
    const stunTimeLeft = stunTimerRef?.current || 0;
    const time = state.clock.getElapsedTime();
    
    // ANIMATION PHASES
    const GET_UP_DURATION = 0.7;
    const isGettingUp = stunned && !isStumbling && stunTimeLeft <= GET_UP_DURATION && stunTimeLeft > 0;
    const isLyingDownAnim = stunned && !isStumbling && stunTimeLeft > GET_UP_DURATION;

    // --- SQUASH / CROUCH LOGIC ---
    const baseCrouch = isCharging ? 0.4 : 0; 
    const landingSquash = landingFactor * 0.4;
    let totalSquash = Math.max(baseCrouch, landingSquash);
    
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
        // Slight stretch when climbing
        totalSquash = -0.1;
    } else if (isHiding) {
        // Crouch low when hiding in wheat
        totalSquash = 0.6;
    }

    // New Height Calculations for 2.0 total height (Body 1.2 + Head 0.8)
    const BODY_HEIGHT = 1.2;
    const HEAD_SIZE = 0.8;

    // Standard Standing Target Positions
    const targetScaleY = 1.0 - totalSquash;
    
    // Body Center Y = Height/2 = 0.6
    const standardBodyY = (BODY_HEIGHT / 2) - (totalSquash * 0.5); 
    
    // Head Center Y = BodyTop (1.2) + HeadHalf (0.4) = 1.6
    const standardHeadY = (BODY_HEIGHT + HEAD_SIZE/2) - (totalSquash * 1.5); 
    
    // --- ROTATION & PIVOT LOGIC ---
    let targetRotX = 0;
    let targetRotZ = 0;
    let targetZOffset = 0;
    let targetPivotY = 0; 
    let bobY = 0;

    let rotLerpSpeed = delta * 10;
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
        // CLIMBING ANIMATION
        // Lean forward into the wall
        targetRotX = -0.2; 
        // Waddle / Shimmy side to side (Z-axis rotation) to simulate climbing steps
        targetRotZ = Math.sin(time * 15) * 0.1;
        // Fast vertical bob to simulate effort
        bobY = Math.sin(time * 20) * 0.05;
        // Move closer to wall (Z-offset)
        targetZOffset = -0.1;
    } else if (stepUpFactor > 0) {
        targetRotX = Math.sin(stepUpFactor * Math.PI) * 0.35;
        targetZOffset = Math.sin(stepUpFactor * Math.PI) * 0.2;
        rotLerpSpeed = delta * 20; 
    } else if ((isMoving || isRunning) && isGrounded) {
        // WALKING / RUNNING ANIMATION
        const speed = isRunning ? 20 : 12;
        const amp = isRunning ? 0.08 : 0.04;
        
        // Bob up and down
        bobY = Math.sin(time * speed) * amp;
        // Sway side to side (half speed of bob)
        targetRotZ = Math.cos(time * (speed * 0.5)) * (isRunning ? 0.05 : 0.03);
        
        if (isRunning) {
             targetRotX = 0.15; // Lean forward when running
        }
    }

    // Apply Lerps
    const squashLerpSpeed = delta * 20; 

    // 1. Update Container Rotation & Pivot
    if (modelGroup.current) {
        const currentBaseY = modelGroup.current.position.y;
        let nextBaseY = currentBaseY;

        if (applyRoll) {
            modelGroup.current.rotation.x = targetRotX;
            nextBaseY = THREE.MathUtils.lerp(currentBaseY, targetPivotY, delta * 20);
        } else {
            // Fix wrap-around if coming from roll
            if (modelGroup.current.rotation.x > Math.PI) {
                 modelGroup.current.rotation.x -= Math.PI * 2;
            }
            modelGroup.current.rotation.x = THREE.MathUtils.lerp(modelGroup.current.rotation.x, targetRotX, rotLerpSpeed);
            modelGroup.current.rotation.z = THREE.MathUtils.lerp(modelGroup.current.rotation.z, targetRotZ, rotLerpSpeed);
            nextBaseY = THREE.MathUtils.lerp(currentBaseY, targetPivotY, rotLerpSpeed);
        }

        modelGroup.current.position.y = nextBaseY + bobY;
        modelGroup.current.position.z = THREE.MathUtils.lerp(modelGroup.current.position.z, targetZOffset, delta * 15);
    }

    // 2. Update Internal Parts
    const targetHeadLocalY = standardHeadY - targetPivotY;
    const targetBodyLocalY = standardBodyY - targetPivotY;

    if (bodyMesh.current) {
        bodyMesh.current.scale.y = THREE.MathUtils.lerp(bodyMesh.current.scale.y, targetScaleY, squashLerpSpeed);
        bodyMesh.current.position.y = THREE.MathUtils.lerp(bodyMesh.current.position.y, targetBodyLocalY, squashLerpSpeed);
    }
    if (headMesh.current) {
        headMesh.current.position.y = THREE.MathUtils.lerp(headMesh.current.position.y, targetHeadLocalY, squashLerpSpeed);
    }
    if (eyesMesh.current) {
         eyesMesh.current.position.y = THREE.MathUtils.lerp(eyesMesh.current.position.y, targetHeadLocalY + 0.1, squashLerpSpeed);
    }
  });

  // Reduced width/depth from 0.8 to 0.7 to minimize wall clipping during rotation
  return (
    <group ref={groupRef}>
      {/* UI Elements */}
      {overlayContent && (
         <Html position={[0, 4.0, 0]} center style={{ pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 101 }}>
            {overlayContent}
         </Html>
      )}

      {/* Stun Indicator - Show during the entire stun sequence */}
      {stunned && (
         <Html position={[0, 2.3, 0]} center style={{ pointerEvents: 'none', zIndex: 100 }}>
            <div className="text-xl animate-spin">💫</div>
         </Html>
      )}

      {/* Stamina Bar */}
      {staminaGroupRef && staminaFillRef && (
        <Billboard position={[0, 2.4, 0]}>
            <group ref={staminaGroupRef} visible={true}>
                <mesh position={[0, 0, 0]} renderOrder={999}>
                    <boxGeometry args={[1.5, 0.25, 0.05]} />
                    <meshBasicMaterial color="#1f2937" depthTest={false} depthWrite={false} toneMapped={false} />
                </mesh>
                <mesh ref={staminaFillRef} position={[0, 0, 0.03]} renderOrder={1000}>
                    <boxGeometry args={[1.45, 0.2, 0.05]} />
                    <meshBasicMaterial color={stunned ? "#9ca3af" : "#fbbf24"} depthTest={false} depthWrite={false} toneMapped={false} />
                </mesh>
            </group>
        </Billboard>
      )}
      
      <group ref={modelGroup} position={[0, 0, 0]}>
        {/* Head - Slightly smaller width/depth */}
        <mesh ref={headMesh} position={[0, 1.6, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.7, 0.8, 0.7]} />
            <meshStandardMaterial color={headColor} />
        </mesh>
        {/* Body - Slightly smaller width/depth */}
        <mesh ref={bodyMesh} position={[0, 0.6, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.7, 1.2, 0.7]} />
            <meshStandardMaterial color={bodyColor} />
        </mesh>
        {/* Eyes */}
        <group ref={eyesMesh} position={[0, 1.6, 0]}>
             <mesh position={[0.18, 0, 0.36]} castShadow>
                <boxGeometry args={[0.15, 0.15, 0.05]} />
                <meshStandardMaterial color="white" emissive="black" emissiveIntensity={0} />
            </mesh>
            <mesh position={[-0.18, 0, 0.36]} castShadow>
                <boxGeometry args={[0.15, 0.15, 0.05]} />
                <meshStandardMaterial color="white" emissive="black" emissiveIntensity={0} />
            </mesh>
        </group>
      </group>
    </group>
  );
};
