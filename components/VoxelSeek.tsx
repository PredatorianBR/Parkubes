
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GameStatus, VoxelObject, GameSettings, Position } from '../types';
import { Character } from './Character';
import { useControls } from '../hooks/useControls';
import { generateCityLevel } from '../utils/levelGen';
import { updatePlayerPhysics } from '../utils/player';
import { worldToIndex, GRID_SCALE } from '../utils/physics';

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
const CollisionDebug: React.FC<{ oGrid: number[][]; bGrid: number[][]; size: number; visible: boolean }> = React.memo(({ oGrid, bGrid, size, visible }) => {
    const oRef = useRef<THREE.InstancedMesh>(null!);
    const bRef = useRef<THREE.InstancedMesh>(null!);
    const halfSize = Math.floor(size / 2);
    
    // GridSize is oGrid.length
    const gridSize = oGrid.length;

    useEffect(() => {
        if (!oRef.current || !bRef.current) return;
        
        const dummy = new THREE.Object3D();
        let idxO = 0;
        let idxB = 0;
        const cellSize = 1.0 / GRID_SCALE;

        for (let x = 0; x < gridSize; x++) {
            for (let z = 0; z < gridSize; z++) {
                // Convert high res index to world center
                const worldX = (x + 0.5) / GRID_SCALE - halfSize;
                const worldZ = (z + 0.5) / GRID_SCALE - halfSize;
                
                const h = oGrid[x][z];
                if (h > -10) { // Render ground collision (even water level)
                    // Place plane slightly above the collision height to prevent z-fighting
                    dummy.position.set(worldX, h + 0.05, worldZ);
                    dummy.rotation.set(-Math.PI / 2, 0, 0); // Rotate flat
                    // Scale slightly smaller than cell to show grid separation
                    dummy.scale.set(cellSize * 0.85, cellSize * 0.85, 1);
                    dummy.updateMatrix();
                    oRef.current.setMatrixAt(idxO++, dummy.matrix);
                }

                const bh = bGrid[x][z];
                if (bh > 0 && bh > h) { 
                     dummy.position.set(worldX, bh + 0.05, worldZ);
                     dummy.rotation.set(-Math.PI / 2, 0, 0);
                     dummy.scale.set(cellSize * 0.85, cellSize * 0.85, 1);
                     dummy.updateMatrix();
                     bRef.current.setMatrixAt(idxB++, dummy.matrix);
                }
            }
        }
        oRef.current.count = idxO;
        bRef.current.count = idxB;
        oRef.current.instanceMatrix.needsUpdate = true;
        bRef.current.instanceMatrix.needsUpdate = true;
    }, [oGrid, bGrid, size, halfSize, gridSize]);

    return (
        <group visible={visible}>
            {/* Ground Collision (Red) */}
            <instancedMesh ref={oRef} args={[undefined, undefined, gridSize * gridSize]} frustumCulled={false}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial color="#ff0000" transparent opacity={0.4} side={THREE.DoubleSide} />
            </instancedMesh>
            {/* Bridge/Roof Collision (Cyan) */}
            <instancedMesh ref={bRef} args={[undefined, undefined, gridSize * gridSize]} frustumCulled={false}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial color="#00ffff" transparent opacity={0.4} side={THREE.DoubleSide} />
            </instancedMesh>
        </group>
    );
});

// --- ENVIRONMENT COMPONENTS ---

const VoxelGround: React.FC<{ size: number; waterGrid?: number[][]; debugMode?: boolean; showGrid?: boolean }> = React.memo(({ size, waterGrid, debugMode, showGrid }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const halfSize = Math.floor(size / 2);
  // FIX: Scale factor depends ONLY on showGrid now, not debugMode
  const scaleFactor = showGrid ? 0.95 : 1.0;
  
  // High Res Rendering
  const gridSize = size * GRID_SCALE;
  const cellSize = 1.0 / GRID_SCALE;

  useEffect(() => {
    if (!waterGrid) return;
    const dummy = new THREE.Object3D();
    let idx = 0;
    
    // Iterate High Res Grid
    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const isWater = waterGrid[x][z] === 1;
        if (isWater) {
            dummy.scale.set(0, 0, 0); 
        } else {
            // World Pos Calculation for Sub-Cell
            const worldX = (x + 0.5) / GRID_SCALE - halfSize;
            const worldZ = (z + 0.5) / GRID_SCALE - halfSize;
            
            dummy.scale.set(cellSize * scaleFactor, 1, cellSize * scaleFactor);
            dummy.position.set(worldX, -0.5, worldZ);
        }
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(idx++, dummy.matrix);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [size, halfSize, waterGrid, scaleFactor, gridSize, cellSize]);

  return (
    <>
        <instancedMesh ref={meshRef} args={[undefined, undefined, gridSize * gridSize]} receiveShadow frustumCulled={false}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#22c55e" /></instancedMesh>
        {showGrid && <gridHelper args={[size, size, 0xffffff, 0x555555]} position={[0, 0.05, 0]} />}
    </>
  );
});

const VoxelWater: React.FC<{ size: number; waterGrid?: number[][] }> = React.memo(({ size, waterGrid }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null!);
    const halfSize = Math.floor(size / 2);
    
    const gridSize = size * GRID_SCALE;
    const cellSize = 1.0 / GRID_SCALE;
    
    useEffect(() => {
      if (!waterGrid) return;
      const dummy = new THREE.Object3D();
      let idx = 0;
      for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
          const isWater = waterGrid[x][z] === 1;
          if (isWater) {
              const worldX = (x + 0.5) / GRID_SCALE - halfSize;
              const worldZ = (z + 0.5) / GRID_SCALE - halfSize;
              
              dummy.scale.set(cellSize, 1, cellSize);
              dummy.position.set(worldX, -0.6, worldZ);
          } else {
              dummy.scale.set(0, 0, 0);
          }
          dummy.updateMatrix();
          meshRef.current.setMatrixAt(idx++, dummy.matrix);
        }
      }
      meshRef.current.instanceMatrix.needsUpdate = true;
    }, [size, halfSize, waterGrid, gridSize, cellSize]);
    
    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, gridSize * gridSize]} receiveShadow={false} frustumCulled={false}>
            <boxGeometry args={[1, 0.8, 1]} />
            <meshStandardMaterial color="#3b82f6" transparent opacity={0.7} />
        </instancedMesh>
    );
});

// --- OPTIMIZED WHEAT FIELD ---
const WheatField: React.FC<{ wheatObjects: VoxelObject[], playerPos: React.MutableRefObject<THREE.Vector3> }> = ({ wheatObjects, playerPos }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null!);
    const materialRef = useRef<THREE.MeshStandardMaterial>(null!);
    
    const geometry = useMemo(() => {
        const stalks = [
            { x: -0.25, z: -0.25, h: 2.1 },
            { x: 0.25, z: 0.25, h: 2.05 },
            { x: -0.2, z: 0.2, h: 2.15 },
            { x: 0.2, z: -0.2, h: 2.1 },
            { x: 0.0, z: 0.0, h: 2.2 } 
        ];
        
        const geometries: THREE.BufferGeometry[] = [];
        const baseGeo = new THREE.BoxGeometry(0.2, 1, 0.2); 
        
        stalks.forEach(s => {
            const g = baseGeo.clone();
            g.scale(1, s.h, 1);
            g.translate(s.x, s.h / 2, s.z);
            geometries.push(g);
        });

        const merged = BufferGeometryUtils.mergeGeometries(geometries);
        return merged;
    }, []);

    useEffect(() => {
        if (!meshRef.current || wheatObjects.length === 0) return;
        
        const dummy = new THREE.Object3D();
        wheatObjects.forEach((obj, i) => {
            dummy.position.set(obj.position[0], obj.position[1], obj.position[2]);
            dummy.scale.set(1, 1, 1);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);
        });
        meshRef.current.instanceMatrix.needsUpdate = true;
    }, [wheatObjects]);

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
            `
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
        <instancedMesh ref={meshRef} args={[geometry, undefined, wheatObjects.length]} castShadow receiveShadow>
            <meshStandardMaterial 
                ref={materialRef}
                color="#eab308" 
                onBeforeCompile={onBeforeCompile}
            />
        </instancedMesh>
    );
};


const RuinBlock: React.FC<{ position: THREE.Vector3; scale: [number, number, number]; color: string }> = ({ position, scale, color }) => {
    return (
        <group position={position}>
            <mesh castShadow receiveShadow>
                <boxGeometry args={scale} />
                <meshStandardMaterial color={color} />
            </mesh>
            <mesh position={[scale[0] * 0.25, scale[1] * 0.5, scale[2] * 0.25]} castShadow receiveShadow>
                <boxGeometry args={[scale[0] * 0.4, scale[1] * 0.4, scale[2] * 0.4]} />
                <meshStandardMaterial color={color} />
            </mesh>
             <mesh position={[-scale[0] * 0.2, scale[1] * 0.5, -scale[2] * 0.2]} castShadow receiveShadow>
                <boxGeometry args={[scale[0] * 0.3, scale[1] * 0.3, scale[2] * 0.3]} />
                <meshStandardMaterial color={color} />
            </mesh>
        </group>
    );
};

const FenceBlock: React.FC<{ position: THREE.Vector3; color: string; neighbors?: { n: boolean, s: boolean, e: boolean, w: boolean } }> = ({ position, color, neighbors }) => {
    const postColor = "#a16207"; 
    const railColor = color || "#d4a373"; 

    return (
        <group position={position}>
             {/* Central Post */}
             <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
                 <boxGeometry args={[0.3, 1.2, 0.3]} />
                 <meshStandardMaterial color={postColor} />
             </mesh>
             
             {/* Rails */}
             {neighbors?.n && (
                <group>
                    <mesh position={[0, 0.8, -0.5]} castShadow receiveShadow>
                        <boxGeometry args={[0.15, 0.15, 0.8]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                    <mesh position={[0, 0.4, -0.5]} castShadow receiveShadow>
                        <boxGeometry args={[0.15, 0.15, 0.8]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                </group>
             )}
             {neighbors?.s && (
                <group>
                    <mesh position={[0, 0.8, 0.5]} castShadow receiveShadow>
                        <boxGeometry args={[0.15, 0.15, 0.8]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                    <mesh position={[0, 0.4, 0.5]} castShadow receiveShadow>
                        <boxGeometry args={[0.15, 0.15, 0.8]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                </group>
             )}
             {neighbors?.e && (
                <group>
                    <mesh position={[0.5, 0.8, 0]} castShadow receiveShadow>
                        <boxGeometry args={[0.8, 0.15, 0.15]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                    <mesh position={[0.5, 0.4, 0]} castShadow receiveShadow>
                        <boxGeometry args={[0.8, 0.15, 0.15]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                </group>
             )}
             {neighbors?.w && (
                <group>
                    <mesh position={[-0.5, 0.8, 0]} castShadow receiveShadow>
                        <boxGeometry args={[0.8, 0.15, 0.15]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                    <mesh position={[-0.5, 0.4, 0]} castShadow receiveShadow>
                        <boxGeometry args={[0.8, 0.15, 0.15]} />
                        <meshStandardMaterial color={railColor} />
                    </mesh>
                </group>
             )}
        </group>
    );
};

const Street: React.FC<{ position: THREE.Vector3; color: string }> = ({ position, color }) => {
    return (
        <mesh position={position} receiveShadow rotation={[-Math.PI/2, 0, 0]}>
            <planeGeometry args={[1, 1]} />
            <meshStandardMaterial color={color} />
        </mesh>
    );
};

// --- BUILDING PARTS ---

const WallAC: React.FC<{ position: THREE.Vector3, scale: [number, number, number], color: string, rotation?: number }> = ({ position, scale, color, rotation = 0 }) => {
    // scale[0] = width, scale[1] = height, scale[2] = depth
    return (
        <group position={position} rotation={[0, rotation, 0]}>
            <group position={[0, 0, 0]}>
                <mesh castShadow receiveShadow position={[0, 0, 0]} userData={{ type: 'detail-fade' }}>
                    <boxGeometry args={[scale[0], scale[1], scale[2]]} />
                    <meshStandardMaterial color={color} />
                </mesh>
                {/* Fan detail - Scaled based on minimum dimension */}
                <mesh position={[0, 0, scale[2]/2 + 0.01]} userData={{ type: 'detail-fade' }}>
                    <circleGeometry args={[Math.min(scale[0], scale[1]) * 0.4, 12]} />
                    <meshStandardMaterial color="#1e293b" />
                </mesh>
                {/* Grill lines */}
                <mesh position={[0, 0, scale[2]/2 + 0.02]} userData={{ type: 'detail-fade' }}>
                     <boxGeometry args={[scale[0] * 0.7, scale[1] * 0.05, 0.01]} />
                     <meshStandardMaterial color="#334155" />
                </mesh>
                 <mesh position={[0, 0, scale[2]/2 + 0.02]} rotation={[0,0,Math.PI/2]} userData={{ type: 'detail-fade' }}>
                     <boxGeometry args={[scale[0] * 0.7, scale[1] * 0.05, 0.01]} />
                     <meshStandardMaterial color="#334155" />
                </mesh>
            </group>
        </group>
    );
}

const RoofAC: React.FC<{ position: THREE.Vector3, scale: [number, number, number], color: string, rotation?: number }> = ({ position, scale, color, rotation = 0 }) => {
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
                 <meshStandardMaterial color={color} />
             </mesh>
             
             {useDoubleFan ? (
                 <group position={[0, h/2 + 0.01, 0]} rotation={[-Math.PI/2, 0, 0]}>
                    <mesh position={[-w*0.25, 0, 0]}>
                        <circleGeometry args={[fanRadius, 16]} />
                        <meshStandardMaterial color="#0f172a" />
                    </mesh>
                    <mesh position={[w*0.25, 0, 0]}>
                        <circleGeometry args={[fanRadius, 16]} />
                        <meshStandardMaterial color="#0f172a" />
                    </mesh>
                 </group>
             ) : (
                <mesh position={[0, h/2 + 0.01, 0]} rotation={[-Math.PI/2, 0, 0]}>
                    <circleGeometry args={[fanRadius, 16]} />
                    <meshStandardMaterial color="#0f172a" />
                </mesh>
             )}
             
             {/* Side Vents */}
             <mesh position={[0, 0, d/2 + 0.01]}>
                  <boxGeometry args={[w * 0.8, h * 0.6, 0.05]} />
                  <meshStandardMaterial color="#1e293b" />
             </mesh>
        </group>
    );
}

const Chimney: React.FC<{ position: THREE.Vector3; scale: [number, number, number]; color: string; smoke?: boolean; rotation?: number; isIndustrial?: boolean }> = ({ position, scale, color, smoke = true, rotation = 0, isIndustrial = false }) => {
    const particlesRef = useRef<THREE.InstancedMesh>(null!);
    const count = 5;
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const particles = useMemo(() => new Array(count).fill(0).map(() => ({
        y: Math.random() * 3,
        speed: 0.5 + Math.random() * 0.5,
        offset: Math.random() * 100
    })), []);

    // Intensity of smoke (0 to 1) for transition
    const intensity = useRef(smoke ? 1.0 : 0.0);

    useFrame((state, delta) => {
        if (!particlesRef.current) return;

        // Smoothly transition intensity based on smoke prop
        const target = smoke ? 1.0 : 0.0;
        // Lerp speed determines dissipation time (approx 2-3 seconds to fully vanish)
        intensity.current = THREE.MathUtils.lerp(intensity.current, target, delta * 1.5);

        if (intensity.current < 0.01) {
            particlesRef.current.visible = false;
            return;
        }

        particlesRef.current.visible = true;
        const t = state.clock.elapsedTime;

        particles.forEach((p, i) => {
             // Always animate physics even if fading
             let y = (t * p.speed + p.offset) % 4; 
             dummy.position.set(0, scale[1]/2 + y, 0);
             dummy.position.x += Math.sin(t * 2 + p.offset) * 0.2 * y;
             dummy.position.z += Math.cos(t * 1.5 + p.offset) * 0.2 * y;
             
             // Scale is affected by vertical height (y) AND current dissipation intensity
             const s = (0.3 + (y * 0.2)) * intensity.current; 
             dummy.scale.set(s, s, s);
             
             dummy.updateMatrix();
             particlesRef.current.setMatrixAt(i, dummy.matrix);
        });
        particlesRef.current.instanceMatrix.needsUpdate = true;
    });

    return (
        <group position={position} rotation={[0, rotation, 0]}>
            <mesh castShadow receiveShadow userData={{ type: 'detail-fade' }}>
                <boxGeometry args={scale} />
                <meshStandardMaterial color={color} />
            </mesh>
            <mesh position={[0, scale[1]/2 + 0.005, 0]} rotation={[-Math.PI/2, 0, 0]} receiveShadow userData={{ type: 'detail-fade' }}>
               <planeGeometry args={[scale[0]*0.6, scale[2]*0.6]} />
               <meshStandardMaterial color="#1a1a1a" />
            </mesh>
            {/* Metal bars only for industrial chimneys */}
            {isIndustrial && scale[1] > 1.5 && (
                <group>
                    <mesh position={[0, -0.5, -scale[2]/2 - 0.05]} castShadow userData={{ type: 'detail-fade' }}>
                        <boxGeometry args={[scale[0] + 0.1, 0.1, 0.1]} />
                        <meshStandardMaterial color="#475569" />
                    </mesh>
                     <mesh position={[0, 0.5, -scale[2]/2 - 0.05]} castShadow userData={{ type: 'detail-fade' }}>
                        <boxGeometry args={[scale[0] + 0.1, 0.1, 0.1]} />
                        <meshStandardMaterial color="#475569" />
                    </mesh>
                </group>
            )}
            {/* Always render instanced mesh, visibility controlled in loop */}
            <instancedMesh ref={particlesRef} args={[undefined, undefined, count]} position={[0, 0, 0]}>
                <boxGeometry args={[1, 1, 1]} />
                <meshBasicMaterial color="#aaaaaa" transparent opacity={0.4} />
            </instancedMesh>
        </group>
    );
}

const DoorBlock: React.FC<{ position: [number, number, number], rotation: [number, number, number] }> = ({ position, rotation }) => {
    // UPDATED: Darker brown frame, door remains original wood brown
    const frameColor = "#4a3018"; // Darker brown
    const frameDepth = 0.08; 
    const frameWidth = 0.06; 
    const frameZ = frameDepth / 2; 

    return (
        <group position={position} rotation={rotation} userData={{ ignoreRaycast: true, type: 'detail-hide' }}>
            {/* Left Jamb */}
            <mesh position={[-0.48, 0, frameZ]} castShadow receiveShadow>
                <boxGeometry args={[frameWidth, 2.2, frameDepth]} />
                <meshStandardMaterial color={frameColor} />
            </mesh>
            {/* Right Jamb */}
            <mesh position={[0.48, 0, frameZ]} castShadow receiveShadow>
                <boxGeometry args={[frameWidth, 2.2, frameDepth]} />
                <meshStandardMaterial color={frameColor} />
            </mesh>
            {/* Top Header - Bottom at 1.04 */}
            <mesh position={[0, 1.1 - frameWidth/2, frameZ]} castShadow receiveShadow>
                <boxGeometry args={[0.9 + (frameWidth*2), frameWidth, frameDepth]} />
                <meshStandardMaterial color={frameColor} />
            </mesh>

            {/* Door Panel - Increased Height to 2.15 to reach header (Top 1.05) */}
            <mesh position={[0, -0.025, 0]}>
                <boxGeometry args={[0.9, 2.15, 0.05]} />
                {/* Changed to brown wood color and increased roughness */}
                <meshStandardMaterial color="#8b5a2b" roughness={0.8} />
            </mesh>
            
            {/* Handle */}
            <mesh position={[0.35, -0.1, 0.05]}>
                <boxGeometry args={[0.1, 0.2, 0.05]} />
                <meshStandardMaterial color="#fcd34d" metalness={0.8} roughness={0.2} />
            </mesh>
        </group>
    );
};

const IndustrialDoorBlock: React.FC<{ position: [number, number, number], rotation: [number, number, number] }> = ({ position, rotation }) => {
    // UPDATED: Taller door panel
    const frameColor = "#334155";
    const frameDepth = 0.1;
    const frameWidth = 0.1; 
    const frameZ = frameDepth / 2;
    
    return (
        <group position={position} rotation={rotation} userData={{ ignoreRaycast: true, type: 'detail-hide' }}>
            {/* Left Jamb */}
            <mesh position={[-0.95, 0, frameZ]} castShadow receiveShadow>
                <boxGeometry args={[frameWidth, 3.0, frameDepth]} />
                <meshStandardMaterial color={frameColor} />
            </mesh>
            {/* Right Jamb */}
            <mesh position={[0.95, 0, frameZ]} castShadow receiveShadow>
                <boxGeometry args={[frameWidth, 3.0, frameDepth]} />
                <meshStandardMaterial color={frameColor} />
            </mesh>
            {/* Header - Bottom at 1.4 */}
            <mesh position={[0, 1.5 - frameWidth/2, frameZ]} castShadow receiveShadow>
                <boxGeometry args={[1.8 + (frameWidth*2), frameWidth, frameDepth]} />
                <meshStandardMaterial color={frameColor} />
            </mesh>

            {/* Panel - Increased Height to 2.95 (Top 1.425) */}
            <mesh position={[0, -0.025, 0]}>
                <boxGeometry args={[1.8, 2.95, 0.05]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} />
            </mesh>

            {[0.25, 0.75, 1.25, -0.25, -0.75, -1.25].map((y, i) => (
                <mesh key={i} position={[0, y - 0.2, 0.03]}>
                     <boxGeometry args={[1.7, 0.02, 0.01]} />
                     <meshStandardMaterial color="#64748b" />
                </mesh>
            ))}
        </group>
    );
};

const BlinkingWindow: React.FC<{ position: [number, number, number], rotation: [number, number, number], size: number, color: string, type: 'residential' | 'industrial', isCorner?: boolean, forceOn?: boolean }> = ({ position, rotation, size, color, type, isCorner = false, forceOn = false }) => {
    // FIXED: Material properties adjusted to allow emissive light to shine through
    const [material] = useState(() => new THREE.MeshStandardMaterial({
        color: new THREE.Color('#1e293b'), 
        emissive: new THREE.Color(type === 'residential' ? '#fbbf24' : '#e2e8f0'),
        emissiveIntensity: 0,
        roughness: 0.1, 
        metalness: 0.1 
    }));
    
    // Independent Random Life Cycle
    const schedule = useMemo(() => {
        return {
            // Random offset so windows don't blink in unison
            offset: Math.random() * 1000, 
            // Cycle speed reduced significantly for slower intervals
            speed: type === 'residential' ? 0.05 + Math.random() * 0.1 : 0.0,
            // Activity threshold: 
            threshold: Math.random() * 0.6
        };
    }, [type]);
    
    useFrame((state, delta) => {
        if (material) {
            let targetIntensity = 0;
            const maxIntensity = 4.0; 

            if (type === 'industrial') {
                targetIntensity = maxIntensity; 
            } else {
                const t = state.clock.elapsedTime;
                const noise = Math.sin(t * schedule.speed + schedule.offset);
                const isWindowOn = noise > schedule.threshold;
                targetIntensity = isWindowOn ? maxIntensity : 0.0;
            }
            
            // FASTER OFF: Significantly speed up fade out
            const speed = targetIntensity < 0.1 ? 20.0 : 2.0; 
            material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, targetIntensity, delta * speed);
        }
    });

    const frameColor = type === 'residential' ? '#4a3018' : '#1f2937';
    const grillColor = type === 'residential' ? '#4a3018' : '#334155'; 
    
    const frameDepth = 0.08; 
    const frameThickness = 0.06; 

    const w = type === 'residential' ? size : 1.6;
    const h = type === 'residential' ? size : 1.0;

    const Frame = ({ w, h }: { w: number, h: number }) => {
        const zPos = frameDepth / 2;
        return (
            <group>
                <mesh position={[0, h/2 + frameThickness/2, zPos]} castShadow>
                    <boxGeometry args={[w + frameThickness*2, frameThickness, frameDepth]} />
                    <meshStandardMaterial color={frameColor} />
                </mesh>
                <mesh position={[0, -h/2 - frameThickness/2, zPos]} castShadow>
                    <boxGeometry args={[w + frameThickness*2, frameThickness, frameDepth]} />
                    <meshStandardMaterial color={frameColor} />
                </mesh>
                <mesh position={[-w/2 - frameThickness/2, 0, zPos]} castShadow>
                    <boxGeometry args={[frameThickness, h, frameDepth]} />
                    <meshStandardMaterial color={frameColor} />
                </mesh>
                <mesh position={[w/2 + frameThickness/2, 0, zPos]} castShadow>
                    <boxGeometry args={[frameThickness, h, frameDepth]} />
                    <meshStandardMaterial color={frameColor} />
                </mesh>
            </group>
        );
    };

    return (
        <group position={[position[0], position[1], position[2]]} rotation={rotation} userData={{ ignoreRaycast: true, type: 'detail-hide' }}>
            <group position={[0, 0, 0]}>
                <Frame w={w} h={h} />
                <mesh material={material} position={[0, 0, 0.025]}>
                    <boxGeometry args={[w, h, 0.04]} />
                </mesh>
                <group position={[0, 0, 0.06]}>
                    {type === 'residential' ? (
                        <>
                             <mesh position={[0, 0, 0]}>
                                 <boxGeometry args={[0.04, h, 0.02]} />
                                 <meshStandardMaterial color={grillColor} />
                             </mesh>
                             <mesh position={[0, 0, 0]}>
                                 <boxGeometry args={[w, 0.04, 0.02]} />
                                 <meshStandardMaterial color={grillColor} />
                             </mesh>
                        </>
                    ) : (
                        <>
                            <mesh position={[0, h * 0.25, 0]}>
                                <boxGeometry args={[w, 0.04, 0.02]} />
                                <meshStandardMaterial color={grillColor} />
                            </mesh>
                             <mesh position={[0, -h * 0.25, 0]}>
                                <boxGeometry args={[w, 0.04, 0.02]} />
                                <meshStandardMaterial color={grillColor} />
                            </mesh>
                        </>
                    )}
                </group>
            </group>
        </group>
    );
};

const Roof: React.FC<{ size: [number, number, number]; color: string }> = ({ size, color }) => {
    const [w, h, d] = size;
    const ow = w + 0.2;
    const od = d + 0.2;

    return (
        <group>
            <mesh position={[0, 0.15, 0]} castShadow receiveShadow userData={{ type: 'roof' }}>
                <boxGeometry args={[ow, 0.3, od]} />
                <meshStandardMaterial color={color} />
            </mesh>
            <mesh position={[0, 0.3, 0]} userData={{ type: 'roof' }}>
                 <boxGeometry args={[ow - 0.2, 0.05, od - 0.2]} />
                 <meshStandardMaterial color="#000000" transparent opacity={0.2} />
            </mesh>
        </group>
    );
};

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
    windows?: { pos: Position, rot: [number,number,number] }[];
    doors?: { pos: Position, rot: [number,number,number], type?: 'standard' | 'industrial' }[];
    variant?: number;
    isLit?: boolean; 
    isCooking?: boolean;
    showWireframe?: boolean;
}> = ({ position, scale, color, type, playerPos, playerVel, chimney, attachedChimneys = [], acs = [], lShape, windows = [], doors = [], variant = 0, isLit = false, isCooking = false, showWireframe = false }) => {
    const groupRef = useRef<THREE.Group>(null!);
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
                 p.push({ size: [b1W, h, d], pos: [-cutW/2, 0, 0] }); 
                 
                 const b2W = cutW;
                 const b2D = d - cutD;
                 const b2CenterX = (w/2) - (b2W/2);
                 let b2CenterZ = 0;
                 if (corner === 0) { b2CenterZ = -d/2 + b2D/2; } 
                 else { b2CenterZ = d/2 - b2D/2; } 
                 p.push({ size: [b2W, h, b2D], pos: [b2CenterX, 0, b2CenterZ] });
            } else { 
                 const b1W = w - cutW;
                 p.push({ size: [b1W, h, d], pos: [cutW/2, 0, 0] }); 
                 
                 const b2W = cutW;
                 const b2D = d - cutD;
                 const b2CenterX = -w/2 + b2W/2;
                 let b2CenterZ = 0;
                 if (corner === 3) { b2CenterZ = -d/2 + b2D/2; } 
                 else { b2CenterZ = d/2 - b2D/2; }
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
            shape.moveTo(0, 0);

            // Shape Logic: Draw the footprint (X, Z plane equivalent)
            // Coordinates in Shape are (x, y) which will become (x, z) after extrusion
            if (corner === 2) { // SW Cut (Low X, Low Z)
                 shape.lineTo(0, d);
                 shape.lineTo(w, d);
                 shape.lineTo(w, 0);
                 shape.lineTo(cutW, 0);
                 shape.lineTo(cutW, cutD);
                 shape.lineTo(0, cutD);
            } else if (corner === 1) { // SE Cut (High X, Low Z)
                 shape.lineTo(0, d);
                 shape.lineTo(w, d);
                 shape.lineTo(w, cutD);
                 shape.lineTo(w - cutW, cutD);
                 shape.lineTo(w - cutW, 0);
                 shape.lineTo(0, 0);
            } else if (corner === 0) { // NE Cut (High X, High Z)
                 shape.lineTo(0, d);
                 shape.lineTo(w - cutW, d);
                 shape.lineTo(w - cutW, d - cutD);
                 shape.lineTo(w, d - cutD);
                 shape.lineTo(w, 0);
                 shape.lineTo(0, 0);
            } else if (corner === 3) { // NW Cut (Low X, High Z)
                 shape.lineTo(0, d - cutD);
                 shape.lineTo(cutW, d - cutD);
                 shape.lineTo(cutW, d);
                 shape.lineTo(w, d);
                 shape.lineTo(w, 0);
                 shape.lineTo(0, 0);
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
            geom.translate(-w/2, h/2, -d/2); // Extrusion goes "up" or "down" depending on rotation.
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
        
        // Setup Ray: Player -> Camera
        ray.origin.copy(playerPos.current);
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

            box.min.set(worldCenter.x - pW/2, worldCenter.y - pH/2, worldCenter.z - pD/2);
            box.max.set(worldCenter.x + pW/2, worldCenter.y + pH/2, worldCenter.z + pD/2);

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
                <meshStandardMaterial color={color} />
            </mesh>

            {/* Wireframe for Transparency Mode */}
            <lineSegments geometry={edges} userData={{ type: 'wireframe' }}>
                <lineBasicMaterial color="#ffffff" transparent opacity={0} depthTest={false} />
            </lineSegments>

            {/* Roofs must still be positioned per part, as they are separate visual toppers */}
            {parts.map((part, i) => (
                <group key={i} position={new THREE.Vector3(...part.pos)}>
                    <group position={[0, h/2, 0]}>
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
                    />
                ))}
            </group>

            <group userData={{ type: 'detail' }}>
                {acs.map((item, i) => {
                    if (item.type === 'wall') {
                         return <WallAC key={`ac-${i}`} position={new THREE.Vector3(...item.pos)} scale={item.scale} color={item.color} rotation={item.rotation} />
                    } else {
                         return <RoofAC key={`ac-${i}`} position={new THREE.Vector3(...item.pos)} scale={item.scale} color={item.color} rotation={item.rotation} />
                    }
                })}
            </group>
            
            {chimney && (
                <group position={[chimney.position[0] - position.x, 0, chimney.position[2] - position.z]} userData={{ type: 'detail' }}>
                    <Chimney position={new THREE.Vector3(0, chimney.position[1] - position.y, 0)} scale={chimney.scale} color={chimney.color} smoke={isFactory ? true : isCooking} isIndustrial={isFactory} />
                </group>
            )}
        </group>
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
  const stepUpTimer = useRef(0);
  const stumbleTimer = useRef(0);
  const stumbleVelocity = useRef(new THREE.Vector3(0, 0, 0));
  const landingAnimTimer = useRef(0);
  const lastFallDist = useRef(0);

  // Character Refs for direct manipulation (if needed)
  const characterGroup = useRef<THREE.Group>(null!);
  const staminaGroup = useRef<HTMLDivElement>(null!);
  const staminaFill = useRef<HTMLDivElement>(null!);

  // Map Data
  const [mapData, setMapData] = useState<{ objects: VoxelObject[], oGrid: number[][], bGrid: number[][], wGrid: number[][], sGrid: number[][], spawnPos: THREE.Vector3 } | null>(null);

  // Character Visual State (for animation props)
  const [visualState, setVisualState] = useState({
      isCharging: false,
      isRolling: false,
      isGrounded: true,
      isClimbing: false,
      isRunning: false,
      isStumbling: false,
      stunned: false,
      isMoving: false,
      stepUpFactor: 0,
      landingFactor: 0,
      currentSurface: 0,
      fallDistance: 0,
      justLanded: false
  });

  // Initialization
  useEffect(() => {
    // Generate Level
    const spawn = new THREE.Vector2(0, 0);
    const data = generateCityLevel(spawn, settings, mapId);
    setMapData(data);

    // Reset Player to NEW SPAWN POS
    playerPos.current.copy(data.spawnPos);
    playerVel.current.set(0, 0, 0);
    stamina.current = 100;
    stunTimer.current = 0;
    
    // Notify Prep Complete ONLY IF IN PREP STATUS (Avoids auto-start when editing menu)
    if (status === GameStatus.PREP) {
         onPrepComplete();
    }
  }, [settings.worldSize, settings.riverWidth, settings.ratios, mapId]);

  // RESET CAMERA ON PREP (RESPAWN)
  useEffect(() => {
    if (status === GameStatus.PREP) {
        if (controls) {
            // @ts-ignore
            if (controls.reset) controls.reset();
        }
        // Force Isometric Defaults
        camera.position.set(100, 100, 100);
        camera.lookAt(0, 0, 0);
    }
  }, [status, camera, controls]);

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
          mapData.oGrid,
          mapData.bGrid,
          mapData.wGrid,
          settings.worldSize,
          canMove,
          rollTimer,
          jumpBufferTimer,
          isRolling,
          stepUpTimer,
          stumbleTimer,
          stumbleVelocity,
          camera, // Pass Camera
          lastFallDist
      );

      // Update Character Transform
      if (characterGroup.current) {
          characterGroup.current.position.copy(playerPos.current);
          
          // ROTATE CHARACTER: Face movement direction
          if (physicsOutput.pMoving && !physicsOutput.isClimbing && !physicsOutput.effectiveStunned) {
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

      // Sync Visual State
      const newVisualState = {
          isCharging: physicsOutput.isCharging,
          isRolling: physicsOutput.isRolling,
          isGrounded: physicsOutput.isGrounded,
          isClimbing: physicsOutput.isClimbing,
          isRunning: physicsOutput.isRunning,
          isStumbling: physicsOutput.isStumbling,
          stunned: physicsOutput.effectiveStunned,
          isMoving: physicsOutput.pMoving,
          stepUpFactor: physicsOutput.stepUpFactor,
          landingFactor: physicsOutput.landingFactor,
          currentSurface: currentSurface,
          fallDistance: physicsOutput.fallDistance,
          justLanded: physicsOutput.justLanded
      };

      // Simple shallow compare
      let changed = false;
      if (newVisualState.isCharging !== visualState.isCharging) changed = true;
      else if (newVisualState.isRolling !== visualState.isRolling) changed = true;
      else if (newVisualState.isGrounded !== visualState.isGrounded) changed = true;
      else if (newVisualState.isClimbing !== visualState.isClimbing) changed = true;
      else if (newVisualState.isRunning !== visualState.isRunning) changed = true;
      else if (newVisualState.isStumbling !== visualState.isStumbling) changed = true;
      else if (newVisualState.stunned !== visualState.stunned) changed = true;
      else if (newVisualState.isMoving !== visualState.isMoving) changed = true;
      else if (Math.abs(newVisualState.stepUpFactor - visualState.stepUpFactor) > 0.05) changed = true;
      else if (Math.abs(newVisualState.landingFactor - visualState.landingFactor) > 0.05) changed = true;
      else if (newVisualState.currentSurface !== visualState.currentSurface) changed = true;
      else if (Math.abs(newVisualState.fallDistance - visualState.fallDistance) > 0.1) changed = true;
      else if (newVisualState.justLanded !== visualState.justLanded) changed = true;
      
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
      return (
        <>
            <VoxelGround size={settings.worldSize} waterGrid={mapData.wGrid} debugMode={debugMode} showGrid={showGrid} />
            <VoxelWater size={settings.worldSize} waterGrid={mapData.wGrid} />
            {mapData.objects.map(obj => {
                if (obj.type === 'wheat') return null;
                if (obj.type === 'ruin') return <RuinBlock key={obj.id} position={new THREE.Vector3(...obj.position)} scale={obj.scale} color={obj.color} />;
                if (obj.type === 'fence') return <FenceBlock key={obj.id} position={new THREE.Vector3(...obj.position)} color={obj.color} neighbors={obj.neighbors} />;
                if (obj.type === 'street') return <Street key={obj.id} position={new THREE.Vector3(...obj.position)} color={obj.color} />;
                return (
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
                        variant={obj.variant}
                        showWireframe={showWireframe}
                    />
                );
            })}
             <WheatField wheatObjects={mapData.objects.filter(o => o.type === 'wheat')} playerPos={playerPos} />
        </>
      );
  }, [mapData, debugMode, settings.worldSize, showGrid, showWireframe]); 

  if (!mapData) return null;

  return (
    <group>
        {mapElements}
        {debugMode && mapData && (
             <CollisionDebug oGrid={mapData.oGrid} bGrid={mapData.bGrid} size={settings.worldSize} visible={!!showCollision} />
        )}
        <Character 
            groupRef={characterGroup}
            staminaFillRef={staminaFill}
            staminaGroupRef={staminaGroup}
            stunned={visualState.stunned}
            isCharging={visualState.isCharging}
            isRolling={visualState.isRolling}
            isStumbling={visualState.isStumbling}
            isClimbing={visualState.isClimbing}
            isRunning={visualState.isRunning}
            isMoving={visualState.isMoving}
            isGrounded={visualState.isGrounded}
            stepUpFactor={visualState.stepUpFactor}
            landingFactor={visualState.landingFactor}
            stunTimerRef={stunTimer}
            rollTimerRef={rollTimer}
            staminaRef={stamina}
            currentSurface={visualState.currentSurface}
            fallDistance={visualState.fallDistance}
            justLanded={visualState.justLanded}
            overlayContent={null}
        />
    </group>
  );
};
