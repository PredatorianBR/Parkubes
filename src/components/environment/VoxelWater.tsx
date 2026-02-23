import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { GRID_SCALE, GROUND_DEPTH } from '../../utils/physics';

export const VoxelWater: React.FC<{ size: number; waterGrid?: number[][] }> = React.memo(({ size, waterGrid }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null!);
    const bedRef = useRef<THREE.InstancedMesh>(null!);
    const halfSize = Math.floor(size / 2);

    const gridSize = size * GRID_SCALE;
    const cellSize = 1.0 / GRID_SCALE;

    useEffect(() => {
        if (!waterGrid) return;
        const dummy = new THREE.Object3D();
        let idx = 0;
        for (let x = 0; x < gridSize; x++) {
            for (let z = 0; z < gridSize; z++) {
                const isWater = waterGrid[x][z] === 1;
                const worldX = (x + 0.5) / GRID_SCALE - halfSize;
                const worldZ = (z + 0.5) / GRID_SCALE - halfSize;

                if (isWater) {
                    // Water Layer - Single plane on the surface
                    dummy.rotation.x = -Math.PI / 2;
                    dummy.scale.set(cellSize, cellSize, 1);
                    dummy.position.set(worldX, -0.2, worldZ);
                    dummy.updateMatrix();
                    meshRef.current.setMatrixAt(idx, dummy.matrix);

                    // Revert dummy rotation for the bed which is a box
                    dummy.rotation.x = 0;

                    // Bed Layer - Bottom aligned with Ground Bottom (-5.0)
                    const bedHeight = 0.5;
                    dummy.scale.set(cellSize, bedHeight, cellSize);
                    dummy.position.set(worldX, -GROUND_DEPTH + bedHeight / 2, worldZ);
                    dummy.updateMatrix();
                    bedRef.current.setMatrixAt(idx, dummy.matrix);
                } else {
                    dummy.scale.set(0, 0, 0);
                    dummy.updateMatrix();
                    meshRef.current.setMatrixAt(idx, dummy.matrix);
                    bedRef.current.setMatrixAt(idx, dummy.matrix);
                }
                idx++;
            }
        }
        meshRef.current.instanceMatrix.needsUpdate = true;
        bedRef.current.instanceMatrix.needsUpdate = true;
    }, [size, halfSize, waterGrid, gridSize, cellSize]);

    return (
        <group>
            {/* River Bed - Brown */}
            <instancedMesh ref={bedRef} args={[undefined, undefined, gridSize * gridSize]} receiveShadow frustumCulled={false}>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color="#5d4037" roughness={0.8} />
            </instancedMesh>

            {/* Water surface */}
            <instancedMesh ref={meshRef} args={[undefined, undefined, gridSize * gridSize]} receiveShadow={false} frustumCulled={false}>
                <planeGeometry args={[1, 1]} />
                <meshStandardMaterial
                    color="#60a5fa"
                    transparent
                    opacity={0.6}
                    roughness={0.1}
                    metalness={0.3}
                    emissive="#1e3a8a"
                    emissiveIntensity={0.2}
                    side={THREE.DoubleSide}
                    depthWrite={false}
                />
            </instancedMesh>
        </group>
    );
});
