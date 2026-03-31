import * as THREE from 'three';
import { updateEntityPhysics } from './src/utils/physics.ts';

const current = {
    pos: new THREE.Vector3(0, 0, 0),
    vel: new THREE.Vector3(0, 0, 0),
    isGrounded: true,
    isClimbing: false,
    isCharging: false,
    isRolling: false,
    didStepUp: false,
    stamina: 100,
    stunned: false,
    stumbleTimer: 0,
    stumbleVel: new THREE.Vector3(0, 0, 0),
    airTimeHigh: 0,
    lastDir: new THREE.Vector2(0, 1),
    noiseLevel: 0
};

const input = {
    dt: 1 / 60,
    moveDir: new THREE.Vector3(1, 0, 1).normalize(),
    actions: { jump: false, charge: false, climb: false, run: false, attemptRoll: false },
    stats: { speed: 1, climbSpeed: 1 },
    world: {
        oGrid: Array.from({ length: 10 }, () => Array(10).fill(0)),
        bGrid: Array.from({ length: 10 }, () => Array(10).fill(0)),
        wGrid: Array.from({ length: 10 }, () => Array(10).fill(0)),
        size: 10
    }
};

const iterations = 500000;

// warm up
for (let i = 0; i < 10000; i++) {
    updateEntityPhysics(current, input);
}

const start = performance.now();
for (let i = 0; i < iterations; i++) {
    updateEntityPhysics(current, input);
}
const end = performance.now();

console.log(`Time taken: ${(end - start).toFixed(2)} ms`);
