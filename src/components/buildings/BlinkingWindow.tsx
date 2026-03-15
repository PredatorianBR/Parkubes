import React, { useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export const BlinkingWindow: React.FC<{ position: [number, number, number], rotation: [number, number, number], size: number, color: string, type: 'residential' | 'industrial', isCorner?: boolean, forceOn?: boolean }> = ({ position, rotation, size, color, type, isCorner = false, forceOn = false }) => {
    // FIXED: Material properties adjusted to allow emissive light to shine through
    const [material] = useState(() => new THREE.MeshStandardMaterial({
        color: new THREE.Color('#1e293b'),
        emissive: new THREE.Color(type === 'residential' ? '#fbbf24' : '#e2e8f0'),
        emissiveIntensity: 0,
        roughness: 0.1,
        metalness: 0.1
    }));

    // Independent Random Life Cycle
    const schedule = useMemo(() => {
        return {
            // Random offset so windows don't blink in unison
            offset: Math.random() * 1000,
            // Cycle speed reduced significantly for slower intervals
            speed: type === 'residential' ? 0.05 + Math.random() * 0.1 : 0.0,
            // Activity threshold: 
            threshold: Math.random() * 0.6
        };
    }, [type]);

    useFrame((state, delta) => {
        if (material) {
            let targetIntensity = 0;
            const maxIntensity = 4.0;

            if (type === 'industrial') {
                targetIntensity = maxIntensity;
            } else {
                const t = state.clock.elapsedTime;
                const noise = Math.sin(t * schedule.speed + schedule.offset);
                const isWindowOn = noise > schedule.threshold;
                targetIntensity = isWindowOn ? maxIntensity : 0.0;
            }

            // FASTER OFF: Significantly speed up fade out
            const speed = targetIntensity < 0.1 ? 20.0 : 2.0;
            material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, targetIntensity, delta * speed);
        }
    });

    const frameColor = type === 'residential' ? '#4a3018' : '#1f2937';
    const grillColor = type === 'residential' ? '#4a3018' : '#334155';

    const frameDepth = 0.05;
    const frameThickness = 0.06;

    const w = type === 'residential' ? size : 2.0;
    const h = type === 'residential' ? size : 1.0;

    const Frame = ({ w, h }: { w: number, h: number }) => {
        const zPos = frameDepth / 2;
        return (
            <group>
                <mesh position={[0, h / 2 + frameThickness / 2, zPos]} castShadow>
                    <boxGeometry args={[w + frameThickness * 2, frameThickness, frameDepth]} />
                    <meshStandardMaterial color={frameColor} />
                </mesh>
                <mesh position={[0, -h / 2 - frameThickness / 2, zPos]} castShadow>
                    <boxGeometry args={[w + frameThickness * 2, frameThickness, frameDepth]} />
                    <meshStandardMaterial color={frameColor} />
                </mesh>
                <mesh position={[-w / 2 - frameThickness / 2, 0, zPos]} castShadow>
                    <boxGeometry args={[frameThickness, h, frameDepth]} />
                    <meshStandardMaterial color={frameColor} />
                </mesh>
                <mesh position={[w / 2 + frameThickness / 2, 0, zPos]} castShadow>
                    <boxGeometry args={[frameThickness, h, frameDepth]} />
                    <meshStandardMaterial color={frameColor} />
                </mesh>
            </group>
        );
    };

    return (
        <group position={[position[0], position[1], position[2]]} rotation={rotation} scale={[2, 2, 2]} userData={{ ignoreRaycast: true, type: 'detail-hide' }}>
            <group position={[0, 0, 0]}>
                <Frame w={w} h={h} />
                <mesh material={material} position={[0, 0, 0.01]}>
                    <boxGeometry args={[w, h, 0.02]} />
                </mesh>
                <group position={[0, 0, 0.022]}>
                    {type === 'residential' ? (
                        <>
                            <mesh position={[0, 0, 0]}>
                                <boxGeometry args={[0.04, h, 0.02]} />
                                <meshStandardMaterial color={grillColor} />
                            </mesh>
                            <mesh position={[0, 0, 0]}>
                                <boxGeometry args={[w, 0.04, 0.02]} />
                                <meshStandardMaterial color={grillColor} />
                            </mesh>
                        </>
                    ) : (
                        <>
                            <mesh position={[0, h * 0.25, 0]}>
                                <boxGeometry args={[w, 0.04, 0.02]} />
                                <meshStandardMaterial color={grillColor} />
                            </mesh>
                            <mesh position={[0, -h * 0.25, 0]}>
                                <boxGeometry args={[w, 0.04, 0.02]} />
                                <meshStandardMaterial color={grillColor} />
                            </mesh>
                        </>
                    )}
                </group>
            </group>
        </group>
    );
};
