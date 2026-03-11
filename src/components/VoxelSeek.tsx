
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GameStatus, VoxelObject, GameSettings, Position } from '../types';
import { Character } from './Character';
import { useControls } from '../hooks/useControls';
import { generateCityLevel, findSpawnPos } from '../utils/levelGen';
import { updatePlayerPhysics } from '../utils/player';
import { worldToIndex, GRID_SCALE, FLOOR_HEIGHT, SpatialHashGrid, CollisionBox } from '../utils/physics';
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
            <instancedMesh ref={meshRef} args={[undefined, undefined, ruins.length]} castShadow receiveShadow>
                <boxGeometry args={[1, 1, 1]} />
                <GridMaterial color={ruins[0]?.color || "#4b5563"} showGrid={showGrid} floorHeight={FLOOR_HEIGHT} transparent={false} opacity={1.0} />
            </instancedMesh>
            <instancedMesh ref={meshTop1Ref} args={[undefined, undefined, ruins.length]} castShadow receiveShadow>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color={ruins[0]?.color || "#4b5563"} transparent={false} opacity={1.0} />
            </instancedMesh>
            <instancedMesh ref={meshTop2Ref} args={[undefined, undefined, ruins.length]} castShadow receiveShadow>
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
            <instancedMesh ref={postRef} args={[undefined, undefined, fences.length]} castShadow receiveShadow>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color={postColor} />
            </instancedMesh>
            <instancedMesh ref={railNRef} args={[undefined, undefined, fences.length * 2]} castShadow receiveShadow>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color={railColor} />
            </instancedMesh>
            <instancedMesh ref={railSRef} args={[undefined, undefined, fences.length * 2]} castShadow receiveShadow>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color={railColor} />
            </instancedMesh>
            <instancedMesh ref={railERef} args={[undefined, undefined, fences.length * 2]} castShadow receiveShadow>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color={railColor} />
            </instancedMesh>
            <instancedMesh ref={railWRef} args={[undefined, undefined, fences.length * 2]} castShadow receiveShadow>
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
            <instancedMesh ref={grassRef} args={[undefined, undefined, objects.length * 60]} castShadow receiveShadow>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color="#3f6212" transparent={false} opacity={1.0} />
            </instancedMesh>
            {/* Flower heads */}
            <instancedMesh ref={flowersRef} args={[undefined, undefined, objects.length * 10]} castShadow receiveShadow>
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
    lShape?: { active: boolean, cutCorner: number, cutSize: [number, number], secondCut?: { corner: number, size: [number, number] } };
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
}> = ({ position, scale, color, type, playerPos, playerVel, chimney, attachedChimneys = [], acs = [], lShape, windows = [], doors = [], ladders = [], variant = 0, isLit = false, isCooking = false, showWireframe = false, showGrid = false, status, debugMode }) => {
    const groupRef = useRef<THREE.Group>(null!);
    const gridShaderRef = useRef<any>(null);
    const { camera } = useThree();
    const [w, h, d] = scale;
    const isFactory = type === 'factory';

    // Memoize parts to use in both Render and Physics loop
    const parts = useMemo(() => {
        const p: { size: [number, number, number], pos: [number, number, number] }[] = [];
        if (lShape?.active) {
            const [cutW, cutD] = lShape.cutSize;
            const corner = lShape.cutCorner;

            if (corner === 0 || corner === 1) {
                const b1W = w - cutW;
                p.push({ size: [b1W, h, d], pos: [-cutW / 2, 0, 0] });

                const b2W = cutW;
                const b2D = d - cutD;
                const b2CenterX = (w / 2) - (b2W / 2);
                let b2CenterZ = 0;
                if (corner === 0) { b2CenterZ = -d / 2 + b2D / 2; }
                else { b2CenterZ = d / 2 - b2D / 2; }
                p.push({ size: [b2W, h, b2D], pos: [b2CenterX, 0, b2CenterZ] });
            } else {
                const b1W = w - cutW;
                p.push({ size: [b1W, h, d], pos: [cutW / 2, 0, 0] });

                const b2W = cutW;
                const b2D = d - cutD;
                const b2CenterX = -w / 2 + b2W / 2;
                let b2CenterZ = 0;
                if (corner === 3) { b2CenterZ = -d / 2 + b2D / 2; }
                else { b2CenterZ = d / 2 - b2D / 2; }
                p.push({ size: [b2W, h, b2D], pos: [b2CenterX, 0, b2CenterZ] });
            }
        } else {
            p.push({ size: [w, h, d], pos: [0, 0, 0] });
        }
        return p;
    }, [w, h, d, lShape]);

    // GEOMETRY GENERATION
    // Use ExtrudeGeometry for L-Shapes to prevent internal faces which show up during transparency
    const hullGeometry = useMemo(() => {
        if (lShape?.active) {
            const [cutW, cutD] = lShape.cutSize;
            const corner = lShape.cutCorner;
            const shape = new THREE.Shape();

            // Build the shape path based on the full rectangle minus the cut corner
            // Start at 0,0 which corresponds to corner 2 (SW) in our logic relative to the bounding box

            // Shape Logic: Draw the footprint (X, Z plane equivalent)
            // Coordinates in Shape are (x, y) which will become (x, z) after extrusion
            if (corner === 2) { // SW Cut (Low X, Low Z)
                shape.moveTo(cutW, 0);
                shape.lineTo(w, 0);
                shape.lineTo(w, d);
                shape.lineTo(0, d);
                shape.lineTo(0, cutD);
                shape.lineTo(cutW, cutD);
            } else if (corner === 1) { // SE Cut (High X, Low Z)
                shape.moveTo(0, 0);
                shape.lineTo(0, d);
                shape.lineTo(w, d);
                shape.lineTo(w, cutD);
                shape.lineTo(w - cutW, cutD);
                shape.lineTo(w - cutW, 0);
            } else if (corner === 0) { // NE Cut (High X, High Z)
                shape.moveTo(0, 0);
                shape.lineTo(0, d);
                shape.lineTo(w - cutW, d);
                shape.lineTo(w - cutW, d - cutD);
                shape.lineTo(w, d - cutD);
                shape.lineTo(w, 0);
            } else if (corner === 3) { // NW Cut (Low X, High Z)
                shape.moveTo(0, 0);
                shape.lineTo(0, d - cutD);
                shape.lineTo(cutW, d - cutD);
                shape.lineTo(cutW, d);
                shape.lineTo(w, d);
                shape.lineTo(w, 0);
            }

            shape.closePath();

            const geom = new THREE.ExtrudeGeometry(shape, {
                depth: h,
                bevelEnabled: false
            });

            // Extrude is along Z axis. We want Height (Y). 
            // Shape X -> World X. Shape Y -> World Z. Extrude Z -> World Y.
            // Rotating X by 90deg maps:
            // Old X -> New X
            // Old Y -> New Z (but inverted, or Z inverted? Standard rotation rule)
            // Old Z (Depth/Height) -> New Y (Height) (with sign change depending on handedness)
            geom.rotateX(Math.PI / 2);

            // Center the geometry. BoxGeometry is centered at 0,0,0.
            // Our shape starts at 0,0 corner. We need to move it to center of W,H,D.
            geom.translate(-w / 2, h / 2, -d / 2); // Extrusion goes "up" or "down" depending on rotation.
            // After rotateX(PI/2): +Z (Height) becomes -Y. 
            // Actually simpler: 
            // Shape X is Width. Shape Y is Depth. Extrude is Height.
            // Rotate X 90: Y becomes Z. Z becomes -Y.
            // So +Height(Z) becomes -Y.
            // So the block is generated "downwards".
            // To Center: X move -w/2. Z move -d/2. Y move +h/2 (to bring -h to +h range centered).

            return geom;
        }

        // Standard Box Fallback
        return new THREE.BoxGeometry(w, h, d);
    }, [w, h, d, lShape]);

    const edges = useMemo(() => new THREE.EdgesGeometry(hullGeometry), [hullGeometry]);

    // Refs for Physics Raycasting
    const box = useMemo(() => new THREE.Box3(), []);
    const ray = useMemo(() => new THREE.Ray(), []);
    const intersectionPoint = useMemo(() => new THREE.Vector3(), []);
    const vecToCam = useMemo(() => new THREE.Vector3(), []);

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
            const worldCenter = new THREE.Vector3(
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

export const VoxelSeek: React.FC<VoxelSeekProps> = ({
    status,
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
    const playerPos = useRef(new THREE.Vector3(0, 10, 0));
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
    const prevPlayerPos = useRef(new THREE.Vector3(0, 10, 0));
    const smoothedMoveSpeed = useRef(0);

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
        isLadderMounting: false
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
            playerVel.current.set(0, 0, 0);
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

            const newSpawn = findSpawnPos(
                settings.worldSize,
                halfSize,
                mapData.tGrid,
                mapData.collisionGrid,
                mapData.wGrid,
                isWaterLogic
            );

            // 2. Reset Player State to the new random spawn
            playerPos.current.copy(newSpawn);
            playerVel.current.set(0, 0, 0);
            stamina.current = 100;
            stunTimer.current = 0;

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
        const canMove = status === GameStatus.PLAYING || status === GameStatus.PREP;

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
            canMove,
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
            const isOnLadder = physicsOutput.isClimbing || physicsOutput.isLadderSliding || physicsOutput.isNearLadder;
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
            isLadderMounting: physicsOutput.isLadderMounting
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
                <VoxelWater size={mapData.worldSize} waterGrid={mapData.wGrid} riverOrientation={mapData.riverOrientation} riverFlow={mapData.riverFlow} />
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
                        lShape={obj.lShape}
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
    }, [mapData, debugMode, showGrid, showWireframe, status]);

    if (!mapData) return null;

    return (
        <group>
            {mapElements}
            {debugMode && mapData && (
                <CollisionDebug collisionGrid={mapData.collisionGrid} bGrid={mapData.bGrid} size={mapData.worldSize} visible={!!showCollision} />
            )}
            {status !== GameStatus.IDLE && (
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
                    overlayContent={null}
                />
            )}
        </group>
    );
};
