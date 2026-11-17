import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VoxelObject } from '../../types';
import { FLOOR_HEIGHT } from '../../utils/physics';
import { GridMaterial } from '../GridMaterial';

export const VoxelRuins: React.FC<{ ruins: VoxelObject[]; showGrid?: boolean }> = React.memo(
  ({ ruins, showGrid }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null!);
    const meshTop1Ref = useRef<THREE.InstancedMesh>(null!);
    const meshTop2Ref = useRef<THREE.InstancedMesh>(null!);

    useEffect(() => {
      if (!meshRef.current || ruins.length === 0) return;

      const dummy = new THREE.Object3D();
      ruins.forEach((obj, i) => {
        const [sx, sy, sz] = obj.scale;
        dummy.position.set(obj.position[0], obj.position[1], obj.position[2]);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);

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

export const VoxelFences: React.FC<{ fences: VoxelObject[] }> = React.memo(({ fences }) => {
  const postRef = useRef<THREE.InstancedMesh>(null!);
  const railNRef = useRef<THREE.InstancedMesh>(null!);
  const railSRef = useRef<THREE.InstancedMesh>(null!);
  const railERef = useRef<THREE.InstancedMesh>(null!);
  const railWRef = useRef<THREE.InstancedMesh>(null!);

  useEffect(() => {
    if (!postRef.current || fences.length === 0) return;

    const dummy = new THREE.Object3D();
    let postIdx = 0;
    let nIdx = 0;
    let sIdx = 0;
    let eIdx = 0;
    let wIdx = 0;

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
      </instancedMesh>
    </group>
  );
});

export const VoxelFoliage: React.FC<{ objects: VoxelObject[] }> = React.memo(({ objects }) => {
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

      const area = sW * sD;
      const blades = Math.floor(8 * area + pseudoRandom(1) * 4);

      for (let b = 0; b < blades; b++) {
        const offX = (pseudoRandom(b * 3) - 0.5) * sW;
        const offZ = (pseudoRandom(b * 3 + 1) - 0.5) * sD;
        const bladeH = (0.3 + pseudoRandom(b + 5) * 0.7) * sH;

        dummy.position.set(x + offX, y + bladeH / 2, z + offZ);
        dummy.scale.set(0.12, bladeH, 0.12);
        dummy.rotation.set(0, pseudoRandom(b + 10) * Math.PI, 0);
        dummy.updateMatrix();
        grassRef.current.setMatrixAt(grassIdx++, dummy.matrix);
      }

      const numFlowers = Math.floor(1 + area * 0.5 + pseudoRandom(20) * 2);
      for (let f = 0; f < numFlowers; f++) {
        const offX = (pseudoRandom(f * 4 + 40) - 0.5) * sW * 0.8;
        const offZ = (pseudoRandom(f * 4 + 41) - 0.5) * sD * 0.8;
        const fH = (0.5 + pseudoRandom(f + 42) * 0.5) * sH;

        dummy.position.set(x + offX, y + fH / 2, z + offZ);
        dummy.scale.set(0.12, fH, 0.12);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        grassRef.current.setMatrixAt(grassIdx++, dummy.matrix);

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
