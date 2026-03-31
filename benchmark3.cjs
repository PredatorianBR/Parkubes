const THREE = require('three');

class Particles {
    constructor() {
        this.particles = new Array(200).fill(0).map(() => ({
            pos: new THREE.Vector3(),
            vel: new THREE.Vector3(),
            life: 0,
            color: new THREE.Color(),
            scale: 0,
            active: false
        }));
    }

    // OLD
    spawnParticleOld(pos, vel, color, scale, life) {
        const p = this.particles.find(p => !p.active);
        if (p) {
            p.active = true;
            p.pos.copy(pos);
            p.vel.copy(vel);
            p.life = life;
            p.color.set(color);
            p.scale = scale;
        }
    }

    // NEW with pre-allocated vectors at module scope
    spawnParticleNew(pos, vel, color, scale, life) {
        const p = this.particles.find(p => !p.active);
        if (p) {
            p.active = true;
            p.pos.copy(pos);
            p.vel.copy(vel);
            p.life = life;
            p.color.set(color);
            p.scale = scale;
        }
    }

    reset() {
        this.particles.forEach(p => p.active = false);
    }
}

const p = new Particles();
const iterations = 1000000;
const playerPos = new THREE.Vector3(1, 2, 3);
const _tempPos = new THREE.Vector3();
const _tempVel = new THREE.Vector3();

// For running particles
let start = performance.now();
for (let i = 0; i < iterations; i++) {
    const offset = new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
    const spawnPos = playerPos.clone().add(offset);

    p.spawnParticleOld(
        spawnPos,
        new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2 + 0.5, (Math.random() - 0.5) * 2),
        '#a8a29e',
        0.1 + Math.random() * 0.1,
        0.5 + Math.random() * 0.5
    );
    p.reset();
}
const oldTime = performance.now() - start;

start = performance.now();
for (let i = 0; i < iterations; i++) {
    _tempPos.copy(playerPos);
    _tempPos.x += (Math.random() - 0.5) * 0.5;
    _tempPos.z += (Math.random() - 0.5) * 0.5;

    _tempVel.set(
        (Math.random() - 0.5) * 2,
        Math.random() * 2 + 0.5,
        (Math.random() - 0.5) * 2
    );

    p.spawnParticleNew(
        _tempPos,
        _tempVel,
        '#a8a29e',
        0.1 + Math.random() * 0.1,
        0.5 + Math.random() * 0.5
    );
    p.reset();
}
const newTime = performance.now() - start;

console.log(`Old Time: ${oldTime.toFixed(2)} ms`);
console.log(`New Time: ${newTime.toFixed(2)} ms`);
console.log(`Improvement: ${((oldTime - newTime) / oldTime * 100).toFixed(2)}%`);
