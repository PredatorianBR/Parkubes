import { describe, it, expect } from 'vitest';
import { isOutOfBounds } from './physics';

describe('isOutOfBounds', () => {
    const halfSize = 10;

    it('should return false for coordinates strictly inside the boundaries', () => {
        expect(isOutOfBounds(0, 0, halfSize)).toBe(false);
        expect(isOutOfBounds(5, 5, halfSize)).toBe(false);
        expect(isOutOfBounds(-5, -5, halfSize)).toBe(false);
        expect(isOutOfBounds(9.9, 9.9, halfSize)).toBe(false);
        expect(isOutOfBounds(-9.9, -9.9, halfSize)).toBe(false);
    });

    it('should return false for coordinates exactly on the boundaries', () => {
        expect(isOutOfBounds(halfSize, 0, halfSize)).toBe(false); // right
        expect(isOutOfBounds(-halfSize, 0, halfSize)).toBe(false); // left
        expect(isOutOfBounds(0, halfSize, halfSize)).toBe(false); // top
        expect(isOutOfBounds(0, -halfSize, halfSize)).toBe(false); // bottom
        expect(isOutOfBounds(halfSize, halfSize, halfSize)).toBe(false); // top-right
        expect(isOutOfBounds(-halfSize, -halfSize, halfSize)).toBe(false); // bottom-left
        expect(isOutOfBounds(halfSize, -halfSize, halfSize)).toBe(false); // bottom-right
        expect(isOutOfBounds(-halfSize, halfSize, halfSize)).toBe(false); // top-left
    });

    it('should return true for coordinates just outside the boundaries', () => {
        const justOutside = halfSize + 0.1;
        const justOutsideNeg = -halfSize - 0.1;

        expect(isOutOfBounds(justOutside, 0, halfSize)).toBe(true);
        expect(isOutOfBounds(justOutsideNeg, 0, halfSize)).toBe(true);
        expect(isOutOfBounds(0, justOutside, halfSize)).toBe(true);
        expect(isOutOfBounds(0, justOutsideNeg, halfSize)).toBe(true);
        expect(isOutOfBounds(justOutside, justOutside, halfSize)).toBe(true);
        expect(isOutOfBounds(justOutsideNeg, justOutsideNeg, halfSize)).toBe(true);
    });

    it('should return true for coordinates far outside the boundaries', () => {
        expect(isOutOfBounds(100, 0, halfSize)).toBe(true);
        expect(isOutOfBounds(-100, 0, halfSize)).toBe(true);
        expect(isOutOfBounds(0, 100, halfSize)).toBe(true);
        expect(isOutOfBounds(0, -100, halfSize)).toBe(true);
    });

    it('should handle negative halfSize gracefully by returning true for all finite coords (bounds are reversed)', () => {
        const negativeHalfSize = -10;
        // x < -halfSize (-(-10) = 10) || x > halfSize (-10) -> true for almost everything
        expect(isOutOfBounds(0, 0, negativeHalfSize)).toBe(true);
        expect(isOutOfBounds(5, 5, negativeHalfSize)).toBe(true);
        expect(isOutOfBounds(-5, -5, negativeHalfSize)).toBe(true);
    });

    it('should return false for everything if halfSize is Infinity', () => {
        expect(isOutOfBounds(0, 0, Infinity)).toBe(false);
        expect(isOutOfBounds(1000000, 1000000, Infinity)).toBe(false);
        expect(isOutOfBounds(-1000000, -1000000, Infinity)).toBe(false);
    });
});
