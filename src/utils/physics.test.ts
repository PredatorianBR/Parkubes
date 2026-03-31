import { describe, it, expect } from 'vitest';
import { getCeilingHeight } from './physics';

describe('getCeilingHeight', () => {
    it('returns Infinity when there is no bridge', () => {
        // bridgeGrid with all 0s
        const bridgeGrid = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ];
        // x=0, z=0 -> indices around the center depending on worldSize
        const result = getCeilingHeight(0, 0, 0, bridgeGrid, 3);
        expect(result).toBe(Infinity);
    });

    it('returns bridgeH - 1.0 when there is a bridge above the player', () => {
        const bridgeGrid = [
            [0, 0, 0],
            [0, 5, 0],
            [0, 0, 0],
        ];
        // player at x=0, z=0 (center of a 3x3 world), currentY=2 (which is < bridgeH - 1.0 = 4)
        const result = getCeilingHeight(0, 0, 2, bridgeGrid, 3);
        expect(result).toBe(4);
    });

    it('returns Infinity when the player is already above the ceiling check boundary', () => {
        const bridgeGrid = [
            [0, 0, 0],
            [0, 5, 0],
            [0, 0, 0],
        ];
        // player at currentY=4 (which is >= bridgeH - 1.0)
        const result = getCeilingHeight(0, 0, 4, bridgeGrid, 3);
        expect(result).toBe(Infinity);
    });

    it('returns Infinity when the player is on top of the bridge', () => {
        const bridgeGrid = [
            [0, 0, 0],
            [0, 5, 0],
            [0, 0, 0],
        ];
        // player at currentY=5 (which is >= bridgeH - 1.0)
        const result = getCeilingHeight(0, 0, 5, bridgeGrid, 3);
        expect(result).toBe(Infinity);
    });

    it('returns Infinity for out of bounds bridgeGrid indices (empty array or undefined column)', () => {
        const bridgeGrid: number[][] = [];
        const result = getCeilingHeight(0, 0, 0, bridgeGrid, 3);
        expect(result).toBe(Infinity);
    });

    it('correctly maps world coordinates to grid indices', () => {
        const bridgeGrid = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 10], // index 2, 2
        ];
        // For worldSize = 3, halfSize = 1.
        // x = 1, z = 1.
        // ix = clamp(floor((1 + 1) * 1), 0, 3 - 1) = clamp(2, 0, 2) = 2.
        // iz = clamp(floor((1 + 1) * 1), 0, 3 - 1) = clamp(2, 0, 2) = 2.
        // So bridgeGrid[2][2] = 10.
        // currentY = 0 < 10 - 1.0 = 9. So should return 9.
        const result = getCeilingHeight(1, 1, 0, bridgeGrid, 3);
        expect(result).toBe(9);
    });
});
