import React, { useMemo } from 'react';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRID_SCALE, GROUND_DEPTH } from '../../utils/physics';

export const VoxelGround: React.FC<{ size: number; waterGrid?: number[][]; sGrid?: number[][]; debugMode?: boolean; showGrid?: boolean }> = React.memo(({ size, waterGrid, sGrid, showGrid }) => {
  const halfSize = Math.floor(size / 2);
  const scaleFactor = showGrid ? 0.95 : 1.0;

  const gridSize = size * GRID_SCALE;
  const cellSize = 1.0 / GRID_SCALE;

  const mergedGeometry = useMemo(() => {
    if (!waterGrid || !sGrid) return null;

    const colors = {
      grass: new THREE.Color('#22c55e'),
      street: new THREE.Color('#334155'),
      hard: new THREE.Color('#475569')
    };

    const geometries: THREE.BufferGeometry[] = [];
    const baseBox = new THREE.BoxGeometry(cellSize * scaleFactor, GROUND_DEPTH, cellSize * scaleFactor);

    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const isWater = waterGrid[x][z] === 1;
        if (isWater) continue;

        const type = sGrid[x][z];
        const worldX = (x + 0.5) / GRID_SCALE - halfSize;
        const worldZ = (z + 0.5) / GRID_SCALE - halfSize;

        let tileColor: THREE.Color;
        if (type === 3) tileColor = colors.hard;
        else if (type === 2) tileColor = colors.street;
        else tileColor = colors.grass;

        const g = baseBox.clone();
        g.translate(worldX, -GROUND_DEPTH / 2, worldZ);

        // Apply vertex colors
        const count = g.attributes.position.count;
        const colorArray = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          colorArray[i * 3] = tileColor.r;
          colorArray[i * 3 + 1] = tileColor.g;
          colorArray[i * 3 + 2] = tileColor.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));

        geometries.push(g);
      }
    }

    if (geometries.length === 0) return null;

    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    // Dispose individual geometries to free memory
    geometries.forEach(g => g.dispose());
    baseBox.dispose();

    return merged;
  }, [halfSize, waterGrid, sGrid, scaleFactor, gridSize, cellSize]);

  React.useEffect(() => {
    return () => {
      if (mergedGeometry) {
        mergedGeometry.dispose();
      }
    };
  }, [mergedGeometry]);

  if (!mergedGeometry) return null;

  return (
    <>
      <mesh geometry={mergedGeometry} receiveShadow frustumCulled={false}>
        <meshStandardMaterial vertexColors={true} />
      </mesh>
      {showGrid && <gridHelper args={[size, size, 0xffffff, 0x555555]} position={[0, 0.05, 0]} />}
    </>
  );
});
