import { performance } from 'perf_hooks';
import { generateCityLevel } from './src/utils/levelGen.ts';
import * as THREE from 'three';

const settings = {
    worldSize: 100, // 100x100 is standard
    ratios: {
        farm: 20,
        ruins: 10,
        house: 30,
        factory: 20,
        highrise: 20
    },
    riverWidth: 10
};

const t0 = performance.now();
for (let i = 0; i < 100; i++) {
    generateCityLevel(new THREE.Vector2(0, 0), settings as any, i, false);
}
const t1 = performance.now();
console.log(`Execution time: ${t1 - t0}ms`);
