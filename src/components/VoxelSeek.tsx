
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GameStatus, VoxelObject, GameSettings, Position, GameMode, MatchState } from '../types';
import { Character } from './Character';
import { useControls } from '../hooks/useControls';
import { generateCityLevel, findSpawnPos } from '../utils/levelGen';
import { updatePlayerPhysics } from '../utils/player';
import { worldToIndex, GRID_SCALE, FLOOR_HEIGHT, SpatialHashGrid, CollisionBox, checkLineOfSight, getTerrainHeight } from '../utils/physics';
import { VoxelGround } from './environment/VoxelGround';
import { VoxelWater } from './environment/VoxelWater';
import { WheatField } from './environment/WheatField';
import { RuinBlock } from './environment/RuinBlock';
import { FenceBlock } from './environment/FenceBlock';

import { WallAC, RoofAC } from './buildings/AcUnits';
import { Chimney } from './buildings/Chimney';
import { DoorBlock, IndustrialDoorBlock } from './buildings/Doors';
import { Ladder } from './buildings/Ladder';
import { GridMaterial } from './GridMaterial';
import { BlinkingWindow } from './buildings/BlinkingWindow';
import { Roof } from './buildings/Roof';

interface VoxelSeekProps {
    status: GameStatus;
    mode: GameMode;
    match: MatchState;
    settings: GameSettings;
    timer: number;
    onRoundEnd: (playerWon: boolean) => void;
    onPrepComplete: () => void;
    debugMode?: boolean;
    showGrid?: boolean;
    showCollision?: boolean;
    showWireframe?: boolean; // NEW PROP
    isEditing?: boolean;
    mapId: number;
}

// --- DEBUG COMPONENT ---
const CollisionDebug: React.FC<{ collisionGrid: SpatialHashGrid; bGrid: number[][]; size: number; visible: boolean }> = React.memo(({ collisionGrid, bGrid, size, visible }) => {
    const boxRef = useRef<THREE.InstancedMesh>(null!);
    const bRef = useRef<THREE.InstancedMesh>(null!);
    const halfSize = Math.floor(size / 2);
    const gridSize = size * GRID_SCALE;

    // Get all collision boxes for visualization
    const allBoxes = useMemo(() => collisionGrid.getAllBoxes(), [collisionGrid]);

    // Count actual bridge cells to avoid over-allocating GPU memory
    const bridgeCellCount = useMemo(() => {
        let count = 0;
        for (let x = 0; x < gridSize; x++) {
            for (let z = 0; z < gridSize; z++) {
                if ((bGrid[x]?.[z] || 0) > 0) count++;
            }
        }
        return Math.max(1, count);
    }, [bGrid, gridSize]);

    useEffect(() => {
        if (!boxRef.current || !bRef.current) return;

        const dummy = new THREE.Object3D();
        let idxBox = 0;

        // Render collision boxes as wireframe cubes
        for (const box of allBoxes) {
            const w = box.maxX - box.minX;
            const h = box.maxY - box.minY;
            const d = box.maxZ - box.minZ;
            if (w <= 0 || h <= 0 || d <= 0) continue;

            dummy.position.set(
                (box.minX + box.maxX) / 2,
                (box.minY + box.maxY) / 2,
                (box.minZ + box.maxZ) / 2
            );
            dummy.scale.set(w, h, d);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            boxRef.current.setMatrixAt(idxBox++, dummy.matrix);
        }
        boxRef.current.count = idxBox;
        boxRef.current.instanceMatrix.needsUpdate = true;

        // Bridge grid (legacy 2D)
        let idxB = 0;
        const cellSize = 1.0 / GRID_SCALE;
        for (let x = 0; x < gridSize; x++) {
            for (let z = 0; z < gridSize; z++) {
                const bh = bGrid[x]?.[z] || 0;
                if (bh > 0) {
                    const worldX = (x + 0.5) / GRID_SCALE - halfSize;
                    const worldZ = (z + 0.5) / GRID_SCALE - halfSize;
                    dummy.position.set(worldX, bh + 0.05, worldZ);
                    dummy.rotation.set(-Math.PI / 2, 0, 0);
                    dummy.scale.set(cellSize * 0.85, cellSize * 0.85, 1);
                    dummy.updateMatrix();
                    bRef.current.setMatrixAt(idxB++, dummy.matrix);
                }
            }
        }
        bRef.current.count = idxB;
        bRef.current.instanceMatrix.needsUpdate = true;
    }, [allBoxes, bGrid, size, halfSize, gridSize]);

    return (
        <group visible={visible}>
            {/* 3D Collision Boxes (Red wireframe) */}
            <instancedMesh ref={boxRef} args={[undefined, undefined, Math.max(1, allBoxes.length)]} frustumCulled={false}>
                <boxGeometry args={[1, 1, 1]} />
                <meshBasicMaterial color="#ff0000" transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} />
            </instancedMesh>
            {/* Bridge/Roof Collision (Cyan) */}
            <instancedMesh ref={bRef} args={[undefined, undefined, bridgeCellCount]} frustumCulled={false}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial color="#00ffff" transparent opacity={0.4} side={THREE.DoubleSide} />
            </instancedMesh>
        </group>
    );
});

const VoxelRuins: React.FC<{ ruins: VoxelObject[], showGrid?: boolean }> = React.memo(({ ruins, showGrid }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null!);
    const meshTop1Ref = useRef<THREE.InstancedMesh>(null!);
    const meshTop2Ref = useRef<THREE.InstancedMesh>(null!);
    const materialRef = useRef<THREE.MeshStandardMaterial>(null!);

    useEffect(() => {
        if (!meshRef.current || ruins.length === 0) return;

        const dummy = new THREE.Object3D();
        ruins.forEach((obj, i) => {
            const [sx, sy, sz] = obj.scale;
            // Base block
            dummy.position.set(obj.position[0], obj.position[1], obj.position[2]);
            dummy.scale.set(sx, sy, sz);
            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);

            // Top blocks
            dummy.scale.set(sx * 0.4, sy * 0.4, sz * 0.4);
            dummy.position.set(obj.position[0] + sx * 0.25, obj.position[1] + sy * 0.5, obj.position[2] + sz * 0.25);
            dummy.updateMatrix();
            meshTop1Ref.current.setMatrixAt(i, dummy.matrix);

            dummy.scale.set(sx * 0.3, sy * 0.3, sz * 0.3);
            dummy.position.set(obj.position[0] - sx * 0.2, obj.position[1] + sy * 0.5, obj.position[2] - sz * 0.2);
            dummy.updateMatrix();
            meshTop2Ref.current.setMatrixAt(i, dummy.matrix);
        });

        meshRef.current.instanceMatrix.needsUpdate = true;
        meshTop1Ref.current.instanceMatrix.needsUpdate = true;
        meshTop2Ref.current.instanceMatrix.needsUpdate = true;
    }, [ruins]);

    if (ruins.length === 0) return null;

    return (
        <group>
            <instancedMesh ref={meshRef} args={[undefined, undefined, ruins.length]} castShadow receiveShadow frustumCulled={false}>
                <boxGeometry args={[1, 1, 1]} />
                <GridMaterial color={ruins[0]?.color || "#4b5563"} showGrid={showGrid} floorHeight={FLOOR_HEIGHT} transparent={false} opacity={1.0} />
            </instancedMesh>
            <instancedMesh ref={meshTop1Ref} args={[undefined, undefined, ruins.length]} castShadow receiveShadow frustumCulled={false}>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color={ruins[0]?.color || "#4b5563"} transparent={false} opacity={1.0} />
            </instancedMesh>
            <instancedMesh ref={meshTop2Ref} args={[undefined, undefined, ruins.length]} castShadow receiveShadow frustumCulled={false}>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color={ruins[0]?.color || "#4b5563"} transparent={false} opacity={1.0} />
            </instancedMesh>
        </group>
    );
});

const VoxelFences: React.FC<{ fences: VoxelObject[] }> = React.memo(({ fences }) => {
    const postRef = useRef<THREE.InstancedMesh>(null!);
    const railNRef = useRef<THREE.InstancedMesh>(null!);
    const railSRef = useRef<THREE.InstancedMesh>(null!);
    const railERef = useRef<THREE.InstancedMesh>(null!);
    const railWRef = useRef<THREE.InstancedMesh>(null!);

    useEffect(() => {
        if (!postRef.current || fences.length === 0) return;

        const dummy = new THREE.Object3D();
        let postIdx = 0, nIdx = 0, sIdx = 0, eIdx = 0, wIdx = 0;

        fences.forEach((f) => {
            const isPost = f.isPost;
            const railLength = isPost ? 0.25 : 0.5;
            const nPosZ = isPost ? -0.375 : -0.25;
            const sPosZ = isPost ? 0.375 : 0.25;
            const ePosX = isPost ? 0.375 : 0.25;
            const wPosX = isPost ? -0.375 : -0.25;

            if (isPost) {
                dummy.position.set(f.position[0], f.position[1] + 0.75, f.position[2]);
                dummy.scale.set(0.5, 1.5, 0.5);
                dummy.updateMatrix();
                postRef.current.setMatrixAt(postIdx++, dummy.matrix);
            }

            const neighbors = f.neighbors;
            if (neighbors?.n) {
                dummy.scale.set(0.15, 0.15, railLength);
                dummy.position.set(f.position[0], f.position[1] + 1.0, f.position[2] + nPosZ);
                dummy.updateMatrix();
                railNRef.current.setMatrixAt(nIdx++, dummy.matrix);
                dummy.position.set(f.position[0], f.position[1] + 0.5, f.position[2] + nPosZ);
                dummy.updateMatrix();
                railNRef.current.setMatrixAt(nIdx++, dummy.matrix);
            }
            if (neighbors?.s) {
                dummy.scale.set(0.15, 0.15, railLength);
                dummy.position.set(f.position[0], f.position[1] + 1.0, f.position[2] + sPosZ);
                dummy.updateMatrix();
                railSRef.current.setMatrixAt(sIdx++, dummy.matrix);
                dummy.position.set(f.position[0], f.position[1] + 0.5, f.position[2] + sPosZ);
                dummy.updateMatrix();
                railSRef.current.setMatrixAt(sIdx++, dummy.matrix);
            }
            if (neighbors?.e) {
                dummy.scale.set(railLength, 0.15, 0.15);
                dummy.position.set(f.position[0] + ePosX, f.position[1] + 1.0, f.position[2]);
                dummy.updateMatrix();
                railERef.current.setMatrixAt(eIdx++, dummy.matrix);
                dummy.position.set(f.position[0] + ePosX, f.position[1] + 0.5, f.position[2]);
                dummy.updateMatrix();
                railERef.current.setMatrixAt(eIdx++, dummy.matrix);
            }
            if (neighbors?.w) {
                dummy.scale.set(railLength, 0.15, 0.15);
                dummy.position.set(f.position[0] + wPosX, f.position[1] + 1.0, f.position[2]);
                dummy.updateMatrix();
                railWRef.current.setMatrixAt(wIdx++, dummy.matrix);
                dummy.position.set(f.position[0] + wPosX, f.position[1] + 0.5, f.position[2]);
                dummy.updateMatrix();
                railWRef.current.setMatrixAt(wIdx++, dummy.matrix);
            }
        });

        postRef.current.count = postIdx;
        railNRef.current.count = nIdx;
        railSRef.current.count = sIdx;
        railERef.current.count = eIdx;
        railWRef.current.count = wIdx;

        postRef.current.instanceMatrix.needsUpdate = true;
        railNRef.current.instanceMatrix.needsUpdate = true;
        railSRef.current.instanceMatrix.needsUpdate = true;
        railERef.current.instanceMatrix.needsUpdate = true;
        railWRef.current.instanceMatrix.needsUpdate = true;
    }, [fences]);

    if (fences.length === 0) return null;

    const postColor = "#a16207";
    const railColor = fences[0]?.color || "#d4a373";

    return (
        <group>
            <instancedMesh ref={postRef} args={[undefined, undefined, fences.length]} castShadow receiveShadow frustumCulled={false}>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color={postColor} />
            </instancedMesh>
            <instancedMesh ref={railNRef} args={[undefined, undefined, fences.length * 2]} castShadow receiveShadow frustumCulled={false}>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color={railColor} />
            </instancedMesh>
            <instancedMesh ref={railSRef} args={[undefined, undefined, fences.length * 2]} castShadow receiveShadow frustumCulled={false}>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color={railColor} />
            </instancedMesh>
            <instancedMesh ref={railERef} args={[undefined, undefined, fences.length * 2]} castShadow receiveShadow frustumCulled={false}>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color={railColor} />
            </instancedMesh>
            <instancedMesh ref={railWRef} args={[undefined, undefined, fences.length * 2]} castShadow receiveShadow frustumCulled={false}>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color={railColor} />
                <meshStandardMaterial />
            </instancedMesh>
        </group>
    );
});

const VoxelFoliage: React.FC<{ objects: VoxelObject[] }> = React.memo(({ objects }) => {
    const grassRef = useRef<THREE.InstancedMesh>(null!);
    const flowersRef = useRef<THREE.InstancedMesh>(null!);

    useEffect(() => {
        if (!grassRef.current || !flowersRef.current || objects.length === 0) return;

        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        let flowerIdx = 0;
        let grassIdx = 0;

        objects.forEach((obj) => {
            const [x, y, z] = obj.position;
            const [sW, sH, sD] = obj.scale;
            const seed = obj.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const pseudoRandom = (offset: number) => {
                const s = Math.sin(seed + offset) * 10000;
                return s - Math.floor(s);
            };

            // Each instance is a "clump" scaled based on the actual object scale
            // Density scale: more area = more blades
            const area = sW * sD;
            const blades = Math.floor(8 * area + pseudoRandom(1) * 4);

            for (let b = 0; b < blades; b++) {
                // Spread blades across the scale [sW, sD]
                const offX = (pseudoRandom(b * 3) - 0.5) * sW;
                const offZ = (pseudoRandom(b * 3 + 1) - 0.5) * sD;
                const bladeH = (0.3 + pseudoRandom(b + 5) * 0.7) * sH;

                dummy.position.set(x + offX, y + bladeH / 2, z + offZ);
                dummy.scale.set(0.12, bladeH, 0.12);
                dummy.rotation.set(0, pseudoRandom(b + 10) * Math.PI, 0);
                dummy.updateMatrix();
                grassRef.current.setMatrixAt(grassIdx++, dummy.matrix);
            }

            // Flowers - also scaled with area
            const numFlowers = Math.floor(1 + area * 0.5 + pseudoRandom(20) * 2);
            for (let f = 0; f < numFlowers; f++) {
                const offX = (pseudoRandom(f * 4 + 40) - 0.5) * sW * 0.8;
                const offZ = (pseudoRandom(f * 4 + 41) - 0.5) * sD * 0.8;
                const fH = (0.5 + pseudoRandom(f + 42) * 0.5) * sH;

                // Stem - Base should be at ground (y=0 logic coord)
                // In world space, obj position is (x, y, z) where y is already the base (0 in levelGen)
                dummy.position.set(x + offX, y + fH / 2, z + offZ);
                dummy.scale.set(0.12, fH, 0.12); // Matched with grass blade thickness
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                grassRef.current.setMatrixAt(grassIdx++, dummy.matrix);

                // Head - Placed at the very top of the stem
                // If stem height is fH, stem top is at y + fH.
                // Flower head is a cube of size 0.25. Its pivot center is at 0.125 from its bottom.
                // We use +0.115 to create a tiny 0.01 overlap, ensuring no visual gap.
                dummy.position.set(x + offX, y + fH + 0.115, z + offZ);
                dummy.scale.set(0.25, 0.25, 0.25);
                dummy.updateMatrix();
                flowersRef.current.setMatrixAt(flowerIdx, dummy.matrix);
                flowersRef.current.setColorAt(flowerIdx, color.set(obj.color));
                flowerIdx++;
            }
        });

        grassRef.current.count = grassIdx;
        flowersRef.current.count = flowerIdx;
        grassRef.current.instanceMatrix.needsUpdate = true;
        flowersRef.current.instanceMatrix.needsUpdate = true;
        if (flowersRef.current.instanceColor) flowersRef.current.instanceColor.needsUpdate = true;
    }, [objects]);

    if (objects.length === 0) return null;

    return (
        <group>
            {/* Grass and stems */}
            <instancedMesh ref={grassRef} args={[undefined, undefined, objects.length * 60]} castShadow receiveShadow frustumCulled={false}>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color="#3f6212" transparent={false} opacity={1.0} />
            </instancedMesh>
            {/* Flower heads */}
            <instancedMesh ref={flowersRef} args={[undefined, undefined, objects.length * 10]} castShadow receiveShadow frustumCulled={false}>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial transparent={false} opacity={1.0} />
            </instancedMesh>
        </group>
    );
});

const Building: React.FC<{
    position: THREE.Vector3;
    scale: [number, number, number];
    color: string;
    type: 'box' | 'factory' | 'highrise';
    playerPos: React.MutableRefObject<THREE.Vector3>;
    playerVel: React.MutableRefObject<THREE.Vector3>;
    chimney?: { position: [number, number, number], scale: [number, number, number], color: string };
    attachedChimneys?: { pos: Position, scale: Position, color: string, smoke?: boolean, rotation?: number }[];
    acs?: { pos: Position, scale: Position, color: string, rotation: number, type: 'wall' | 'roof' }[];
    shape?: { active: boolean, points: [number, number][], mask: boolean[][] };
    windows?: { pos: Position, rot: [number, number, number] }[];
    doors?: { pos: Position, rot: [number, number, number], type?: 'standard' | 'industrial' }[];
    ladders?: { pos: Position, rot: [number, number, number], height: number }[];
    variant?: number;
    isLit?: boolean;
    isCooking?: boolean;
    showWireframe?: boolean;
    showGrid?: boolean;
    status: GameStatus;
    debugMode?: boolean;
}> = ({ position, scale, color, type, playerPos, playerVel, chimney, attachedChimneys = [], acs = [], shape, windows = [], doors = [], ladders = [], variant = 0, isLit = false, isCooking = false, showWireframe = false, showGrid = false, status, debugMode }) => {
    const groupRef = useRef<THREE.Group>(null!);
    const gridShaderRef = useRef<any>(null);
    const { camera } = useThree();
    const [w, h, d] = scale;
    const isFactory = type === 'factory';

    // Memoize parts to use in both Render and Physics loop
    const parts = useMemo(() => {
        const p: { size: [number, number, number], pos: [number, number, number] }[] = [];
        if (shape?.active && shape.mask) {
            const { mask } = shape;
            const mWidth = mask.length;
            const mDepth = mask[0].length;
            
            for (let i = 0; i < mWidth; i++) {
                let j = 0;
                while (j < mDepth) {
                    if (mask[i][j]) {
                        let runLength = 1;
                        while(j + runLength < mDepth && mask[i][j + runLength]) {
                            runLength++;
                        }
                        const bW = 1;
                        const bD = runLength;
                        
                        // Center of the 1xRun box relative to building center
                        const cx = -w/2 + i + bW/2;
                        const cz = -d/2 + j + bD/2;
                        
                        p.push({ size: [bW, h, bD], pos: [cx, 0, cz] });
                        
                        j += runLength;
                    } else {
                        j++;
                    }
                }
            }
        } else {
            p.push({ size: [w, h, d], pos: [0, 0, 0] });
        }
        return p;
    }, [w, h, d, shape]);

    // GEOMETRY GENERATION
    // Use ExtrudeGeometry for procedural shapes to prevent internal faces
    const hullGeometry = useMemo(() => {
        if (shape?.active && shape.points && shape.points.length > 0) {
            const shapeObj = new THREE.Shape();

            const startPt = shape.points[0];
            shapeObj.moveTo(startPt[0], startPt[1]);
            
            for(let i=1; i<shape.points.length; i++) {
                shapeObj.lineTo(shape.points[i][0], shape.points[i][1]);
            }
            shapeObj.closePath();

            const geom = new THREE.ExtrudeGeometry(shapeObj, {
                depth: h,
                bevelEnabled: false
            });

            geom.rotateX(Math.PI / 2);
            geom.translate(-w / 2, h / 2, -d / 2);

            return geom;
        }

        // Standard Box Fallback
        return new THREE.BoxGeometry(w, h, d);
    }, [w, h, d, shape]);

    const edges = useMemo(() => new THREE.EdgesGeometry(hullGeometry), [hullGeometry]);

    // Refs for Physics Raycasting
    const box = useMemo(() => new THREE.Box3(), []);
    const ray = useMemo(() => new THREE.Ray(), []);
    const intersectionPoint = useMemo(() => new THREE.Vector3(), []);
    const vecToCam = useMemo(() => new THREE.Vector3(), []);
    const worldCenter = useMemo(() => new THREE.Vector3(), []); // Pre-allocated vector to prevent GC spikes in loops

    // OCCLUSION FADING LOGIC
    useFrame((state, delta) => {
        if (!groupRef.current) return;

        // Update Grid Uniform
        if (gridShaderRef.current) {
            gridShaderRef.current.uniforms.showGrid.value = showGrid ? 1.0 : 0.0;
        }

        // --- NEW LOGIC: ENABLE OCCLUSION AS SOON AS GAME STARTS ---
        // Occlusion should be active in PREP, PLAYING and PAUSED.
        // It should ONLY be disabled in IDLE (generating/menu).
        const isGameActive = status !== GameStatus.IDLE;

        if (!isGameActive) {
            // Reset everything to default (fully visible, no wireframe)
            groupRef.current.traverse((child) => {
                if ((child as THREE.Mesh).isMesh && (child.userData.type === 'hull' || child.userData.type === 'detail-fade')) {
                    const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
                    if (mat) {
                        mat.opacity = 1.0;
                        mat.transparent = false;
                        mat.depthWrite = true;
                    }
                }
                if (child.userData.type === 'detail-hide' || child.userData.type === 'roof') {
                    child.visible = true;
                }
                if (child.userData.type === 'wireframe') {
                    child.visible = false;
                }
            });
            return;
        }

        // Skip occlusion check for buildings that are definitely not blocking the player
        // In this isometric view, only buildings within a certain radius or "behind" the player matter
        const distSq = position.distanceToSquared(playerPos.current);
        if (distSq > 2500) { // Approx 50 units
            // Ensure we reset opacity if player moved away
            groupRef.current.traverse((child) => {
                if ((child as THREE.Mesh).isMesh && (child.userData.type === 'hull' || child.userData.type === 'detail-fade')) {
                    const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
                    if (mat && mat.opacity < 0.99) {
                        mat.opacity = THREE.MathUtils.lerp(mat.opacity, 1.0, delta * 5);
                        mat.transparent = mat.opacity < 0.99;
                    }
                }
            });
            return;
        }

        // Setup Ray: Player -> Camera
        ray.origin.copy(playerPos.current);
        // For orthographic camera, the direction to camera is actually constant
        // but we'll use this for simplicity and compatibility with perspective
        vecToCam.subVectors(camera.position, playerPos.current);
        const distToCam = vecToCam.length();
        ray.direction.copy(vecToCam).normalize();

        let isBlocking = false;

        // Check against all physical parts of the building
        for (const part of parts) {
            worldCenter.set(
                position.x + part.pos[0],
                position.y, // part.pos[1] is 0 relative to center
                position.z + part.pos[2]
            );

            const pW = part.size[0];
            const pH = part.size[1];
            const pD = part.size[2];

            box.min.set(worldCenter.x - pW / 2, worldCenter.y - pH / 2, worldCenter.z - pD / 2);
            box.max.set(worldCenter.x + pW / 2, worldCenter.y + pH / 2, worldCenter.z + pD / 2);

            // 1. Is Player INSIDE?
            if (box.containsPoint(playerPos.current)) {
                isBlocking = true;
                break;
            }

            // 2. Does Ray intersect?
            const hit = ray.intersectBox(box, intersectionPoint);
            if (hit) {
                // Ensure hit is actually between player and camera
                if (hit.distanceTo(playerPos.current) < distToCam) {
                    isBlocking = true;
                    break;
                }
            }
        }

        let targetOpacity = 1.0;
        if (isBlocking) {
            // Simple distance based fade for smoother look
            const camDist = camera.position.distanceTo(playerPos.current);
            const bldgDist = position.distanceTo(playerPos.current);
            const t = Math.min(bldgDist / camDist, 1.0);
            targetOpacity = THREE.MathUtils.lerp(0.6, 0.15, t);
        }

        // Calculate if player is standing on TOP of this specific building
        // Visual Building Top is roughly position.y + h/2. 
        // We use a margin of -1.0 so if feet are slightly inside roof, it still counts as "on top"
        const isAbove = playerPos.current.y >= position.y + h / 2 - 1.0;

        groupRef.current.traverse((child) => {
            // Hide Details logic
            if (child.userData.type === 'detail-hide') {
                child.visible = !isBlocking;
            } else if (child.userData.type === 'roof') {
                child.visible = !isBlocking || isAbove;
            } else if (child.userData.type === 'detail-fade' || child.userData.type === 'hull') {
                // Ensure visibility is reset if not blocking, or handle fading
                child.visible = true;
            } else if (child.userData.type === 'wireframe') {
                // Wireframe logic
                if (!showWireframe) {
                    child.visible = false;
                } else {
                    // Fade in wireframe as building fades out
                    // Opacity logic: if targetOpacity is < 0.9, we start showing it.
                    const wireOpacity = 1.0 - targetOpacity;
                    child.visible = wireOpacity > 0.1;
                    if (child.visible) {
                        const mat = (child as THREE.LineSegments).material as THREE.LineBasicMaterial;
                        mat.opacity = THREE.MathUtils.lerp(mat.opacity, wireOpacity * 0.4, delta * 10);
                        mat.transparent = true;
                    }
                }
            }

            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = mesh.material as THREE.MeshStandardMaterial;
                // Fade both Hull and Detail-Fade meshes together
                if (mat && (mesh.userData.type === 'hull' || mesh.userData.type === 'detail-fade')) {
                    if (Math.abs(mat.opacity - targetOpacity) > 0.01) {
                        const fadeSpeed = delta * 8;
                        mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, fadeSpeed);
                        mat.transparent = mat.opacity < 0.99;
                        mat.depthWrite = mat.opacity > 0.8;
                        mat.needsUpdate = true;
                    }
                }
            }
        });
    });

    let roofColor = "#334155";
    if (type === 'factory') {
        roofColor = "#1f2937";
    } else {
        if (h <= 4) roofColor = "#7f1d1d";
        else if (h <= 6) roofColor = "#475569";
        else roofColor = "#0f172a";
    }

    return (
        <group ref={groupRef} position={position}>
            {/* Merged Hull Mesh */}
            <mesh geometry={hullGeometry} castShadow receiveShadow userData={{ type: 'hull' }}>
                <GridMaterial color={color} showGrid={showGrid} floorHeight={FLOOR_HEIGHT} />
            </mesh>

            {/* Wireframe for Transparency Mode */}
            <lineSegments geometry={edges} userData={{ type: 'wireframe' }}>
                <lineBasicMaterial color="#ffffff" transparent opacity={0} depthTest={false} />
            </lineSegments>

            {/* Roofs must still be positioned per part, as they are separate visual toppers */}
            {parts.map((part, i) => (
                <group key={i} position={new THREE.Vector3(...part.pos)}>
                    <group position={[0, h / 2, 0]}>
                        <Roof size={part.size} color={roofColor} />
                    </group>
                </group>
            ))}

            <group userData={{ type: 'detail' }}>
                {windows.map((item, i) => {
                    return <BlinkingWindow key={i} position={item.pos} rotation={item.rot} size={1.0} color="white" type={isFactory ? 'industrial' : 'residential'} forceOn={isFactory ? true : false} />
                })}
            </group>

            <group userData={{ type: 'detail' }}>
                {doors.map((item, i) => {
                    if (item.type === 'industrial') {
                        return <IndustrialDoorBlock key={`door-${i}`} position={item.pos} rotation={item.rot} />
                    }
                    return <DoorBlock key={`door-${i}`} position={item.pos} rotation={item.rot} />
                })}
            </group>

            <group userData={{ type: 'detail' }}>
                {attachedChimneys.map((item, i) => (
                    <Chimney
                        key={`chim-${i}`}
                        position={new THREE.Vector3(...item.pos)}
                        scale={item.scale}
                        color={item.color}
                        smoke={isFactory ? true : (isCooking && item.smoke)}
                        rotation={item.rotation}
                        isIndustrial={isFactory}
                        showGrid={showGrid}
                    />
                ))}
            </group>

            <group userData={{ type: 'detail' }}>
                {acs.map((item, i) => {
                    if (item.type === 'wall') {
                        return <WallAC key={`ac-${i}`} position={new THREE.Vector3(...item.pos)} scale={item.scale} color={item.color} rotation={item.rotation} showGrid={showGrid} />
                    } else {
                        return <RoofAC key={`ac-${i}`} position={new THREE.Vector3(...item.pos)} scale={item.scale} color={item.color} rotation={item.rotation} showGrid={showGrid} />
                    }
                })}
            </group>

            <group userData={{ type: 'detail' }}>
                {ladders.map((item, i) => (
                    <Ladder
                        key={`ladder-${i}`}
                        position={item.pos}
                        rotation={item.rot}
                        height={item.height}
                    />
                ))}
            </group>

            {
                chimney && (
                    <group position={[chimney.position[0] - position.x, 0, chimney.position[2] - position.z]} userData={{ type: 'detail' }}>
                        <Chimney position={new THREE.Vector3(0, chimney.position[1] - position.y, 0)} scale={chimney.scale} color={chimney.color} smoke={isFactory ? true : isCooking} isIndustrial={isFactory} showGrid={showGrid} />
                    </group>
                )
            }
        </group >
    );
};

export const VoxelSeek: React.FC<VoxelSeekProps> = React.memo(({
    status,
    mode,
    match,
    settings,
    timer,
    onRoundEnd,
    onPrepComplete,
    debugMode,
    showGrid,
    showCollision,
    showWireframe,
    isEditing,
    mapId
}) => {
    const { camera, controls } = useThree(); // Access Controls

    const keys = useControls();

    // Physics Refs
    const playerPos = useRef(new THREE.Vector3(0, 0, 0));
    const playerVel = useRef(new THREE.Vector3(0, 0, 0));
    const playerLastDir = useRef(new THREE.Vector2(0, 1));
    const isGrounded = useRef(false);
    const isCharging = useRef(false);
    const isRolling = useRef(false);
    const stamina = useRef(100);
    const stunTimer = useRef(0);
    const jumpDelayTimer = useRef(0);
    const airTimeHighPoint = useRef(0);
    const jumpPressedPrev = useRef(false);
    const rollTimer = useRef(0);
    const jumpBufferTimer = useRef(0);
    const stumbleTimer = useRef(0);
    const stumbleVelocity = useRef(new THREE.Vector3(0, 0, 0));
    const landingAnimTimer = useRef(0);
    const lastFallDist = useRef(0);
    const prevPlayerPos = useRef(new THREE.Vector3(0, 0, 0));
    const smoothedMoveSpeed = useRef(0);

    // --- AI Refs ---
    const aiPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiVel = useRef(new THREE.Vector3(0, 0, 0));
    const aiLastDir = useRef(new THREE.Vector2(0, 1));
    const isAIGrounded = useRef(false);
    const isAICharging = useRef(false);
    const isAIRolling = useRef(false);
    const aiStamina = useRef(100);
    const aiStunTimer = useRef(0);
    const aiJumpDelayTimer = useRef(0);
    const aiAirTimeHighPoint = useRef(0);
    const aiJumpPressedPrev = useRef(false);
    const aiRollTimer = useRef(0);
    const aiJumpBufferTimer = useRef(0);
    const aiStumbleTimer = useRef(0);
    const aiStumbleVelocity = useRef(new THREE.Vector3(0, 0, 0));
    const aiLandingAnimTimer = useRef(0);
    const aiLastFallDist = useRef(0);
    const lastKnownPlayerPos = useRef<THREE.Vector3 | null>(null);
    const lastKnownPlayerDir = useRef<THREE.Vector3 | null>(null);
    const aiLadderState = useRef({
        isClimbing: false,
        isLadderSliding: false,
        isLadderHanging: false,
        isLadderMounting: false,
        ladderMountTimer: 0,
        isWallClimbing: false,
        wallClimbProgress: 0,
        wallClimbDir: new THREE.Vector2(0, 0)
    });

    const playerStartPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiStartPos = useRef(new THREE.Vector3(0, 0, 0));
    
    // AI Visual state 
    // Character Refs for AI
    const aiGroup = useRef<THREE.Group>(null!);
    const prevAIPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiSmoothedMoveSpeed = useRef(0);
    const losLineRef = useRef<any>(null!);
    const lastKnownMarkerRef = useRef<THREE.Mesh>(null!);
    
    const [aiVisualState, setAiVisualState] = useState({
        isCharging: false,
        isRolling: false,
        isGrounded: true,
        isRunning: false,
        isMoving: false,
        moveSpeed: 0,
        isStumbling: false,
        stunned: false,
        landingFactor: 0,
        currentSurface: 0,
        fallDistance: 0,
        justLanded: false,
        isClimbing: false,
        isLadderSliding: false,
        isNearLadder: false,
        isLadderHanging: false,
        isLadderMounting: false,
        ladderFaceAngle: 0,
        isWallClimbing: false,
        wallClimbProgress: 0
    });

    // Character Refs for direct manipulation (if needed)
    const characterGroup = useRef<THREE.Group>(null!);
    const staminaGroup = useRef<HTMLDivElement>(null!);
    const staminaFill = useRef<HTMLDivElement>(null!);

    // Map Data
    const [mapData, setMapData] = useState<{ objects: VoxelObject[], collisionGrid: SpatialHashGrid, bGrid: number[][], wGrid: number[][], sGrid: number[][], tGrid: number[][], spawnPos: THREE.Vector3, ladderZones: { minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, faceAngle: number, railX: number, railZ: number }[], riverOrientation: number, riverFlow: number, worldSize: number } | null>(null);

    // Character Visual State (for animation props)
    const [visualState, setVisualState] = useState({
        isCharging: false,
        isRolling: false,
        isGrounded: true,
        isRunning: false,
        isMoving: false,
        moveSpeed: 0,
        isStumbling: false,
        stunned: false,
        landingFactor: 0,
        currentSurface: 0,
        fallDistance: 0,
        justLanded: false,
        isHiding: false,
        isClimbing: false,
        isLadderSliding: false,
        isNearLadder: false,
        isLadderHanging: false,
        isLadderMounting: false,
        ladderFaceAngle: 0,
        isWallClimbing: false,
        wallClimbProgress: 0
    });

    // Initialization & Map Regeneration
    useEffect(() => {
        // Debounce Level Generation to prevent freezing when moving sliders
        const timeout = setTimeout(() => {
            const spawn = new THREE.Vector2(0, 0);
            const data = generateCityLevel(spawn, settings, mapId, debugMode);
            setMapData(data);

            // Reset Player to Initial Spawn
            playerPos.current.copy(data.spawnPos);
            prevPlayerPos.current.copy(data.spawnPos);
            playerVel.current.set(0, 0, 0);
            isGrounded.current = true;
            airTimeHighPoint.current = data.spawnPos.y;
            stamina.current = 100;
            stunTimer.current = 0;
        }, 150); // 150ms debounce

        return () => clearTimeout(timeout);
    }, [settings.worldSize, settings.riverWidth, settings.ratios, mapId]);

    // Handle Match Start or Respawn (PREP status)
    useEffect(() => {
        if (status === GameStatus.PREP && mapData) {
            // 1. Recalculate a fresh random spawn point on the current map
            const halfSize = Math.floor(settings.worldSize / 2);
            const gridSize = settings.worldSize * GRID_SCALE;

            const isWaterLogic = (lx: number, lz: number) => {
                const startX = worldToIndex(lx, halfSize, settings.worldSize);
                const startZ = worldToIndex(lz, halfSize, settings.worldSize);
                if (startX >= 0 && startX < gridSize && startZ >= 0 && startZ < gridSize) {
                    return mapData.wGrid[startX][startZ] === 1;
                }
                return false;
            };

            // Player Quadrant (1-4)
            const playerQuad = (Math.floor(Math.random() * 4) + 1) as 1 | 2 | 3 | 4;
            const aiQuad = ((playerQuad + 1) % 4 + 1) as 1 | 2 | 3 | 4; 

            const newSpawn = findSpawnPos(
                settings.worldSize,
                halfSize,
                mapData.tGrid,
                mapData.collisionGrid,
                mapData.wGrid,
                isWaterLogic,
                playerQuad
            );

            // 2. Reset Player State to the new random spawn
            playerPos.current.copy(newSpawn);
            prevPlayerPos.current.copy(newSpawn);
            playerStartPos.current.copy(newSpawn);
            playerVel.current.set(0, 0, 0);
            isGrounded.current = true;
            airTimeHighPoint.current = newSpawn.y;
            stamina.current = 100;
            stunTimer.current = 0;

            // Spawn AI on opposite side of the map if in Hide and Seek
            if (mode === GameMode.HIDE_AND_SEEK) {
                let aiSpawn = findSpawnPos(settings.worldSize, halfSize, mapData.tGrid, mapData.collisionGrid, mapData.wGrid, isWaterLogic, aiQuad);
                
                aiPos.current.copy(aiSpawn);
                prevAIPos.current.copy(aiSpawn);
                aiStartPos.current.copy(aiSpawn);
                aiVel.current.set(0, 0, 0);
                isAIGrounded.current = true;
                aiAirTimeHighPoint.current = aiSpawn.y;
                aiStamina.current = 100;
                aiStunTimer.current = 0;
            }

            // 3. Reset Camera & Controls
            if (controls) {
                // @ts-ignore
                if (controls.reset) controls.reset();
            }
            camera.position.set(100, 100, 100);
            camera.lookAt(0, 0, 0);

            // 4. Notify Prep Complete
            onPrepComplete();
        }
    }, [status, mapData]); // Triggers on status change (Respawn/Iniciar) or Map change

    useFrame((state, delta) => {
        if (!mapData) return;
        const dt = Math.min(delta, 0.1);
        let playerCanMove = status === GameStatus.PLAYING || status === GameStatus.PREP;
        let aiCanMove = status === GameStatus.PLAYING || status === GameStatus.PREP;

        if (mode === GameMode.HIDE_AND_SEEK && match.phase === 'WAITING') {
            if (match.playerRole === 'SEEKER') {
                playerCanMove = false; // Player is hunter, cannot move
                aiCanMove = true;      // AI is fugitive, can run
            } else {
                playerCanMove = true;  // Player is fugitive, can run
                aiCanMove = false;     // AI is hunter, cannot move
            }
        }

        const physicsOutput = updatePlayerPhysics(
            dt,
            playerPos.current,
            playerVel.current,
            isGrounded,
            isCharging,
            landingAnimTimer,
            jumpDelayTimer,
            airTimeHighPoint,
            stamina,
            stunTimer,
            stunTimer.current > 0, // Current stunned state
            keys,
            playerLastDir,
            jumpPressedPrev,
            settings.playerSpeed,
            mapData.collisionGrid,
            mapData.bGrid,
            mapData.wGrid,
            settings.worldSize,
            playerCanMove,
            rollTimer,
            jumpBufferTimer,
            isRolling,
            stumbleTimer,
            stumbleVelocity,
            camera, // Pass Camera
            lastFallDist,
            mapData?.riverOrientation ?? -1,
            settings.riverFlow,
            mapData?.ladderZones ?? []
        );

        // Update Character Transform
        if (characterGroup.current) {
            characterGroup.current.position.copy(playerPos.current);

            // ROTATE CHARACTER: Face movement direction or face ladder
            const isOnLadder = physicsOutput.isClimbing || physicsOutput.isLadderSliding || physicsOutput.isLadderHanging || physicsOutput.isLadderMounting;
            if (isOnLadder) {
                // Face the ladder wall
                const targetAngle = physicsOutput.ladderFaceAngle;
                let currentAngle = characterGroup.current.rotation.y;
                let diff = targetAngle - currentAngle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;

                const rotSpeed = 12;
                characterGroup.current.rotation.y += diff * dt * rotSpeed;
            } else if (physicsOutput.pMoving && !physicsOutput.effectiveStunned) {
                // pDir now reflects world direction relative to camera
                const targetAngle = Math.atan2(physicsOutput.pDir.x, physicsOutput.pDir.z);
                let currentAngle = characterGroup.current.rotation.y;
                let diff = targetAngle - currentAngle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;

                const rotSpeed = 15;
                characterGroup.current.rotation.y += diff * dt * rotSpeed;
            }
        }
        
        // --- AI LOGIC ---
        let aiCatchTriggered = false;
        
        if (mode === GameMode.HIDE_AND_SEEK && status === GameStatus.PLAYING) {
            const aiInput: { moveDir: THREE.Vector3, jump: boolean, run: boolean, ladderUp?: boolean, ladderDown?: boolean } = { 
                moveDir: new THREE.Vector3(), jump: false, run: true, ladderUp: false, ladderDown: false 
            };
            
            // Artificial Steering Logic 
            const isSeeker = match.playerRole === 'HIDER'; // Since player is Hider, AI is Seeker
            
            // VISION CHECK
            const aiEyePos = aiPos.current.clone().add(new THREE.Vector3(0, 3.5, 0));
            const playerVisualPos = playerPos.current.clone().add(new THREE.Vector3(0, 3.5, 0));
            const isVisible = checkLineOfSight(aiEyePos, playerVisualPos, mapData.collisionGrid);
            
            if (isVisible) {
                if (!lastKnownPlayerPos.current) lastKnownPlayerPos.current = new THREE.Vector3();
                if (!lastKnownPlayerDir.current) lastKnownPlayerDir.current = new THREE.Vector3();
                lastKnownPlayerPos.current.copy(playerPos.current);
                if (playerVel.current.lengthSq() > 0.1) {
                    lastKnownPlayerDir.current.copy(playerVel.current);
                    lastKnownPlayerDir.current.y = 0;
                    if (lastKnownPlayerDir.current.lengthSq() > 0) lastKnownPlayerDir.current.normalize();
                }
            }
            
            // --- DEBUG GRAPHICS UPDATE ---
            if (debugMode && losLineRef.current && lastKnownMarkerRef.current) {
                losLineRef.current.visible = true;
                const positions = new Float32Array([
                    aiEyePos.x, aiEyePos.y, aiEyePos.z,
                    playerVisualPos.x, playerVisualPos.y, playerVisualPos.z
                ]);
                losLineRef.current.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                const mat = losLineRef.current.material as THREE.LineBasicMaterial;
                mat.color.set(isVisible ? 0x00ff00 : 0xff0000);
                
                if (lastKnownPlayerPos.current) {
                    lastKnownMarkerRef.current.position.copy(lastKnownPlayerPos.current).add(new THREE.Vector3(0, 2, 0));
                    lastKnownMarkerRef.current.visible = true;
                } else {
                    lastKnownMarkerRef.current.visible = false;
                }
            } else if (losLineRef.current && lastKnownMarkerRef.current) {
                losLineRef.current.visible = false;
                lastKnownMarkerRef.current.visible = false;
            }
            
            const targetPos = lastKnownPlayerPos.current || playerPos.current;

            const dist = aiPos.current.distanceTo(playerPos.current);
            
            const dirToTarget = new THREE.Vector3().subVectors(targetPos, aiPos.current);
            const dyToPlayer = dirToTarget.y; 
            dirToTarget.y = 0;
            const distXZ = dirToTarget.length(); 
            
            const actualDirToPlayer = new THREE.Vector3().subVectors(playerPos.current, aiPos.current);
            actualDirToPlayer.y = 0;
            const actualDistXZ = actualDirToPlayer.length();

            // 1. Stamina Management
            if (aiStamina.current < 25) {
                aiInput.run = false; // Walk to recover
            } else if (aiStamina.current > 60) {
                if (isSeeker) aiInput.run = true;
                else aiInput.run = actualDistXZ < 30;
            } else {
                aiInput.run = isSeeker ? true : actualDistXZ < 20; // Hysteresis approximation
            }
            
            if (match.phase === 'WAITING') {
                // If it's waiting phase and AI is seeker, stay still.
                if (isSeeker) {
                    aiInput.moveDir.set(0, 0, 0);
                    aiInput.run = false;
                } else {
                    // AI is hider, run away from player initially
                    aiInput.moveDir.copy(dirToTarget).negate().normalize();
                }
            } else {
                // HUNTING Phase
                if (isSeeker) {
                    if (distXZ > 1.0) {
                        aiInput.moveDir.copy(dirToTarget).normalize();
                    } else {
                        if (!isVisible && lastKnownPlayerPos.current) {
                            if (lastKnownPlayerDir.current && lastKnownPlayerDir.current.lengthSq() > 0.1) {
                                // First time reached last known pos: Extrapolate!
                                lastKnownPlayerPos.current.add(lastKnownPlayerDir.current.clone().multiplyScalar(15.0));
                                lastKnownPlayerDir.current.set(0, 0, 0); // Clear so next time it patrols
                            } else {
                                // Reached extrapolated point or previous patrol point: Patrol!
                                const angle = Math.random() * Math.PI * 2;
                                const patrolDist = 10 + Math.random() * 10;
                                lastKnownPlayerPos.current.set(
                                    aiPos.current.x + Math.cos(angle) * patrolDist,
                                    aiPos.current.y,
                                    aiPos.current.z + Math.sin(angle) * patrolDist
                                );
                            }
                            
                            // Clamp to map bounds
                            const boundHalf = Math.floor(settings.worldSize / 2) - 2;
                            lastKnownPlayerPos.current.x = THREE.MathUtils.clamp(lastKnownPlayerPos.current.x, -boundHalf, boundHalf);
                            lastKnownPlayerPos.current.z = THREE.MathUtils.clamp(lastKnownPlayerPos.current.z, -boundHalf, boundHalf);
                            
                            // Ensure it's not inside a building by snapping to terrain/roof
                            const tH = getTerrainHeight(lastKnownPlayerPos.current.x, lastKnownPlayerPos.current.z, 1000, mapData.collisionGrid, mapData.bGrid, mapData.wGrid, settings.worldSize, 0.6);
                            if (tH > -Infinity) {
                                lastKnownPlayerPos.current.y = tH;
                            }
                            
                        } else {
                            aiInput.moveDir.set(0, 0, 0);
                            aiInput.run = false;
                        }
                    }
                    
                    // Walk while patrolling to save stamina
                    if (!isVisible && (!lastKnownPlayerDir.current || lastKnownPlayerDir.current.lengthSq() === 0)) {
                        aiInput.run = false;
                    }

                    // Catch logic!
                    if (dist < 1.5) {
                        aiCatchTriggered = true;
                    }
                } else {
                    // AI is hider
                    if (distXZ > 0.5) {
                        aiInput.moveDir.copy(dirToTarget).negate().normalize();
                        
                        // Stop and hide to save stamina if far from last known position and without line of sight
                        if (!isVisible && distXZ > 30) {
                            aiInput.moveDir.set(0, 0, 0);
                            aiInput.run = false;
                        }
                    } else {
                        aiInput.moveDir.set(0, 0, 0);
                    }
                    // Catch logic (player caught ai)
                    if (dist < 1.5) {
                        aiCatchTriggered = true;
                    }
                }
            }
            
            // Advanced Hiding: seek cover behind objects if hider
            if (!isSeeker && match.phase === 'HUNTING' && aiInput.moveDir.lengthSq() > 0) {
                const nearbyObjects = mapData.collisionGrid.query(aiPos.current.x, aiPos.current.z, 8.0);
                if (nearbyObjects.length > 0) {
                    // Find a big enough object to hide behind
                    const cover = nearbyObjects.find((b: any) => b.maxY > Math.max(aiPos.current.y, 1.0) + 2.0 && b.minY <= aiPos.current.y + 0.5);
                    if (cover) {
                        const coverCenter = new THREE.Vector3(
                            (cover.minX + cover.maxX) / 2,
                            0,
                            (cover.minZ + cover.maxZ) / 2
                        );
                        const dirCoverToPlayer = new THREE.Vector3().subVectors(playerPos.current, coverCenter).normalize();
                        const hideDist = Math.max((cover.maxX - cover.minX)/2, (cover.maxZ - cover.minZ)/2) + 1.0;
                        const hideSpot = new THREE.Vector3().copy(coverCenter).add(dirCoverToPlayer.negate().multiplyScalar(hideDist));
                        
                        hideSpot.y = aiPos.current.y;
                        const distToHide = hideSpot.distanceTo(aiPos.current);
                        if (distToHide > 1.0) {
                            aiInput.moveDir.copy(hideSpot).sub(aiPos.current).normalize();
                        } else {
                            // AI is hidden behind object relative to player, and can stay put or crouch
                            aiInput.moveDir.set(0, 0, 0);
                        }
                    }
                }
            }
            
            // 2. Obstacle Avoidance (Steering)
            if (aiInput.moveDir.lengthSq() > 0) {
                const lookAheadDist = 2.0;
                const aiRadius = 0.5;
                const p = aiPos.current;
                const d = aiInput.moveDir;
                
                const checkX = p.x + d.x * lookAheadDist;
                const checkZ = p.z + d.z * lookAheadDist;
                const filterObstacles = (b: any) => {
                    if (b.maxY <= p.y + 0.1 || b.minY >= p.y + 1.0) return false;
                    const isClimbable = b.maxY <= p.y + 4.0; // PLAYER_HEIGHT is 4.0
                    return !(isClimbable && dyToPlayer > -1.0);
                };
                
                const rawBoxes = mapData.collisionGrid.query(checkX, checkZ, aiRadius);
                const boxes = rawBoxes.filter(filterObstacles);
                
                if (boxes.length > 0) {
                    // Try diagonal avoidance instead of hard 90 degree turns
                    const rightWhiskerDir = new THREE.Vector3(d.x + d.z, 0, d.z - d.x).normalize();
                    const leftWhiskerDir = new THREE.Vector3(d.x - d.z, 0, d.z + d.x).normalize();
                    
                    const rightCheckX = p.x + rightWhiskerDir.x * lookAheadDist;
                    const rightCheckZ = p.z + rightWhiskerDir.z * lookAheadDist;
                    const rightBoxes = mapData.collisionGrid.query(rightCheckX, rightCheckZ, aiRadius).filter(filterObstacles);
                    
                    const leftCheckX = p.x + leftWhiskerDir.x * lookAheadDist;
                    const leftCheckZ = p.z + leftWhiskerDir.z * lookAheadDist;
                    const leftBoxes = mapData.collisionGrid.query(leftCheckX, leftCheckZ, aiRadius).filter(filterObstacles);
                    
                    if (rightBoxes.length < boxes.length && rightBoxes.length <= leftBoxes.length) {
                        aiInput.moveDir.add(rightWhiskerDir.multiplyScalar(1.5)).normalize();
                    } else if (leftBoxes.length < boxes.length) {
                        aiInput.moveDir.add(leftWhiskerDir.multiplyScalar(1.5)).normalize();
                    } else {
                        // If diagonals are also blocked, do a sharper 90 degree turn
                        const hardRightDir = new THREE.Vector3(d.z, 0, -d.x);
                        aiInput.moveDir.add(hardRightDir.multiplyScalar(2.0)).normalize();
                    }
                    
                    // Small jump for minor obstacles removed
                }
            }
            
            const isAIOnLadder = aiLadderState.current.isClimbing || aiLadderState.current.isLadderSliding || aiLadderState.current.isLadderHanging || aiLadderState.current.isLadderMounting;

            // Stuck detection & jump logic for AI (fallback)
            if (!isAIOnLadder && aiInput.moveDir.lengthSq() > 0 && Math.abs(aiVel.current.x) < 0.5 && Math.abs(aiVel.current.z) < 0.5 && isAIGrounded.current) {
                // Jump removed to avoid unnecessary jumping
            }
            
            const aiPhysicsOutput = updatePlayerPhysics(
                dt, aiPos.current, aiVel.current, isAIGrounded, isAICharging, aiLandingAnimTimer, aiJumpDelayTimer,
                aiAirTimeHighPoint, aiStamina, aiStunTimer, aiStunTimer.current > 0, keys /* unused by ai */,
                aiLastDir, aiJumpPressedPrev, settings.playerSpeed * 0.95, // AI is slightly slower for fairness
                mapData.collisionGrid, mapData.bGrid, mapData.wGrid, settings.worldSize, aiCanMove,
                aiRollTimer, aiJumpBufferTimer, isAIRolling, aiStumbleTimer, aiStumbleVelocity,
                camera, aiLastFallDist, mapData?.riverOrientation ?? -1, settings.riverFlow,
                mapData?.ladderZones ?? [],
                aiInput,
                aiLadderState
            );
            
            // AI Visual Transformation
            if (aiGroup.current) {
                aiGroup.current.position.copy(aiPos.current);
                
                const isAIOtherLadder = aiPhysicsOutput.isClimbing || aiPhysicsOutput.isLadderSliding || aiPhysicsOutput.isLadderHanging || aiPhysicsOutput.isLadderMounting;
                if (isAIOtherLadder) {
                    const targetAngle = aiPhysicsOutput.ladderFaceAngle;
                    let currentAngle = aiGroup.current.rotation.y;
                    let diff = targetAngle - currentAngle;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    aiGroup.current.rotation.y += diff * dt * 12;
                } else if (aiPhysicsOutput.pMoving && !aiPhysicsOutput.effectiveStunned) {
                    const targetAngle = Math.atan2(aiPhysicsOutput.pDir.x, aiPhysicsOutput.pDir.z);
                    let currentAngle = aiGroup.current.rotation.y;
                    let diff = targetAngle - currentAngle;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    aiGroup.current.rotation.y += diff * dt * 15;
                }
            }

            // Sync AI Visual State
            const aiDx = aiPos.current.x - prevAIPos.current.x;
            const aiDz = aiPos.current.z - prevAIPos.current.z;
            const aiRawMoveSpeed = dt > 0 ? Math.sqrt(aiDx * aiDx + aiDz * aiDz) / dt : 0;
            aiSmoothedMoveSpeed.current = THREE.MathUtils.lerp(aiSmoothedMoveSpeed.current, aiRawMoveSpeed, dt * 10);
            prevAIPos.current.copy(aiPos.current);
            
            setAiVisualState({
                isCharging: aiPhysicsOutput.isCharging,
                isRolling: aiPhysicsOutput.isRolling,
                isGrounded: aiPhysicsOutput.isGrounded,
                isRunning: aiPhysicsOutput.isRunning,
                isMoving: aiPhysicsOutput.pMoving,
                moveSpeed: aiSmoothedMoveSpeed.current,
                isStumbling: aiPhysicsOutput.isStumbling,
                stunned: aiPhysicsOutput.effectiveStunned,
                landingFactor: aiPhysicsOutput.landingFactor,
                currentSurface: 0, // AI doesn't need precise footstep surface
                fallDistance: aiPhysicsOutput.fallDistance,
                justLanded: aiPhysicsOutput.justLanded,
                isClimbing: aiPhysicsOutput.isClimbing,
                isLadderSliding: aiPhysicsOutput.isLadderSliding,
                isNearLadder: aiPhysicsOutput.isNearLadder,
                isLadderHanging: aiPhysicsOutput.isLadderHanging,
                isLadderMounting: aiPhysicsOutput.isLadderMounting,
                ladderFaceAngle: aiPhysicsOutput.ladderFaceAngle,
                isWallClimbing: aiPhysicsOutput.isWallClimbing,
                wallClimbProgress: aiPhysicsOutput.wallClimbProgress
            });
            
            if (aiCatchTriggered) {
                // If the player was the SEEKER, they caught the AI. True = Player Won
                onRoundEnd(match.playerRole === 'SEEKER');
            }
        }

        // Update Stamina Bar
        if (staminaFill.current && staminaGroup.current) {
            const s = Math.max(0, stamina.current / 100);
            staminaFill.current.style.width = `${s * 100}%`;

            if (physicsOutput.effectiveStunned) {
                staminaFill.current.style.backgroundColor = '#9ca3af';
            } else {
                const hue = s * 120;
                staminaFill.current.style.backgroundColor = `hsl(${hue}, 100%, 50%)`;
            }

            staminaGroup.current.style.display = s < 0.99 ? 'block' : 'none';
        }

        // Determine Surface
        let currentSurface = 0;
        if (mapData) {
            const halfSize = Math.floor(settings.worldSize / 2);
            const ix = worldToIndex(playerPos.current.x, halfSize, settings.worldSize);
            const iz = worldToIndex(playerPos.current.z, halfSize, settings.worldSize);
            if (mapData.sGrid[ix]?.[iz] !== undefined) {
                currentSurface = mapData.sGrid[ix][iz];
            }
        }

        // --- HIDING LOGIC ---
        let isHiding = false;

        const dx = playerPos.current.x - prevPlayerPos.current.x;
        const dz = playerPos.current.z - prevPlayerPos.current.z;
        const rawMoveSpeed = dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
        smoothedMoveSpeed.current = THREE.MathUtils.lerp(smoothedMoveSpeed.current, rawMoveSpeed, dt * 10);
        const currentMoveSpeed = smoothedMoveSpeed.current;
        prevPlayerPos.current.copy(playerPos.current);

        // Sync Visual State
        const newVisualState = {
            isCharging: physicsOutput.isCharging,
            isRolling: physicsOutput.isRolling,
            isGrounded: physicsOutput.isGrounded,
            isRunning: physicsOutput.isRunning,
            isStumbling: physicsOutput.isStumbling,
            stunned: physicsOutput.effectiveStunned,
            isMoving: physicsOutput.pMoving,
            moveSpeed: currentMoveSpeed,
            landingFactor: physicsOutput.landingFactor,
            currentSurface: currentSurface,
            fallDistance: physicsOutput.fallDistance,
            justLanded: physicsOutput.justLanded,
            isHiding: isHiding,
            isClimbing: physicsOutput.isClimbing,
            isLadderSliding: physicsOutput.isLadderSliding,
            isNearLadder: physicsOutput.isNearLadder,
            isLadderHanging: physicsOutput.isLadderHanging,
            isLadderMounting: physicsOutput.isLadderMounting,
            ladderFaceAngle: physicsOutput.ladderFaceAngle,
            isWallClimbing: physicsOutput.isWallClimbing,
            wallClimbProgress: physicsOutput.wallClimbProgress
        };

        // Simple shallow compare
        let changed = false;
        if (newVisualState.isCharging !== visualState.isCharging) changed = true;
        else if (newVisualState.isRolling !== visualState.isRolling) changed = true;
        else if (newVisualState.isGrounded !== visualState.isGrounded) changed = true;
        else if (newVisualState.isRunning !== visualState.isRunning) changed = true;
        else if (newVisualState.isStumbling !== visualState.isStumbling) changed = true;
        else if (newVisualState.stunned !== visualState.stunned) changed = true;
        else if (newVisualState.isMoving !== visualState.isMoving) changed = true;
        else if (Math.abs(newVisualState.moveSpeed - visualState.moveSpeed) > 0.1) changed = true;
        else if (Math.abs(newVisualState.landingFactor - visualState.landingFactor) > 0.05) changed = true;
        else if (newVisualState.currentSurface !== visualState.currentSurface) changed = true;
        else if (Math.abs(newVisualState.fallDistance - visualState.fallDistance) > 0.1) changed = true;
        else if (newVisualState.justLanded !== visualState.justLanded) changed = true;
        else if (newVisualState.isHiding !== visualState.isHiding) changed = true;
        else if (newVisualState.isClimbing !== visualState.isClimbing) changed = true;
        else if (newVisualState.isLadderSliding !== visualState.isLadderSliding) changed = true;
        else if (newVisualState.isNearLadder !== visualState.isNearLadder) changed = true;
        else if (newVisualState.isLadderHanging !== visualState.isLadderHanging) changed = true;
        else if (newVisualState.isLadderMounting !== visualState.isLadderMounting) changed = true;
        else if (newVisualState.isWallClimbing !== visualState.isWallClimbing) changed = true;
        else if (Math.abs(newVisualState.wallClimbProgress - visualState.wallClimbProgress) > 0.05) changed = true;

        if (changed) {
            setVisualState(newVisualState);
        }

        // Camera Handling
        if (status === GameStatus.IDLE) {
            // Force Static Isometric View centered on World Center (0,0,0)
            const target = new THREE.Vector3(0, 0, 0);
            const camPos = new THREE.Vector3(100, 100, 100);

            camera.position.lerp(camPos, dt * 2);

            if (controls) {
                // @ts-ignore
                controls.target.lerp(target, dt * 5);
                // @ts-ignore
                controls.update();
            }
        }
        else if (settings.cameraFollow) {
            // Cast controls to any to access OrbitControls properties
            const ctrl = controls as unknown as { target: THREE.Vector3, update: () => void } | null;

            const target = playerPos.current.clone();

            // Simple follow: smooth lerp to target position
            if (ctrl) {
                ctrl.target.lerp(target, dt * 3.0);
                ctrl.update();
            }
        }

        // --- FALL SAFETY (DEATH ZONE) ---
        if ((playerCanMove || aiCanMove) && mapData && status === GameStatus.PLAYING) {
            if (playerPos.current.y < -10) {
                playerPos.current.copy(playerStartPos.current);
                playerVel.current.set(0, 0, 0);
            }
            if (aiPos.current.y < -10) {
                aiPos.current.copy(aiStartPos.current);
                aiVel.current.set(0, 0, 0);
            }
        }
    });

    // Memoize Map Rendering
    const mapElements = useMemo(() => {
        if (!mapData) return null;

        const ruins = mapData.objects.filter(o => o.type === 'ruin');
        const fences = mapData.objects.filter(o => o.type === 'fence');
        const wheat = mapData.objects.filter(o => o.type === 'wheat');
        const foliage = mapData.objects.filter(o => o.type === 'foliage');
        const buildings = mapData.objects.filter(o => o.type !== 'ruin' && o.type !== 'fence' && o.type !== 'wheat' && o.type !== 'foliage');

        return (
            <>
                <VoxelGround size={mapData.worldSize} waterGrid={mapData.wGrid} sGrid={mapData.sGrid} debugMode={debugMode} showGrid={showGrid} />
                <VoxelWater size={mapData.worldSize} waterGrid={mapData.wGrid} riverOrientation={mapData.riverOrientation} riverFlow={settings.riverFlow} />
                <VoxelRuins ruins={ruins} showGrid={showGrid} />
                <VoxelFences fences={fences} />
                <VoxelFoliage objects={foliage} />
                <WheatField wheatObjects={wheat} playerPos={playerPos} />
                {buildings.map(obj => (
                    <Building
                        key={obj.id}
                        position={new THREE.Vector3(...obj.position)}
                        scale={obj.scale}
                        color={obj.color}
                        type={obj.type as any}
                        playerPos={playerPos}
                        playerVel={playerVel}
                        chimney={obj.chimney}
                        attachedChimneys={obj.attachedChimneys}
                        acs={obj.acs}
                        shape={obj.shape}
                        windows={obj.windows}
                        doors={obj.doors}
                        ladders={obj.ladders}
                        variant={obj.variant}
                        showWireframe={showWireframe}
                        showGrid={showGrid}
                        status={status}
                        debugMode={debugMode}
                    />
                ))}
            </>
        );
    }, [mapData, debugMode, showGrid, showWireframe, status, settings.riverFlow]);

    if (!mapData) return null;

    return (
        <group>
            {mapElements}
            {debugMode && mapData && (
                <CollisionDebug collisionGrid={mapData.collisionGrid} bGrid={mapData.bGrid} size={mapData.worldSize} visible={!!showCollision} />
            )}
            
            {/* AI DEBUG VISUALIZERS */}
            <lineSegments ref={losLineRef} visible={false}>
                <bufferGeometry attach="geometry" />
                <lineBasicMaterial attach="material" color="green" linewidth={2} />
            </lineSegments>
            
            <mesh ref={lastKnownMarkerRef} visible={false}>
                <boxGeometry args={[1, 4, 1]} />
                <meshBasicMaterial color="yellow" wireframe={true} transparent opacity={0.6} depthTest={false} />
            </mesh>
            {status !== GameStatus.IDLE && (
                <>
                    <Character
                        groupRef={characterGroup}
                        staminaFillRef={staminaFill}
                        staminaGroupRef={staminaGroup}
                        stunned={visualState.stunned}
                        isCharging={visualState.isCharging}
                        isRolling={visualState.isRolling}
                        isStumbling={visualState.isStumbling}
                        isRunning={visualState.isRunning}
                        isMoving={visualState.isMoving}
                        moveSpeed={visualState.moveSpeed}
                        isGrounded={visualState.isGrounded}
                        landingFactor={visualState.landingFactor}
                        stunTimerRef={stunTimer}
                        rollTimerRef={rollTimer}
                        staminaRef={stamina}
                        currentSurface={visualState.currentSurface}
                        fallDistance={visualState.fallDistance}
                        justLanded={visualState.justLanded}
                        isHiding={visualState.isHiding}
                        isClimbing={visualState.isClimbing}
                        isLadderSliding={visualState.isLadderSliding}
                        isNearLadder={visualState.isNearLadder}
                        isLadderHanging={visualState.isLadderHanging}
                        isLadderMounting={visualState.isLadderMounting}
                        ladderFaceAngle={visualState.ladderFaceAngle}
                        isWallClimbing={visualState.isWallClimbing}
                        color="#3b82f6"
                        overlayContent={
                            mode === GameMode.HIDE_AND_SEEK && match.phase === 'WAITING' && (
                                <div className="flex flex-col items-center select-none pointer-events-none">
                                    <div className="bg-black/80 backdrop-blur-sm text-white border-2 border-[#3b82f6] px-4 py-1.5 rounded-full text-sm font-black mb-2 pixel-font tracking-widest animate-bounce shadow-[0_0_15px_rgba(59,130,246,0.6)]">
                                        VOCÊ
                                    </div>
                                    <div className="text-6xl font-black pixel-font text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] animate-pulse">
                                        {timer}
                                    </div>
                                </div>
                            )
                        }
                    />

                    {mode === GameMode.HIDE_AND_SEEK && (
                        <Character
                            groupRef={aiGroup}
                            stunned={aiVisualState.stunned}
                            isCharging={aiVisualState.isCharging}
                            isRolling={aiVisualState.isRolling}
                            isStumbling={aiVisualState.isStumbling}
                            isRunning={aiVisualState.isRunning}
                            isMoving={aiVisualState.isMoving}
                            moveSpeed={aiVisualState.moveSpeed}
                            isGrounded={aiVisualState.isGrounded}
                            landingFactor={aiVisualState.landingFactor}
                            stunTimerRef={aiStunTimer}
                            rollTimerRef={aiRollTimer}
                            staminaRef={aiStamina}
                            currentSurface={aiVisualState.currentSurface}
                            fallDistance={aiVisualState.fallDistance}
                            justLanded={aiVisualState.justLanded}
                            isHiding={false}
                            isClimbing={aiVisualState.isClimbing}
                            isLadderSliding={aiVisualState.isLadderSliding}
                            isNearLadder={aiVisualState.isNearLadder}
                            isLadderHanging={aiVisualState.isLadderHanging}
                            isLadderMounting={aiVisualState.isLadderMounting}
                            ladderFaceAngle={aiVisualState.ladderFaceAngle}
                            isWallClimbing={aiVisualState.isWallClimbing}
                            wallClimbProgress={aiVisualState.wallClimbProgress}
                            overlayContent={null}
                            color="#ef4444" // AI Color
                        />
                    )}
                </>
            )}
        </group>
    );
});
