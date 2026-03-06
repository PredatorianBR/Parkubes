
import React from 'react';
import * as THREE from 'three';
import { updateEntityPhysics, SpatialHashGrid } from './physics';

// Wrapper to bridge Game Inputs -> Physics Engine
export const updatePlayerPhysics = (
    dt: number,
    pos: THREE.Vector3,
    velocity: THREE.Vector3,
    isGrounded: React.MutableRefObject<boolean>,
    isChargingRef: React.MutableRefObject<boolean>,
    landingAnimTimer: React.MutableRefObject<number>,
    jumpDelayTimer: React.MutableRefObject<number>,
    airTimeHighPoint: React.MutableRefObject<number>,
    stamina: React.MutableRefObject<number>,
    stunTimer: React.MutableRefObject<number>,
    stunned: boolean,
    keys: React.MutableRefObject<{ [key: string]: boolean | { x: number; y: number } | undefined }>,
    playerLastDir: React.MutableRefObject<THREE.Vector2>,
    jumpPressedPrev: React.MutableRefObject<boolean>,
    speedSettings: number,
    collisionGrid: SpatialHashGrid,
    bridgeGrid: number[][],
    waterGrid: number[][],
    worldSize: number,
    canMove: boolean,
    rollTimer: React.MutableRefObject<number>,
    jumpBufferTimer: React.MutableRefObject<number>,
    isRollingRef: React.MutableRefObject<boolean>,
    stumbleTimer: React.MutableRefObject<number>,
    stumbleVelocityRef: React.MutableRefObject<THREE.Vector3>,
    camera: THREE.Camera, // ADDED: Camera for relative movement
    lastFallDistRef: React.MutableRefObject<number>,
    riverOrientation: number,
    riverFlow: number,
    ladderZones: { minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, faceAngle: number, railX: number, railZ: number }[]
) => {

    // 1. Calculate Input Direction Relative to Camera
    const inputDir = new THREE.Vector3(0, 0, 0);
    let isAnalogRunning = false;

    if (canMove && !stunned && rollTimer.current <= 0) {
        // Get Camera Direction projected to XZ plane
        const camForward = new THREE.Vector3();
        camera.getWorldDirection(camForward);
        camForward.y = 0;
        camForward.normalize();

        // Calculate Right Vector (Forward x Up)
        const camRight = new THREE.Vector3();
        camRight.crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();

        // Analog Input Priority
        const analogInput: any = keys.current.analog;
        if (analogInput && (analogInput.x !== 0 || analogInput.y !== 0)) {
            const joyX = analogInput.x;
            const joyY = -analogInput.y; // Invert Y (Screen Y is down, World Z is forward/back)

            // Check magnitude for running
            const mag = Math.sqrt(joyX * joyX + joyY * joyY);
            if (mag > 0.9) isAnalogRunning = true;

            // In screen space, Up (-Y) means Forward. Right (+X) means Right.
            inputDir.addScaledVector(camForward, joyY);
            inputDir.addScaledVector(camRight, joyX);
        } else {
            // Keyboard Fallback
            if (keys.current['w'] || keys.current['arrowup']) inputDir.add(camForward);
            if (keys.current['s'] || keys.current['arrowdown']) inputDir.sub(camForward);
            if (keys.current['d'] || keys.current['arrowright']) inputDir.add(camRight);
            if (keys.current['a'] || keys.current['arrowleft']) inputDir.sub(camRight);
        }

        if (inputDir.lengthSq() > 0) {
            // Clamp magnitude to 1.0 for analog (so diagonal isn't faster, but partial push is slower)
            if (inputDir.lengthSq() > 1) inputDir.normalize();
        }
    }

    // 2. Handle Stun Timer
    let effectiveStunned = stunned;
    if (stunTimer.current > 0) {
        stunTimer.current -= dt;
        effectiveStunned = true;
        if (stunTimer.current <= 0) {
            effectiveStunned = false;
            stumbleTimer.current = 0;
        }
    } else {
        effectiveStunned = stunned;
    }

    // Input Detection
    const isJumpDown = !!keys.current[' '];
    const justPressedJump = isJumpDown && !jumpPressedPrev.current;

    // --- JUMP BUFFER (For Roll) ---
    if (justPressedJump) {
        jumpBufferTimer.current = 0.2;
    }
    if (jumpBufferTimer.current > 0) {
        jumpBufferTimer.current -= dt;
        if (jumpBufferTimer.current < 0) jumpBufferTimer.current = 0;
    }

    // Capture previous grounded state
    const wasGrounded = isGrounded.current;

    // --- PRE-JUMP LOGIC ---
    if (justPressedJump && isGrounded.current && jumpDelayTimer.current <= 0 && !stunned && rollTimer.current <= 0) {
        jumpDelayTimer.current = 0.05;
    }

    let performJump = false;
    let isVisualPreJumping = false;

    if (jumpDelayTimer.current > 0) {
        isVisualPreJumping = true;
        jumpDelayTimer.current -= dt;
        if (jumpDelayTimer.current <= 0) {
            performJump = true;
            jumpDelayTimer.current = 0;
        }
    }

    // --- TIMERS ---
    if (rollTimer.current > 0) {
        rollTimer.current -= dt;
        if (rollTimer.current < 0) rollTimer.current = 0;
    }

    // 3. Prepare Physics State
    const currentState = {
        pos: pos,
        vel: velocity,
        isGrounded: isGrounded.current,
        isCharging: isChargingRef.current,
        isRolling: rollTimer.current > 0,
        didStepUp: false,
        stamina: stamina.current,
        stunned: effectiveStunned,
        stumbleTimer: stumbleTimer.current,
        stumbleVel: stumbleVelocityRef.current,
        airTimeHigh: airTimeHighPoint.current,
        lastDir: playerLastDir.current,
        noiseLevel: 0,
        isClimbing: false,
        ladderFaceAngle: 0,
        isLadderSliding: false,
        isNearLadder: false,
        isLadderHanging: false
    };

    const analogIn: any = keys.current.analog;
    const isJoyUp = analogIn && analogIn.y < -0.3; // y < 0 is UP on thumbstick
    const isJoyDown = analogIn && analogIn.y > 0.3;

    const inputs = {
        dt: dt,
        moveDir: inputDir,
        actions: {
            jump: performJump,
            charge: isVisualPreJumping,
            climb: !!isJumpDown,
            run: !!(keys.current['shift'] || isAnalogRunning),
            attemptRoll: jumpBufferTimer.current > 0,
            ladderUp: !!(keys.current['w'] || keys.current['arrowup'] || isJoyUp),
            ladderDown: !!(keys.current['s'] || keys.current['arrowdown'] || isJoyDown)
        },
        stats: { speed: speedSettings, climbSpeed: 2.5 },
        world: { collisionGrid: collisionGrid, bGrid: bridgeGrid, wGrid: waterGrid, size: worldSize, ladderZones, riverOrientation, riverFlow }
    };

    // 4. Run Physics Engine
    const nextState = updateEntityPhysics(currentState, inputs);

    // Update Input History
    jumpPressedPrev.current = isJumpDown;

    // CHECK IF WE ENTERED ROLL STATE
    if (nextState.isRolling && rollTimer.current <= 0) {
        rollTimer.current = 0.6;
        jumpBufferTimer.current = 0;
        landingAnimTimer.current = 0;
    }

    // 5. Apply Results back to Mutable Refs
    pos.copy(nextState.pos);
    velocity.copy(nextState.vel);
    isGrounded.current = nextState.isGrounded;
    isChargingRef.current = nextState.isCharging;
    isRollingRef.current = nextState.isRolling;
    stamina.current = nextState.stamina;
    airTimeHighPoint.current = nextState.airTimeHigh;
    playerLastDir.current.copy(nextState.lastDir);
    stumbleTimer.current = nextState.stumbleTimer;
    stumbleVelocityRef.current.copy(nextState.stumbleVel);

    // Handle Landing Event
    let justLanded = false;
    if (!wasGrounded && nextState.isGrounded) {
        landingAnimTimer.current = 0.3;
        lastFallDistRef.current = currentState.airTimeHigh - nextState.pos.y;
        justLanded = true;
    }

    if (landingAnimTimer.current > 0) {
        landingAnimTimer.current -= dt;
        if (landingAnimTimer.current < 0) landingAnimTimer.current = 0;
    }

    // Handle Fall Damage
    if (nextState.stunned && !effectiveStunned) {
        const fallSeverity = (nextState.airTimeHigh - nextState.pos.y) - 2.5;
        stunTimer.current = Math.max(2.0, fallSeverity * 0.8);
        stumbleTimer.current = 0.15;
        effectiveStunned = true;
    }


    return {
        isRunning: !!(keys.current['shift'] || isAnalogRunning) && inputDir.lengthSq() > 0,
        isCharging: nextState.isCharging || isVisualPreJumping,
        isRolling: nextState.isRolling,
        pMoving: inputDir.lengthSq() > 0,
        pDir: new THREE.Vector3(nextState.lastDir.x, 0, nextState.lastDir.y),
        effectiveStunned,
        isStumbling: stumbleTimer.current > 0,
        isGrounded: nextState.isGrounded,
        isClimbing: nextState.isClimbing,
        ladderFaceAngle: nextState.ladderFaceAngle,
        isLadderSliding: nextState.isLadderSliding,
        isNearLadder: nextState.isNearLadder,
        isLadderHanging: nextState.isLadderHanging,
        noiseLevel: nextState.noiseLevel,
        landingFactor: landingAnimTimer.current / 0.3,
        fallDistance: lastFallDistRef.current,
        justLanded
    };
};
