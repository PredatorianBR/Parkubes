import React from 'react';
import * as THREE from 'three';

export const Roof: React.FC<{ size: [number, number, number]; color: string }> = ({ size, color }) => {
    const [w, h, d] = size;
    const ow = w + 0.2;
    const od = d + 0.2;

    return (
        <group>
            <mesh position={[0, 0.15, 0]} castShadow receiveShadow userData={{ type: 'roof' }}>
                <boxGeometry args={[ow, 0.3, od]} />
                <meshStandardMaterial color={color} />
            </mesh>
            <mesh position={[0, 0.3, 0]} userData={{ type: 'roof' }}>
                <boxGeometry args={[ow - 0.2, 0.05, od - 0.2]} />
                <meshStandardMaterial color="#000000" transparent opacity={0.2} />
            </mesh>
        </group>
    );
};
