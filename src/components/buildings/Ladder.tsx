import React from 'react';

/**
 * Vertical Ladder component for building walls.
 * Renders a pair of side rails with evenly-spaced rungs.
 * The ladder is always 1 voxel wide and extends upward for `height` world units.
 */
export const Ladder: React.FC<{
    position: [number, number, number];
    rotation: [number, number, number];
    height: number;
}> = ({ position, rotation, height }) => {
    const railColor = '#5a3d1e';   // Dark wood brown
    const rungColor = '#8b6a3e';   // Lighter wood brown

    // Dimensions (in half-scale since parent group has scale=[2,2,2])
    const railWidth = 0.08;        // Thicker rails
    const railDepth = 0.08;        // Deeper rails
    const rungWidth = 0.5;         // horizontal span between rails
    const rungHeight = 0.06;       // Thicker rungs
    const rungDepth = 0.09;        // Deeper rungs
    const rungSpacing = 0.28;      // vertical distance between rungs
    const halfHeight = height / 2 / 2; // divide by 2 for parent scale

    const numRungs = Math.max(2, Math.floor(height / (rungSpacing * 2)));

    const rungs: number[] = [];
    for (let i = 0; i < numRungs; i++) {
        // Evenly distribute rungs from bottom to top 
        const t = (i + 0.5) / numRungs;
        const y = -halfHeight + t * (halfHeight * 2);
        rungs.push(y);
    }

    return (
        <group position={position} rotation={rotation} scale={[2, 2, 2]} userData={{ ignoreRaycast: true, type: 'detail-fade' }}>
            {/* Left Rail */}
            <mesh position={[-rungWidth / 2, 0, 0]} castShadow receiveShadow userData={{ type: 'detail-fade' }}>
                <boxGeometry args={[railWidth, halfHeight * 2, railDepth]} />
                <meshStandardMaterial color={railColor} roughness={0.9} />
            </mesh>

            {/* Right Rail */}
            <mesh position={[rungWidth / 2, 0, 0]} castShadow receiveShadow userData={{ type: 'detail-fade' }}>
                <boxGeometry args={[railWidth, halfHeight * 2, railDepth]} />
                <meshStandardMaterial color={railColor} roughness={0.9} />
            </mesh>

            {/* Rungs */}
            {rungs.map((y, i) => (
                <mesh key={i} position={[0, y, 0]} castShadow receiveShadow userData={{ type: 'detail-fade' }}>
                    <boxGeometry args={[rungWidth, rungHeight, rungDepth]} />
                    <meshStandardMaterial color={rungColor} roughness={0.85} />
                </mesh>
            ))}
        </group>
    );
};
