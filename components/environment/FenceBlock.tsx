import React from 'react';
import * as THREE from 'three';

export const FenceBlock: React.FC<{ position: THREE.Vector3; color: string; neighbors?: { n: boolean, s: boolean, e: boolean, w: boolean }; isPost?: boolean }> = ({ position, color, neighbors, isPost = true }) => {
    const postColor = "#a16207";
    const railColor = color || "#d4a373";

    const railLength = isPost ? 0.25 : 0.5;
    const nPosZ = isPost ? -0.375 : -0.25;
    const sPosZ = isPost ? 0.375 : 0.25;
    const ePosX = isPost ? 0.375 : 0.25;
    const wPosX = isPost ? -0.375 : -0.25;

    return (
        <group position={position}>
            {/* Central Post */}
            {isPost && (
                <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
                    <boxGeometry args={[0.5, 1.5, 0.5]} />
                    <meshStandardMaterial color={postColor} />
                </mesh>
            )}

            {/* Rails */}
            {neighbors?.n && (
                <group>
                    <mesh position={[0, 1.0, nPosZ]} castShadow receiveShadow>
                        <boxGeometry args={[0.15, 0.15, railLength]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                    <mesh position={[0, 0.5, nPosZ]} castShadow receiveShadow>
                        <boxGeometry args={[0.15, 0.15, railLength]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                </group>
            )}
            {neighbors?.s && (
                <group>
                    <mesh position={[0, 1.0, sPosZ]} castShadow receiveShadow>
                        <boxGeometry args={[0.15, 0.15, railLength]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                    <mesh position={[0, 0.5, sPosZ]} castShadow receiveShadow>
                        <boxGeometry args={[0.15, 0.15, railLength]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                </group>
            )}
            {neighbors?.e && (
                <group>
                    <mesh position={[ePosX, 1.0, 0]} castShadow receiveShadow>
                        <boxGeometry args={[railLength, 0.15, 0.15]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                    <mesh position={[ePosX, 0.5, 0]} castShadow receiveShadow>
                        <boxGeometry args={[railLength, 0.15, 0.15]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                </group>
            )}
            {neighbors?.w && (
                <group>
                    <mesh position={[wPosX, 1.0, 0]} castShadow receiveShadow>
                        <boxGeometry args={[railLength, 0.15, 0.15]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                    <mesh position={[wPosX, 0.5, 0]} castShadow receiveShadow>
                        <boxGeometry args={[railLength, 0.15, 0.15]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                </group>
            )}
        </group>
    );
};
