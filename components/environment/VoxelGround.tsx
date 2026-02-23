import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { GRID_SCALE, GROUND_DEPTH } from '../../utils/physics';

export const VoxelGround: React.FC<{ size: number; waterGrid?: number[][]; sGrid?: number[][]; debugMode?: boolean; showGrid?: boolean }> = React.memo(({ size, waterGrid, sGrid, debugMode, showGrid }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const halfSize = Math.floor(size / 2);
  const scaleFactor = showGrid ? 0.95 : 1.0;

  const gridSize = size * GRID_SCALE;
  const cellSize = 1.0 / GRID_SCALE;

  useEffect(() => {
    if (!waterGrid || !sGrid) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let idx = 0;

    const colors = {
      grass: '#22c55e',
      street: '#334155',
      hard: '#475569'
    };

    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const isWater = waterGrid[x][z] === 1;
        const type = sGrid[x][z];

        if (isWater) {
          dummy.scale.set(0, 0, 0);
        } else {
          const worldX = (x + 0.5) / GRID_SCALE - halfSize;
          const worldZ = (z + 0.5) / GRID_SCALE - halfSize;

          dummy.scale.set(cellSize * scaleFactor, GROUND_DEPTH, cellSize * scaleFactor);
          dummy.position.set(worldX, -GROUND_DEPTH / 2, worldZ);

          if (type === 3) color.set(colors.hard);
          else if (type === 2) color.set(colors.street);
          else color.set(colors.grass);

          meshRef.current.setColorAt(idx, color);
        }
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(idx++, dummy.matrix);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  }, [size, halfSize, waterGrid, sGrid, scaleFactor, gridSize, cellSize]);

  return (
    <>
      <instancedMesh ref={meshRef} args={[undefined, undefined, gridSize * gridSize]} receiveShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial vertexColors={false} color="#ffffff" />
      </instancedMesh>
      {showGrid && <gridHelper args={[size, size, 0xffffff, 0x555555]} position={[0, 0.05, 0]} />}
    </>
  );
});
