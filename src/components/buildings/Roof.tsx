import React from 'react';
import * as THREE from 'three';

export const Roof: React.FC<{ size: [number, number, number]; color: string }> = ({ size, color }) => {
    const [w, , d] = size;
    const ow = w + 0.4;
    const od = d + 0.4;

    const roofMaterial = React.useMemo(() => new THREE.MeshStandardMaterial({ color }), [color]);
    const shadowMaterial = React.useMemo(() => new THREE.MeshStandardMaterial({ color: "#000000", transparent: true, opacity: 0.2 }), []);

    React.useEffect(() => {
        return () => {
            roofMaterial.dispose();
            shadowMaterial.dispose();
        };
    }, [roofMaterial, shadowMaterial]);

    return (
        <group>
            <mesh position={[0, 0.15, 0]} receiveShadow userData={{ type: 'roof' }} renderOrder={11}>
                <boxGeometry args={[ow, 0.3, od]} />
                <primitive object={roofMaterial} attach="material" />
            </mesh>
            <mesh position={[0, 0.3, 0]} userData={{ type: 'roof' }} renderOrder={12}>
                <boxGeometry args={[ow - 0.2, 0.05, od - 0.2]} />
                <primitive object={shadowMaterial} attach="material" />
            </mesh>
        </group>
    );
};
