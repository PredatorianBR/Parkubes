import { describe, it, expect } from 'vitest';
import { worldToIndex, isOutOfBounds } from './physics';

describe('Physics Utilities', () => {
    describe('worldToIndex', () => {
        // GRID_SCALE is 1 from physics.ts
        const halfSize = 50;
        const worldSize = 100;

        it('should correctly offset the value by halfSize', () => {
            expect(worldToIndex(0, halfSize, worldSize)).toBe(50);
            expect(worldToIndex(-50, halfSize, worldSize)).toBe(0);
            expect(worldToIndex(49, halfSize, worldSize)).toBe(99);
        });

        it('should clamp to 0 when the value is smaller than -halfSize', () => {
            expect(worldToIndex(-51, halfSize, worldSize)).toBe(0);
            expect(worldToIndex(-100, halfSize, worldSize)).toBe(0);
        });

        it('should clamp to worldSize * GRID_SCALE - 1 when the value is larger than the world bounds', () => {
            expect(worldToIndex(50, halfSize, worldSize)).toBe(99);
            expect(worldToIndex(100, halfSize, worldSize)).toBe(99);
        });

        it('should properly floor decimal values', () => {
            expect(worldToIndex(0.5, halfSize, worldSize)).toBe(50);
            expect(worldToIndex(-0.5, halfSize, worldSize)).toBe(49);
            expect(worldToIndex(49.9, halfSize, worldSize)).toBe(99);
        });
    });

    describe('isOutOfBounds', () => {
        const halfSize = 50;

        it('should return false when within bounds', () => {
            expect(isOutOfBounds(0, 0, halfSize)).toBe(false);
            expect(isOutOfBounds(-25, 25, halfSize)).toBe(false);
            expect(isOutOfBounds(49, -49, halfSize)).toBe(false);
        });

        it('should return false on the exact edges', () => {
            expect(isOutOfBounds(50, 50, halfSize)).toBe(false);
            expect(isOutOfBounds(-50, -50, halfSize)).toBe(false);
            expect(isOutOfBounds(50, -50, halfSize)).toBe(false);
            expect(isOutOfBounds(-50, 50, halfSize)).toBe(false);
        });

        it('should return true when x is out of bounds', () => {
            expect(isOutOfBounds(51, 0, halfSize)).toBe(true);
            expect(isOutOfBounds(-51, 0, halfSize)).toBe(true);
        });

        it('should return true when z is out of bounds', () => {
            expect(isOutOfBounds(0, 51, halfSize)).toBe(true);
            expect(isOutOfBounds(0, -51, halfSize)).toBe(true);
        });

        it('should return true when both x and z are out of bounds', () => {
            expect(isOutOfBounds(51, 51, halfSize)).toBe(true);
            expect(isOutOfBounds(-51, -51, halfSize)).toBe(true);
        });
    });
});
