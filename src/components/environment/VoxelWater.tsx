import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { GRID_SCALE, GROUND_DEPTH, worldToIndex } from '../../utils/physics';

export const VoxelWater: React.FC<{ size: number; waterGrid?: number[][]; riverOrientation?: number; riverFlow?: number }> = React.memo(({ size, waterGrid, riverOrientation = -1, riverFlow = 3.0 }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null!);
    const bedRef = useRef<THREE.InstancedMesh>(null!);
    const foamRef = useRef<THREE.InstancedMesh>(null!);
    const halfSize = Math.floor(size / 2);

    const gridSize = size * GRID_SCALE;
    const cellSize = 1.0 / GRID_SCALE;

    // Foam Particles State
    const maxFoam = 120;
    const foamParticles = useRef<{ pos: THREE.Vector3; life: number; speed: number; scale: number; offset: THREE.Vector3 }[]>([]);

    useEffect(() => {
        if (!waterGrid) return;
        // Find all water tiles for spawning
        const waterTiles: { x: number, z: number }[] = [];
        for (let x = 0; x < gridSize; x++) {
            for (let z = 0; z < gridSize; z++) {
                if (waterGrid[x][z] === 1) waterTiles.push({ x, z });
            }
        }

        foamParticles.current = new Array(maxFoam).fill(0).map(() => {
            const tile = waterTiles[Math.floor(Math.random() * waterTiles.length)] || { x: 0, z: 0 };
            return {
                pos: new THREE.Vector3(
                    (tile.x + 0.5) / GRID_SCALE - halfSize,
                    -0.19,
                    (tile.z + 0.5) / GRID_SCALE - halfSize
                ),
                life: Math.random(),
                speed: 1.5 + Math.random() * 2.0,
                scale: 0.2 + Math.random() * 0.4,
                offset: new THREE.Vector3((Math.random() - 0.5) * cellSize, 0, (Math.random() - 0.5) * cellSize)
            };
        });

        const dummy = new THREE.Object3D();
        let idx = 0;
        for (let x = 0; x < gridSize; x++) {
            for (let z = 0; z < gridSize; z++) {
                const isWater = waterGrid[x][z] === 1;
                const worldX = (x + 0.5) / GRID_SCALE - halfSize;
                const worldZ = (z + 0.5) / GRID_SCALE - halfSize;

                if (isWater) {
                    // 1. Water Surface
                    dummy.rotation.x = -Math.PI / 2;
                    dummy.rotation.z = 0;
                    dummy.scale.set(cellSize, cellSize, 1);
                    dummy.position.set(worldX, -0.2, worldZ);
                    dummy.updateMatrix();
                    meshRef.current.setMatrixAt(idx, dummy.matrix);

                    // 2. Bed Layer
                    dummy.rotation.x = 0;
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

    useFrame((state, delta) => {
        if (!foamRef.current || !waterGrid) return;
        const dummy = new THREE.Object3D();
        const color = new THREE.Color('#ffffff');

        // Find all water tiles for respawning
        const waterTiles: { x: number, z: number }[] = [];
        for (let x = 0; x < gridSize; x++) {
            for (let z = 0; z < gridSize; z++) {
                if (waterGrid[x][z] === 1) waterTiles.push({ x, z });
            }
        }

        foamParticles.current.forEach((p, i) => {
            p.life += delta * 0.5; // Life cycle
            if (p.life > 1.0) {
                // Respawn
                p.life = 0;
                const tile = waterTiles[Math.floor(Math.random() * waterTiles.length)] || { x: 0, z: 0 };
                p.pos.set(
                    (tile.x + 0.5) / GRID_SCALE - halfSize,
                    -0.19,
                    (tile.z + 0.5) / GRID_SCALE - halfSize
                );
            }

            // Move with current
            const baseSpeed = 1.0;
            const flowFactor = (riverFlow / 3.0);
            const movement = (p.speed + baseSpeed) * flowFactor * delta;

            if (riverOrientation === 0) p.pos.z += movement;      // N->S
            else if (riverOrientation === 2) p.pos.z -= movement; // S->N
            else if (riverOrientation === 3) p.pos.x += movement; // W->E
            else if (riverOrientation === 1) p.pos.x -= movement; // E->W
            else {
                // Random drift if no orientation
                const drift = 0.2 * flowFactor;
                p.pos.x += Math.sin(state.clock.elapsedTime + i) * delta * drift;
                p.pos.z += Math.cos(state.clock.elapsedTime + i) * delta * drift;
            }

            // Check if still in water (logic tile)
            const gx = worldToIndex(p.pos.x, halfSize, size);
            const gz = worldToIndex(p.pos.z, halfSize, size);
            const inWater = waterGrid[gx]?.[gz] === 1;

            if (!inWater) {
                // Diminish if out of water
                p.life = Math.min(1.0, p.life + delta * 2.0);
            }

            // Animation
            const alpha = Math.sin(p.life * Math.PI); // Fade in/out
            const s = p.scale * (0.8 + 0.2 * Math.sin(state.clock.elapsedTime * 2 + i));

            dummy.position.copy(p.pos).add(p.offset);
            dummy.rotation.x = -Math.PI / 2;
            dummy.rotation.z = i; // Random static rotation
            dummy.scale.set(s * alpha, s * alpha, 1);
            dummy.updateMatrix();
            foamRef.current.setMatrixAt(i, dummy.matrix);
        });

        foamRef.current.instanceMatrix.needsUpdate = true;
    });

    return (
        <group>
            {/* River Bed */}
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

            {/* Dynamic River Foam */}
            <instancedMesh ref={foamRef} args={[undefined, undefined, maxFoam]} frustumCulled={false}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial color="#ffffff" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
            </instancedMesh>
        </group>
    );
});
