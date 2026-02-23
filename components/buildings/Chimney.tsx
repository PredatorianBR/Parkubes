import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GridMaterial } from '../GridMaterial';

export const Chimney: React.FC<{ position: THREE.Vector3; scale: [number, number, number]; color: string; smoke?: boolean; rotation?: number; isIndustrial?: boolean; showGrid?: boolean }> = ({ position, scale, color, smoke = true, rotation = 0, isIndustrial = false, showGrid = false }) => {
    const particlesRef = useRef<THREE.InstancedMesh>(null!);
    const count = 5;
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const particles = useMemo(() => new Array(count).fill(0).map(() => ({
        y: Math.random() * 3,
        speed: 0.5 + Math.random() * 0.5,
        offset: Math.random() * 100
    })), []);

    // Intensity of smoke (0 to 1) for transition
    const intensity = useRef(smoke ? 1.0 : 0.0);

    useFrame((state, delta) => {
        if (!particlesRef.current) return;

        // Smoothly transition intensity based on smoke prop
        const target = smoke ? 1.0 : 0.0;
        // Lerp speed determines dissipation time (approx 2-3 seconds to fully vanish)
        intensity.current = THREE.MathUtils.lerp(intensity.current, target, delta * 1.5);

        if (intensity.current < 0.01) {
            particlesRef.current.visible = false;
            return;
        }

        particlesRef.current.visible = true;
        const t = state.clock.elapsedTime;

        particles.forEach((p, i) => {
            // Always animate physics even if fading
            let y = (t * p.speed + p.offset) % 4;
            dummy.position.set(0, scale[1] / 2 + y, 0);
            dummy.position.x += Math.sin(t * 2 + p.offset) * 0.2 * y;
            dummy.position.z += Math.cos(t * 1.5 + p.offset) * 0.2 * y;

            // Scale is affected by vertical height (y) AND current dissipation intensity
            const s = (0.3 + (y * 0.2)) * intensity.current;
            dummy.scale.set(s, s, s);

            dummy.updateMatrix();
            particlesRef.current.setMatrixAt(i, dummy.matrix);
        });
        particlesRef.current.instanceMatrix.needsUpdate = true;
    });

    return (
        <group position={position} rotation={[0, rotation, 0]}>
            {/* Main Chimney Shaft */}
            <mesh castShadow receiveShadow userData={{ type: 'detail-fade' }}>
                {isIndustrial ? (
                    <cylinderGeometry args={[scale[0] / 2 * 0.9, scale[0] / 2, scale[1], 16]} />
                ) : (
                    <boxGeometry args={scale} />
                )}
                <GridMaterial color={color} roughness={0.7} metalness={isIndustrial ? 0.3 : 0} showGrid={showGrid} />
            </mesh>

            {/* Industrial details: Metal rings and base */}
            {isIndustrial && (
                <group>
                    {/* Top Ring */}
                    <mesh position={[0, scale[1] / 2 - 0.2, 0]} castShadow userData={{ type: 'detail-fade' }}>
                        <cylinderGeometry args={[scale[0] / 2 * 1.05, scale[0] / 2 * 1.05, 0.2, 16]} />
                        <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.3} />
                    </mesh>

                    {/* Industrial Base (Square plate at the bottom) */}
                    <mesh position={[0, -scale[1] / 2 + 0.1, 0]} receiveShadow userData={{ type: 'detail-fade' }}>
                        <boxGeometry args={[scale[0] * 1.2, 0.2, scale[2] * 1.2]} />
                        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.4} />
                    </mesh>

                    {/* Middle Ring */}
                    {scale[1] > 5 && (
                        <mesh position={[0, 0, 0]} castShadow userData={{ type: 'detail-fade' }}>
                            <cylinderGeometry args={[scale[0] / 2 * 1.02, scale[0] / 2 * 1.02, 0.15, 16]} />
                            <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
                        </mesh>
                    )}
                </group>
            )}

            {/* Top Vent Hole (black plane) */}
            <mesh position={[0, scale[1] / 2 + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow userData={{ type: 'detail-fade' }}>
                {isIndustrial ? (
                    <circleGeometry args={[scale[0] / 2 * 0.7, 16]} />
                ) : (
                    <planeGeometry args={[scale[0] * 0.6, scale[2] * 0.6]} />
                )}
                <meshStandardMaterial color="#1a1a1a" />
            </mesh>

            {/* Metal bars for residential industrial style or extra detail */}
            {isIndustrial && scale[1] > 1.5 && !isIndustrial && ( // Keeping logic for specific cases if needed, but suppressed by !isIndustrial
                <group>
                    <mesh position={[0, -0.5, -scale[2] / 2 - 0.05]} castShadow userData={{ type: 'detail-fade' }}>
                        <boxGeometry args={[scale[0] + 0.1, 0.1, 0.1]} />
                        <meshStandardMaterial color="#475569" />
                    </mesh>
                    <mesh position={[0, 0.5, -scale[2] / 2 - 0.05]} castShadow userData={{ type: 'detail-fade' }}>
                        <boxGeometry args={[scale[0] + 0.1, 0.1, 0.1]} />
                        <meshStandardMaterial color="#475569" />
                    </mesh>
                </group>
            )}
            {/* Always render instanced mesh, visibility controlled in loop */}
            <instancedMesh ref={particlesRef} args={[undefined, undefined, count]} position={[0, 0, 0]}>
                <sphereGeometry args={[0.5, 8, 8]} />
                <meshBasicMaterial color="#aaaaaa" transparent opacity={0.4} />
            </instancedMesh>
        </group>
    );
}
