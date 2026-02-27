import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { GRID_SCALE, GROUND_DEPTH, worldToIndex } from '../../utils/physics';

export const VoxelWater: React.FC<{ size: number; waterGrid?: number[][]; riverOrientation?: number; riverFlow?: number }> = React.memo(({ size, waterGrid, riverOrientation = -1, riverFlow = 3.0 }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null!);
    const bedRef = useRef<THREE.InstancedMesh>(null!);
    const foamRef = useRef<THREE.InstancedMesh>(null!);
    const wallRef = useRef<THREE.InstancedMesh>(null!);
    const halfSize = Math.floor(size / 2);

    const gridSize = size * GRID_SCALE;
    const cellSize = 1.0 / GRID_SCALE;

    // Foam Particles State
    const maxFoam = 600;
    const foamParticles = useRef<{ pos: THREE.Vector3; vel: THREE.Vector3; life: number; speed: number; scale: number; offset: THREE.Vector3; type: 'drift' | 'source' | 'exit' }[]>([]);

    const waterTilesRef = useRef<{ x: number, z: number }[]>([]);
    const edgeTilesRef = useRef<{ x: number, z: number, side: 'N' | 'S' | 'E' | 'W' }[]>([]);
    const sourceTilesRef = useRef<{ x: number, z: number, side: string }[]>([]);
    const exitTilesRef = useRef<{ x: number, z: number, side: string }[]>([]);

    useEffect(() => {
        if (!waterGrid) return;

        const waterTiles: { x: number, z: number }[] = [];
        const edgeTiles: { x: number, z: number, side: 'N' | 'S' | 'E' | 'W' }[] = [];

        for (let x = 0; x < gridSize; x++) {
            for (let z = 0; z < gridSize; z++) {
                if (waterGrid[x][z] === 1) {
                    waterTiles.push({ x, z });
                    if (x === 0) edgeTiles.push({ x, z, side: 'W' });
                    else if (x === gridSize - 1) edgeTiles.push({ x, z, side: 'E' });
                    if (z === 0) edgeTiles.push({ x, z, side: 'N' });
                    else if (z === gridSize - 1) edgeTiles.push({ x, z, side: 'S' });
                }
            }
        }

        waterTilesRef.current = waterTiles;
        edgeTilesRef.current = edgeTiles;

        const sourceSide = riverOrientation === 0 ? 'N' : riverOrientation === 2 ? 'S' : riverOrientation === 3 ? 'W' : riverOrientation === 1 ? 'E' : null;
        const exitSide = riverOrientation === 0 ? 'S' : riverOrientation === 2 ? 'N' : riverOrientation === 3 ? 'E' : riverOrientation === 1 ? 'W' : null;

        const sourceTiles = edgeTiles.filter(t => t.side === sourceSide);
        const exitTiles = edgeTiles.filter(t => t.side === exitSide);
        sourceTilesRef.current = sourceTiles;
        exitTilesRef.current = exitTiles;

        foamParticles.current = new Array(maxFoam).fill(0).map((_, i) => {
            let type: 'drift' | 'source' | 'exit' = 'drift';
            if (i < 200 && sourceTiles.length > 0) type = 'source';
            else if (i < 400 && exitTiles.length > 0) type = 'exit';

            if (type === 'source') {
                const edge = sourceTiles[Math.floor(Math.random() * sourceTiles.length)];
                let vx = (Math.random() - 0.5) * 2.0;
                let vz = (Math.random() - 0.5) * 2.0;
                let vy = 0.8 + Math.random() * 1.2;

                const logicX = (edge.x + 0.5) / GRID_SCALE - halfSize;
                const logicZ = (edge.z + 0.5) / GRID_SCALE - halfSize;
                let spawnX = logicX;
                let spawnZ = logicZ;

                // Shift spawning back to be closer to the edge
                if (riverOrientation === 0) { vz = 2.5 + Math.random() * 2; spawnZ -= 0.2; }
                else if (riverOrientation === 2) { vz = -2.5 - Math.random() * 2; spawnZ += 0.2; }
                else if (riverOrientation === 3) { vx = 2.5 + Math.random() * 2; spawnX -= 0.2; }
                else if (riverOrientation === 1) { vx = -2.5 - Math.random() * 2; spawnX += 0.2; }

                return {
                    pos: new THREE.Vector3(spawnX, -0.18, spawnZ),
                    vel: new THREE.Vector3(vx, vy, vz),
                    life: Math.random(),
                    speed: 2.0 + Math.random() * 3.0,
                    scale: 0.3 + Math.random() * 0.3,
                    offset: new THREE.Vector3((Math.random() - 0.5) * cellSize, 0, (Math.random() - 0.5) * cellSize),
                    type: 'source'
                };
            }

            if (type === 'exit') {
                const edge = exitTiles[Math.floor(Math.random() * exitTiles.length)];
                const logicX = (edge.x + 0.5) / GRID_SCALE - halfSize;
                const logicZ = (edge.z + 0.5) / GRID_SCALE - halfSize;
                return {
                    pos: new THREE.Vector3(logicX, -0.18, logicZ),
                    vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, -2.0 - Math.random() * 3.0, (Math.random() - 0.5) * 1.5),
                    life: Math.random(),
                    speed: 2.0 + Math.random() * 2.0,
                    scale: 0.3 + Math.random() * 0.3,
                    offset: new THREE.Vector3((Math.random() - 0.5) * cellSize, 0, (Math.random() - 0.5) * cellSize),
                    type: 'exit'
                };
            }

            const tile = waterTiles[Math.floor(Math.random() * waterTiles.length)] || { x: 0, z: 0 };
            return {
                pos: new THREE.Vector3((tile.x + 0.5) / GRID_SCALE - halfSize, -0.19, (tile.z + 0.5) / GRID_SCALE - halfSize),
                vel: new THREE.Vector3(0, 0, 0),
                life: Math.random(),
                speed: 1.5 + Math.random() * 2.0,
                scale: 0.2 + Math.random() * 0.4,
                offset: new THREE.Vector3((Math.random() - 0.5) * cellSize, 0, (Math.random() - 0.5) * cellSize),
                type: 'drift'
            };
        });

        const dummy = new THREE.Object3D();
        let idx = 0;
        let wallIdx = 0;

        const waterDepth = GROUND_DEPTH - 0.2;

        for (let x = 0; x < gridSize; x++) {
            for (let z = 0; z < gridSize; z++) {
                const isWater = waterGrid[x][z] === 1;
                const worldX = (x + 0.5) / GRID_SCALE - halfSize;
                const worldZ = (z + 0.5) / GRID_SCALE - halfSize;

                if (isWater) {
                    dummy.rotation.set(-Math.PI / 2, 0, 0);
                    dummy.scale.set(cellSize, cellSize, 1);
                    dummy.position.set(worldX, -0.2, worldZ);
                    dummy.updateMatrix();
                    meshRef.current.setMatrixAt(idx, dummy.matrix);

                    dummy.rotation.set(0, 0, 0);
                    const bedHeight = 0.5;
                    dummy.scale.set(cellSize, bedHeight, cellSize);
                    dummy.position.set(worldX, -GROUND_DEPTH + bedHeight / 2, worldZ);
                    dummy.updateMatrix();
                    bedRef.current.setMatrixAt(idx, dummy.matrix);

                    const wallOffset = 0.5;

                    if (x === 0) {
                        dummy.position.set(worldX - wallOffset, -0.2 - waterDepth / 2, worldZ);
                        dummy.rotation.set(0, -Math.PI / 2, 0);
                        dummy.scale.set(cellSize, waterDepth, 1);
                        dummy.updateMatrix();
                        wallRef.current.setMatrixAt(wallIdx++, dummy.matrix);
                    } else if (x === gridSize - 1) {
                        dummy.position.set(worldX + wallOffset, -0.2 - waterDepth / 2, worldZ);
                        dummy.rotation.set(0, Math.PI / 2, 0);
                        dummy.scale.set(cellSize, waterDepth, 1);
                        dummy.updateMatrix();
                        wallRef.current.setMatrixAt(wallIdx++, dummy.matrix);
                    }

                    if (z === 0) {
                        dummy.position.set(worldX, -0.2 - waterDepth / 2, worldZ - wallOffset);
                        dummy.rotation.set(0, Math.PI, 0);
                        dummy.scale.set(cellSize, waterDepth, 1);
                        dummy.updateMatrix();
                        wallRef.current.setMatrixAt(wallIdx++, dummy.matrix);
                    } else if (z === gridSize - 1) {
                        dummy.position.set(worldX, -0.2 - waterDepth / 2, worldZ + wallOffset);
                        dummy.rotation.set(0, 0, 0);
                        dummy.scale.set(cellSize, waterDepth, 1);
                        dummy.updateMatrix();
                        wallRef.current.setMatrixAt(wallIdx++, dummy.matrix);
                    }
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

        wallRef.current.count = wallIdx;
        wallRef.current.instanceMatrix.needsUpdate = true;
    }, [size, halfSize, waterGrid, gridSize, cellSize, riverOrientation]);

    useFrame((state, delta) => {
        if (!foamRef.current || !waterGrid) return;
        const dummy = new THREE.Object3D();

        const waterTiles = waterTilesRef.current;
        const edgeTiles = edgeTilesRef.current;

        const sourceTiles = sourceTilesRef.current;
        const exitTiles = exitTilesRef.current;

        const flowStrength = Math.max(1.0, riverFlow);
        const currentRotation = new THREE.Euler();
        const currentScale = new THREE.Vector3();

        foamParticles.current.forEach((p, i) => {
            p.life += delta * (p.type !== 'drift' ? 1.5 : 0.6);

            if (p.life > 1.0) {
                p.life = 0;
                if (p.type === 'source' && sourceTiles.length > 0) {
                    const edge = sourceTiles[Math.floor(Math.random() * sourceTiles.length)];
                    let vx = (Math.random() - 0.5) * 2.0;
                    let vz = (Math.random() - 0.5) * 2.0;
                    let vy = 0.8 + Math.random() * 1.2;

                    const logicX = (edge.x + 0.5) / GRID_SCALE - halfSize;
                    const logicZ = (edge.z + 0.5) / GRID_SCALE - halfSize;
                    let spawnX = logicX;
                    let spawnZ = logicZ;

                    if (riverOrientation === 0) { vz = 2.5 + Math.random() * 2; spawnZ -= 0.2; }
                    else if (riverOrientation === 2) { vz = -2.5 - Math.random() * 2; spawnZ += 0.2; }
                    else if (riverOrientation === 3) { vx = 2.5 + Math.random() * 2; spawnX -= 0.2; }
                    else if (riverOrientation === 1) { vx = -2.5 - Math.random() * 2; spawnX += 0.2; }

                    p.pos.set(spawnX, -0.18, spawnZ);
                    p.vel.set(vx, vy, vz);
                } else if (p.type === 'exit' && exitTiles.length > 0) {
                    const edge = exitTiles[Math.floor(Math.random() * exitTiles.length)];
                    p.pos.set((edge.x + 0.5) / GRID_SCALE - halfSize, -0.18, (edge.z + 0.5) / GRID_SCALE - halfSize);
                    p.vel.set((Math.random() - 0.5) * 1.5, -2.0 - Math.random() * 3.0, (Math.random() - 0.5) * 1.5);
                } else {
                    const tile = waterTiles[Math.floor(Math.random() * waterTiles.length)] || { x: 0, z: 0 };
                    p.pos.set((tile.x + 0.5) / GRID_SCALE - halfSize, -0.17, (tile.z + 0.5) / GRID_SCALE - halfSize);
                    p.vel.set(0, 0, 0);
                }
            }

            let scaleMult = 1.0;
            currentRotation.set(0, 0, 0);
            currentScale.set(1, 1, 1);

            if (p.type === 'source' || p.type === 'exit') {
                // Impact Smoke Physics: Gravity applies always
                p.vel.y -= p.type === 'source' ? 12.0 * delta : 20.0 * delta; // Faster fall for exit
                p.pos.addScaledVector(p.vel, delta);

                // Expansion + Fade scale
                scaleMult = 1.1 * (1.1 - p.life * 0.7); // Reduced volume further
                p.pos.x += Math.sin(state.clock.elapsedTime * 4 + i) * 0.01;
                p.pos.z += Math.cos(state.clock.elapsedTime * 4 + i) * 0.01;

                currentRotation.set(0, state.clock.elapsedTime * i * 0.1, 0);
                currentScale.set(1, 1, 1); // Full box
            } else {
                // Normal flow drift
                const movement = (p.speed + 1.0) * (flowStrength / 3.0) * delta;
                if (riverOrientation === 0) p.pos.z += movement;
                else if (riverOrientation === 2) p.pos.z -= movement;
                else if (riverOrientation === 3) p.pos.x += movement;
                else if (riverOrientation === 1) p.pos.x -= movement;

                currentRotation.set(-Math.PI / 2, 0, i);
                currentScale.set(1, 1, 0.001); // Flatten into a plane
            }

            const margin = (p.type === 'source' || p.type === 'exit') ? 2.0 : 0.0;
            const alpha = (Math.abs(p.pos.x) > halfSize + margin || Math.abs(p.pos.z) > halfSize + margin || p.pos.y < -GROUND_DEPTH) ? 0 : Math.sin(p.life * Math.PI);
            const s = p.scale * scaleMult * (0.8 + 0.2 * Math.sin(state.clock.elapsedTime * 4 + i));

            dummy.position.copy(p.pos).add(p.offset);
            dummy.rotation.copy(currentRotation);
            dummy.scale.set(s * alpha * currentScale.x, s * alpha * currentScale.y, s * alpha * currentScale.z);
            dummy.updateMatrix();
            foamRef.current.setMatrixAt(i, dummy.matrix);
        });

        foamRef.current.instanceMatrix.needsUpdate = true;
    });

    const waterMaterial = (
        <meshStandardMaterial
            color="#60a5fa"
            transparent={true}
            opacity={0.88}
            roughness={0.05}
            metalness={0.4}
            emissive="#1e3a8a"
            emissiveIntensity={0.3}
            side={THREE.DoubleSide}
            depthWrite={true}
        />
    );

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
                {waterMaterial}
            </instancedMesh>

            {/* Water edge walls */}
            <instancedMesh ref={wallRef} args={[undefined, undefined, gridSize * 4]} receiveShadow={false} frustumCulled={false}>
                <planeGeometry args={[1, 1]} />
                {waterMaterial}
            </instancedMesh>

            {/* Dynamic River Foam & Waterfall Mist */}
            <instancedMesh ref={foamRef} args={[undefined, undefined, maxFoam]} frustumCulled={false} renderOrder={1}>
                <boxGeometry args={[1, 1, 1]} />
                <meshBasicMaterial color="#ffffff" transparent={true} opacity={0.6} depthWrite={false} />
            </instancedMesh>
        </group>
    );
});
