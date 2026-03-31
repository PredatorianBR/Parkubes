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

    // NEW
    spawnParticleNew(px, py, pz, vx, vy, vz, color, scale, life) {
        const p = this.particles.find(p => !p.active);
        if (p) {
            p.active = true;
            p.pos.set(px, py, pz);
            p.vel.set(vx, vy, vz);
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

let start = performance.now();
for (let i = 0; i < iterations; i++) {
    // OLD METHOD
    const offset = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2);
    const spawnPos = playerPos.clone().add(offset);
    spawnPos.y = -0.5;

    p.spawnParticleOld(
        spawnPos,
        new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 4 + 2, (Math.random() - 0.5) * 3),
        '#60a5fa',
        0.2 + Math.random() * 0.2,
        0.8
    );
    p.reset(); // prevent finding inactive taking too long or running out
}
const oldTime = performance.now() - start;

start = performance.now();
for (let i = 0; i < iterations; i++) {
    // NEW METHOD
    const offsetX = (Math.random() - 0.5) * 1.2;
    const offsetZ = (Math.random() - 0.5) * 1.2;
    const spawnX = playerPos.x + offsetX;
    const spawnY = -0.5;
    const spawnZ = playerPos.z + offsetZ;

    p.spawnParticleNew(
        spawnX, spawnY, spawnZ,
        (Math.random() - 0.5) * 3, Math.random() * 4 + 2, (Math.random() - 0.5) * 3,
        '#60a5fa',
        0.2 + Math.random() * 0.2,
        0.8
    );
    p.reset();
}
const newTime = performance.now() - start;

console.log(`Old Time: ${oldTime.toFixed(2)} ms`);
console.log(`New Time: ${newTime.toFixed(2)} ms`);
console.log(`Improvement: ${((oldTime - newTime) / oldTime * 100).toFixed(2)}%`);
