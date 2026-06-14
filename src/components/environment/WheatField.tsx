import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VoxelObject } from '../../types';

export const WheatField: React.FC<{
  wheatObjects: VoxelObject[];
  playerPos: React.MutableRefObject<THREE.Vector3>;
}> = ({ wheatObjects, playerPos }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null!);

  const geometry = useMemo(() => {
    const stalks = [
      { x: -0.25, z: -0.1, h: 2.1 },
      { x: 0.25, z: -0.1, h: 2.05 },
      { x: 0.0, z: 0.25, h: 2.2 },
    ];

    const geometries: THREE.BufferGeometry[] = [];
    const baseGeo = new THREE.BoxGeometry(0.4, 1, 0.4);

    stalks.forEach((s) => {
      const g = baseGeo.clone();
      g.scale(1, s.h, 1);
      g.translate(s.x, s.h / 2, s.z);
      geometries.push(g);
    });

    const merged = BufferGeometryUtils.mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    baseGeo.dispose();
    return merged;
  }, []);

  useEffect(() => {
    return () => {
      if (geometry) {
        geometry.dispose();
      }
    };
  }, [geometry]);

  useEffect(() => {
    if (!meshRef.current || wheatObjects.length === 0) return;

    const dummy = new THREE.Object3D();
    wheatObjects.forEach((obj, i) => {
      dummy.position.set(obj.position[0], obj.position[1], obj.position[2]);
      // Wheat instances internally have heights around ~2.1.
      // We apply the scale from levelGen, but divided by the base height.
      dummy.scale.set(obj.scale[0], obj.scale[1] / 2.15, obj.scale[2]);
      dummy.rotation.set(0, obj.rotation || 0, 0);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [wheatObjects]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onBeforeCompile = (shader: any) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uPlayerPos = { value: new THREE.Vector3() };

    materialRef.current.userData.shader = shader;

    shader.vertexShader = `
            uniform float uTime;
            uniform vec3 uPlayerPos;
            ${shader.vertexShader}
        `;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
            #include <begin_vertex>
            vec3 instanceCenter = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            float h = max(0.0, transformed.y);
            float normH = clamp(h / 2.2, 0.0, 1.0);
            float bendFactor = normH * normH; 
            float windStrength = 0.15;
            float windSpeed = 2.5;
            float swayX = sin(uTime * windSpeed + instanceCenter.x * 0.5 + instanceCenter.z * 0.3);
            float swayZ = cos(uTime * (windSpeed * 0.85) + instanceCenter.x * 0.3 + instanceCenter.z * 0.5);
            transformed.x += swayX * windStrength * bendFactor; 
            transformed.z += swayZ * windStrength * bendFactor;

            float dist = distance(instanceCenter.xz, uPlayerPos.xz);
            float radius = 1.4; 
            
            if (dist < radius) {
                vec2 dir = normalize(instanceCenter.xz - uPlayerPos.xz);
                float t = 1.0 - (dist / radius);
                float pushForce = t * t * 0.8; 
                transformed.x += dir.x * pushForce * bendFactor;
                transformed.z += dir.y * pushForce * bendFactor;
                transformed.y -= pushForce * bendFactor * 0.2;
            }
            `,
    );
  };

  useFrame((state) => {
    if (materialRef.current?.userData?.shader) {
      materialRef.current.userData.shader.uniforms.uTime.value = state.clock.getElapsedTime();
      materialRef.current.userData.shader.uniforms.uPlayerPos.value.copy(playerPos.current);
    }
  });

  if (wheatObjects.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, wheatObjects.length]}
      castShadow
      receiveShadow
      frustumCulled={false}
    >
      <meshStandardMaterial
        ref={materialRef}
        color="#eab308"
        onBeforeCompile={onBeforeCompile}
        transparent={false}
        opacity={1.0}
      />
    </instancedMesh>
  );
};
