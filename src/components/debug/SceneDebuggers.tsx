import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GRID_SCALE, SpatialHashGrid } from '../../utils/physics';
import { AIWaypoint, WhiskerHit } from '../../utils/aiController';

export const CollisionDebug: React.FC<{
  collisionGrid: SpatialHashGrid;
  bGrid: number[][];
  size: number;
  visible: boolean;
}> = React.memo(({ collisionGrid, bGrid, size, visible }) => {
  const boxRef = useRef<THREE.InstancedMesh>(null!);
  const bRef = useRef<THREE.InstancedMesh>(null!);
  const halfSize = Math.floor(size / 2);
  const gridSize = size * GRID_SCALE;

  const allBoxes = useMemo(() => collisionGrid.getAllBoxes(), [collisionGrid]);

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

export const VisionPointsDebug: React.FC<{
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

const MAX_DEBUG_NODES = 100;
const MAX_LINE_POINTS = 104;

function updateTwoPointLine(
  line: THREE.Line | null,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
) {
  if (!line) return;
  const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  posAttr.setXYZ(0, x1, y1, z1);
  posAttr.setXYZ(1, x2, y2, z2);
  posAttr.needsUpdate = true;
  line.geometry.setDrawRange(0, 2);
}

export const AIDebugVisualizer: React.FC<{
  visible: boolean;
  aiPos: React.MutableRefObject<THREE.Vector3>;
  aiPath: React.MutableRefObject<AIWaypoint[]>;
  aiPathIndex: React.MutableRefObject<number>;
  aiTargetPos: React.MutableRefObject<THREE.Vector3>;
  aiLastKnownPlayerPos: React.MutableRefObject<THREE.Vector3>;
  aiLastKnownPlayerDir: React.MutableRefObject<THREE.Vector3>;
  aiHasLastKnownPlayerPos: React.MutableRefObject<boolean>;
  aiWhiskerCenterHit: React.MutableRefObject<WhiskerHit | null>;
  aiWhiskerLeftHit: React.MutableRefObject<WhiskerHit | null>;
  aiWhiskerRightHit: React.MutableRefObject<WhiskerHit | null>;
  aiWhiskerCenterDir: React.MutableRefObject<THREE.Vector3>;
  aiWhiskerLeftDir: React.MutableRefObject<THREE.Vector3>;
  aiWhiskerRightDir: React.MutableRefObject<THREE.Vector3>;
  aiWhiskerCenterLen: React.MutableRefObject<number>;
  aiWhiskerSideLen: React.MutableRefObject<number>;
}> = React.memo(
  ({
    visible,
    aiPos,
    aiPath,
    aiPathIndex,
    aiTargetPos,
    aiLastKnownPlayerPos,
    aiLastKnownPlayerDir,
    aiHasLastKnownPlayerPos,
    aiWhiskerCenterHit,
    aiWhiskerLeftHit,
    aiWhiskerRightHit,
    aiWhiskerCenterDir,
    aiWhiskerLeftDir,
    aiWhiskerRightDir,
    aiWhiskerCenterLen,
    aiWhiskerSideLen,
  }) => {
    const pathLineRef = useRef<THREE.Line>(null);
    const nodesMeshRef = useRef<THREE.InstancedMesh>(null);
    const targetMarkerRef = useRef<THREE.Mesh>(null);
    const lastPosMarkerRef = useRef<THREE.Mesh>(null);
    const lastDirLineRef = useRef<THREE.Line>(null);
    const whiskerCenterRef = useRef<THREE.Line>(null);
    const whiskerLeftRef = useRef<THREE.Line>(null);
    const whiskerRightRef = useRef<THREE.Line>(null);

    const dummy = useMemo(() => new THREE.Object3D(), []);
    const pathPositions = useMemo(() => new Float32Array(MAX_LINE_POINTS * 3), []);
    const dirPositions = useMemo(() => new Float32Array(2 * 3), []);
    const centerPositions = useMemo(() => new Float32Array(2 * 3), []);
    const leftPositions = useMemo(() => new Float32Array(2 * 3), []);
    const rightPositions = useMemo(() => new Float32Array(2 * 3), []);

    useEffect(() => {
      const lines = [
        pathLineRef.current,
        lastDirLineRef.current,
        whiskerCenterRef.current,
        whiskerLeftRef.current,
        whiskerRightRef.current,
      ];
      for (const line of lines) {
        if (line) line.frustumCulled = false;
      }
    }, [visible]);

    useFrame(() => {
      if (!visible) return;

      const path = aiPath.current;
      const pIdx = aiPathIndex.current;
      const hasCalculatedPath = path.length > 0;
      const curPos = aiPos.current;

      if (pathLineRef.current) {
        if (hasCalculatedPath) {
          const posAttr = pathLineRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
          let count = 0;
          posAttr.setXYZ(count++, curPos.x, curPos.y + 0.25, curPos.z);

          if (pIdx < path.length) {
            for (let i = pIdx; i < path.length && count < MAX_LINE_POINTS; i++) {
              const wp = path[i];
              posAttr.setXYZ(count++, wp.x, wp.y + 0.25, wp.z);
            }
          }
          posAttr.needsUpdate = true;
          pathLineRef.current.geometry.setDrawRange(0, count);
          pathLineRef.current.visible = count > 1;
        } else {
          pathLineRef.current.visible = false;
        }
      }

      if (nodesMeshRef.current) {
        if (hasCalculatedPath && pIdx < path.length) {
          const count = Math.min(path.length - pIdx, MAX_DEBUG_NODES);
          for (let i = 0; i < count; i++) {
            const node = path[pIdx + i];
            dummy.position.set(node.x, node.y + 0.3, node.z);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            nodesMeshRef.current.setMatrixAt(i, dummy.matrix);
          }
          nodesMeshRef.current.count = count;
          nodesMeshRef.current.instanceMatrix.needsUpdate = true;
          nodesMeshRef.current.visible = count > 0;
        } else {
          nodesMeshRef.current.visible = false;
        }
      }

      if (targetMarkerRef.current) {
        if (hasCalculatedPath) {
          targetMarkerRef.current.position.set(
            aiTargetPos.current.x,
            aiTargetPos.current.y + 0.5,
            aiTargetPos.current.z,
          );
          targetMarkerRef.current.visible = true;
        } else {
          targetMarkerRef.current.visible = false;
        }
      }

      if (lastPosMarkerRef.current) {
        if (aiHasLastKnownPlayerPos.current) {
          lastPosMarkerRef.current.position.set(
            aiLastKnownPlayerPos.current.x,
            aiLastKnownPlayerPos.current.y + 0.5,
            aiLastKnownPlayerPos.current.z,
          );
          lastPosMarkerRef.current.visible = true;
        } else {
          lastPosMarkerRef.current.visible = false;
        }
      }

      if (lastDirLineRef.current) {
        if (aiHasLastKnownPlayerPos.current && aiLastKnownPlayerDir.current.lengthSq() > 0.01) {
          const sx = aiLastKnownPlayerPos.current.x;
          const sy = aiLastKnownPlayerPos.current.y + 0.5;
          const sz = aiLastKnownPlayerPos.current.z;
          const ex = sx + aiLastKnownPlayerDir.current.x * 6.0;
          const ey = sy + aiLastKnownPlayerDir.current.y * 6.0;
          const ez = sz + aiLastKnownPlayerDir.current.z * 6.0;
          updateTwoPointLine(lastDirLineRef.current, sx, sy, sz, ex, ey, ez);
          lastDirLineRef.current.visible = true;
        } else {
          lastDirLineRef.current.visible = false;
        }
      }

      const updateWhisker = (
        line: THREE.Line | null,
        hit: WhiskerHit | null,
        dir: THREE.Vector3,
        len: number,
      ) => {
        if (!line) return;
        const ex = hit ? hit.hitPoint.x : curPos.x + dir.x * len;
        const ey = hit ? hit.hitPoint.y + 0.25 : curPos.y + dir.y * len + 0.25;
        const ez = hit ? hit.hitPoint.z : curPos.z + dir.z * len;
        updateTwoPointLine(line, curPos.x, curPos.y + 0.25, curPos.z, ex, ey, ez);
        line.visible = true;
        const mat = line.material as THREE.LineBasicMaterial;
        if (mat) mat.color.set(hit ? '#ef4444' : '#22c55e');
      };

      updateWhisker(
        whiskerCenterRef.current,
        aiWhiskerCenterHit.current,
        aiWhiskerCenterDir.current,
        aiWhiskerCenterLen.current,
      );
      updateWhisker(
        whiskerLeftRef.current,
        aiWhiskerLeftHit.current,
        aiWhiskerLeftDir.current,
        aiWhiskerSideLen.current,
      );
      updateWhisker(
        whiskerRightRef.current,
        aiWhiskerRightHit.current,
        aiWhiskerRightDir.current,
        aiWhiskerSideLen.current,
      );
    });

    if (!visible) return null;

    return (
      <group>
        <line ref={pathLineRef as unknown as React.Ref<SVGLineElement>}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[pathPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="cyan" linewidth={3} depthTest={false} transparent opacity={0.8} />
        </line>

        <instancedMesh
          ref={nodesMeshRef}
          args={[undefined, undefined, MAX_DEBUG_NODES]}
          frustumCulled={false}
        >
          <sphereGeometry args={[0.25, 12, 12]} />
          <meshBasicMaterial color="#00ffff" depthTest={false} transparent opacity={0.9} />
        </instancedMesh>

        <mesh ref={targetMarkerRef} frustumCulled={false}>
          <sphereGeometry args={[0.7, 16, 16]} />
          <meshBasicMaterial color="#ff00ff" depthTest={false} transparent opacity={0.85} />
        </mesh>

        <mesh ref={lastPosMarkerRef} frustumCulled={false}>
          <sphereGeometry args={[0.6, 16, 16]} />
          <meshBasicMaterial color="#ffee00" depthTest={false} transparent opacity={0.85} />
        </mesh>

        <line ref={lastDirLineRef as unknown as React.Ref<SVGLineElement>}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[dirPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#ffaa00" linewidth={4} depthTest={false} transparent opacity={0.9} />
        </line>

        <line ref={whiskerCenterRef as unknown as React.Ref<SVGLineElement>}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[centerPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="green" linewidth={3} depthTest={false} transparent opacity={0.8} />
        </line>

        <line ref={whiskerLeftRef as unknown as React.Ref<SVGLineElement>}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[leftPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="green" linewidth={2} depthTest={false} transparent opacity={0.8} />
        </line>

        <line ref={whiskerRightRef as unknown as React.Ref<SVGLineElement>}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[rightPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="green" linewidth={2} depthTest={false} transparent opacity={0.8} />
        </line>
      </group>
    );
  },
);
