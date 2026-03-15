import React from 'react';
import * as THREE from 'three';

export const DoorBlock: React.FC<{ position: [number, number, number], rotation: [number, number, number] }> = ({ position, rotation }) => {
    // UPDATED: Darker brown frame, door remains original wood brown
    const frameColor = "#4a3018"; // Darker brown
    const frameDepth = 0.05;
    const frameWidth = 0.06;
    const frameZ = frameDepth / 2;

    return (
        <group position={position} rotation={rotation} scale={[2, 2, 2]} userData={{ ignoreRaycast: true, type: 'detail-hide' }}>
            {/* Left Jamb */}
            <mesh position={[-0.48, 0, frameZ]} castShadow receiveShadow>
                <boxGeometry args={[frameWidth, 2.2, frameDepth]} />
                <meshStandardMaterial color={frameColor} />
            </mesh>
            {/* Right Jamb */}
            <mesh position={[0.48, 0, frameZ]} castShadow receiveShadow>
                <boxGeometry args={[frameWidth, 2.2, frameDepth]} />
                <meshStandardMaterial color={frameColor} />
            </mesh>
            {/* Top Header - Bottom at 1.04 */}
            <mesh position={[0, 1.1 - frameWidth / 2, frameZ]} castShadow receiveShadow>
                <boxGeometry args={[0.9 + (frameWidth * 2), frameWidth, frameDepth]} />
                <meshStandardMaterial color={frameColor} />
            </mesh>

            <mesh position={[0, -0.025, 0.01]}>
                <boxGeometry args={[0.9, 2.15, 0.02]} />
                {/* Changed to brown wood color and increased roughness */}
                <meshStandardMaterial color="#8b5a2b" roughness={0.8} />
            </mesh>

            {/* Handle */}
            <mesh position={[0.35, -0.1, 0.025]}>
                <boxGeometry args={[0.1, 0.2, 0.02]} />
                <meshStandardMaterial color="#fcd34d" metalness={0.8} roughness={0.2} />
            </mesh>
        </group>
    );
};

export const IndustrialDoorBlock: React.FC<{ position: [number, number, number], rotation: [number, number, number] }> = ({ position, rotation }) => {
    // UPDATED: Taller door panel
    const frameColor = "#334155";
    const frameDepth = 0.06;
    const frameWidth = 0.1;
    const frameZ = frameDepth / 2;

    return (
        <group position={position} rotation={rotation} scale={[2, 2, 2]} userData={{ ignoreRaycast: true, type: 'detail-hide' }}>
            {/* Left Jamb */}
            <mesh position={[-0.95, 0, frameZ]} castShadow receiveShadow>
                <boxGeometry args={[frameWidth, 3.0, frameDepth]} />
                <meshStandardMaterial color={frameColor} />
            </mesh>
            {/* Right Jamb */}
            <mesh position={[0.95, 0, frameZ]} castShadow receiveShadow>
                <boxGeometry args={[frameWidth, 3.0, frameDepth]} />
                <meshStandardMaterial color={frameColor} />
            </mesh>
            {/* Header - Bottom at 1.4 */}
            <mesh position={[0, 1.5 - frameWidth / 2, frameZ]} castShadow receiveShadow>
                <boxGeometry args={[1.8 + (frameWidth * 2), frameWidth, frameDepth]} />
                <meshStandardMaterial color={frameColor} />
            </mesh>

            {/* Panel - Increased Height to 2.95 (Top 1.425) */}
            <mesh position={[0, -0.025, 0.015]}>
                <boxGeometry args={[1.8, 2.95, 0.03]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} />
            </mesh>

            {[0.25, 0.75, 1.25, -0.25, -0.75, -1.25].map((y, i) => (
                <mesh key={i} position={[0, y - 0.2, 0.035]}>
                    <boxGeometry args={[1.7, 0.02, 0.01]} />
                    <meshStandardMaterial color="#64748b" />
                </mesh>
            ))}
        </group>
    );
};
