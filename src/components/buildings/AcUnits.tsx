import React from 'react';
import * as THREE from 'three';
import { GridMaterial } from '../GridMaterial';
import { FLOOR_HEIGHT } from '../../utils/physics';

export const WallAC: React.FC<{
  position: THREE.Vector3;
  scale: [number, number, number];
  color: string;
  rotation?: number;
  showGrid?: boolean;
}> = ({ position, scale, color, rotation = 0, showGrid = false }) => {
  // scale[0] = width, scale[1] = height, scale[2] = depth
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <group position={[0, 0, 0]}>
        <mesh castShadow receiveShadow position={[0, 0, 0]} userData={{ type: 'detail-fade' }}>
          <boxGeometry args={[scale[0], scale[1], scale[2]]} />
          <GridMaterial color={color} showGrid={showGrid} floorHeight={FLOOR_HEIGHT} />
        </mesh>
        {/* Fan detail - Scaled based on minimum dimension */}
        <mesh position={[0, 0, scale[2] / 2 + 0.01]} userData={{ type: 'detail-fade' }}>
          <circleGeometry args={[Math.min(scale[0], scale[1]) * 0.4, 12]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
        {/* Grill lines */}
        <mesh position={[0, 0, scale[2] / 2 + 0.02]} userData={{ type: 'detail-fade' }}>
          <boxGeometry args={[scale[0] * 0.7, scale[1] * 0.05, 0.01]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <mesh
          position={[0, 0, scale[2] / 2 + 0.02]}
          rotation={[0, 0, Math.PI / 2]}
          userData={{ type: 'detail-fade' }}
        >
          <boxGeometry args={[scale[0] * 0.7, scale[1] * 0.05, 0.01]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
      </group>
    </group>
  );
};

export const RoofAC: React.FC<{
  position: THREE.Vector3;
  scale: [number, number, number];
  color: string;
  rotation?: number;
  showGrid?: boolean;
}> = ({ position, scale, color, rotation = 0, showGrid = false }) => {
  // scale[0] = width, scale[1] = height, scale[2] = depth
  const w = scale[0];
  const h = scale[1];
  const d = scale[2];

  // Determine configuration
  // Use double fans if width is sufficient and significantly wider than depth
  const useDoubleFan = w >= 2.0 && w >= d * 1.5;

  let fanRadius = 0;
  if (useDoubleFan) {
    // Fits 2 fans along Width
    // Max radius constrained by Depth (d/2) and Half-Width slot (w/4)
    fanRadius = Math.min(d / 2, w / 4) * 0.85;
  } else {
    // Single fan centered
    fanRadius = (Math.min(w, d) / 2) * 0.85;
  }

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow receiveShadow userData={{ type: 'detail-fade' }}>
        <boxGeometry args={[w, h, d]} />
        <GridMaterial color={color} showGrid={showGrid} floorHeight={FLOOR_HEIGHT} />
      </mesh>

      {useDoubleFan ? (
        <group position={[0, h / 2 + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <mesh position={[-w * 0.25, 0, 0]}>
            <circleGeometry args={[fanRadius, 16]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
          <mesh position={[w * 0.25, 0, 0]}>
            <circleGeometry args={[fanRadius, 16]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
        </group>
      ) : (
        <mesh position={[0, h / 2 + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[fanRadius, 16]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>
      )}

      {/* Side Vents */}
      <mesh position={[0, 0, d / 2 + 0.01]}>
        <boxGeometry args={[w * 0.8, h * 0.6, 0.05]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
    </group>
  );
};
