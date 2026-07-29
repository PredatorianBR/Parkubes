import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GameStatus, VoxelObject, GameSettings, Position, GameMode, MatchState } from '../types';
import { Character } from './Character';
import { useControls } from '../hooks/useControls';
import { generateCityLevel, findSpawnPos } from '../utils/levelGen';
import { updatePlayerPhysics } from '../utils/player';
import {
  worldToIndex,
  GRID_SCALE,
  FLOOR_HEIGHT,
  SpatialHashGrid,
  checkLineOfSight,
  getTerrainHeight,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  CLIMB_THRESHOLD,
  isPositionBlocked,
} from '../utils/physics';
import { NavigationGraph, NavNode } from '../utils/navigation';

// Helper to check wall height and blockages for AI pathfinding
const getWallHeightAt = (
  pos: THREE.Vector3,
  dir: THREE.Vector3,
  collisionGrid: SpatialHashGrid,
  probeDist: number,
  checkRadius: number = PLAYER_RADIUS,
): { isBlocked: boolean; maxY: number } => {
  const probeX = pos.x + dir.x * probeDist;
  const probeZ = pos.z + dir.z * probeDist;

  // Query nearby collision boxes
  const boxes = collisionGrid.query(probeX, probeZ, checkRadius);
  let isBlocked = false;
  let maxY = -Infinity;

  for (const box of boxes) {
    // A box is blocking if it overlaps vertically with the AI's standard height span.
    if (pos.y + CLIMB_THRESHOLD < box.maxY && pos.y + PLAYER_HEIGHT > box.minY) {
      // Check horizontal overlap with probe cylinder
      const closeX = Math.max(box.minX, Math.min(probeX, box.maxX));
      const closeZ = Math.max(box.minZ, Math.min(probeZ, box.maxZ));
      const dx = probeX - closeX;
      const dz = probeZ - closeZ;

      if (dx * dx + dz * dz < checkRadius * checkRadius) {
        isBlocked = true;
        if (box.maxY > maxY) {
          maxY = box.maxY;
        }
      }
    }
  }

  return { isBlocked, maxY };
};

// Whisker collision check for AI pathfinding/steering (Cat's Whiskers system)
// Note: Map boundaries and any non-climbable obstacles (taller than head height) are treated as obstacles.
const checkWhiskerCollision = (
  pos: THREE.Vector3,
  wDir: THREE.Vector3,
  wLen: number,
  collisionGrid: SpatialHashGrid,
  worldSize: number,
  isCenter: boolean = false,
): {
  isBlocked: boolean;
  hitPoint: THREE.Vector3;
  normal: THREE.Vector3;
  dist: number;
  box?: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
} | null => {
  const halfSize = worldSize / 2;
  const stepSize = 0.2; // fine sampling
  const steps = Math.ceil(wLen / stepSize);

  // Start probing from PLAYER_RADIUS to avoid self-colliding at center
  const startDist = PLAYER_RADIUS;

  for (let i = 0; i <= steps; i++) {
    const d = startDist + (wLen - startDist) * (i / steps);
    const probeX = pos.x + wDir.x * d;
    const probeZ = pos.z + wDir.z * d;
    const probeY = pos.y;

    // 1. Check map boundaries (external area) - only for center whisker to avoid side-pushing when walking parallel
    if (isCenter) {
      const boundaryMargin = PLAYER_RADIUS + 0.02;
      if (probeX < -halfSize + boundaryMargin) {
        return {
          isBlocked: true,
          hitPoint: new THREE.Vector3(-halfSize + boundaryMargin, probeY, probeZ),
          normal: new THREE.Vector3(1, 0, 0),
          dist: d,
        };
      }
      if (probeX > halfSize - boundaryMargin) {
        return {
          isBlocked: true,
          hitPoint: new THREE.Vector3(halfSize - boundaryMargin, probeY, probeZ),
          normal: new THREE.Vector3(-1, 0, 0),
          dist: d,
        };
      }
      if (probeZ < -halfSize + boundaryMargin) {
        return {
          isBlocked: true,
          hitPoint: new THREE.Vector3(probeX, probeY, -halfSize + boundaryMargin),
          normal: new THREE.Vector3(0, 0, 1),
          dist: d,
        };
      }
      if (probeZ > halfSize - boundaryMargin) {
        return {
          isBlocked: true,
          hitPoint: new THREE.Vector3(probeX, probeY, halfSize - boundaryMargin),
          normal: new THREE.Vector3(0, 0, -1),
          dist: d,
        };
      }
    }

    // 2. Check collision grid for high walls (non-climbable)
    const whiskerRadius = 0.25;
    const boxes = collisionGrid.query(probeX, probeZ, whiskerRadius);
    for (const box of boxes) {
      // Check vertical overlap with a non-climbable high obstacle
      if (probeY + PLAYER_HEIGHT < box.maxY && probeY + PLAYER_HEIGHT > box.minY) {
        // Check horizontal overlap with probe sphere/cylinder
        const closeX = Math.max(box.minX, Math.min(probeX, box.maxX));
        const closeZ = Math.max(box.minZ, Math.min(probeZ, box.maxZ));
        const dx = probeX - closeX;
        const dz = probeZ - closeZ;

        if (dx * dx + dz * dz < whiskerRadius * whiskerRadius) {
          // Collision! Find closest face to compute normal
          const distToMinX = Math.abs(probeX - box.minX);
          const distToMaxX = Math.abs(probeX - box.maxX);
          const distToMinZ = Math.abs(probeZ - box.minZ);
          const distToMaxZ = Math.abs(probeZ - box.maxZ);

          const minDist = Math.min(distToMinX, distToMaxX, distToMinZ, distToMaxZ);
          const normal = new THREE.Vector3(0, 0, 0);
          if (minDist === distToMinX) normal.set(-1, 0, 0);
          else if (minDist === distToMaxX) normal.set(1, 0, 0);
          else if (minDist === distToMinZ) normal.set(0, 0, -1);
          else normal.set(0, 0, 1);

          return {
            isBlocked: true,
            hitPoint: new THREE.Vector3(probeX, probeY, probeZ),
            normal,
            dist: d,
            box: {
              minX: box.minX,
              maxX: box.maxX,
              minY: box.minY,
              maxY: box.maxY,
              minZ: box.minZ,
              maxZ: box.maxZ,
            },
          };
        }
      }
    }
  }

  return null;
};

// Helper to calculate shortest distance from point p to line segment ab
const distToSegment = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number => {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ap = new THREE.Vector3().subVectors(p, a);
  const abLenSq = ab.lengthSq();
  if (abLenSq === 0) return p.distanceTo(a);

  // Project ap onto ab, clamp to segment bounds [0, 1]
  let t = ap.dot(ab) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  const closestPoint = new THREE.Vector3().copy(a).addScaledVector(ab, t);
  return p.distanceTo(closestPoint);
};

// Helper to get quadrant of a position
const getQuadrant = (x: number, z: number): number => {
  if (x >= 0 && z >= 0) return 1;
  if (x < 0 && z >= 0) return 2;
  if (x < 0 && z < 0) return 3;
  return 4;
};
import { VoxelGround } from './environment/VoxelGround';
import { VoxelWater } from './environment/VoxelWater';
import { WheatField } from './environment/WheatField';

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
  onRoundEnd: (playerWon: boolean) => void;
  onPrepComplete: () => void;
  debugMode?: boolean;
  showGrid?: boolean;
  showCollision?: boolean;
  showWireframe?: boolean; // NEW PROP
  showOcclusion?: boolean;
  showAIPath?: boolean;
  isEditing?: boolean;
  mapId: number;
}

// --- DEBUG COMPONENT ---
const CollisionDebug: React.FC<{
  collisionGrid: SpatialHashGrid;
  bGrid: number[][];
  size: number;
  visible: boolean;
}> = React.memo(({ collisionGrid, bGrid, size, visible }) => {
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
        (box.minZ + box.maxZ) / 2,
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
      <instancedMesh
        ref={boxRef}
        args={[undefined, undefined, Math.max(1, allBoxes.length)]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color="#ff0000"
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </instancedMesh>
      {/* Bridge/Roof Collision (Cyan) */}
      <instancedMesh
        ref={bRef}
        args={[undefined, undefined, bridgeCellCount]}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#00ffff" transparent opacity={0.4} side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  );
});

const VisionPointsDebug: React.FC<{
  playerPos: React.MutableRefObject<THREE.Vector3>;
  playerLastDir: React.MutableRefObject<THREE.Vector2>;
  visible: boolean;
}> = React.memo(({ playerPos, playerLastDir, visible }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    if (!meshRef.current || !visible || !playerLastDir.current) return;

    const px = playerPos.current.x;
    const py = playerPos.current.y;
    const pz = playerPos.current.z;
    const dirX = playerLastDir.current.x;
    const dirZ = playerLastDir.current.y;

    const distances = [4.0, 8.0, 12.0, 16.0];

    for (let i = 0; i < distances.length; i++) {
      const dist = distances[i];
      dummy.position.set(px + dirX * dist, py + 0.5, pz + dirZ * dist);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group visible={visible}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, 4]} frustumCulled={false}>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshBasicMaterial color="#eab308" transparent opacity={0.8} depthTest={false} />
      </instancedMesh>
    </group>
  );
});

const VoxelRuins: React.FC<{ ruins: VoxelObject[]; showGrid?: boolean }> = React.memo(
  ({ ruins, showGrid }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null!);
    const meshTop1Ref = useRef<THREE.InstancedMesh>(null!);
    const meshTop2Ref = useRef<THREE.InstancedMesh>(null!);

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
        dummy.position.set(
          obj.position[0] + sx * 0.25,
          obj.position[1] + sy * 0.5,
          obj.position[2] + sz * 0.25,
        );
        dummy.updateMatrix();
        meshTop1Ref.current.setMatrixAt(i, dummy.matrix);

        dummy.scale.set(sx * 0.3, sy * 0.3, sz * 0.3);
        dummy.position.set(
          obj.position[0] - sx * 0.2,
          obj.position[1] + sy * 0.5,
          obj.position[2] - sz * 0.2,
        );
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
        <instancedMesh
          ref={meshRef}
          args={[undefined, undefined, ruins.length]}
          castShadow
          receiveShadow
          frustumCulled={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          <GridMaterial
            color={ruins[0]?.color || '#4b5563'}
            showGrid={showGrid}
            floorHeight={FLOOR_HEIGHT}
            transparent={false}
            opacity={1.0}
          />
        </instancedMesh>
        <instancedMesh
          ref={meshTop1Ref}
          args={[undefined, undefined, ruins.length]}
          castShadow
          receiveShadow
          frustumCulled={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color={ruins[0]?.color || '#4b5563'}
            transparent={false}
            opacity={1.0}
          />
        </instancedMesh>
        <instancedMesh
          ref={meshTop2Ref}
          args={[undefined, undefined, ruins.length]}
          castShadow
          receiveShadow
          frustumCulled={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color={ruins[0]?.color || '#4b5563'}
            transparent={false}
            opacity={1.0}
          />
        </instancedMesh>
      </group>
    );
  },
);

const VoxelFences: React.FC<{ fences: VoxelObject[] }> = React.memo(({ fences }) => {
  const postRef = useRef<THREE.InstancedMesh>(null!);
  const railNRef = useRef<THREE.InstancedMesh>(null!);
  const railSRef = useRef<THREE.InstancedMesh>(null!);
  const railERef = useRef<THREE.InstancedMesh>(null!);
  const railWRef = useRef<THREE.InstancedMesh>(null!);

  useEffect(() => {
    if (!postRef.current || fences.length === 0) return;

    const dummy = new THREE.Object3D();
    let postIdx = 0,
      nIdx = 0,
      sIdx = 0,
      eIdx = 0,
      wIdx = 0;

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

  const postColor = '#a16207';
  const railColor = fences[0]?.color || '#d4a373';

  return (
    <group>
      <instancedMesh
        ref={postRef}
        args={[undefined, undefined, fences.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={postColor} />
      </instancedMesh>
      <instancedMesh
        ref={railNRef}
        args={[undefined, undefined, fences.length * 2]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={railColor} />
      </instancedMesh>
      <instancedMesh
        ref={railSRef}
        args={[undefined, undefined, fences.length * 2]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={railColor} />
      </instancedMesh>
      <instancedMesh
        ref={railERef}
        args={[undefined, undefined, fences.length * 2]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={railColor} />
      </instancedMesh>
      <instancedMesh
        ref={railWRef}
        args={[undefined, undefined, fences.length * 2]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
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
      <instancedMesh
        ref={grassRef}
        args={[undefined, undefined, objects.length * 60]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#3f6212" transparent={false} opacity={1.0} />
      </instancedMesh>
      {/* Flower heads */}
      <instancedMesh
        ref={flowersRef}
        args={[undefined, undefined, objects.length * 10]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial transparent={false} opacity={1.0} />
      </instancedMesh>
    </group>
  );
});

function createLineSegmentsGeometry(shape: THREE.Shape): THREE.BufferGeometry {
  const points = shape.getPoints(); // N+1 points for closed shapes (last point equals first)
  const vertices: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    vertices.push(p1.x, 0, p1.y);
    vertices.push(p2.x, 0, p2.y);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geom;
}

function offsetOrthogonalPolygon(points: [number, number][], d: number): [number, number][] {
  const n = points.length;
  if (n < 3) return points;
  const offsetPoints: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    const dxIn = curr[0] - prev[0];
    const dzIn = curr[1] - prev[1];
    const lenIn = Math.sqrt(dxIn * dxIn + dzIn * dzIn) || 1;
    const uxIn = dxIn / lenIn;
    const uzIn = dzIn / lenIn;

    const dxOut = next[0] - curr[0];
    const dzOut = next[1] - curr[1];
    const lenOut = Math.sqrt(dxOut * dxOut + dzOut * dzOut) || 1;
    const uxOut = dxOut / lenOut;
    const uzOut = dzOut / lenOut;

    const nxIn = uzIn;
    const nzIn = -uxIn;

    const nxOut = uzOut;
    const nzOut = -uxOut;

    const ox = curr[0] + d * (nxIn + nxOut);
    const oz = curr[1] + d * (nzIn + nzOut);
    offsetPoints.push([ox, oz]);
  }
  return offsetPoints;
}

const Building: React.FC<{
  id: string;
  occludedBuildingIdsRef: React.MutableRefObject<Set<string>>;
  position: THREE.Vector3;
  scale: [number, number, number];
  color: string;
  type: 'box' | 'factory' | 'highrise';
  playerPos: React.MutableRefObject<THREE.Vector3>;
  playerVel: React.MutableRefObject<THREE.Vector3>;
  playerLastDir: React.MutableRefObject<THREE.Vector2>;
  chimney?: { position: [number, number, number]; scale: [number, number, number]; color: string };
  attachedChimneys?: {
    pos: Position;
    scale: Position;
    color: string;
    smoke?: boolean;
    rotation?: number;
  }[];
  acs?: {
    pos: Position;
    scale: Position;
    color: string;
    rotation: number;
    type: 'wall' | 'roof';
  }[];
  shape?: { active: boolean; points: [number, number][]; mask: boolean[][] };
  windows?: { pos: Position; rot: [number, number, number] }[];
  doors?: { pos: Position; rot: [number, number, number]; type?: 'standard' | 'industrial' }[];
  ladders?: { pos: Position; rot: [number, number, number]; height: number }[];
  variant?: number;
  isLit?: boolean;
  isCooking?: boolean;
  showWireframe?: boolean;
  showGrid?: boolean;
  status: GameStatus;
  debugMode?: boolean;
}> = React.memo(
  ({
    id,
    occludedBuildingIdsRef,
    position,
    scale,
    color,
    type,
    chimney,
    attachedChimneys = [],
    acs = [],
    shape,
    windows = [],
    doors = [],
    ladders = [],
    isCooking = false,
    showGrid = false,
  }) => {
    const groupRef = useRef<THREE.Group>(null!);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gridShaderRef = useRef<any>(null);
    const [w, h, d] = scale;
    const isFactory = type === 'factory';

    const roofColor = useMemo(() => {
      if (type === 'factory') return '#1f2937';
      if (h <= 4) return '#7f1d1d';
      if (h <= 6) return '#475569';
      return '#0f172a';
    }, [type, h]);

    const roofMaterial = useMemo(
      () => new THREE.MeshStandardMaterial({ color: roofColor }),
      [roofColor],
    );
    const roofShadowMaterial = useMemo(
      () => new THREE.MeshStandardMaterial({ color: '#000000', transparent: true, opacity: 0.2 }),
      [],
    );

    useEffect(() => {
      return () => {
        roofMaterial.dispose();
        roofShadowMaterial.dispose();
      };
    }, [roofMaterial, roofShadowMaterial]);

    // Memoize parts to use in both Render and Physics loop
    const parts = useMemo(() => {
      const p: { size: [number, number, number]; pos: [number, number, number] }[] = [];
      if (shape?.active && shape.mask) {
        const { mask } = shape;
        const mWidth = mask.length;
        const mDepth = mask[0].length;

        for (let i = 0; i < mWidth; i++) {
          let j = 0;
          while (j < mDepth) {
            if (mask[i][j]) {
              let runLength = 1;
              while (j + runLength < mDepth && mask[i][j + runLength]) {
                runLength++;
              }
              const bW = 1;
              const bD = runLength;

              // Center of the 1xRun box relative to building center
              const cx = -w / 2 + i + bW / 2;
              const cz = -d / 2 + j + bD / 2;

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

    const { hullGeometry, fillGeometry, wireframeEdges, roofBaseGeometry, roofShadowGeometry } =
      useMemo(() => {
        let hGeom: THREE.BufferGeometry;
        const hw = (w || 1) / 2,
          hd = (d || 1) / 2;

        // --- Build the union footprint shape (building + wall attachments) ---
        const allAtts = [...(attachedChimneys || []), ...(acs || [])];

        // Classify attachments by which wall they protrude from
        interface WallBump {
          min: number;
          max: number;
          depth: number;
        }
        const rightBumps: WallBump[] = [];
        const leftBumps: WallBump[] = [];
        const backBumps: WallBump[] = []; // z = -hd
        const frontBumps: WallBump[] = []; // z = +hd

        allAtts.forEach((att) => {
          if (!att?.pos || !att?.scale) return;
          const [ax, , az] = att.pos as [number, number, number];
          const [rawW, , rawD] = att.scale as [number, number, number];
          if (rawW <= 0 || rawD <= 0) return;

          // Account for rotation: swap width/depth when rotated ~90 degrees
          const rot = att.rotation || 0;
          const isRotated = Math.abs(Math.sin(rot)) > 0.5;
          const aw = isRotated ? rawD : rawW;
          const ad = isRotated ? rawW : rawD;

          const WALL_THRESHOLD = 2.0;

          if (ax > hw - WALL_THRESHOLD && ax + aw / 2 > hw) {
            rightBumps.push({ min: az - ad / 2, max: az + ad / 2, depth: ax + aw / 2 - hw });
          } else if (ax < -hw + WALL_THRESHOLD && ax - aw / 2 < -hw) {
            leftBumps.push({ min: az - ad / 2, max: az + ad / 2, depth: -hw - (ax - aw / 2) });
          } else if (az < -hd + WALL_THRESHOLD && az - ad / 2 < -hd) {
            backBumps.push({ min: ax - aw / 2, max: ax + aw / 2, depth: -hd - (az - ad / 2) });
          } else if (az > hd - WALL_THRESHOLD && az + ad / 2 > hd) {
            frontBumps.push({ min: ax - aw / 2, max: ax + aw / 2, depth: az + ad / 2 - hd });
          }
        });

        // Sort bumps along each wall's travel direction
        backBumps.sort((a, b) => a.min - b.min);
        rightBumps.sort((a, b) => a.min - b.min);
        frontBumps.sort((a, b) => b.max - a.max);
        leftBumps.sort((a, b) => b.max - a.max);

        // --- Footprint Shape (Integrated building footprint + wall bumps) ---
        const footprintShape = new THREE.Shape();
        if (shape?.active && shape.mask) {
          const { mask } = shape;
          const mWidth = mask.length;
          const mDepth = mask[0].length;
          const pad = 2;
          const pWidth = mWidth + 2 * pad;
          const pDepth = mDepth + 2 * pad;
          const paddedMask = Array(pWidth)
            .fill(null)
            .map(() => Array(pDepth).fill(false));
          for (let i = 0; i < mWidth; i++) {
            for (let j = 0; j < mDepth; j++) {
              paddedMask[i + pad][j + pad] = mask[i][j];
            }
          }

          // Union attached chimneys into the padded mask
          if (attachedChimneys && attachedChimneys.length > 0) {
            attachedChimneys.forEach((att) => {
              if (!att?.pos || !att?.scale) return;
              const [ax, , az] = att.pos as [number, number, number];
              const [aw, , ad] = att.scale as [number, number, number];
              if (aw > 0 && ad > 0) {
                const rot = att.rotation || 0;
                const cos = Math.cos(-rot);
                const sin = Math.sin(-rot);

                for (let pi = 0; pi < pWidth; pi++) {
                  for (let pj = 0; pj < pDepth; pj++) {
                    // Center of this cell in building space
                    const px = -hw + (pi - pad) + 0.5;
                    const pz = -hd + (pj - pad) + 0.5;

                    // Rotate relative to chimney center
                    const dx = px - ax;
                    const dz = pz - az;
                    const lx = dx * cos - dz * sin;
                    const lz = dx * sin + dz * cos;

                    if (Math.abs(lx) < aw / 2 + 0.1 && Math.abs(lz) < ad / 2 + 0.1) {
                      paddedMask[pi][pj] = true;
                    }
                  }
                }
              }
            });
          }

          // Extract the union footprint shape using the grid contour walk
          const outlineEdges = new Map<string, [number, number]>();
          const addEdge = (x1: number, z1: number, x2: number, z2: number) => {
            outlineEdges.set(`${x1},${z1}`, [x2, z2]);
          };
          for (let x = 0; x < pWidth; x++) {
            for (let z = 0; z < pDepth; z++) {
              if (paddedMask[x][z]) {
                if (z === 0 || !paddedMask[x][z - 1]) addEdge(x, z, x + 1, z);
                if (x === pWidth - 1 || !paddedMask[x + 1][z]) addEdge(x + 1, z, x + 1, z + 1);
                if (z === pDepth - 1 || !paddedMask[x][z + 1]) addEdge(x + 1, z + 1, x, z + 1);
                if (x === 0 || !paddedMask[x - 1][z]) addEdge(x, z + 1, x, z);
              }
            }
          }

          const points: [number, number][] = [];
          if (outlineEdges.size > 0) {
            const startKey = outlineEdges.keys().next().value;
            let currentKey = startKey;
            while (true) {
              const [x, z] = currentKey.split(',').map(Number);
              points.push([x, z]);
              const nextNode = outlineEdges.get(currentKey);
              if (!nextNode) break;
              currentKey = `${nextNode[0]},${nextNode[1]}`;
              if (currentKey === startKey) break;
            }
          }

          if (points.length >= 3) {
            const startPt = points[0];
            footprintShape.moveTo(startPt[0] - hw - pad, startPt[1] - hd - pad);
            for (let i = 1; i < points.length; i++) {
              footprintShape.lineTo(points[i][0] - hw - pad, points[i][1] - hd - pad);
            }
            footprintShape.closePath();
          }
        } else if (shape?.active && shape.points && shape.points.length >= 3) {
          const startPt = shape.points[0];
          footprintShape.moveTo(startPt[0] - hw, startPt[1] - hd);
          for (let i = 1; i < shape.points.length; i++) {
            footprintShape.lineTo(shape.points[i][0] - hw, shape.points[i][1] - hd);
          }
          footprintShape.closePath();
        } else {
          footprintShape.moveTo(-hw, -hd);

          // 1. Back wall: traveling from -hw to hw (z = -hd)
          backBumps.forEach((bump) => {
            footprintShape.lineTo(bump.min, -hd);
            footprintShape.lineTo(bump.min, -hd - bump.depth);
            footprintShape.lineTo(bump.max, -hd - bump.depth);
            footprintShape.lineTo(bump.max, -hd);
          });
          footprintShape.lineTo(hw, -hd);

          // 2. Right wall: traveling from -hd to hd (x = hw)
          rightBumps.forEach((bump) => {
            footprintShape.lineTo(hw, bump.min);
            footprintShape.lineTo(hw + bump.depth, bump.min);
            footprintShape.lineTo(hw + bump.depth, bump.max);
            footprintShape.lineTo(hw, bump.max);
          });
          footprintShape.lineTo(hw, hd);

          // 3. Front wall: traveling from hw to -hw (z = hd)
          const sortedFrontBumps = [...frontBumps].sort((a, b) => b.min - a.min);
          sortedFrontBumps.forEach((bump) => {
            footprintShape.lineTo(bump.max, hd);
            footprintShape.lineTo(bump.max, hd + bump.depth);
            footprintShape.lineTo(bump.min, hd + bump.depth);
            footprintShape.lineTo(bump.min, hd);
          });
          footprintShape.lineTo(-hw, hd);

          // 4. Left wall: traveling from hd to -hd (x = -hw)
          const sortedLeftBumps = [...leftBumps].sort((a, b) => b.min - a.min);
          sortedLeftBumps.forEach((bump) => {
            footprintShape.lineTo(-hw, bump.max);
            footprintShape.lineTo(-hw - bump.depth, bump.max);
            footprintShape.lineTo(-hw - bump.depth, bump.min);
            footprintShape.lineTo(-hw, bump.min);
          });
          footprintShape.lineTo(-hw, -hd);
        }

        const fillGeom = new THREE.ShapeGeometry(footprintShape);
        fillGeom.rotateX(Math.PI / 2);

        const edgesGeom = createLineSegmentsGeometry(footprintShape);

        // --- Hull (3D solid building body, kept separate from chimneys to retain separate materials/colors) ---
        if (shape?.active && shape.points && shape.points.length >= 3) {
          try {
            const shapeObj = new THREE.Shape();
            const startPt = shape.points[0];
            shapeObj.moveTo(startPt[0], startPt[1]);
            for (let i = 1; i < shape.points.length; i++)
              shapeObj.lineTo(shape.points[i][0], shape.points[i][1]);
            shapeObj.closePath();

            hGeom = new THREE.ExtrudeGeometry(shapeObj, { depth: h || 1, bevelEnabled: false });
            hGeom.rotateX(Math.PI / 2);
            hGeom.translate(-hw, h / 2, -hd);
          } catch {
            hGeom = new THREE.BoxGeometry(w || 1, h || 1, d || 1);
          }
        } else {
          hGeom = new THREE.BoxGeometry(w || 1, h || 1, d || 1);
        }

        let roofBaseGeom: THREE.BufferGeometry | null = null;
        let roofShadowGeom: THREE.BufferGeometry | null = null;

        if (shape?.active && shape.points && shape.points.length >= 3) {
          try {
            // 1. Build the base/outer roof shape (with offset/padding of 0.2)
            const offsetPoints = offsetOrthogonalPolygon(shape.points, 0.2);
            const baseShapeObj = new THREE.Shape();
            baseShapeObj.moveTo(offsetPoints[0][0], offsetPoints[0][1]);
            for (let i = 1; i < offsetPoints.length; i++) {
              baseShapeObj.lineTo(offsetPoints[i][0], offsetPoints[i][1]);
            }
            baseShapeObj.closePath();

            roofBaseGeom = new THREE.ExtrudeGeometry(baseShapeObj, {
              depth: 0.3,
              bevelEnabled: false,
            });
            roofBaseGeom.rotateX(Math.PI / 2);
            roofBaseGeom.translate(-hw, h / 2 + 0.3, -hd);

            // 2. Build the inner shadow roof shape (with offset/padding of 0.1)
            const offsetPointsShadow = offsetOrthogonalPolygon(shape.points, 0.1);
            const shadowShapeObj = new THREE.Shape();
            shadowShapeObj.moveTo(offsetPointsShadow[0][0], offsetPointsShadow[0][1]);
            for (let i = 1; i < offsetPointsShadow.length; i++) {
              shadowShapeObj.lineTo(offsetPointsShadow[i][0], offsetPointsShadow[i][1]);
            }
            shadowShapeObj.closePath();

            roofShadowGeom = new THREE.ExtrudeGeometry(shadowShapeObj, {
              depth: 0.05,
              bevelEnabled: false,
            });
            roofShadowGeom.rotateX(Math.PI / 2);
            roofShadowGeom.translate(-hw, h / 2 + 0.325, -hd);
          } catch (e) {
            console.error('Error creating custom roof geometry: ', e);
          }
        }

        return {
          hullGeometry: hGeom,
          fillGeometry: fillGeom,
          wireframeEdges: edgesGeom,
          roofBaseGeometry: roofBaseGeom,
          roofShadowGeometry: roofShadowGeom,
        };
      }, [w, h, d, shape, attachedChimneys, acs]);

    const currentOpacity = useRef(1.0);
    const currentWireframeOpacity = useRef(0.0);
    const currentFillOpacity = useRef(0.0);

    const wireframeMaterial = useMemo(() => {
      return new THREE.LineBasicMaterial({
        color: '#00e5ff',
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    }, []);

    const fillMaterial = useMemo(() => {
      return new THREE.MeshBasicMaterial({
        color: '#00e5ff',
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    }, []);

    React.useEffect(() => {
      return () => {
        wireframeMaterial.dispose();
        fillMaterial.dispose();
      };
    }, [wireframeMaterial, fillMaterial]);

    useFrame((state, delta) => {
      if (!groupRef.current) return;
      const dt = Math.min(delta, 0.1);

      // Update Grid Uniform
      if (gridShaderRef.current) {
        gridShaderRef.current.uniforms.showGrid.value = showGrid ? 1.0 : 0.0;
      }

      // Smoothly fade building opacity based on occlusion (Highly transparent target: 0.0)
      const isOccluded = occludedBuildingIdsRef.current.has(id);
      const targetOpacity = isOccluded ? 0.0 : 1.0;

      const wasTransparent = currentOpacity.current < 0.999;
      currentOpacity.current = THREE.MathUtils.lerp(
        currentOpacity.current,
        targetOpacity,
        dt * 8.0,
      );
      const isTransparent = currentOpacity.current < 0.999;

      if (
        isTransparent ||
        wasTransparent !== isTransparent ||
        Math.abs(currentOpacity.current - targetOpacity) > 0.001
      ) {
        groupRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh && child.userData.type !== 'footprint') {
            // Keep meshes visible so they always cast shadows, even when transparent
            child.visible = true;

            // Resolve building part type by checking the mesh itself or searching its parent hierarchy
            let partType = child.userData.type;
            let p = child.parent;
            while (!partType && p) {
              if (p.userData && p.userData.type) {
                partType = p.userData.type;
                break;
              }
              p = p.parent;
            }

            const isLadder = partType === 'ladder' || child.userData.isLadder;
            const meshOpacity = isLadder
              ? currentOpacity.current * 0.85 + 0.15 // Fades to 0.15 (15% opacity) when building is transparent (currentOpacity = 0)
              : currentOpacity.current; // Fades to 0.0 when building is transparent (currentOpacity = 0)

            // Assign explicit renderOrder to ensure proper layering during semi-transparent transition
            if (partType === 'hull') {
              child.renderOrder = 10;
            } else if (partType === 'roof') {
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              const isShadow = materials.some((m) => m.transparent || m.opacity < 0.999);
              child.renderOrder = isShadow ? 12 : 11;
            } else if (partType === 'ladder' || child.userData.isLadder) {
              child.renderOrder = 13;
            } else if (partType === 'detail-fade') {
              if (child instanceof THREE.InstancedMesh) {
                child.renderOrder = 14; // Smoke particles render on top of chimney details
              } else {
                child.renderOrder = 13; // Windows, doors, chimneys, ACs
              }
            } else {
              child.renderOrder = 13;
            }

            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((mat) => {
              if (mat.userData.initialOpacity === undefined) {
                mat.userData.initialOpacity = mat.opacity !== undefined ? mat.opacity : 1.0;
              }
              mat.opacity = mat.userData.initialOpacity * meshOpacity;
              const targetTransparent = mat.opacity < 0.999;
              if (mat.transparent !== targetTransparent) {
                mat.transparent = targetTransparent;
                mat.needsUpdate = true;
              }
              // Write to depth buffer only when building is visible/fading, and disable it when fully transparent (currentOpacity = 0)
              mat.depthWrite = currentOpacity.current > 0.001;
            });
          }
        });
      }

      // Smoothly fade the 3D wireframe outline (accentuated thick wall simulation: 0.95)
      const targetWireframeOpacity = isOccluded ? 0.95 : 0.0;
      currentWireframeOpacity.current = THREE.MathUtils.lerp(
        currentWireframeOpacity.current,
        targetWireframeOpacity,
        dt * 8.0,
      );
      wireframeMaterial.opacity = currentWireframeOpacity.current;

      // Smoothly fade the solid footprint fill (1.0 under occlusion)
      const targetFillOpacity = isOccluded ? 1.0 : 0.0;
      currentFillOpacity.current = THREE.MathUtils.lerp(
        currentFillOpacity.current,
        targetFillOpacity,
        dt * 8.0,
      );
      fillMaterial.opacity = currentFillOpacity.current;
    });

    // roofColor is now memoized at the top of the component

    return (
      <group ref={groupRef} position={position} userData={{ buildingId: id }}>
        {/* Merged Hull Mesh */}
        <mesh geometry={hullGeometry} castShadow receiveShadow userData={{ type: 'hull' }}>
          <GridMaterial color={color} showGrid={showGrid} floorHeight={FLOOR_HEIGHT} />
        </mesh>

        {/* 2D Holographic Floor Wireframe (Visually merged into a single thick line on the ground plane) */}
        <lineSegments geometry={wireframeEdges} position={[0, -h / 2 + 0.06, 0]}>
          <primitive object={wireframeMaterial} attach="material" />
        </lineSegments>
        <lineSegments geometry={wireframeEdges} position={[0.02, -h / 2 + 0.06, 0.02]}>
          <primitive object={wireframeMaterial} attach="material" />
        </lineSegments>
        <lineSegments geometry={wireframeEdges} position={[-0.02, -h / 2 + 0.06, -0.02]}>
          <primitive object={wireframeMaterial} attach="material" />
        </lineSegments>
        <lineSegments geometry={wireframeEdges} position={[0.02, -h / 2 + 0.06, -0.02]}>
          <primitive object={wireframeMaterial} attach="material" />
        </lineSegments>
        <lineSegments geometry={wireframeEdges} position={[-0.02, -h / 2 + 0.06, 0.02]}>
          <primitive object={wireframeMaterial} attach="material" />
        </lineSegments>

        {/* Holographic Footprint Fill */}
        <mesh
          geometry={fillGeometry}
          position={[0, -h / 2 + 0.05, 0]}
          userData={{ type: 'footprint' }}
        >
          <primitive object={fillMaterial} attach="material" />
        </mesh>

        {/* Unified roof for custom shapes, or fallback to per-part roofs */}
        {shape?.active &&
        shape.points &&
        shape.points.length >= 3 &&
        roofBaseGeometry &&
        roofShadowGeometry ? (
          <>
            <mesh
              geometry={roofBaseGeometry}
              castShadow={false}
              receiveShadow
              userData={{ type: 'roof' }}
            >
              <primitive object={roofMaterial} attach="material" />
            </mesh>
            <mesh geometry={roofShadowGeometry} castShadow={false} userData={{ type: 'roof' }}>
              <primitive object={roofShadowMaterial} attach="material" />
            </mesh>
          </>
        ) : (
          parts.map((part, i) => (
            <group key={i} position={new THREE.Vector3(...part.pos)}>
              <group position={[0, h / 2, 0]}>
                <Roof size={part.size} color={roofColor} />
              </group>
            </group>
          ))
        )}

        <group userData={{ type: 'detail-fade' }}>
          {windows.map((item, i) => {
            return (
              <BlinkingWindow
                key={i}
                position={item.pos}
                rotation={item.rot}
                size={1.0}
                color="white"
                type={isFactory ? 'industrial' : 'residential'}
                forceOn={isFactory ? true : false}
              />
            );
          })}
        </group>

        <group userData={{ type: 'detail-fade' }}>
          {doors.map((item, i) => {
            if (item.type === 'industrial') {
              return (
                <IndustrialDoorBlock key={`door-${i}`} position={item.pos} rotation={item.rot} />
              );
            }
            return <DoorBlock key={`door-${i}`} position={item.pos} rotation={item.rot} />;
          })}
        </group>

        <group userData={{ type: 'detail-fade' }}>
          {attachedChimneys.map((item, i) => (
            <Chimney
              key={`chim-${i}`}
              position={new THREE.Vector3(...item.pos)}
              scale={item.scale}
              color={item.color}
              smoke={isFactory ? true : isCooking && item.smoke}
              rotation={item.rotation}
              isIndustrial={isFactory}
              showGrid={showGrid}
            />
          ))}
        </group>

        <group userData={{ type: 'detail-fade' }}>
          {acs.map((item, i) => {
            if (item.type === 'wall') {
              return (
                <WallAC
                  key={`ac-${i}`}
                  position={new THREE.Vector3(...item.pos)}
                  scale={item.scale}
                  color={item.color}
                  rotation={item.rotation}
                  showGrid={showGrid}
                />
              );
            } else {
              return (
                <RoofAC
                  key={`ac-${i}`}
                  position={new THREE.Vector3(...item.pos)}
                  scale={item.scale}
                  color={item.color}
                  rotation={item.rotation}
                  showGrid={showGrid}
                />
              );
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

        {chimney && (
          <group
            position={[chimney.position[0] - position.x, 0, chimney.position[2] - position.z]}
            userData={{ type: 'detail-fade' }}
          >
            <Chimney
              position={new THREE.Vector3(0, chimney.position[1] - position.y, 0)}
              scale={chimney.scale}
              color={chimney.color}
              smoke={isFactory ? true : isCooking}
              isIndustrial={isFactory}
              showGrid={showGrid}
            />
          </group>
        )}
      </group>
    );
  },
);

export const VoxelSeek: React.FC<VoxelSeekProps> = React.memo(
  (props) => {
    const {
      status,
      settings,
      onPrepComplete,
      debugMode,
      showGrid,
      showCollision,
      showWireframe,
      showOcclusion,
      showAIPath,
      mapId,
    } = props;
    const { camera, controls } = useThree(); // Access Controls

    const keys = useControls();

    const [aiEmoji, setAiEmoji] = useState('❓');
    const aiEmojiRef = useRef('❓');
    const aiDebugPathLineRef = useRef<THREE.Line>(null);
    const aiDebugLastPosMarkerRef = useRef<THREE.Mesh>(null);
    const aiDebugLastDirLineRef = useRef<THREE.Line>(null);
    const aiDebugWhiskerCenterRef = useRef<THREE.Line>(null);
    const aiDebugWhiskerLeftRef = useRef<THREE.Line>(null);
    const aiDebugWhiskerRightRef = useRef<THREE.Line>(null);

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

    // AI Physics & State Refs
    const aiPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiVel = useRef(new THREE.Vector3(0, 0, 0));
    const aiLastDir = useRef(new THREE.Vector2(0, 1));
    const aiIsGrounded = useRef(false);
    const aiIsCharging = useRef(false);
    const aiIsRolling = useRef(false);
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
    const aiPrevPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiSmoothedMoveSpeed = useRef(0);
    const aiStuckTimer = useRef(0);
    const aiDetourTimer = useRef(0);
    const aiDetourDir = useRef(new THREE.Vector3(0, 0, 0));
    const aiLateralDetourDir = useRef(new THREE.Vector3(0, 0, 0));
    const aiLateralDetourTimer = useRef(0);
    const aiLongStuckTimer = useRef(0);
    const aiLongStuckPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiJumpHoldTimer = useRef(0);
    const aiLastProgressPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiProgressCheckTimer = useRef(0);
    const aiSearchLookTimer = useRef(0);
    const aiWasTryingToMove = useRef(false);
    const aiWhiskerCenterHit = useRef<{
      isBlocked: boolean;
      hitPoint: THREE.Vector3;
      dist: number;
    } | null>(null);
    const aiWhiskerLeftHit = useRef<{
      isBlocked: boolean;
      hitPoint: THREE.Vector3;
      dist: number;
    } | null>(null);
    const aiWhiskerRightHit = useRef<{
      isBlocked: boolean;
      hitPoint: THREE.Vector3;
      dist: number;
    } | null>(null);
    const aiWhiskerCenterDir = useRef(new THREE.Vector3(0, 0, 0));
    const aiWhiskerLeftDir = useRef(new THREE.Vector3(0, 0, 0));
    const aiWhiskerRightDir = useRef(new THREE.Vector3(0, 0, 0));
    const aiWhiskerCenterLen = useRef(2.5);
    const aiWhiskerSideLen = useRef(1.5);

    // AI Ladder State
    const aiLadderState = useRef({
      isClimbing: false,
      isLadderSliding: false,
      isLadderHanging: false,
      isLadderMounting: false,
      ladderMountTimer: 0,
      isWallClimbing: false,
      wallClimbProgress: 0,
      wallClimbDir: new THREE.Vector2(0, 0),
    });

    // AI Character Group & UI Refs
    const aiCharacterGroup = useRef<THREE.Group>(null!);
    const aiStaminaGroup = useRef<HTMLDivElement>(null!);
    const aiStaminaFill = useRef<HTMLDivElement>(null!);

    // AI Hiding & Decision States
    const aiHidingSpot = useRef(new THREE.Vector3(0, 0, 0));
    const aiLastKnownPlayerPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiPlayerLastVel = useRef(new THREE.Vector3(0, 0, 0));
    const aiLastKnownPlayerDir = useRef(new THREE.Vector3(0, 0, 0));
    const aiHasLastKnownPlayerPos = useRef(false);
    const aiLastHeardUpdateTimer = useRef(0);
    const aiHeardEmojiTimer = useRef(0);
    const aiLocalSearchCount = useRef(0);
    const aiWanderTarget = useRef(new THREE.Vector3(0, 0, 0));
    const aiHasWanderTarget = useRef(false);
    const aiFleeTimer = useRef(0); // Cooldown to re-evaluate fleeing hiding spot
    const aiWanderTargetTimer = useRef(0); // Countdown to force target re-evaluation
    const aiLastSearchedQuadrant = useRef(0); // Track last searched quadrant in search mode

    // AI Visual State
    const aiVisualStateRef = useRef({
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
      wallClimbProgress: 0,
    });

    const occludedBuildingIdsRef = useRef<Set<string>>(new Set());
    const buildingsGroupRef = useRef<THREE.Group>(null);

    // Character Refs for direct manipulation (if needed)
    const characterGroup = useRef<THREE.Group>(null!);
    const staminaGroup = useRef<HTMLDivElement>(null!);
    const staminaFill = useRef<HTMLDivElement>(null!);

    // Map Data
    const [mapData, setMapData] = useState<{
      objects: VoxelObject[];
      collisionGrid: SpatialHashGrid;
      bGrid: number[][];
      wGrid: number[][];
      sGrid: number[][];
      tGrid: number[][];
      spawnPos: THREE.Vector3;
      ladderZones: {
        minX: number;
        minY: number;
        minZ: number;
        maxX: number;
        maxY: number;
        maxZ: number;
        faceAngle: number;
        railX: number;
        railZ: number;
      }[];
      riverOrientation: number;
      riverFlow: number;
      worldSize: number;
    } | null>(null);

    const navGraph = useMemo(() => (mapData ? new NavigationGraph(mapData) : null), [mapData]);
    useEffect(() => {
      (window as any).__PARKUBES_NAV_GRAPH = navGraph;
    }, [navGraph]);
    const aiPath = useRef<NavNode[]>([]);
    const aiPathIndex = useRef<number>(0);
    const aiPathRecalcTimer = useRef<number>(0);
    const aiLastPathTarget = useRef<THREE.Vector3>(new THREE.Vector3(Infinity, Infinity, Infinity));
    const aiWasDirect = useRef(false);

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
      wallClimbProgress: 0,
    });

    // Initialization & Map Regeneration
    useEffect(() => {
      // Debounce Level Generation to prevent freezing when moving sliders
      const timeout = setTimeout(() => {
        const spawn = new THREE.Vector2(0, 0);
        const data = generateCityLevel(spawn, settings, mapId);
        setMapData(data);
        // @ts-expect-error - Export map data for debug/AI scripts
        window.__PARKUBES_MAP_DATA = data;
        // Export debug refs to window for automated testing
        (window as any).__PARKUBES_PLAYER_POS = playerPos;
        (window as any).__PARKUBES_AI_POS = aiPos;
        (window as any).__PARKUBES_AI_PATH = aiPath;
        (window as any).__PARKUBES_AI_PATH_INDEX = aiPathIndex;
        (window as any).__PARKUBES_AI_LAST_KNOWN = aiLastKnownPlayerPos;
        (window as any).__PARKUBES_AI_HAS_LAST_KNOWN = aiHasLastKnownPlayerPos;

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
    }, [settings, mapId]);

    const oppositeQuadrant = (q: number): 1 | 2 | 3 | 4 => {
      switch (q) {
        case 1:
          return 3;
        case 2:
          return 4;
        case 3:
          return 1;
        case 4:
          return 2;
        default:
          return 3;
      }
    };

    const getTrappedPenalty = (
      pos: THREE.Vector3,
      collisionGrid: SpatialHashGrid,
      worldSize: number,
    ) => {
      const halfSize = worldSize / 2;
      const distToXMin = Math.abs(pos.x - -halfSize);
      const distToXMax = Math.abs(pos.x - halfSize);
      const distToZMin = Math.abs(pos.z - -halfSize);
      const distToZMax = Math.abs(pos.z - halfSize);

      let penalty = 0;

      // 1. Map boundary corners (very easy to get cornered here!)
      const isNearX = distToXMin < 6.0 || distToXMax < 6.0;
      const isNearZ = distToZMin < 6.0 || distToZMax < 6.0;
      if (isNearX && isNearZ) {
        penalty += 100; // massive penalty for map corners
      } else if (isNearX || isNearZ) {
        penalty += 30; // penalty for map edges
      }

      // 2. Obstacle corners (walls)
      // Check 4 cardinal directions at 3.0 units distance
      const checkOffsets = [
        { x: 3.0, z: 0.0 }, // East
        { x: -3.0, z: 0.0 }, // West
        { x: 0.0, z: 3.0 }, // North
        { x: 0.0, z: -3.0 }, // South
      ];

      let blockedDirections = 0;
      checkOffsets.forEach((offset) => {
        const cx = pos.x + offset.x;
        const cz = pos.z + offset.z;

        // Check if this offset is out of bounds
        if (cx < -halfSize || cx > halfSize || cz < -halfSize || cz > halfSize) {
          blockedDirections++;
          return;
        }

        // Check if there is an obstacle
        const boxes = collisionGrid.query(cx, cz, 0.5);
        let isBlocked = false;
        for (const box of boxes) {
          // Check if the obstacle is at the same height level
          if (pos.y + 0.1 <= box.maxY && pos.y + 2.0 >= box.minY) {
            if (cx >= box.minX && cx <= box.maxX && cz >= box.minZ && cz <= box.maxZ) {
              isBlocked = true;
              break;
            }
          }
        }
        if (isBlocked) {
          blockedDirections++;
        }
      });

      // If 2 or more directions are blocked, it's a corner or dead-end
      if (blockedDirections >= 2) {
        penalty += blockedDirections * 30; // e.g. 2 -> 60, 3 -> 90, 4 -> 120
      }

      return penalty;
    };

    const getFurthestWaypointFrom = React.useCallback(
      (
        origin: THREE.Vector3,
        currentAiPos?: THREE.Vector3,
        playerDir?: THREE.Vector3 | null,
        graph?: NavigationGraph | null,
      ): THREE.Vector3 => {
        if (!graph || !graph.nodes || graph.nodes.size === 0) {
          return new THREE.Vector3(0, 0, 0);
        }

        const furthestSpot = new THREE.Vector3(0, 0, 0);
        let bestScore = -Infinity;

        // Vector direction from AI to player position
        const dirToPlayerPos = currentAiPos
          ? new THREE.Vector3().subVectors(origin, currentAiPos).normalize()
          : null;
        const currentDistToPlayer = currentAiPos ? currentAiPos.distanceTo(origin) : 0;

        const candidates: { pos: THREE.Vector3; score: number }[] = [];

        graph.nodes.forEach((node) => {
          const pos = new THREE.Vector3(node.x, node.y, node.z);
          const distToPlayer = pos.distanceTo(origin);

          let score = distToPlayer;

          if (currentAiPos) {
            const dirToCand = new THREE.Vector3().subVectors(pos, currentAiPos).normalize();

            // 1. Evade player's position
            if (dirToPlayerPos) {
              const dotPos = dirToPlayerPos.dot(dirToCand);
              if (dotPos > 0.3) {
                score -= 2000;
              } else if (dotPos > 0.0) {
                score -= 1000;
              } else {
                score += (1.0 - dotPos) * 50.0;
              }
            }

            // 2. Flee OPPOSITE to player's heading vector (if player was moving)
            if (playerDir && playerDir.lengthSq() > 0.1) {
              const dotVel = playerDir.dot(dirToCand);
              // If candidate is in the direction player was heading (dotVel > 0), penalize!
              // If candidate is OPPOSITE to player's heading (dotVel < 0), bonus!
              if (dotVel > 0.2) {
                score -= 1500;
              } else if (dotVel < -0.2) {
                score += Math.abs(dotVel) * 100.0; // Bonus for fleeing opposite to player's heading!
              }
            }

            // 3. Heavy penalty if candidate brings AI closer to player
            if (distToPlayer < currentDistToPlayer) {
              score -= (currentDistToPlayer - distToPlayer) * 100.0;
            }

            // 4. Penalty if candidate is too close to player
            if (distToPlayer < 8.0) {
              score -= (8.0 - distToPlayer) * 200.0;
            }
          }

          candidates.push({ pos, score });
        });

        // Sort candidates by score descending
        candidates.sort((a, b) => b.score - a.score);

        // Select the highest scoring reachable candidate whose path avoids running past the player
        for (const cand of candidates) {
          if (currentAiPos) {
            const path = graph.findPath(currentAiPos, cand.pos);
            if (!path || path.length === 0) {
              continue; // Skip unreachable node
            }

            // Path safety check: ensure no step along the path runs past/into the player
            let pathPassesThroughPlayer = false;
            for (const node of path) {
              const nodePos = new THREE.Vector3(node.x, node.y, node.z);
              const nodeDistToPlayer = nodePos.distanceTo(origin);
              // If path forces running within 4.0 meters of player when AI was further away, reject path
              if (nodeDistToPlayer < 4.0 && currentDistToPlayer > 5.0) {
                pathPassesThroughPlayer = true;
                break;
              }
            }

            if (pathPassesThroughPlayer) {
              continue; // Skip path that runs into the player
            }
          }

          furthestSpot.copy(cand.pos);
          bestScore = cand.score;
          break;
        }

        return bestScore !== -Infinity ? furthestSpot : new THREE.Vector3(0, 0, 0);
      },
      [],
    );

    // Calculate camera zoom & position to fit the entire map inside app window before countdown
    const fitCameraToMap = React.useCallback(() => {
      if (!camera || !(camera instanceof THREE.OrthographicCamera)) return;
      const halfSize = settings.worldSize / 2;
      const maxH = 20; // maximum building height

      camera.position.set(100, 100, 100);
      camera.lookAt(0, 0, 0);
      if (controls) {
        const ctrl = controls as unknown as { target: THREE.Vector3; update: () => void; reset?: () => void };
        if (ctrl.reset) ctrl.reset();
        if (ctrl.target) ctrl.target.set(0, 0, 0);
        if (ctrl.update) ctrl.update();
      }
      camera.updateMatrixWorld(true);

      const corners = [
        new THREE.Vector3(-halfSize, 0, -halfSize),
        new THREE.Vector3(halfSize, 0, -halfSize),
        new THREE.Vector3(-halfSize, 0, halfSize),
        new THREE.Vector3(halfSize, 0, halfSize),
        new THREE.Vector3(-halfSize, maxH, -halfSize),
        new THREE.Vector3(halfSize, maxH, -halfSize),
        new THREE.Vector3(-halfSize, maxH, halfSize),
        new THREE.Vector3(halfSize, maxH, halfSize),
      ];

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      const viewMatrix = camera.matrixWorldInverse;

      corners.forEach((corner) => {
        const v = corner.clone().applyMatrix4(viewMatrix);
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      });

      const mapWidth3D = maxX - minX;
      const mapHeight3D = maxY - minY;
      const frustumWidth = camera.right - camera.left;
      const frustumHeight = camera.top - camera.bottom;

      if (frustumWidth > 0 && frustumHeight > 0 && mapWidth3D > 0 && mapHeight3D > 0) {
        const zoomX = frustumWidth / mapWidth3D;
        const zoomY = frustumHeight / mapHeight3D;
        camera.zoom = Math.min(zoomX, zoomY) * 0.90; // 90% for padding
        camera.updateProjectionMatrix();
      }
    }, [camera, controls, settings.worldSize]);

    // Handle Match Start or Respawn (PREP status)
    useEffect(() => {
      if (status === GameStatus.PREP && mapData) {
        if (props.mode === GameMode.HIDE_AND_SEEK) {
          // Choose player spawn quadrant randomly
          const pQuad = (Math.floor(Math.random() * 4) + 1) as 1 | 2 | 3 | 4;
          const aiQuad = oppositeQuadrant(pQuad);

          const isWaterLogic = (lx: number, lz: number) => {
            const halfSize = Math.floor(settings.worldSize / 2);
            const startX = worldToIndex(lx, halfSize, settings.worldSize);
            const startZ = worldToIndex(lz, halfSize, settings.worldSize);
            return mapData.wGrid[startX]?.[startZ] === 1;
          };

          const halfSize = Math.floor(settings.worldSize / 2);
          const pSpawn = findSpawnPos(
            settings.worldSize,
            halfSize,
            mapData.tGrid,
            mapData.collisionGrid,
            mapData.wGrid,
            isWaterLogic,
            pQuad,
          );
          const aiSpawn = findSpawnPos(
            settings.worldSize,
            halfSize,
            mapData.tGrid,
            mapData.collisionGrid,
            mapData.wGrid,
            isWaterLogic,
            aiQuad,
          );

          // Reset player physics state
          playerPos.current.copy(pSpawn);
          prevPlayerPos.current.copy(pSpawn);
          playerVel.current.set(0, 0, 0);
          isGrounded.current = true;
          airTimeHighPoint.current = pSpawn.y;
          stamina.current = 100;
          stunTimer.current = 0;

          // Reset AI physics state
          aiPos.current.copy(aiSpawn);
          aiPrevPos.current.copy(aiSpawn);
          aiVel.current.set(0, 0, 0);
          aiIsGrounded.current = true;
          aiAirTimeHighPoint.current = aiSpawn.y;
          aiStamina.current = 100;
          aiStunTimer.current = 0;
          aiStuckTimer.current = 0;
          aiDetourTimer.current = 0;
          aiJumpHoldTimer.current = 0;
          aiLastProgressPos.current.copy(aiSpawn);
          aiProgressCheckTimer.current = 0;
          aiSearchLookTimer.current = 0;
          aiLateralDetourDir.current.set(0, 0, 0);
          aiLateralDetourTimer.current = 0;
          aiLongStuckTimer.current = 0;
          aiLongStuckPos.current.copy(aiSpawn);

          // Reset AI target states
          aiHasLastKnownPlayerPos.current = false;
          aiWasDirect.current = false;
          aiHasWanderTarget.current = false;
          aiWanderTargetTimer.current = 0;

          // Select initial hiding spot if AI is Hider
          const isAISeeker = props.match.currentRound % 2 !== 0;
          if (!isAISeeker) {
            aiHidingSpot.current.copy(getFurthestWaypointFrom(pSpawn, aiSpawn, null, navGraph));
          }
        } else {
          // Free Mode: reset player only
          playerPos.current.copy(mapData.spawnPos);
          prevPlayerPos.current.copy(mapData.spawnPos);
          playerVel.current.set(0, 0, 0);
          isGrounded.current = true;
          airTimeHighPoint.current = mapData.spawnPos.y;
          stamina.current = 100;
          stunTimer.current = 0;
        }

        // Reset Camera & Controls strictly ONCE before the countdown starts (PREP status)
        fitCameraToMap();

        // In FREE mode, transition immediately
        if (props.mode === GameMode.FREE) {
          onPrepComplete();
        }
      }
    }, [
      status,
      mapData,
      props.mode,
      props.match.currentRound,
      onPrepComplete,
      getFurthestWaypointFrom,
      fitCameraToMap,
    ]);

    // Handle Camera Fitting on App Load (IDLE), Prep Phase & Window Resize
    useEffect(() => {
      if (mapData && !settings.cameraFollow && (status === GameStatus.IDLE || status === GameStatus.PREP)) {
        fitCameraToMap();
      }

      const handleResize = () => {
        if (!settings.cameraFollow && (status === GameStatus.IDLE || status === GameStatus.PREP)) {
          fitCameraToMap();
        }
      };

      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [fitCameraToMap, settings.cameraFollow, status, mapData]);

    useFrame((state, delta) => {
      if (!mapData) return;
      const dt = Math.min(delta, 0.1);
      const isPlayerSeeker =
        props.mode === GameMode.HIDE_AND_SEEK && props.match.currentRound % 2 === 0;
      const playerIsFrozen = status === GameStatus.PREP && isPlayerSeeker;
      const finalPlayerCanMove =
        (status === GameStatus.PLAYING || status === GameStatus.PREP) && !playerIsFrozen;
      const playerCanMove = finalPlayerCanMove;

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
        finalPlayerCanMove,
        rollTimer,
        jumpBufferTimer,
        isRolling,
        stumbleTimer,
        stumbleVelocity,
        camera, // Pass Camera
        lastFallDist,
        mapData?.riverOrientation ?? -1,
        settings.riverFlow,
        mapData?.ladderZones ?? [],
      );

      // Update Character Transform
      if (characterGroup.current) {
        characterGroup.current.position.copy(playerPos.current);

        // ROTATE CHARACTER: Face movement direction or face ladder
        const isOnLadder =
          physicsOutput.isClimbing ||
          physicsOutput.isLadderSliding ||
          physicsOutput.isLadderHanging ||
          physicsOutput.isLadderMounting;
        if (isOnLadder) {
          // Face the ladder wall
          const targetAngle = physicsOutput.ladderFaceAngle;
          const currentAngle = characterGroup.current.rotation.y;
          let diff = targetAngle - currentAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;

          const rotSpeed = 12;
          characterGroup.current.rotation.y += diff * dt * rotSpeed;
        } else if (physicsOutput.pMoving && !physicsOutput.effectiveStunned) {
          // pDir now reflects world direction relative to camera
          const targetAngle = Math.atan2(physicsOutput.pDir.x, physicsOutput.pDir.z);
          const currentAngle = characterGroup.current.rotation.y;
          let diff = targetAngle - currentAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;

          const rotSpeed = 15;
          characterGroup.current.rotation.y += diff * dt * rotSpeed;
        }
      }

      // --- START AI LOGIC ---
      const isAISeeker =
        props.mode === GameMode.HIDE_AND_SEEK && props.match.currentRound % 2 !== 0;
      const aiIsFrozen = status === GameStatus.PREP && isAISeeker;
      const aiCanMove =
        (status === GameStatus.PLAYING || status === GameStatus.PREP) && !aiIsFrozen;

      const aiInput = {
        moveDir: new THREE.Vector3(0, 0, 0),
        jump: false,
        run: false,
        ladderUp: false,
        ladderDown: false,
        grabLadder: false,
        charge: false,
        climb: false,
        attemptRoll: false,
      };

      let isAIChasing = false;
      const targetPos = new THREE.Vector3().copy(aiPos.current);

      if (props.mode === GameMode.HIDE_AND_SEEK && aiCanMove) {
        const toPlayer = new THREE.Vector3().subVectors(playerPos.current, aiPos.current);
        const distanceToPlayer = toPlayer.length();
        const hasLOS = checkLineOfSight(aiPos.current, playerPos.current, mapData.collisionGrid);

        // Update last seen position
        if (hasLOS && status === GameStatus.PLAYING) {
          aiLastKnownPlayerPos.current.copy(playerPos.current);
          aiPlayerLastVel.current.copy(playerVel.current);
          const pVelXZ = Math.sqrt(playerVel.current.x * playerVel.current.x + playerVel.current.z * playerVel.current.z);
          if (pVelXZ > 0.3) {
            aiLastKnownPlayerDir.current.set(playerVel.current.x, 0, playerVel.current.z).normalize();
          } else if (physicsOutput.pDir && physicsOutput.pDir.lengthSq() > 0.1) {
            aiLastKnownPlayerDir.current.set(physicsOutput.pDir.x, 0, physicsOutput.pDir.z).normalize();
          }
          aiHasLastKnownPlayerPos.current = true;
          aiLocalSearchCount.current = 0; // Reset local search count while chasing
        }

        // Hear player running
        const playerNoise = physicsOutput.noiseLevel;
        const canHearPlayer = playerNoise > 0 && distanceToPlayer < playerNoise * 1.5;
        if (aiLastHeardUpdateTimer.current > 0) {
          aiLastHeardUpdateTimer.current -= dt;
        }
        if (aiHeardEmojiTimer.current > 0) {
          aiHeardEmojiTimer.current -= dt;
        }
        if (canHearPlayer && status === GameStatus.PLAYING) {
          aiHeardEmojiTimer.current = 1.5; // Show ear emoji 👂 for 1.5s when heard
          if (!aiHasLastKnownPlayerPos.current || aiLastHeardUpdateTimer.current <= 0) {
            aiLastKnownPlayerPos.current.copy(playerPos.current);
            aiPlayerLastVel.current.copy(playerVel.current);
            const pVelXZ = Math.sqrt(playerVel.current.x * playerVel.current.x + playerVel.current.z * playerVel.current.z);
            if (pVelXZ > 0.3) {
              aiLastKnownPlayerDir.current.set(playerVel.current.x, 0, playerVel.current.z).normalize();
            } else if (physicsOutput.pDir && physicsOutput.pDir.lengthSq() > 0.1) {
              aiLastKnownPlayerDir.current.set(physicsOutput.pDir.x, 0, physicsOutput.pDir.z).normalize();
            }
            aiHasLastKnownPlayerPos.current = true;
            aiLocalSearchCount.current = 0; // Reset local search count while chasing
            aiLastHeardUpdateTimer.current = 1.5; // Cooldown of 1.5 seconds
            console.log('[AI Hearing] Registered new player position at:', playerPos.current.toArray());
          }
        }

        isAIChasing = isAISeeker && (hasLOS || aiHasLastKnownPlayerPos.current);

        if (isAISeeker) {
          // SEEKER AI
          if (hasLOS) {
            // Visual contact: run directly to player's current position + small lead in player heading direction
            targetPos.copy(playerPos.current);
            if (aiLastKnownPlayerDir.current.lengthSq() > 0.1) {
              targetPos.addScaledVector(aiLastKnownPlayerDir.current, 2.0);
            }
            aiInput.run = true;
          } else if (aiHasLastKnownPlayerPos.current) {
            // No visual contact: project target in the direction player was heading when last seen/heard!
            targetPos.copy(aiLastKnownPlayerPos.current);
            if (aiLastKnownPlayerDir.current.lengthSq() > 0.1) {
              targetPos.addScaledVector(aiLastKnownPlayerDir.current, 6.0); // lead 6m in player vector direction
            }
            // Run with urgency (always run, ignore stamina threshold)
            aiInput.run = true;

            // Clear tracking once we arrive at the last known position, or if we reached the end of the path and are blocked
            const arrived = aiPos.current.distanceTo(aiLastKnownPlayerPos.current) < 2.0;
            const pathCompleted =
              aiPath.current.length === 0 || aiPathIndex.current >= aiPath.current.length;
            const currentSpeedXZ = Math.sqrt(
              aiVel.current.x * aiVel.current.x + aiVel.current.z * aiVel.current.z,
            );
            const isBlockedAtEnd =
              pathCompleted && currentSpeedXZ < 0.3 && aiStunTimer.current <= 0;

            const isAIOnLadder = mapData.ladderZones?.some(
              (zone) =>
                aiPos.current.x >= zone.minX - 1.2 &&
                aiPos.current.x <= zone.maxX + 1.2 &&
                aiPos.current.z >= zone.minZ - 1.2 &&
                aiPos.current.z <= zone.maxZ + 1.2 &&
                aiPos.current.y >= zone.minY - 0.5 &&
                aiPos.current.y < zone.maxY - 0.2,
            );

            if (!isAIOnLadder && (arrived || isBlockedAtEnd) && !canHearPlayer && !aiWasDirect.current) {
              console.log(
                '[AI Chase] Desistiu/Arrived. Arrived:',
                arrived,
                'BlockedAtEnd:',
                isBlockedAtEnd,
                'Dist:',
                aiPos.current.distanceTo(aiLastKnownPlayerPos.current),
                'canHear:',
                canHearPlayer,
                'wasDirect:',
                aiWasDirect.current,
              );
              aiHasLastKnownPlayerPos.current = false;
              aiHasWanderTarget.current = false; // Trigger immediate search in a different quadrant
              aiLocalSearchCount.current = 0;
            }
          } else {
            // Wander search: continuously move from waypoint to waypoint across quadrants
            if (aiHasWanderTarget.current) {
              aiWanderTargetTimer.current -= dt;
              if (aiWanderTargetTimer.current <= 0) {
                aiHasWanderTarget.current = false; // Abandon target
              }
            }

            if (
              !aiHasWanderTarget.current ||
              aiPos.current.distanceTo(aiWanderTarget.current) < 2.0
            ) {
              aiHasWanderTarget.current = false;
              // Determine current quadrant and filter out both current and last searched quadrant
              const currentQuad = getQuadrant(aiPos.current.x, aiPos.current.z);
              let validQuads = [1, 2, 3, 4].filter(
                (q) => q !== currentQuad && q !== aiLastSearchedQuadrant.current,
              );
              if (validQuads.length === 0) {
                validQuads = [1, 2, 3, 4].filter((q) => q !== currentQuad);
              }
              const targetQuad =
                validQuads[Math.floor(Math.random() * validQuads.length)] || 1;
              aiLastSearchedQuadrant.current = targetQuad;

              // 50% chance to climb a building with a ladder in target quadrant, 50% chance of street wander in target quadrant
              const buildingsWithLadders = mapData.objects.filter((obj) => {
                if (!obj.ladders || obj.ladders.length === 0) return false;
                return getQuadrant(obj.position[0], obj.position[2]) === targetQuad;
              });

              if (buildingsWithLadders.length > 0 && Math.random() < 0.5) {
                const obj =
                  buildingsWithLadders[
                    Math.floor(Math.random() * buildingsWithLadders.length)
                  ];
                // Target the base of the ladder so the AI routes to ladder base -> ladder top -> roof
                const ladderZone = mapData.ladderZones.find(
                  (z) =>
                    obj.position[0] >= z.minX - 2.5 &&
                    obj.position[0] <= z.maxX + 2.5 &&
                    obj.position[2] >= z.minZ - 2.5 &&
                    obj.position[2] <= z.maxZ + 2.5,
                );
                if (ladderZone) {
                  const ladderBasePos = new THREE.Vector3(
                    (ladderZone.minX + ladderZone.maxX) / 2,
                    ladderZone.minY,
                    (ladderZone.minZ + ladderZone.maxZ) / 2,
                  );
                  aiWanderTarget.current.copy(ladderBasePos);
                } else {
                  const roofY = obj.position[1] + obj.scale[1] / 2;
                  aiWanderTarget.current.set(obj.position[0], roofY, obj.position[2]);
                }
                aiHasWanderTarget.current = true;
                aiWanderTargetTimer.current = 12.0; // 12 seconds for roof climb
              } else {
                // Generate random coordinates bounded to the target quadrant
                const halfSize = settings.worldSize / 2;
                const margin = PLAYER_RADIUS + 0.1;
                let minX = 0,
                  maxX = 0,
                  minZ = 0,
                  maxZ = 0;
                if (targetQuad === 1) {
                  minX = 0;
                  maxX = halfSize - margin;
                  minZ = 0;
                  maxZ = halfSize - margin;
                } else if (targetQuad === 2) {
                  minX = -halfSize + margin;
                  maxX = 0;
                  minZ = 0;
                  maxZ = halfSize - margin;
                } else if (targetQuad === 3) {
                  minX = -halfSize + margin;
                  maxX = 0;
                  minZ = -halfSize + margin;
                  maxZ = 0;
                } else {
                  minX = 0;
                  maxX = halfSize - margin;
                  minZ = -halfSize + margin;
                  maxZ = 0;
                }

                let rx = 0;
                let rz = 0;
                let ry = -Infinity;
                let found = false;
                for (let attempt = 0; attempt < 50; attempt++) {
                  rx = minX + Math.random() * (maxX - minX);
                  rz = minZ + Math.random() * (maxZ - minZ);
                  ry = getTerrainHeight(
                    rx,
                    rz,
                    0,
                    mapData.collisionGrid,
                    mapData.bGrid,
                    mapData.wGrid,
                    settings.worldSize,
                  );
                  if (ry !== -Infinity && ry < 2.0) {
                    if (
                      !isPositionBlocked(
                        rx,
                        ry,
                        rz,
                        mapData.collisionGrid,
                        PLAYER_RADIUS - 0.25,
                      )
                    ) {
                      found = true;
                      break;
                    }
                  }
                }
                if (found) {
                  aiWanderTarget.current.set(rx, ry, rz);
                  aiHasWanderTarget.current = true;
                  aiWanderTargetTimer.current = 10.0; // 10 seconds for street wander
                }
              }
            }

            if (aiHasWanderTarget.current) {
              targetPos.copy(aiWanderTarget.current);
              // Maintain continuous movement forward
              aiInput.run = true;
            }
          }
        } else {
          // HIDER AI
          if (status === GameStatus.PREP) {
            targetPos.copy(aiHidingSpot.current);
            aiInput.run = true;
          } else {
            // Playing: decisions are made EXCLUSIVELY based on aiLastKnownPlayerPos
            const distToLastKnownPlayer = aiHasLastKnownPlayerPos.current
              ? aiPos.current.distanceTo(aiLastKnownPlayerPos.current)
              : Infinity;

            const isPlayerDangerouslyClose = distToLastKnownPlayer < 10.0;
            const inImmediateDanger = hasLOS || canHearPlayer || isPlayerDangerouslyClose;

            if (inImmediateDanger && aiHasLastKnownPlayerPos.current) {
              // Fleeing: run to a reachable hiding spot away from the player's last known position
              const spotDistToLastKnown = aiHidingSpot.current.distanceTo(aiLastKnownPlayerPos.current);
              const spotHasLOS = checkLineOfSight(aiLastKnownPlayerPos.current, aiHidingSpot.current, mapData.collisionGrid);
              const isSpotCompromised = spotDistToLastKnown < 8.0 || spotHasLOS;
              const arrivedAtSpot = aiPos.current.distanceTo(aiHidingSpot.current) < 2.0;

              aiFleeTimer.current -= dt;
              if (aiFleeTimer.current <= 0) {
                if (isSpotCompromised || arrivedAtSpot) {
                  const bestSpot = getFurthestWaypointFrom(
                    aiLastKnownPlayerPos.current,
                    aiPos.current,
                    aiLastKnownPlayerDir.current,
                    navGraph,
                  );
                  if (bestSpot && bestSpot.lengthSq() > 0) {
                    aiHidingSpot.current.copy(bestSpot);
                  }
                }
                aiFleeTimer.current = 1.0; // Throttle hiding spot re-evaluation to once per second
              }
              targetPos.copy(aiHidingSpot.current);
              aiInput.run = true;
            } else {
              // Safe, stay in hiding spot
              targetPos.copy(aiHidingSpot.current);
              aiInput.run = false;
            }
          }
        }

        // --- AI WAYPOINT / A* PATHFINDING UPDATE ---
        const currentWaypointPos = targetPos.clone(); // fallback to direct target

        if (navGraph) {
          aiPathRecalcTimer.current -= dt;
          const targetMovedThreshold = isAIChasing && hasLOS ? 0.8 : 1.5;
          const targetMoved = aiLastPathTarget.current.distanceTo(targetPos) > targetMovedThreshold;

          const isAIOnLadder = mapData.ladderZones?.some(
            (zone) =>
              aiPos.current.x >= zone.minX - 1.2 &&
              aiPos.current.x <= zone.maxX + 1.2 &&
              aiPos.current.z >= zone.minZ - 1.2 &&
              aiPos.current.z <= zone.maxZ + 1.2 &&
              aiPos.current.y >= zone.minY - 0.5 &&
              aiPos.current.y < zone.maxY - 0.2,
          );

          const needsRecalc =
            !isAIOnLadder &&
            (aiPath.current.length === 0 ||
              aiPathIndex.current >= aiPath.current.length ||
              targetMoved ||
              (isAIChasing && aiPathRecalcTimer.current <= 0));

          if (needsRecalc) {
            aiPathRecalcTimer.current = isAIChasing ? 0.1 : 0.3; // Throttle to 100ms when chasing, 300ms otherwise
            aiLastPathTarget.current.copy(targetPos);
            const computedPath = navGraph.findPath(aiPos.current, targetPos);
            console.log(
              '[AI Path] Recalculado A* para:',
              targetPos.toArray(),
              'Encontrado:',
              !!computedPath,
              'Tamanho:',
              computedPath ? computedPath.length : 0,
            );
            if (computedPath && computedPath.length > 0) {
              aiPath.current = computedPath;
              // If node 0 is close to current AI position, start at node 1 to maintain smooth forward momentum
              if (computedPath.length > 1) {
                const distToNode0 = Math.sqrt(
                  (aiPos.current.x - computedPath[0].x) ** 2 +
                  (aiPos.current.z - computedPath[0].z) ** 2
                );
                aiPathIndex.current = distToNode0 < 1.5 ? 1 : 0;
              } else {
                aiPathIndex.current = 0;
              }
            } else {
              aiPath.current = [];
              aiPathIndex.current = 0;
            }
          }

          if (aiPath.current.length > 0 && aiPathIndex.current < aiPath.current.length) {
            // Path smoothing: lookahead to shortcut straight path segments
            let shortcutIndex = aiPathIndex.current;
            const maxLookAhead = Math.min(aiPath.current.length - 1, aiPathIndex.current + 4);
            for (let i = maxLookAhead; i > aiPathIndex.current; i--) {
              const wpAhead = aiPath.current[i];
              const distXZ = Math.sqrt((aiPos.current.x - wpAhead.x) ** 2 + (aiPos.current.z - wpAhead.z) ** 2);
              const distY = Math.abs(aiPos.current.y - wpAhead.y);
              
              if (distY < 0.6 && distXZ < 12.0) {
                let pathIsClear = true;
                // Check that no intermediate node requires a ladder/high vertical transition
                for (let k = aiPathIndex.current; k <= i; k++) {
                  if (Math.abs(aiPath.current[k].y - aiPos.current.y) > 1.5) {
                    pathIsClear = false;
                    break;
                  }
                }

                if (pathIsClear) {
                  const steps = Math.ceil(distXZ / 0.5);
                  for (let step = 1; step < steps; step++) {
                    const t = step / steps;
                    const px = aiPos.current.x + (wpAhead.x - aiPos.current.x) * t;
                    const pz = aiPos.current.z + (wpAhead.z - aiPos.current.z) * t;
                    
                    if (isPositionBlocked(px, wpAhead.y, pz, mapData.collisionGrid, PLAYER_RADIUS - 0.2)) {
                      pathIsClear = false;
                      break;
                    }
                    
                    const h = getTerrainHeight(
                      px,
                      pz,
                      0,
                      mapData.collisionGrid,
                      mapData.bGrid,
                      mapData.wGrid,
                      settings.worldSize
                    );
                    if (h === -Infinity || Math.abs(h - wpAhead.y) > 0.6) {
                      pathIsClear = false;
                      break;
                    }
                  }
                  if (pathIsClear) {
                    shortcutIndex = i;
                    break;
                  }
                }
              }
            }

            if (shortcutIndex > aiPathIndex.current) {
              aiPathIndex.current = shortcutIndex;
            }

            const wp = aiPath.current[aiPathIndex.current];
            currentWaypointPos.set(wp.x, wp.y, wp.z);

            // Obstacle-repelled waypoint shifting to centralize paths in narrow passages/streets
            const repulsion = new THREE.Vector3(0, 0, 0);
            const checkRadius = 1.2;
            const boxes = mapData.collisionGrid.query(wp.x, wp.z, checkRadius);
            for (const box of boxes) {
              if (wp.y + 0.1 < box.maxY && wp.y + PLAYER_HEIGHT - 0.1 > box.minY) {
                const closeX = Math.max(box.minX, Math.min(wp.x, box.maxX));
                const closeZ = Math.max(box.minZ, Math.min(wp.z, box.maxZ));
                const dx = wp.x - closeX;
                const dz = wp.z - closeZ;
                const distSq = dx * dx + dz * dz;
                if (distSq < checkRadius * checkRadius) {
                  const dist = Math.sqrt(distSq);
                  if (dist > 0.01) {
                    const pushForce = (checkRadius - dist) / checkRadius;
                    repulsion.add(new THREE.Vector3(dx / dist, 0, dz / dist).multiplyScalar(pushForce * 0.7));
                  }
                }
              }
            }
            if (repulsion.lengthSq() > 0.01) {
              const shiftedPos = new THREE.Vector3().copy(currentWaypointPos).add(repulsion);
              if (!isPositionBlocked(shiftedPos.x, shiftedPos.y, shiftedPos.z, mapData.collisionGrid, PLAYER_RADIUS - 0.3)) {
                currentWaypointPos.copy(shiftedPos);
              }
            }

            const distXZ = Math.sqrt((aiPos.current.x - currentWaypointPos.x) ** 2 + (aiPos.current.z - currentWaypointPos.z) ** 2);
            const distY = Math.abs(aiPos.current.y - currentWaypointPos.y);

            // Check if current waypoint is in a narrow passage (walls on opposite sides within 1.6m)
            let isNarrowPassage = false;
            if (wp.isCorner) {
              const testDist = 1.6;
              const blockedLeft = isPositionBlocked(wp.x - testDist, wp.y, wp.z, mapData.collisionGrid, 0.2);
              const blockedRight = isPositionBlocked(wp.x + testDist, wp.y, wp.z, mapData.collisionGrid, 0.2);
              const blockedForward = isPositionBlocked(wp.x, wp.y, wp.z - testDist, mapData.collisionGrid, 0.2);
              const blockedBackward = isPositionBlocked(wp.x, wp.y, wp.z + testDist, mapData.collisionGrid, 0.2);
              if ((blockedLeft && blockedRight) || (blockedForward && blockedBackward)) {
                isNarrowPassage = true;
              }
            }

            const arrivalThreshold = isNarrowPassage ? 0.8 : (wp.isCorner ? 2.0 : 1.2);

            if (distXZ < arrivalThreshold && distY < 1.0) {
              aiPathIndex.current++;
              if (aiPathIndex.current < aiPath.current.length) {
                const nextWp = aiPath.current[aiPathIndex.current];
                currentWaypointPos.set(nextWp.x, nextWp.y, nextWp.z);
              }
            }

            // Jump climb trigger for low obstacles (suppress jump when near a ladder)
            const heightDiffToWp = wp.y - aiPos.current.y;
            const isNearLadder = mapData.ladderZones?.some(
              (z) =>
                aiPos.current.x >= z.minX - 1.2 &&
                aiPos.current.x <= z.maxX + 1.2 &&
                aiPos.current.z >= z.minZ - 1.2 &&
                aiPos.current.z <= z.maxZ + 1.2,
            );
            if (
              heightDiffToWp > 0.6 &&
              heightDiffToWp <= PLAYER_HEIGHT &&
              distXZ < 2.2 &&
              !isNearLadder
            ) {
              aiJumpHoldTimer.current = Math.max(aiJumpHoldTimer.current, 0.6);
            }
          }
        }

        // Ladder climbing decision: ONLY grab if current path/target intends to climb UP (target height > current height + 1.0)
        if (mapData.ladderZones) {
          const ax = aiPos.current.x;
          const ay = aiPos.current.y;
          const az = aiPos.current.z;

          // Check if the path or final target destination intends to reach an elevated position (e.g. rooftop or ladder top)
          const finalWp = aiPath.current.length > 0 ? aiPath.current[aiPath.current.length - 1] : null;
          const targetIsElevated =
            (finalWp && finalWp.y > ay + 1.5) ||
            targetPos.y > ay + 1.5 ||
            currentWaypointPos.y > ay + 1.0;

          if (targetIsElevated) {
            for (const zone of mapData.ladderZones) {
              const nearLadderXZ =
                ax >= zone.minX - 1.2 &&
                ax <= zone.maxX + 1.2 &&
                az >= zone.minZ - 1.2 &&
                az <= zone.maxZ + 1.2;

              const inLadderYRange = ay >= zone.minY - 1.5 && ay <= zone.maxY + 1.0;

              if (nearLadderXZ && inLadderYRange) {
                if (ay < zone.maxY - 0.2) {
                  // Below ladder top: climb up smoothly to ladder top
                  aiInput.ladderUp = true;
                  aiInput.grabLadder = true;
                  aiInput.jump = false;

                  // Target top of ladder rail directly
                  currentWaypointPos.set(zone.railX, zone.maxY, zone.railZ);
                  break;
                } else if (ay >= zone.maxY - 0.2) {
                  // At or above ladder top: dismount onto roof! Clear ladder inputs so AI steps cleanly onto the roof
                  aiInput.ladderUp = false;
                  aiInput.ladderDown = false;
                  aiInput.grabLadder = false;
                  aiInput.jump = false;
                  break;
                }
              }
            }
          }
        }

        // Steering direction towards the current waypoint
        const dir = new THREE.Vector3().subVectors(currentWaypointPos, aiPos.current);
        dir.y = 0;
        if (dir.lengthSq() > 0.05) {
          dir.normalize();
        } else {
          dir.set(0, 0, 0);
        }

        // Stuck progress checking (every 0.3s)
        aiProgressCheckTimer.current += dt;
        aiLongStuckTimer.current += dt;
        const isTryingToMove = dir.lengthSq() > 0.1;

        // Reset progress tracking if we just started trying to move to prevent false positives when starting to run
        if (isTryingToMove && !aiWasTryingToMove.current) {
          aiProgressCheckTimer.current = 0;
          aiLastProgressPos.current.copy(aiPos.current);
          aiLongStuckTimer.current = 0;
          aiLongStuckPos.current.copy(aiPos.current);
        }
        aiWasTryingToMove.current = isTryingToMove;

        const isClimbingOrHanging =
          aiLadderState.current.isClimbing || aiLadderState.current.isLadderHanging;
        const isNearHidingSpot =
          !isAISeeker && aiPos.current.distanceTo(aiHidingSpot.current) < 1.5;
        const isActivelyUsingLadder = isClimbingOrHanging || aiInput.ladderUp || aiInput.ladderDown;

        if (aiProgressCheckTimer.current > 0.3) {
          aiProgressCheckTimer.current = 0;
          const distMoved = aiPos.current.distanceTo(aiLastProgressPos.current);

          if (
            isTryingToMove &&
            !isActivelyUsingLadder &&
            aiStunTimer.current <= 0 &&
            !isNearHidingSpot &&
            distMoved < 0.25
          ) {
            // AI is stuck on a wall! Check wall height in front of the AI
            const wallCheck = getWallHeightAt(
              aiPos.current,
              dir,
              mapData.collisionGrid,
              PLAYER_RADIUS + 0.4,
              PLAYER_RADIUS * 0.4,
            );

            if (wallCheck.isBlocked && wallCheck.maxY <= aiPos.current.y + PLAYER_HEIGHT) {
              // Stuck on a low wall: jump to scale/climb it
              aiJumpHoldTimer.current = 0.8;
              aiDetourTimer.current = 0; // Clear any detour
            } else {
              // Stuck on a high wall or complex collision: detour around it (sidestepping)
              const perp1 = new THREE.Vector3(-dir.z, 0, dir.x);
              const perp2 = new THREE.Vector3(dir.z, 0, -dir.x);

              const checkPoint1 = new THREE.Vector3()
                .copy(aiPos.current)
                .addScaledVector(perp1, 1.1);
              const checkPoint2 = new THREE.Vector3()
                .copy(aiPos.current)
                .addScaledVector(perp2, 1.1);

              const boxes1 = mapData.collisionGrid.query(checkPoint1.x, checkPoint1.z, 0.5);
              const boxes2 = mapData.collisionGrid.query(checkPoint2.x, checkPoint2.z, 0.5);

              const dirToPlayer = new THREE.Vector3()
                .subVectors(playerPos.current, aiPos.current)
                .normalize();
              const dot1 = dirToPlayer.dot(perp1);
              const dot2 = dirToPlayer.dot(perp2);

              // Scored evaluation: penalize obstacles (-15 each), penalize going towards the player (-80 * dot), and penalize out of bounds (-9999)
              const halfSize = settings.worldSize / 2;
              const margin = PLAYER_RADIUS + 0.02;
              const outOfBounds1 =
                checkPoint1.x < -halfSize + margin ||
                checkPoint1.x > halfSize - margin ||
                checkPoint1.z < -halfSize + margin ||
                checkPoint1.z > halfSize - margin;
              const outOfBounds2 =
                checkPoint2.x < -halfSize + margin ||
                checkPoint2.x > halfSize - margin ||
                checkPoint2.z < -halfSize + margin ||
                checkPoint2.z > halfSize - margin;

              const isBlocked1 = isPositionBlocked(
                checkPoint1.x,
                aiPos.current.y,
                checkPoint1.z,
                mapData.collisionGrid,
                PLAYER_RADIUS,
              );
              const isBlocked2 = isPositionBlocked(
                checkPoint2.x,
                aiPos.current.y,
                checkPoint2.z,
                mapData.collisionGrid,
                PLAYER_RADIUS,
              );

              if (isBlocked1 && isBlocked2) {
                // Both side detours are blocked! Back out of the corner/pocket
                aiDetourDir.current.copy(dir).multiplyScalar(-1);
                aiDetourTimer.current = 1.0; // Back out for 1 second
              } else {
                const score1 =
                  -boxes1.length * 15 -
                  (isAISeeker ? 0 : dot1 * 80) -
                  (outOfBounds1 ? 9999 : 0) -
                  (isBlocked1 ? 9999 : 0);
                const score2 =
                  -boxes2.length * 15 -
                  (isAISeeker ? 0 : dot2 * 80) -
                  (outOfBounds2 ? 9999 : 0) -
                  (isBlocked2 ? 9999 : 0);

                if (score1 >= score2) {
                  aiDetourDir.current.copy(perp1);
                } else {
                  aiDetourDir.current.copy(perp2);
                }
                aiDetourTimer.current = 1.2; // detouring duration
              }
            }
          }
          aiLastProgressPos.current.copy(aiPos.current);
        }

        // Long-term stuck check (every 1.2s) to detect oscillations
        if (aiLongStuckTimer.current > 1.2) {
          aiLongStuckTimer.current = 0;
          const distMovedLong = aiPos.current.distanceTo(aiLongStuckPos.current);

          if (
            isTryingToMove &&
            !isActivelyUsingLadder &&
            aiStunTimer.current <= 0 &&
            !isNearHidingSpot &&
            distMovedLong < 1.2
          ) {
            // Trigger a detour!
            const perp1 = new THREE.Vector3(-dir.z, 0, dir.x);
            const perp2 = new THREE.Vector3(dir.z, 0, -dir.x);

            const checkPoint1 = new THREE.Vector3().copy(aiPos.current).addScaledVector(perp1, 1.1);
            const checkPoint2 = new THREE.Vector3().copy(aiPos.current).addScaledVector(perp2, 1.1);

            const boxes1 = mapData.collisionGrid.query(checkPoint1.x, checkPoint1.z, 0.5);
            const boxes2 = mapData.collisionGrid.query(checkPoint2.x, checkPoint2.z, 0.5);

            const dirToPlayer = new THREE.Vector3()
              .subVectors(playerPos.current, aiPos.current)
              .normalize();
            const dot1 = dirToPlayer.dot(perp1);
            const dot2 = dirToPlayer.dot(perp2);

            const halfSize = settings.worldSize / 2;
            const margin = PLAYER_RADIUS + 0.02;
            const outOfBounds1 =
              checkPoint1.x < -halfSize + margin ||
              checkPoint1.x > halfSize - margin ||
              checkPoint1.z < -halfSize + margin ||
              checkPoint1.z > halfSize - margin;
            const outOfBounds2 =
              checkPoint2.x < -halfSize + margin ||
              checkPoint2.x > halfSize - margin ||
              checkPoint2.z < -halfSize + margin ||
              checkPoint2.z > halfSize - margin;

            const isBlocked1 = isPositionBlocked(
              checkPoint1.x,
              aiPos.current.y,
              checkPoint1.z,
              mapData.collisionGrid,
              PLAYER_RADIUS,
            );
            const isBlocked2 = isPositionBlocked(
              checkPoint2.x,
              aiPos.current.y,
              checkPoint2.z,
              mapData.collisionGrid,
              PLAYER_RADIUS,
            );

            if (isBlocked1 && isBlocked2) {
              // Both side detours are blocked! Back out of the corner/pocket
              aiDetourDir.current.copy(dir).multiplyScalar(-1);
              aiDetourTimer.current = 1.5; // Back out for 1.5 seconds
            } else {
              const score1 =
                -boxes1.length * 15 -
                (isAISeeker ? 0 : dot1 * 80) -
                (outOfBounds1 ? 9999 : 0) -
                (isBlocked1 ? 9999 : 0);
              const score2 =
                -boxes2.length * 15 -
                (isAISeeker ? 0 : dot2 * 80) -
                (outOfBounds2 ? 9999 : 0) -
                (isBlocked2 ? 9999 : 0);

              if (score1 >= score2) {
                aiDetourDir.current.copy(perp1);
              } else {
                aiDetourDir.current.copy(perp2);
              }
              aiDetourTimer.current = 2.0; // detouring duration (longer detour to clear the obstacle)
            }
          }
          aiLongStuckPos.current.copy(aiPos.current);
        }

        // Proactive obstacle avoidance using Cat's Whiskers (Bigodes de Gato) system
        let centerHit = null;
        let leftHit = null;
        let rightHit = null;
        let L_center = 2.5;
        let L_side = 1.5;
        const speedXZ = Math.sqrt(
          aiVel.current.x * aiVel.current.x + aiVel.current.z * aiVel.current.z,
        );

        // Calculate base desired movement direction (strictly follow A* path)
        // Movement direction strictly follows A* path waypoints
        if (dir.lengthSq() > 0.05) {
          dir.normalize();
        } else {
          dir.set(0, 0, 0);
        }

        // Clear whisker debug info
        aiWhiskerCenterHit.current = null;
        aiWhiskerLeftHit.current = null;
        aiWhiskerRightHit.current = null;

        // Close-range wall climb check (climb automatically when close to a low wall)
        if (dir.lengthSq() > 0.01 && !isActivelyUsingLadder) {
          const closeWallCheck = getWallHeightAt(
            aiPos.current,
            dir,
            mapData.collisionGrid,
            PLAYER_RADIUS + 0.4,
            PLAYER_RADIUS * 0.4,
          );
          if (closeWallCheck.isBlocked && closeWallCheck.maxY <= aiPos.current.y + PLAYER_HEIGHT) {
            aiJumpHoldTimer.current = 0.6;
            aiDetourTimer.current = 0;
          }
        }

        // Blend target direction with stuck detour if active
        if (aiDetourTimer.current > 0) {
          aiDetourTimer.current -= dt;
          dir.copy(aiDetourDir.current);
        }

        aiInput.moveDir.copy(dir);

        // Apply held jump (vital for wall climbing / grabbing ledges in air)
        if (aiJumpHoldTimer.current > 0) {
          aiJumpHoldTimer.current -= dt;
          aiInput.jump = true;
        }

        // Determine AI Emoji based on its actions
        let currentEmoji = '❓';
        if (aiStunTimer.current > 0) {
          currentEmoji = '💫';
        } else if (aiLadderState.current.isWallClimbing) {
          currentEmoji = '🧗‍♀️';
        } else if (aiLadderState.current.isClimbing) {
          currentEmoji = '🧗‍♂️';
        } else if (aiRollTimer.current > 0) {
          currentEmoji = '🤸‍♂️';
        } else if (aiHeardEmojiTimer.current > 0 && !hasLOS) {
          currentEmoji = '👂'; // Show ear emoji when player running is heard!
        } else {
          if (isAISeeker) {
            if (hasLOS) {
              currentEmoji = '🎯'; // actively chasing player in visual contact
            } else if (aiHasLastKnownPlayerPos.current) {
              currentEmoji = '🔎'; // going to predicted position
            } else {
              currentEmoji = '🚶‍♂️'; // wandering/searching
            }
          } else {
            // Hider: Despair emoji 😱 ONLY if AI has seen (hasLOS), heard (canHearPlayer), or has close last known player position
            const distToLastKnown = aiHasLastKnownPlayerPos.current
              ? aiPos.current.distanceTo(aiLastKnownPlayerPos.current)
              : Infinity;
            const sawOrHeardPlayer = hasLOS || canHearPlayer || (aiHasLastKnownPlayerPos.current && distToLastKnown < 10.0);

            if (sawOrHeardPlayer) {
              currentEmoji = '😱'; // Fleeing in despair because player was seen/heard
            } else {
              currentEmoji = '🤫'; // Hiding quietly
            }
          }
        }

        // Update emoji state only if it changed to prevent excessive re-renders
        if (aiEmojiRef.current !== currentEmoji) {
          aiEmojiRef.current = currentEmoji;
          setAiEmoji(currentEmoji);
        }

        isAIChasing = isAISeeker && (hasLOS || aiHasLastKnownPlayerPos.current);
        aiWasDirect.current = false;
      }

      // Run AI Physics
      const dummyKeys = { current: {} };
      const aiSpeed = settings.playerSpeed * (isAIChasing ? 1.15 : 1.0);
      const aiPhysicsOutput = updatePlayerPhysics(
        dt,
        aiPos.current,
        aiVel.current,
        aiIsGrounded,
        aiIsCharging,
        aiLandingAnimTimer,
        aiJumpDelayTimer,
        aiAirTimeHighPoint,
        aiStamina,
        aiStunTimer,
        aiStunTimer.current > 0,
        dummyKeys,
        aiLastDir,
        aiJumpPressedPrev,
        aiSpeed,
        mapData.collisionGrid,
        mapData.bGrid,
        mapData.wGrid,
        settings.worldSize,
        aiCanMove,
        aiRollTimer,
        aiJumpBufferTimer,
        aiIsRolling,
        aiStumbleTimer,
        aiStumbleVelocity,
        camera,
        aiLastFallDist,
        mapData?.riverOrientation ?? -1,
        settings.riverFlow,
        mapData?.ladderZones ?? [],
        aiInput,
        aiLadderState,
      );

      // Update AI Character Transform
      if (aiCharacterGroup.current) {
        aiCharacterGroup.current.position.copy(aiPos.current);
        const isOnLadder =
          aiPhysicsOutput.isClimbing ||
          aiPhysicsOutput.isLadderSliding ||
          aiPhysicsOutput.isLadderHanging ||
          aiPhysicsOutput.isLadderMounting;
        if (isOnLadder) {
          const targetAngle = aiPhysicsOutput.ladderFaceAngle;
          const currentAngle = aiCharacterGroup.current.rotation.y;
          let diff = targetAngle - currentAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          aiCharacterGroup.current.rotation.y += diff * dt * 12;
        } else if (
          (aiPhysicsOutput.pMoving || aiSearchLookTimer.current > 0) &&
          !aiPhysicsOutput.effectiveStunned
        ) {
          const targetAngle = Math.atan2(aiPhysicsOutput.pDir.x, aiPhysicsOutput.pDir.z);
          const currentAngle = aiCharacterGroup.current.rotation.y;
          let diff = targetAngle - currentAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          aiCharacterGroup.current.rotation.y += diff * dt * 10; // Rotate slightly slower for scan look
        }
      }

      // Sync AI Visual State for animations
      const aiDx = aiPos.current.x - aiPrevPos.current.x;
      const aiDz = aiPos.current.z - aiPrevPos.current.z;
      const aiRawMoveSpeed = dt > 0 ? Math.sqrt(aiDx * aiDx + aiDz * aiDz) / dt : 0;
      aiSmoothedMoveSpeed.current = THREE.MathUtils.lerp(
        aiSmoothedMoveSpeed.current,
        aiRawMoveSpeed,
        dt * 10,
      );
      aiPrevPos.current.copy(aiPos.current);

      let aiSurface = 0;
      if (mapData) {
        const halfSize = Math.floor(settings.worldSize / 2);
        const ix = worldToIndex(aiPos.current.x, halfSize, settings.worldSize);
        const iz = worldToIndex(aiPos.current.z, halfSize, settings.worldSize);
        if (mapData.sGrid[ix]?.[iz] !== undefined) {
          aiSurface = mapData.sGrid[ix][iz];
        }
      }

      aiVisualStateRef.current = {
        isCharging: aiPhysicsOutput.isCharging,
        isRolling: aiPhysicsOutput.isRolling,
        isGrounded: aiPhysicsOutput.isGrounded,
        isRunning: aiPhysicsOutput.isRunning,
        isStumbling: aiPhysicsOutput.isStumbling,
        stunned: aiPhysicsOutput.effectiveStunned,
        isMoving: aiPhysicsOutput.pMoving,
        moveSpeed: aiSmoothedMoveSpeed.current,
        landingFactor: aiPhysicsOutput.landingFactor,
        currentSurface: aiSurface,
        fallDistance: aiPhysicsOutput.fallDistance,
        justLanded: aiPhysicsOutput.justLanded,
        isHiding:
          props.mode === GameMode.HIDE_AND_SEEK &&
          !isAISeeker &&
          aiInput.moveDir.lengthSq() < 0.01 &&
          aiPos.current.distanceTo(aiHidingSpot.current) < 1.5,
        isClimbing: aiPhysicsOutput.isClimbing,
        isLadderSliding: aiPhysicsOutput.isLadderSliding,
        isNearLadder: aiPhysicsOutput.isNearLadder,
        isLadderHanging: aiPhysicsOutput.isLadderHanging,
        isLadderMounting: aiPhysicsOutput.isLadderMounting,
        ladderFaceAngle: aiPhysicsOutput.ladderFaceAngle,
        isWallClimbing: aiPhysicsOutput.isWallClimbing,
        wallClimbProgress: aiPhysicsOutput.wallClimbProgress,
      };

      // Catch Collision Check
      if (
        status === GameStatus.PLAYING &&
        props.mode === GameMode.HIDE_AND_SEEK &&
        !props.debugMode
      ) {
        const dist = playerPos.current.distanceTo(aiPos.current);
        if (dist < 1.8) {
          const isPlayerSeeker = props.match.currentRound % 2 === 0;
          props.onRoundEnd(isPlayerSeeker);
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

      // Update AI Stamina Bar
      if (aiStaminaFill.current && aiStaminaGroup.current) {
        const s = Math.max(0, aiStamina.current / 100);
        aiStaminaFill.current.style.width = `${s * 100}%`;

        if (aiPhysicsOutput.effectiveStunned) {
          aiStaminaFill.current.style.backgroundColor = '#9ca3af';
        } else {
          const hue = s * 120;
          aiStaminaFill.current.style.backgroundColor = `hsl(${hue}, 100%, 50%)`;
        }

        aiStaminaGroup.current.style.display = s < 0.99 ? 'block' : 'none';
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
      const isHiding = false;

      const dx = playerPos.current.x - prevPlayerPos.current.x;
      const dz = playerPos.current.z - prevPlayerPos.current.z;
      const rawMoveSpeed = dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
      smoothedMoveSpeed.current = THREE.MathUtils.lerp(
        smoothedMoveSpeed.current,
        rawMoveSpeed,
        dt * 10,
      );
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
        wallClimbProgress: physicsOutput.wallClimbProgress,
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
      else if (Math.abs(newVisualState.landingFactor - visualState.landingFactor) > 0.05)
        changed = true;
      else if (newVisualState.currentSurface !== visualState.currentSurface) changed = true;
      else if (Math.abs(newVisualState.fallDistance - visualState.fallDistance) > 0.1)
        changed = true;
      else if (newVisualState.justLanded !== visualState.justLanded) changed = true;
      else if (newVisualState.isHiding !== visualState.isHiding) changed = true;
      else if (newVisualState.isClimbing !== visualState.isClimbing) changed = true;
      else if (newVisualState.isLadderSliding !== visualState.isLadderSliding) changed = true;
      else if (newVisualState.isNearLadder !== visualState.isNearLadder) changed = true;
      else if (newVisualState.isLadderHanging !== visualState.isLadderHanging) changed = true;
      else if (newVisualState.isLadderMounting !== visualState.isLadderMounting) changed = true;
      else if (newVisualState.isWallClimbing !== visualState.isWallClimbing) changed = true;
      else if (Math.abs(newVisualState.wallClimbProgress - visualState.wallClimbProgress) > 0.05)
        changed = true;

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
          const ctrl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
          if (ctrl) {
            ctrl.target.lerp(target, dt * 5);
            ctrl.update();
          }
        }
      } else if (settings.cameraFollow) {
        // Cast controls to any to access OrbitControls properties
        const ctrl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;

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

      // --- OCCLUSION RAYCASTING ---
      if (mapData) {
        const raycaster = new THREE.Raycaster();
        const camPos = camera.position;
        const playerHead = playerPos.current.clone();
        playerHead.y += 1.0; // target player chest/head

        const toPlayer = new THREE.Vector3().subVectors(playerHead, camPos);
        toPlayer.y = 0; // horizontal projection
        toPlayer.normalize();

        // Perpendicular direction (left/right relative to screen view)
        const perp = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x);

        const targets: THREE.Vector3[] = [playerHead];

        // 1. Side buffers (0.6 units) for early horizontal entry detection
        const sideBuffer = 0.6;
        targets.push(playerHead.clone().addScaledVector(perp, sideBuffer));
        targets.push(playerHead.clone().addScaledVector(perp, -sideBuffer));

        // 2. Velocity-based predictive lookahead (0.3s future projection)
        if (playerVel.current.lengthSq() > 0.01) {
          const velProj = playerVel.current.clone().multiplyScalar(0.3);
          // Clamp lookahead distance to a maximum of 1.8 units
          if (velProj.length() > 1.8) velProj.normalize().multiplyScalar(1.8);
          targets.push(playerHead.clone().add(velProj));
        }

        const currentIntersectedIds = new Set<string>();
        const rootObject = buildingsGroupRef.current || state.scene;
        const isTargeted = !!buildingsGroupRef.current;

        for (const target of targets) {
          const dir = new THREE.Vector3().subVectors(target, camPos).normalize();
          raycaster.set(camPos, dir);
          raycaster.far = camPos.distanceTo(target) - 0.2; // stop right before target

          // Intersect ONLY the buildings group recursively if available, otherwise fallback to scene
          const intersects = isTargeted
            ? raycaster.intersectObject(rootObject, true)
            : raycaster.intersectObjects(rootObject.children, true);

          for (const hit of intersects) {
            let curr: THREE.Object3D | null = hit.object;
            while (curr) {
              if (curr.userData && curr.userData.buildingId) {
                currentIntersectedIds.add(curr.userData.buildingId);
                break;
              }
              curr = curr.parent;
            }
          }
        }

        occludedBuildingIdsRef.current = currentIntersectedIds;

        // --- AI PATH & TARGET DEBUG VISUALIZATION ---
        if (debugMode && showAIPath) {
          // Update pathway line
          if (aiDebugPathLineRef.current) {
            const points: THREE.Vector3[] = [];
            points.push(aiPos.current.clone());

            if (aiPath.current.length > 0) {
              for (let i = aiPathIndex.current; i < aiPath.current.length; i++) {
                const wp = aiPath.current[i];
                points.push(new THREE.Vector3(wp.x, wp.y, wp.z));
              }
            } else {
              points.push(targetPos.clone());
            }

            // Lift all points slightly off the ground to prevent clipping/z-fighting
            points.forEach((p) => (p.y += 0.25));

            aiDebugPathLineRef.current.geometry.setFromPoints(points);
            aiDebugPathLineRef.current.visible = true;
          }

          // Update last known position marker and direction vector line
          if (aiDebugLastPosMarkerRef.current) {
            if (aiHasLastKnownPlayerPos.current) {
              aiDebugLastPosMarkerRef.current.position.copy(aiLastKnownPlayerPos.current);
              aiDebugLastPosMarkerRef.current.position.y += 0.5; // Lift sphere so it doesn't clip
              aiDebugLastPosMarkerRef.current.visible = true;
            } else {
              aiDebugLastPosMarkerRef.current.visible = false;
            }
          }

          if (aiDebugLastDirLineRef.current) {
            if (aiHasLastKnownPlayerPos.current && aiLastKnownPlayerDir.current.lengthSq() > 0.01) {
              const start = aiLastKnownPlayerPos.current.clone();
              start.y += 0.5;
              const end = start.clone().addScaledVector(aiLastKnownPlayerDir.current, 4.0);
              aiDebugLastDirLineRef.current.geometry.setFromPoints([start, end]);
              aiDebugLastDirLineRef.current.visible = true;
            } else {
              aiDebugLastDirLineRef.current.visible = false;
            }
          }

          // Update debug whiskers
          if (aiDebugWhiskerCenterRef.current) {
            const hit = aiWhiskerCenterHit.current;
            const wDir = aiWhiskerCenterDir.current;
            const wLen = aiWhiskerCenterLen.current;
            const points = [
              aiPos.current.clone(),
              hit ? hit.hitPoint.clone() : aiPos.current.clone().addScaledVector(wDir, wLen),
            ];
            points[0].y += 0.25;
            points[1].y += 0.25;
            aiDebugWhiskerCenterRef.current.geometry.setFromPoints(points);
            aiDebugWhiskerCenterRef.current.visible = true;
            const mat = aiDebugWhiskerCenterRef.current.material as THREE.LineBasicMaterial;
            if (mat) mat.color.set(hit ? 'red' : 'green');
          }
          if (aiDebugWhiskerLeftRef.current) {
            const hit = aiWhiskerLeftHit.current;
            const wDir = aiWhiskerLeftDir.current;
            const wLen = aiWhiskerSideLen.current;
            const points = [
              aiPos.current.clone(),
              hit ? hit.hitPoint.clone() : aiPos.current.clone().addScaledVector(wDir, wLen),
            ];
            points[0].y += 0.25;
            points[1].y += 0.25;
            aiDebugWhiskerLeftRef.current.geometry.setFromPoints(points);
            aiDebugWhiskerLeftRef.current.visible = true;
            const mat = aiDebugWhiskerLeftRef.current.material as THREE.LineBasicMaterial;
            if (mat) mat.color.set(hit ? 'red' : 'green');
          }
          if (aiDebugWhiskerRightRef.current) {
            const hit = aiWhiskerRightHit.current;
            const wDir = aiWhiskerRightDir.current;
            const wLen = aiWhiskerSideLen.current;
            const points = [
              aiPos.current.clone(),
              hit ? hit.hitPoint.clone() : aiPos.current.clone().addScaledVector(wDir, wLen),
            ];
            points[0].y += 0.25;
            points[1].y += 0.25;
            aiDebugWhiskerRightRef.current.geometry.setFromPoints(points);
            aiDebugWhiskerRightRef.current.visible = true;
            const mat = aiDebugWhiskerRightRef.current.material as THREE.LineBasicMaterial;
            if (mat) mat.color.set(hit ? 'red' : 'green');
          }
        } else {
          if (aiDebugPathLineRef.current) aiDebugPathLineRef.current.visible = false;
          if (aiDebugLastPosMarkerRef.current) aiDebugLastPosMarkerRef.current.visible = false;
          if (aiDebugLastDirLineRef.current) aiDebugLastDirLineRef.current.visible = false;
          if (aiDebugWhiskerCenterRef.current) aiDebugWhiskerCenterRef.current.visible = false;
          if (aiDebugWhiskerLeftRef.current) aiDebugWhiskerLeftRef.current.visible = false;
          if (aiDebugWhiskerRightRef.current) aiDebugWhiskerRightRef.current.visible = false;
        }
      }
    });

    // Memoize Map Rendering
    const mapElements = useMemo(() => {
      if (!mapData) return null;

      const ruins = mapData.objects.filter((o) => o.type === 'ruin');
      const fences = mapData.objects.filter((o) => o.type === 'fence');
      const wheat = mapData.objects.filter((o) => o.type === 'wheat');
      const foliage = mapData.objects.filter((o) => o.type === 'foliage');
      const buildings = mapData.objects.filter(
        (o) =>
          o.type !== 'ruin' && o.type !== 'fence' && o.type !== 'wheat' && o.type !== 'foliage',
      );

      return (
        <>
          <VoxelGround
            size={mapData.worldSize}
            waterGrid={mapData.wGrid}
            sGrid={mapData.sGrid}
            debugMode={debugMode}
            showGrid={showGrid}
          />
          <VoxelWater
            size={mapData.worldSize}
            waterGrid={mapData.wGrid}
            riverOrientation={mapData.riverOrientation}
            riverFlow={settings.riverFlow}
          />
          <VoxelRuins ruins={ruins} showGrid={showGrid} />
          <VoxelFences fences={fences} />
          <VoxelFoliage objects={foliage} />
          <WheatField wheatObjects={wheat} playerPos={playerPos} />
          <group ref={buildingsGroupRef}>
            {buildings.map((obj) => (
              <Building
                key={obj.id}
                id={obj.id}
                occludedBuildingIdsRef={occludedBuildingIdsRef}
                position={new THREE.Vector3(...obj.position)}
                scale={obj.scale}
                color={obj.color}
                type={obj.type as 'box' | 'factory' | 'highrise'}
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
          </group>
        </>
      );
    }, [mapData, debugMode, showGrid, showWireframe, status, settings.riverFlow]);

    if (!mapData) return null;

    return (
      <group>
        {mapElements}
        {debugMode && mapData && (
          <>
            <CollisionDebug
              collisionGrid={mapData.collisionGrid}
              bGrid={mapData.bGrid}
              size={mapData.worldSize}
              visible={!!showCollision}
            />
            <VisionPointsDebug
              playerPos={playerPos}
              playerLastDir={playerLastDir}
              visible={!!showOcclusion}
            />
            {showAIPath && (
              <>
                <line ref={aiDebugPathLineRef as unknown as React.Ref<SVGLineElement>}>
                  <bufferGeometry />
                  <lineBasicMaterial
                    color="cyan"
                    linewidth={3}
                    depthTest={false}
                    transparent
                    opacity={0.8}
                  />
                </line>
                <mesh ref={aiDebugLastPosMarkerRef}>
                  <sphereGeometry args={[0.6, 16, 16]} />
                  <meshBasicMaterial color="yellow" depthTest={false} transparent opacity={0.8} />
                </mesh>
                <line ref={aiDebugLastDirLineRef as unknown as React.Ref<SVGLineElement>}>
                  <bufferGeometry />
                  <lineBasicMaterial
                    color="#ffaa00"
                    linewidth={4}
                    depthTest={false}
                    transparent
                    opacity={0.9}
                  />
                </line>
                <line ref={aiDebugWhiskerCenterRef as unknown as React.Ref<SVGLineElement>}>
                  <bufferGeometry />
                  <lineBasicMaterial
                    color="green"
                    linewidth={3}
                    depthTest={false}
                    transparent
                    opacity={0.8}
                  />
                </line>
                <line ref={aiDebugWhiskerLeftRef as unknown as React.Ref<SVGLineElement>}>
                  <bufferGeometry />
                  <lineBasicMaterial
                    color="green"
                    linewidth={2}
                    depthTest={false}
                    transparent
                    opacity={0.8}
                  />
                </line>
                <line ref={aiDebugWhiskerRightRef as unknown as React.Ref<SVGLineElement>}>
                  <bufferGeometry />
                  <lineBasicMaterial
                    color="green"
                    linewidth={2}
                    depthTest={false}
                    transparent
                    opacity={0.8}
                  />
                </line>
              </>
            )}
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
            overlayContent={
              props.mode === GameMode.HIDE_AND_SEEK && status === GameStatus.PREP ? (
                <div className="bg-black/75 px-2 py-0.5 rounded text-white text-[10px] pixel-font border border-white/20 select-none uppercase tracking-wider">
                  {props.match.currentRound % 2 === 0 ? 'PEGADOR (VOCÊ)' : 'FUGITIVO (VOCÊ)'}
                </div>
              ) : null
            }
          />
        )}
        {props.mode === GameMode.HIDE_AND_SEEK && status !== GameStatus.IDLE && (
          <Character
            groupRef={aiCharacterGroup}
            staminaFillRef={aiStaminaFill}
            staminaGroupRef={aiStaminaGroup}
            visualStateRef={aiVisualStateRef}
            stunTimerRef={aiStunTimer}
            rollTimerRef={aiRollTimer}
            staminaRef={aiStamina}
            color="#ef4444"
            overlayContent={
              status === GameStatus.PREP ? (
                <div className="bg-black/75 px-2 py-0.5 rounded text-white text-[10px] pixel-font border border-white/20 select-none uppercase tracking-wider">
                  {props.match.currentRound % 2 !== 0 ? 'PEGADOR (IA)' : 'FUGITIVO (IA)'}
                </div>
              ) : status === GameStatus.PLAYING ? (
                <div className="flex flex-col items-center gap-1">
                  <div
                    className="text-2xl animate-bounce"
                    style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
                  >
                    {aiEmoji}
                  </div>
                </div>
              ) : null
            }
          />
        )}
      </group>
    );
  },
  (prev, next) => {
    // CUSTOM COMPARISON: Ignore timer changes to prevent heavy re-renders every second.
    // The timer is only used in a simple overlay div, it doesn't affect the 3D scene/physics.
    // By ignoring it here, we save massive React reconciliation time.
    return (
      prev.status === next.status &&
      prev.mode === next.mode &&
      prev.match === next.match && // match.timer might change, but we care about phase/currentRound
      prev.settings === next.settings &&
      prev.mapId === next.mapId &&
      prev.debugMode === next.debugMode &&
      prev.showGrid === next.showGrid &&
      prev.showCollision === next.showCollision &&
      prev.showWireframe === next.showWireframe &&
      prev.showOcclusion === next.showOcclusion &&
      prev.showAIPath === next.showAIPath &&
      prev.isEditing === next.isEditing
    );
    // We explicitly skip comparing 'timer'
  },
);
