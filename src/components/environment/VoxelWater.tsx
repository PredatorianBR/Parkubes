import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useFrame } from '@react-three/fiber';
import { GRID_SCALE, GROUND_DEPTH } from '../../utils/physics';

export const VoxelWater: React.FC<{
  size: number;
  waterGrid?: number[][];
  riverOrientation?: number;
  riverFlow?: number;
}> = React.memo(({ size, waterGrid, riverOrientation = -1, riverFlow = 3.0 }) => {
  const foamRef = useRef<THREE.InstancedMesh>(null!);
  const halfSize = Math.floor(size / 2);

  const gridSize = size * GRID_SCALE;
  const cellSize = 1.0 / GRID_SCALE;

  // Foam Particles State
  const maxFoam = 1000;
  const foamParticles = useRef<
    {
      pos: THREE.Vector3;
      vel: THREE.Vector3;
      life: number;
      speed: number;
      scale: number;
      offset: THREE.Vector3;
      type: 'drift' | 'source' | 'exit';
    }[]
  >([]);

  const waterTilesRef = useRef<{ x: number; z: number }[]>([]);
  const edgeTilesRef = useRef<{ x: number; z: number; side: 'N' | 'S' | 'E' | 'W' }[]>([]);
  const sourceTilesRef = useRef<{ x: number; z: number; side: string }[]>([]);
  const exitTilesRef = useRef<{ x: number; z: number; side: string }[]>([]);

  // Build merged geometries for water surface, bed, and walls
  // ... (rest of useMemo remains same)
  const { surfaceGeom, bedGeom, wallGeom } = useMemo(() => {
    if (!waterGrid) return { surfaceGeom: null, bedGeom: null, wallGeom: null };

    const surfaceGeoms: THREE.BufferGeometry[] = [];
    const bedGeoms: THREE.BufferGeometry[] = [];
    const wallGeoms: THREE.BufferGeometry[] = [];

    const basePlane = new THREE.PlaneGeometry(cellSize, cellSize);
    const baseBed = new THREE.BoxGeometry(cellSize, 0.5, cellSize);
    const waterDepth = GROUND_DEPTH - 0.2;

    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const isWater = waterGrid[x][z] === 1;
        if (!isWater) continue;

        const worldX = (x + 0.5) / GRID_SCALE - halfSize;
        const worldZ = (z + 0.5) / GRID_SCALE - halfSize;

        // Water surface plane
        const sp = basePlane.clone();
        sp.rotateX(-Math.PI / 2);
        sp.translate(worldX, -0.2, worldZ);
        surfaceGeoms.push(sp);

        // River bed
        const bp = baseBed.clone();
        bp.translate(worldX, -GROUND_DEPTH + 0.25, worldZ);
        bedGeoms.push(bp);

        // Edge walls
        if (x === 0) {
          const wp = new THREE.PlaneGeometry(cellSize, waterDepth);
          wp.rotateY(-Math.PI / 2);
          wp.translate(worldX - 0.5, -0.2 - waterDepth / 2, worldZ);
          wallGeoms.push(wp);
        } else if (x === gridSize - 1) {
          const wp = new THREE.PlaneGeometry(cellSize, waterDepth);
          wp.rotateY(Math.PI / 2);
          wp.translate(worldX + 0.5, -0.2 - waterDepth / 2, worldZ);
          wallGeoms.push(wp);
        }

        if (z === 0) {
          const wp = new THREE.PlaneGeometry(cellSize, waterDepth);
          wp.rotateY(Math.PI);
          wp.translate(worldX, -0.2 - waterDepth / 2, worldZ - 0.5);
          wallGeoms.push(wp);
        } else if (z === gridSize - 1) {
          const wp = new THREE.PlaneGeometry(cellSize, waterDepth);
          // no rotation needed for south-facing
          wp.translate(worldX, -0.2 - waterDepth / 2, worldZ + 0.5);
          wallGeoms.push(wp);
        }
      }
    }

    const surfaceGeom =
      surfaceGeoms.length > 0 ? BufferGeometryUtils.mergeGeometries(surfaceGeoms) : null;
    const bedGeom = bedGeoms.length > 0 ? BufferGeometryUtils.mergeGeometries(bedGeoms) : null;
    const wallGeom = wallGeoms.length > 0 ? BufferGeometryUtils.mergeGeometries(wallGeoms) : null;

    // Dispose temporary geometries
    surfaceGeoms.forEach((g) => g.dispose());
    bedGeoms.forEach((g) => g.dispose());
    wallGeoms.forEach((g) => g.dispose());
    basePlane.dispose();
    baseBed.dispose();

    return { surfaceGeom, bedGeom, wallGeom };
  }, [halfSize, waterGrid, gridSize, cellSize]);

  useEffect(() => {
    return () => {
      if (surfaceGeom) surfaceGeom.dispose();
      if (bedGeom) bedGeom.dispose();
      if (wallGeom) wallGeom.dispose();
    };
  }, [surfaceGeom, bedGeom, wallGeom]);

  const currentMaxFoam = Math.floor(100 + riverFlow * 140); // Max 800 at flow 5

  const flowVector = useMemo(() => {
    switch (riverOrientation) {
      case 0:
        return new THREE.Vector2(0, 1); // North to South
      case 2:
        return new THREE.Vector2(0, -1); // South to North
      case 3:
        return new THREE.Vector2(1, 0); // West to East
      case 1:
        return new THREE.Vector2(-1, 0); // East to West
      default:
        return new THREE.Vector2(0, 0);
    }
  }, [riverOrientation]);

  // Initialize foam particles and tile refs
  useEffect(() => {
    if (!waterGrid) return;

    const waterTiles: { x: number; z: number }[] = [];
    const edgeTiles: { x: number; z: number; side: 'N' | 'S' | 'E' | 'W' }[] = [];

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

    const sourceSide =
      riverOrientation === 0
        ? 'N'
        : riverOrientation === 2
          ? 'S'
          : riverOrientation === 3
            ? 'W'
            : riverOrientation === 1
              ? 'E'
              : null;
    const exitSide =
      riverOrientation === 0
        ? 'S'
        : riverOrientation === 2
          ? 'N'
          : riverOrientation === 3
            ? 'E'
            : riverOrientation === 1
              ? 'W'
              : null;

    const sourceTiles = edgeTiles.filter((t) => t.side === sourceSide);
    const exitTiles = edgeTiles.filter((t) => t.side === exitSide);
    sourceTilesRef.current = sourceTiles;
    exitTilesRef.current = exitTiles;

    // Distribution: 50% source, 12.5% exit (waterfall), the rest drift
    const sourceCount = Math.floor(currentMaxFoam * 0.5);
    const exitCount = Math.floor(currentMaxFoam * 0.125);

    foamParticles.current = new Array(currentMaxFoam).fill(0).map((_, i) => {
      let type: 'drift' | 'source' | 'exit' = 'drift';
      if (i < sourceCount && sourceTiles.length > 0) type = 'source';
      else if (i < sourceCount + exitCount && exitTiles.length > 0) type = 'exit';

      if (type === 'source') {
        const edge = sourceTiles[Math.floor(Math.random() * sourceTiles.length)];
        let vx = (Math.random() - 0.5) * 2.0;
        let vz = (Math.random() - 0.5) * 2.0;
        const vy = 0.8 + Math.random() * 1.2;

        const logicX = (edge.x + 0.5) / GRID_SCALE - halfSize;
        const logicZ = (edge.z + 0.5) / GRID_SCALE - halfSize;
        let spawnX = logicX;
        let spawnZ = logicZ;

        const push = 2.5 + Math.random() * 2;
        vx += flowVector.x * push;
        vz += flowVector.y * push;
        spawnX -= flowVector.x * 0.2;
        spawnZ -= flowVector.y * 0.2;

        return {
          pos: new THREE.Vector3(spawnX, -0.18, spawnZ),
          vel: new THREE.Vector3(vx, vy, vz),
          life: Math.random(),
          speed: 2.0 + Math.random() * 3.0,
          scale: 0.3 + Math.random() * 0.3,
          offset: new THREE.Vector3(
            (Math.random() - 0.5) * cellSize,
            0,
            (Math.random() - 0.5) * cellSize,
          ),
          type: 'source' as const,
        };
      }

      if (type === 'exit') {
        const edge = exitTiles[Math.floor(Math.random() * exitTiles.length)];
        const logicX = (edge.x + 0.5) / GRID_SCALE - halfSize;
        const logicZ = (edge.z + 0.5) / GRID_SCALE - halfSize;
        return {
          pos: new THREE.Vector3(logicX, -0.18, logicZ),
          vel: new THREE.Vector3(
            (Math.random() - 0.5) * 1.5,
            -2.0 - Math.random() * 3.0,
            (Math.random() - 0.5) * 1.5,
          ),
          life: Math.random(),
          speed: 2.0 + Math.random() * 2.0,
          scale: 0.3 + Math.random() * 0.3,
          offset: new THREE.Vector3(
            (Math.random() - 0.5) * cellSize,
            0,
            (Math.random() - 0.5) * cellSize,
          ),
          type: 'exit' as const,
        };
      }

      // Drift type (floating)
      const tile = waterTiles[Math.floor(Math.random() * waterTiles.length)] || { x: 0, z: 0 };
      return {
        pos: new THREE.Vector3(
          (tile.x + 0.5) / GRID_SCALE - halfSize,
          -0.19,
          (tile.z + 0.5) / GRID_SCALE - halfSize,
        ),
        vel: new THREE.Vector3(0, 0, 0),
        life: Math.random(),
        speed: 1.5 + Math.random() * 2.0,
        scale: 0.2 + Math.random() * 0.4,
        offset: new THREE.Vector3(
          (Math.random() - 0.5) * cellSize,
          0,
          (Math.random() - 0.5) * cellSize,
        ),
        type: 'drift' as const,
      };
    });
  }, [
    size,
    halfSize,
    waterGrid,
    gridSize,
    cellSize,
    riverOrientation,
    riverFlow,
    flowVector,
    currentMaxFoam,
  ]);

  useFrame((state, delta) => {
    if (!foamRef.current || !waterGrid) return;
    const dummy = new THREE.Object3D();

    const waterTiles = waterTilesRef.current;
    const sourceTiles = sourceTilesRef.current;
    const exitTiles = exitTilesRef.current;

    const flowStrength = Math.max(1.0, riverFlow);
    const currentRotation = new THREE.Euler();
    const currentScale = new THREE.Vector3();

    if (foamRef.current.count !== currentMaxFoam) {
      foamRef.current.count = currentMaxFoam;
    }

    foamParticles.current.forEach((p, i) => {
      if (i >= currentMaxFoam) return;

      p.life += delta * (p.type !== 'drift' ? 1.5 : 0.6);

      const margin = p.type === 'source' || p.type === 'exit' ? 0.5 : 0.0;
      const isOutOfBounds =
        Math.abs(p.pos.x) > halfSize + margin ||
        Math.abs(p.pos.z) > halfSize + margin ||
        p.pos.y < -GROUND_DEPTH;

      if (p.life > 1.0 || isOutOfBounds) {
        p.life = 0;
        if (p.type === 'source' && sourceTiles.length > 0) {
          const edge = sourceTiles[Math.floor(Math.random() * sourceTiles.length)];
          let vx = (Math.random() - 0.5) * 2.0;
          let vz = (Math.random() - 0.5) * 2.0;
          const vy = 0.8 + Math.random() * 1.2;

          const logicX = (edge.x + 0.5) / GRID_SCALE - halfSize;
          const logicZ = (edge.z + 0.5) / GRID_SCALE - halfSize;
          let spawnX = logicX;
          let spawnZ = logicZ;

          const push = 2.5 + Math.random() * 2;
          vx += flowVector.x * push;
          vz += flowVector.y * push;
          spawnX -= flowVector.x * 0.2;
          spawnZ -= flowVector.y * 0.2;

          p.pos.set(spawnX, -0.18, spawnZ);
          p.vel.set(vx, vy, vz);
        } else if (p.type === 'exit' && exitTiles.length > 0) {
          const edge = exitTiles[Math.floor(Math.random() * exitTiles.length)];
          p.pos.set(
            (edge.x + 0.5) / GRID_SCALE - halfSize,
            -0.18,
            (edge.z + 0.5) / GRID_SCALE - halfSize,
          );
          p.vel.set(
            (Math.random() - 0.5) * 1.5,
            -2.0 - Math.random() * 3.0,
            (Math.random() - 0.5) * 1.5,
          );
        } else {
          const tile = waterTiles[Math.floor(Math.random() * waterTiles.length)] || { x: 0, z: 0 };
          p.pos.set(
            (tile.x + 0.5) / GRID_SCALE - halfSize,
            -0.17,
            (tile.z + 0.5) / GRID_SCALE - halfSize,
          );
          p.vel.set(0, 0, 0);
        }
      }

      let scaleMult = 1.0;
      currentRotation.set(0, 0, 0);
      currentScale.set(1, 1, 1);

      const speedFactor = flowStrength / 3.0;

      if (p.type === 'source' || p.type === 'exit') {
        p.vel.y -= (p.type === 'source' ? 12.0 : 20.0) * delta;
        p.pos.addScaledVector(p.vel, delta * speedFactor);

        scaleMult = 1.1 * (1.1 - p.life * 0.7);
        p.pos.x += Math.sin(state.clock.elapsedTime * 4 + i) * 0.01 * speedFactor;
        p.pos.z += Math.cos(state.clock.elapsedTime * 4 + i) * 0.01 * speedFactor;

        currentRotation.set(0, state.clock.elapsedTime * i * 0.1, 0);
        currentScale.set(1, 1, 1);
      } else {
        const movement = (p.speed + 1.0) * speedFactor * delta;
        p.pos.x += flowVector.x * movement;
        p.pos.z += flowVector.y * movement;

        currentRotation.set(-Math.PI / 2, 0, i);
        currentScale.set(1, 1, 0.001);
      }

      const alpha = isOutOfBounds ? 0 : Math.sin(p.life * Math.PI);
      const s = p.scale * scaleMult * (0.8 + 0.2 * Math.sin(state.clock.elapsedTime * 4 + i));

      dummy.position.copy(p.pos).add(p.offset);
      dummy.rotation.copy(currentRotation);
      dummy.scale.set(
        s * alpha * currentScale.x,
        s * alpha * currentScale.y,
        s * alpha * currentScale.z,
      );
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

  const hasWater = surfaceGeom !== null;

  return (
    <group>
      {/* River Bed */}
      {bedGeom && (
        <mesh geometry={bedGeom} receiveShadow frustumCulled={false}>
          <meshStandardMaterial color="#5d4037" roughness={0.8} />
        </mesh>
      )}

      {/* Water surface */}
      {surfaceGeom && (
        <mesh geometry={surfaceGeom} receiveShadow={false} frustumCulled={false}>
          {waterMaterial}
        </mesh>
      )}

      {/* Water edge walls */}
      {wallGeom && (
        <mesh geometry={wallGeom} receiveShadow={false} frustumCulled={false}>
          {waterMaterial}
        </mesh>
      )}

      {/* Dynamic River Foam & Waterfall Mist */}
      {hasWater && (
        <instancedMesh
          ref={foamRef}
          args={[undefined, undefined, maxFoam]}
          frustumCulled={false}
          renderOrder={1}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#bfdbfe" transparent={true} opacity={0.6} depthWrite={false} />
        </instancedMesh>
      )}
    </group>
  );
});
