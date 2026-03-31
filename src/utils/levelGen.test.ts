import { describe, it, expect, vi } from 'vitest';
import { generateCityLevel } from './levelGen';
import { GameSettings } from '../types';
import * as THREE from 'three';
import { GRID_SCALE } from './physics';

describe('generateCityLevel', () => {
    const defaultSettings: GameSettings = {
        worldSize: 64,
        playerSpeed: 1,
        staminaDuration: 1,
        ratios: {
            farm: 20,
            ruins: 20,
            house: 20,
            highrise: 20,
            factory: 20
        },
        lockedRatios: [],
        riverWidth: 4,
        cameraZoom: 1,
        cameraFollow: true
    };

    it('should return the correct structure and grid sizes', () => {
        const pSpawn = new THREE.Vector2(0, 0);
        const mapId = 1;

        const result = generateCityLevel(pSpawn, defaultSettings, mapId);

        // Check structure
        expect(result).toHaveProperty('objects');
        expect(result).toHaveProperty('oGrid');
        expect(result).toHaveProperty('bGrid');
        expect(result).toHaveProperty('wGrid');
        expect(result).toHaveProperty('sGrid');
        expect(result).toHaveProperty('spawnPos');

        // Check grid sizes
        const expectedGridSize = defaultSettings.worldSize * GRID_SCALE;
        expect(result.oGrid.length).toBe(expectedGridSize);
        expect(result.oGrid[0].length).toBe(expectedGridSize);

        expect(result.bGrid.length).toBe(expectedGridSize);
        expect(result.bGrid[0].length).toBe(expectedGridSize);

        expect(result.wGrid.length).toBe(expectedGridSize);
        expect(result.wGrid[0].length).toBe(expectedGridSize);

        expect(result.sGrid.length).toBe(expectedGridSize);
        expect(result.sGrid[0].length).toBe(expectedGridSize);
    });

    it('should deterministically generate fixed buildings in debug mode', () => {
        const pSpawn = new THREE.Vector2(0, 0);
        const mapId = 999; // Non-zero mapId to verify debugMode flag works
        const debugMode = true;

        const result = generateCityLevel(pSpawn, defaultSettings, mapId, debugMode);

        // In debug mode, we expect fixed buildings to be placed.
        // Farms return null and mutate tGrid and later add 'wheat' objects and fences
        // Ruins mutate objects arrays with 'ruin' items.
        // Houses are 'box'. Factory is 'factory'. Highrise is 'highrise'.

        // Let's verify that at least these types exist in the debug level
        // NOTE: Farms with width/depth 12x12 will successfully generate wheat.
        // The debug factory uses 12x12 which will pass the constraints and might be mutated to a house if it doesn't fit after cutoffs, but at these sizes, they usually fit.
        // Ruins might fail to place if area is bad, but debug level is empty.

        const hasFactory = result.objects.some(o => o.type === 'factory');
        const hasHighrise = result.objects.some(o => o.type === 'highrise');
        const hasHouse = result.objects.some(o => o.type === 'box'); // Houses are 'box'
        const hasWheat = result.objects.some(o => o.type === 'wheat'); // Farm
        const hasRuins = result.objects.some(o => o.type === 'ruin');

        expect(hasFactory).toBe(true);
        expect(hasHighrise).toBe(true);
        expect(hasHouse).toBe(true);
        expect(hasWheat).toBe(true);
        expect(hasRuins).toBe(true);
    });

    it('should handle zero riverWidth gracefully', () => {
        const pSpawn = new THREE.Vector2(0, 0);
        const mapId = 2;
        const settingsNoRiver = { ...defaultSettings, riverWidth: 0 };

        const result = generateCityLevel(pSpawn, settingsNoRiver, mapId);

        // Ensure no water was generated
        let hasWater = false;
        for (let x = 0; x < result.wGrid.length; x++) {
            for (let z = 0; z < result.wGrid[0].length; z++) {
                if (result.wGrid[x][z] === 1) {
                    hasWater = true;
                    break;
                }
            }
            if (hasWater) break;
        }

        expect(hasWater).toBe(false);
    });

    it('should handle small worldSize gracefully without crashing', () => {
        const pSpawn = new THREE.Vector2(0, 0);
        const mapId = 3;
        const smallSettings = { ...defaultSettings, worldSize: 10 };

        // Should not throw an error
        expect(() => generateCityLevel(pSpawn, smallSettings, mapId)).not.toThrow();

        const result = generateCityLevel(pSpawn, smallSettings, mapId);
        const expectedGridSize = smallSettings.worldSize * GRID_SCALE;
        expect(result.oGrid.length).toBe(expectedGridSize);
    });

    it('regression test: multiple random generations do not crash', () => {
        const pSpawn = new THREE.Vector2(0, 0);

        // Mock Math.random to ensure we hit various branches over multiple runs
        // We will just run it 5 times normally without mocking to simulate multiple real generations
        for (let i = 0; i < 5; i++) {
            expect(() => generateCityLevel(pSpawn, defaultSettings, 100 + i)).not.toThrow();
        }
    });
});
