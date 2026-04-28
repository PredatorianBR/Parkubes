import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GameStatus, VoxelObject, GameSettings, Position, GameMode, MatchState } from '../types';
import { Character, MatchTimerOverlay } from './Character';
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
import { Line } from '@react-three/drei';


interface VoxelSeekProps {
    status: GameStatus;
    mode: GameMode;
    match: MatchState;
    settings: GameSettings;
    onRoundEnd: (playerWon: boolean) => void;
    onPrepComplete: () => void;
    debugMode?: boolean;
    showGrid?: boolean;
    showCollision?: boolean;
    showWireframe?: boolean; // NEW PROP
    showOcclusion?: boolean;
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

const OcclusionCylinderDebug: React.FC<{ playerPos: React.MutableRefObject<THREE.Vector3>, playerLastDir: React.MutableRefObject<THREE.Vector2>, visible: boolean }> = React.memo(({ playerPos, playerLastDir, visible }) => {
    const meshRef = useRef<THREE.Group>(null!);
    
    useFrame(() => {
        if (!meshRef.current || !visible) return;
        meshRef.current.position.copy(playerPos.current);
        
        const angle = Math.atan2(playerLastDir.current.x, playerLastDir.current.y);
        meshRef.current.rotation.y = angle;
    });

    return (
        <group ref={meshRef} visible={visible}>
            <mesh position={[0, 2.8, 6.0]} rotation={[-Math.PI / 2, 0, 0]}>
                <coneGeometry args={[2.0, 12.0, 32]} />
                <meshBasicMaterial color="#eab308" wireframe transparent opacity={0.4} depthTest={false} />
            </mesh>
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
    playerLastDir: React.MutableRefObject<THREE.Vector2>;
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
}> = React.memo(({ position, scale, color, type, playerPos, playerVel, playerLastDir, chimney, attachedChimneys = [], acs = [], shape, windows = [], doors = [], ladders = [], variant = 0, isLit = false, isCooking = false, showWireframe = false, showGrid = false, status, debugMode }) => {
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

    const { hullGeometry, fillGeometry, wireframeEdges } = useMemo(() => {
        let hGeom: THREE.BufferGeometry;
        const hw = (w || 1) / 2, hd = (d || 1) / 2;

        // --- Build the union footprint shape (building + wall attachments) ---
        const allAtts = [...(attachedChimneys || []), ...(acs || [])];
        
        // Classify attachments by which wall they protrude from
        interface WallBump { min: number; max: number; depth: number; }
        const rightBumps: WallBump[] = [];
        const leftBumps: WallBump[] = [];
        const backBumps: WallBump[] = [];  // z = -hd
        const frontBumps: WallBump[] = []; // z = +hd

        allAtts.forEach(att => {
            if (!att?.pos || !att?.scale) return;
            const [ax, , az] = att.pos as [number, number, number];
            const [rawW, , rawD] = att.scale as [number, number, number];
            if (rawW <= 0 || rawD <= 0) return;

            // Account for rotation: swap width/depth when rotated ~90 degrees
            const rot = (att as any).rotation || 0;
            const isRotated = Math.abs(Math.sin(rot)) > 0.5;
            const aw = isRotated ? rawD : rawW;
            const ad = isRotated ? rawW : rawD;

            const WALL_THRESHOLD = 2.0;

            if (ax > hw - WALL_THRESHOLD && (ax + aw / 2) > hw) {
                rightBumps.push({ min: az - ad / 2, max: az + ad / 2, depth: (ax + aw / 2) - hw });
            } else if (ax < -hw + WALL_THRESHOLD && (ax - aw / 2) < -hw) {
                leftBumps.push({ min: az - ad / 2, max: az + ad / 2, depth: -hw - (ax - aw / 2) });
            } else if (az < -hd + WALL_THRESHOLD && (az - ad / 2) < -hd) {
                backBumps.push({ min: ax - aw / 2, max: ax + aw / 2, depth: -hd - (az - ad / 2) });
            } else if (az > hd - WALL_THRESHOLD && (az + ad / 2) > hd) {
                frontBumps.push({ min: ax - aw / 2, max: ax + aw / 2, depth: (az + ad / 2) - hd });
            }
        });

        // Sort bumps along each wall's travel direction
        backBumps.sort((a, b) => a.min - b.min);
        rightBumps.sort((a, b) => a.min - b.min);
        frontBumps.sort((a, b) => b.max - a.max);
        leftBumps.sort((a, b) => b.max - a.max);

        // --- Base footprint shape ---
        const fillGeoms: THREE.BufferGeometry[] = [];

        if (shape?.active && shape.points && shape.points.length >= 3) {
            // Always use shape.points as the base footprint
            const baseShape = new THREE.Shape();
            const startPt = shape.points[0];
            baseShape.moveTo(startPt[0] - hw, startPt[1] - hd);
            for (let i = 1; i < shape.points.length; i++) {
                baseShape.lineTo(shape.points[i][0] - hw, shape.points[i][1] - hd);
            }
            baseShape.closePath();
            const baseGeom = new THREE.ShapeGeometry(baseShape);
            baseGeom.rotateX(Math.PI / 2);
            fillGeoms.push(baseGeom);
        } else {
            const baseGeom = new THREE.PlaneGeometry(w || 1, d || 1);
            baseGeom.rotateX(-Math.PI / 2);
            fillGeoms.push(baseGeom);
        }

        // Add chimney/AC protruding footprints as separate planes
        allAtts.forEach(att => {
            if (!att?.pos || !att?.scale) return;
            const [ax, , az] = att.pos as [number, number, number];
            const [rawW, , rawD] = att.scale as [number, number, number];
            if (rawW <= 0 || rawD <= 0) return;
            const rot = (att as any).rotation || 0;
            const isRotated = Math.abs(Math.sin(rot)) > 0.5;
            const aw = isRotated ? rawD : rawW;
            const ad = isRotated ? rawW : rawD;

            const g = new THREE.PlaneGeometry(aw, ad);
            g.rotateX(-Math.PI / 2);
            g.translate(ax, 0, az);
            fillGeoms.push(g);
        });

        // --- Hull (3D building body) ---
        if (shape?.active && shape.points && shape.points.length >= 3) {
            try {
                const shapeObj = new THREE.Shape();
                const startPt = shape.points[0];
                shapeObj.moveTo(startPt[0], startPt[1]);
                for (let i = 1; i < shape.points.length; i++) shapeObj.lineTo(shape.points[i][0], shape.points[i][1]);
                shapeObj.closePath();

                hGeom = new THREE.ExtrudeGeometry(shapeObj, { depth: h || 1, bevelEnabled: false });
                hGeom.rotateX(Math.PI / 2);
                hGeom.translate(-hw, h / 2, -hd);
            } catch (e) {
                hGeom = new THREE.BoxGeometry(w || 1, h || 1, d || 1);
            }
        } else {
            hGeom = new THREE.BoxGeometry(w || 1, h || 1, d || 1);
        }

        // --- Fill + Wireframe ---
        const mergedFill = fillGeoms.length > 1 ? mergeGeometries(fillGeoms) : fillGeoms[0];
        const fillGeom = mergedFill || fillGeoms[0];

        const edgesGeom = new THREE.EdgesGeometry(fillGeom, 1);

        return { 
            hullGeometry: hGeom, 
            fillGeometry: fillGeom,
            wireframeEdges: edgesGeom
        };
    }, [w, h, d, shape, attachedChimneys, acs]);



    // Refs for Physics Raycasting
    const box = useMemo(() => new THREE.Box3(), []);
    const ray = useMemo(() => new THREE.Ray(), []);
    const intersectionPoint = useMemo(() => new THREE.Vector3(), []);
    const vecToCam = useMemo(() => new THREE.Vector3(), []);
    const worldCenter = useMemo(() => new THREE.Vector3(), []); // Pre-allocated vector to prevent GC spikes in loops
    const playerPartPos = useMemo(() => new THREE.Vector3(), []); // NEW: Pre-allocated for multi-point occlusion

    // Offsets to cover the character's volume (approx 0.7 radius, 3.8 height) plus expanded volume for alleyway clearance
    const dynamicOffsets = useMemo(() => [
        new THREE.Vector3(0, 0.5, 0),    // Feet level
        new THREE.Vector3(0, 1.8, 0),    // Mid level
        new THREE.Vector3(0, 3.4, 0),    // Head level
        // Dynamic Cone Points (Pre-allocated, updated in useFrame)
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0)
    ], []);

    // OCCLUSION FADING LOGIC
    const frameCount = useRef(Math.floor(Math.random() * 10)); // Individual building offset
    const isBlockingRef = useRef(false);

    useFrame((state, delta) => {
        if (!groupRef.current) return;

        frameCount.current++;
        const shouldUpdateOcclusion = frameCount.current % 6 === 0;

        if (shouldUpdateOcclusion && playerLastDir?.current) {
            const dirX = playerLastDir.current.x;
            const dirZ = playerLastDir.current.y;
            const perpX = -dirZ;
            const perpZ = dirX;
            const len = dynamicOffsets.length;
            // Flare at mid-distance (thinner, longer)
            dynamicOffsets[len - 4].set(dirX * 6.0 + perpX * 1.0, 2.8, dirZ * 6.0 + perpZ * 1.0);
            dynamicOffsets[len - 3].set(dirX * 6.0 - perpX * 1.0, 2.8, dirZ * 6.0 - perpZ * 1.0);
            // Flare at far-distance
            dynamicOffsets[len - 2].set(dirX * 12.0 + perpX * 2.0, 2.8, dirZ * 12.0 + perpZ * 2.0);
            dynamicOffsets[len - 1].set(dirX * 12.0 - perpX * 2.0, 2.8, dirZ * 12.0 - perpZ * 2.0);
        }

        // Update Grid Uniform
        if (gridShaderRef.current) {
            gridShaderRef.current.uniforms.showGrid.value = showGrid ? 1.0 : 0.0;
        }

        // --- NEW LOGIC: ENABLE OCCLUSION AS SOON AS GAME STARTS ---
        // Occlusion should be active in PREP, PLAYING and PAUSED.
        // It should ONLY be disabled in IDLE (generating/menu).
        const isGameActive = status !== GameStatus.IDLE;

        if (!isGameActive) {
            const resetObj = (obj: THREE.Object3D, inheritedFade: boolean) => {
                const anyObj = obj as any;
                const isFadeRoot = obj.userData.type === 'hull' || obj.userData.type === 'detail-fade';
                const shouldFade = inheritedFade || isFadeRoot;

                if ((anyObj.isMesh || anyObj.isLine || anyObj.isPoints) && shouldFade) {
                    const materials = Array.isArray(anyObj.material) ? anyObj.material : [anyObj.material];
                    materials.forEach((mat: any) => {
                        if (mat) {
                            mat.opacity = 1.0;
                            mat.transparent = false;
                            mat.depthWrite = true;
                        }
                    });
                    
                    if (anyObj.isMesh) {
                        obj.visible = true;
                        anyObj.castShadow = true;
                        anyObj.receiveShadow = true;
                    }
                }

                if (obj.userData.type === 'detail-hide' || obj.userData.type === 'roof' || obj.userData.type === 'detail-fade') {
                    obj.visible = true;
                }
                if (obj.userData.type === 'wireframe' || obj.userData.type === 'wireframe-fill') {
                    obj.visible = false;
                }

                obj.children.forEach(child => resetObj(child, shouldFade));
            };
            resetObj(groupRef.current, false);
            return;
        }

        // Skip occlusion check for buildings that are definitely not blocking the player
        // In this isometric view, only buildings within a certain radius or "behind" the player matter
        const distSq = position.distanceToSquared(playerPos.current);
        if (distSq > 10000) { // Approx 100 units

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

        // Setup Ray Direction: Player -> Camera
        vecToCam.subVectors(camera.position, playerPos.current);
        ray.direction.copy(vecToCam).normalize();
        
        // XZ-only distance for depth comparison (ignores height, critical for isometric camera)
        const playerDepthXZ = Math.sqrt(
            (playerPos.current.x - camera.position.x) ** 2 + 
            (playerPos.current.z - camera.position.z) ** 2
        );

        if (shouldUpdateOcclusion) {
            let isBlocking = false;

            // Quick reject: only allow occlusion for buildings BETWEEN camera and player
            // Uses XZ plane only to prevent tall buildings behind player from false-triggering
            const cpX = playerPos.current.x - camera.position.x;
            const cpZ = playerPos.current.z - camera.position.z;
            const cpLenSq = cpX * cpX + cpZ * cpZ;

            const cbX = position.x - camera.position.x;
            const cbZ = position.z - camera.position.z;

            const t = (cbX * cpX + cbZ * cpZ) / cpLenSq;

            // Quick reject: only allow occlusion for buildings in front of camera
            if (t > 0) {
                for (const part of parts) {
                    worldCenter.set(
                        position.x + part.pos[0],
                        position.y,
                        position.z + part.pos[2]
                    );

                    const pW = part.size[0];
                    const pH = part.size[1];
                    const pD = part.size[2];

                    box.min.set(worldCenter.x - pW / 2, worldCenter.y, worldCenter.z - pD / 2);
                    box.max.set(worldCenter.x + pW / 2, worldCenter.y + pH, worldCenter.z + pD / 2);

                    // 1. Check if building is in the vision cone (looking ahead)
                    let inVisionCone = false;
                    if (playerLastDir?.current) {
                        const lookDir = new THREE.Vector3(playerLastDir.current.x, 0, playerLastDir.current.y).normalize();
                        ray.origin.copy(playerPos.current);
                        ray.origin.y += 1.0; // Check from chest height
                        ray.direction.copy(lookDir);
                        
                        const hitCone = ray.intersectBox(box, intersectionPoint);
                        if (hitCone && ray.origin.distanceTo(intersectionPoint) < 12.0) {
                            inVisionCone = true;
                        }
                    }

                    if (inVisionCone) {
                        isBlocking = true;
                        break;
                    }

                    // 2. Check if building obstructs camera view
                    ray.direction.copy(vecToCam).normalize(); // Use parallel camera ray for orthographic view
                    for (const offset of dynamicOffsets) {
                        ray.origin.copy(playerPos.current).add(offset);
                        
                        // Check if the vision point is already inside the building
                        if (box.containsPoint(ray.origin)) {
                            isBlocking = true;
                            break;
                        }

                        const hit = ray.intersectBox(box, intersectionPoint);
                        if (hit) {
                            // Depth comparison: is the hit point closer to camera than the specific vision point?
                            const originDepthXZ = Math.sqrt(
                                (ray.origin.x - camera.position.x) ** 2 + 
                                (ray.origin.z - camera.position.z) ** 2
                            );
                            const hitDepthXZ = Math.sqrt(
                                (intersectionPoint.x - camera.position.x) ** 2 + 
                                (intersectionPoint.z - camera.position.z) ** 2
                            );
                            
                            if (hitDepthXZ < originDepthXZ - 0.2) { 
                                isBlocking = true;
                                break;
                            }
                        }
                    }
                    if (isBlocking) break;
                }
            }

            isBlockingRef.current = isBlocking;
        }

        const isBlocking = isBlockingRef.current;

        let targetOpacity = 1.0;
        if (isBlocking) {
            targetOpacity = 0.0;
        }

        // Calculate if player is standing on TOP of this specific building
        // Visual Building Top is roughly position.y + h/2. 
        // We use a margin of -1.0 so if feet are slightly inside roof, it still counts as "on top"
        const isAbove = playerPos.current.y >= position.y + h / 2 - 1.0;

        const updateObj = (obj: THREE.Object3D, inheritedFade: boolean) => {
            const anyObj = obj as any;
            const isFadeRoot = obj.userData.type === 'hull' || obj.userData.type === 'detail-fade';
            const shouldFade = inheritedFade || isFadeRoot;
            const isMeshLike = anyObj.isMesh || anyObj.isLine || anyObj.isPoints;

            // Visibility Logic
            if (obj.userData.type === 'detail-hide') {
                obj.visible = !isBlocking;
            } else if (obj.userData.type === 'roof') {
                obj.visible = !isBlocking || isAbove;
            } else if (isFadeRoot) {
                obj.visible = true;
            } else if (obj.userData.type === 'wireframe') {
                if (!showWireframe) {
                    obj.visible = false;
                } else {
                    const wireOpacity = 1.0 - targetOpacity;
                    obj.visible = wireOpacity > 0.1;
                    if (obj.visible && anyObj.material) {
                        const mat = anyObj.material;
                        mat.opacity = THREE.MathUtils.lerp(mat.opacity, wireOpacity * 0.8, delta * 12);
                        mat.transparent = true;
                    }
                }
            } else if (obj.userData.type === 'wireframe-fill') {
                const wireOpacity = 1.0 - targetOpacity;
                obj.visible = !!showWireframe && wireOpacity > 0.1;
                if (obj.visible && anyObj.material) {
                    const mat = anyObj.material;
                    mat.opacity = THREE.MathUtils.lerp(mat.opacity, wireOpacity * 0.45, delta * 12);
                    mat.transparent = true;
                }
            }

            // Fading Logic
            if (isMeshLike && shouldFade && anyObj.material) {
                const materials = Array.isArray(anyObj.material) ? anyObj.material : [anyObj.material];
                materials.forEach((mat: any) => {
                    if (Math.abs(mat.opacity - targetOpacity) > 0.001) {
                        const fadeSpeed = delta * 8;
                        mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, fadeSpeed);
                        
                        const isFading = mat.opacity < 0.99;
                        if (mat.transparent !== isFading) {
                            mat.transparent = isFading;
                            mat.depthWrite = !isFading || mat.opacity > 0.8;
                            mat.needsUpdate = true;
                        } else if (isFading) {
                            const shouldWriteDepth = mat.opacity > 0.8;
                            if (mat.depthWrite !== shouldWriteDepth) {
                                mat.depthWrite = shouldWriteDepth;
                                mat.needsUpdate = true;
                            }
                        }
                    } else if (targetOpacity >= 0.99 && mat.transparent) {
                        mat.opacity = 1.0;
                        mat.transparent = false;
                        mat.depthWrite = true;
                        mat.needsUpdate = true;
                    }

                    // Shadow & Visibility Logic
                    // We hide the mesh entirely when opacity is near zero to ensure shadows are removed.
                    // This is more reliable than just toggling castShadow.
                    if (anyObj.isMesh) {
                        const isFullyTransparent = mat.opacity < 0.01 && targetOpacity === 0;
                        obj.visible = !isFullyTransparent;
                        
                        // Also toggle shadow properties as an extra measure
                        const shouldShadow = mat.opacity > 0.2; 
                        if (anyObj.castShadow !== shouldShadow) {
                            anyObj.castShadow = shouldShadow;
                            anyObj.receiveShadow = shouldShadow;
                        }
                    }
                });
            }

            obj.children.forEach(child => updateObj(child, shouldFade));
        };

        updateObj(groupRef.current, false);
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

            {/* Solid Fill for Footprint (Including attachments) */}
            <mesh 
                geometry={fillGeometry} 
                position={[0, -position.y + 0.15, 0]}
                userData={{ type: 'wireframe-fill' }}
                renderOrder={10}
                castShadow={false}
                receiveShadow={false}
            >
                <meshBasicMaterial color="#1e40af" transparent opacity={0} depthTest={false} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>

            {/* Wireframe for Transparency Mode (Boolean Union Perimeter) */}
            <lineSegments
                geometry={wireframeEdges}
                position={[0, -position.y + 0.12, 0]}
                renderOrder={6}
                userData={{ type: 'wireframe' }}
            >
                <lineBasicMaterial color="#ffffff" transparent opacity={0} depthTest={true} depthWrite={false} />
            </lineSegments>

            {/* Roofs must still be positioned per part, as they are separate visual toppers */}
            {parts.map((part, i) => (
                <group key={i} position={new THREE.Vector3(...part.pos)}>
                    <group position={[0, h / 2, 0]}>
                        <Roof size={part.size} color={roofColor} />
                    </group>
                </group>
            ))}

            <group userData={{ type: 'detail-fade' }}>
                {windows.map((item, i) => {
                    return <BlinkingWindow key={i} position={item.pos} rotation={item.rot} size={1.0} color="white" type={isFactory ? 'industrial' : 'residential'} forceOn={isFactory ? true : false} />
                })}
            </group>

            <group userData={{ type: 'detail-fade' }}>
                {doors.map((item, i) => {
                    if (item.type === 'industrial') {
                        return <IndustrialDoorBlock key={`door-${i}`} position={item.pos} rotation={item.rot} />
                    }
                    return <DoorBlock key={`door-${i}`} position={item.pos} rotation={item.rot} />
                })}
            </group>

            <group userData={{ type: 'detail-fade' }}>
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

            <group userData={{ type: 'detail-fade' }}>
                {acs.map((item, i) => {
                    if (item.type === 'wall') {
                        return <WallAC key={`ac-${i}`} position={new THREE.Vector3(...item.pos)} scale={item.scale} color={item.color} rotation={item.rotation} showGrid={showGrid} />
                    } else {
                        return <RoofAC key={`ac-${i}`} position={new THREE.Vector3(...item.pos)} scale={item.scale} color={item.color} rotation={item.rotation} showGrid={showGrid} />
                    }
                })}
            </group>

            <group userData={{ type: 'detail-fade' }}>
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
                    <group position={[chimney.position[0] - position.x, 0, chimney.position[2] - position.z]} userData={{ type: 'detail-fade' }}>
                        <Chimney position={new THREE.Vector3(0, chimney.position[1] - position.y, 0)} scale={chimney.scale} color={chimney.color} smoke={isFactory ? true : isCooking} isIndustrial={isFactory} showGrid={showGrid} />
                    </group>
                )
            }
        </group >
    );
});

export const VoxelSeek: React.FC<VoxelSeekProps> = React.memo(({
    status,
    mode,
    match,
    settings,
    onRoundEnd,
    onPrepComplete,
    debugMode,
    showGrid,
    showCollision,
    showWireframe,
    showOcclusion,
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

    // Character Refs for direct manipulation (if needed)
    const characterGroup = useRef<THREE.Group>(null!);
    const staminaGroup = useRef<HTMLDivElement>(null!);
    const staminaFill = useRef<HTMLDivElement>(null!);

    // Map Data
    const [mapData, setMapData] = useState<{ objects: VoxelObject[], collisionGrid: SpatialHashGrid, bGrid: number[][], wGrid: number[][], sGrid: number[][], tGrid: number[][], spawnPos: THREE.Vector3, ladderZones: { minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, faceAngle: number, railX: number, railZ: number }[], riverOrientation: number, riverFlow: number, worldSize: number } | null>(null);

    // Character Visual State (for animation props)
    const visualStateRef = useRef({
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
            (window as any).__PARKUBES_MAP_DATA = data; // Export map data for debug/AI scripts

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

    // Handle Camera Free-Mode Zoom to Fit
    useEffect(() => {

        const updateFreeCamera = () => {
            if (!settings.cameraFollow) {
                // O mapa é diagonal, logo seu tamanho visível bounding box é (worldSize * sqrt(2)) unidades 3D.
                // Usamos 1.5 para adicionar um pequeno fôlego/padding para que não fique cortando a borda extrema.
                const mapVisualSize = settings.worldSize * 1.5; 
                // Assumindo que a altura de renderização de um Voxel é 1 unidade.
                // Calculando o zoom necessário tanto para a largura quanto para a altura.
                const zoomX = window.innerWidth / mapVisualSize;
                const zoomY = window.innerHeight / mapVisualSize;
                
                // Pega o menor zoom para encaixar o mapa totalmente
                camera.zoom = Math.min(zoomX, zoomY);
                camera.position.set(100, 100, 100);
                
                if (controls) {
                    const ctrl = controls as unknown as { target: THREE.Vector3, update: () => void };
                    ctrl.target.set(0, 0, 0);
                    ctrl.update();
                }
                camera.updateProjectionMatrix();
            } else {
                camera.zoom = settings.cameraZoom;
                camera.updateProjectionMatrix();
            }
        };

        // Aplica o ajuste inicialmente sempre que o settings.cameraFollow ou worldSize mudam
        updateFreeCamera();

        // Faz o re-planejamento sempre que a janela sofrer o resize
        const handleResize = () => {
            if (!settings.cameraFollow) {
                updateFreeCamera();
            }
        };
        
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [settings.cameraFollow, settings.worldSize, settings.cameraZoom, status, camera, controls]);

    useFrame((state, delta) => {
        if (!mapData) return;
        const dt = Math.min(delta, 0.1);
        let playerCanMove = status === GameStatus.PLAYING || status === GameStatus.PREP;
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
        
        // --- END AI LOGIC ---
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
        const visualState = visualStateRef.current;
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
            visualStateRef.current = newVisualState;
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
        if (playerCanMove && mapData && status === GameStatus.PLAYING) {
            if (playerPos.current.y < -10) {
                playerPos.current.y = 100;
                playerVel.current.set(0, 0, 0);
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
                        playerLastDir={playerLastDir}
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
                <>
                    <CollisionDebug collisionGrid={mapData.collisionGrid} bGrid={mapData.bGrid} size={mapData.worldSize} visible={!!showCollision} />
                    <OcclusionCylinderDebug playerPos={playerPos} playerLastDir={playerLastDir} visible={!!showOcclusion} />
                </>
            )}
            {status !== GameStatus.IDLE && (
                <Character
                    groupRef={characterGroup}
                    staminaFillRef={staminaFill}
                    staminaGroupRef={staminaGroup}
                    visualStateRef={visualStateRef}
                    stunTimerRef={stunTimer}
                    rollTimerRef={rollTimer}
                    staminaRef={stamina}
                    color="#3b82f6"
                    overlayContent={null}
                />
            )}
        </group>
    );
}, (prev, next) => {
    // CUSTOM COMPARISON: Ignore timer changes to prevent heavy re-renders every second.
    // The timer is only used in a simple overlay div, it doesn't affect the 3D scene/physics.
    // By ignoring it here, we save massive React reconciliation time.
    return prev.status === next.status &&
           prev.mode === next.mode &&
           prev.match === next.match && // match.timer might change, but we care about phase/currentRound
           prev.settings === next.settings &&
           prev.mapId === next.mapId &&
           prev.debugMode === next.debugMode &&
           prev.showGrid === next.showGrid &&
           prev.showCollision === next.showCollision &&
           prev.showWireframe === next.showWireframe &&
           prev.isEditing === next.isEditing;
           // We explicitly skip comparing 'timer'
});
