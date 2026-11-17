import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GameStatus, Position } from '../../types';
import { FLOOR_HEIGHT } from '../../utils/physics';
import { WallAC, RoofAC } from './AcUnits';
import { Chimney } from './Chimney';
import { DoorBlock, IndustrialDoorBlock } from './Doors';
import { Ladder } from './Ladder';
import { GridMaterial } from '../GridMaterial';
import { BlinkingWindow } from './BlinkingWindow';
import { Roof } from './Roof';

function createLineSegmentsGeometry(shape: THREE.Shape): THREE.BufferGeometry {
  const points = shape.getPoints();
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

interface CachedMeshFadeEntry {
  mesh: THREE.Mesh;
  materials: THREE.Material[];
  isLadder: boolean;
}

export interface BuildingProps {
  id: string;
  occludedBuildingIdsRef: React.MutableRefObject<Set<string>>;
  position: [number, number, number] | THREE.Vector3;
  scale: [number, number, number];
  color: string;
  type: 'box' | 'factory' | 'highrise';
  playerPos?: React.MutableRefObject<THREE.Vector3>;
  playerVel?: React.MutableRefObject<THREE.Vector3>;
  playerLastDir?: React.MutableRefObject<THREE.Vector2>;
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
  status?: GameStatus;
  debugMode?: boolean;
}

export const Building: React.FC<BuildingProps> = React.memo(
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
    const cachedMeshesRef = useRef<CachedMeshFadeEntry[]>([]);
    const lastSettledOccludedRef = useRef<boolean | null>(null);
    const [w, h, d] = scale;
    const isFactory = type === 'factory';

    const posArr: [number, number, number] = Array.isArray(position)
      ? position
      : [position.x, position.y, position.z];

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
        const hw = (w || 1) / 2;
        const hd = (d || 1) / 2;

        const allAtts = [...(attachedChimneys || []), ...(acs || [])];

        interface WallBump {
          min: number;
          max: number;
          depth: number;
        }
        const rightBumps: WallBump[] = [];
        const leftBumps: WallBump[] = [];
        const backBumps: WallBump[] = [];
        const frontBumps: WallBump[] = [];

        allAtts.forEach((att) => {
          if (!att?.pos || !att?.scale) return;
          const [ax, , az] = att.pos as [number, number, number];
          const [rawW, , rawD] = att.scale as [number, number, number];
          if (rawW <= 0 || rawD <= 0) return;

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

        backBumps.sort((a, b) => a.min - b.min);
        rightBumps.sort((a, b) => a.min - b.min);
        frontBumps.sort((a, b) => b.max - a.max);
        leftBumps.sort((a, b) => b.max - a.max);

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
                    const px = -hw + (pi - pad) + 0.5;
                    const pz = -hd + (pj - pad) + 0.5;
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
            const visited = new Set<string>();
            let iterations = 0;
            const maxIter = outlineEdges.size + 10;
            while (currentKey && iterations < maxIter) {
              iterations++;
              if (visited.has(currentKey)) break;
              visited.add(currentKey);
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
          backBumps.forEach((bump) => {
            footprintShape.lineTo(bump.min, -hd);
            footprintShape.lineTo(bump.min, -hd - bump.depth);
            footprintShape.lineTo(bump.max, -hd - bump.depth);
            footprintShape.lineTo(bump.max, -hd);
          });
          footprintShape.lineTo(hw, -hd);

          rightBumps.forEach((bump) => {
            footprintShape.lineTo(hw, bump.min);
            footprintShape.lineTo(hw + bump.depth, bump.min);
            footprintShape.lineTo(hw + bump.depth, bump.max);
            footprintShape.lineTo(hw, bump.max);
          });
          footprintShape.lineTo(hw, hd);

          const sortedFrontBumps = [...frontBumps].sort((a, b) => b.min - a.min);
          sortedFrontBumps.forEach((bump) => {
            footprintShape.lineTo(bump.max, hd);
            footprintShape.lineTo(bump.max, hd + bump.depth);
            footprintShape.lineTo(bump.min, hd + bump.depth);
            footprintShape.lineTo(bump.min, hd);
          });
          footprintShape.lineTo(-hw, hd);

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

    // Dispose generated BufferGeometries on unmount or regeneration to prevent GPU memory leaks
    useEffect(() => {
      return () => {
        hullGeometry.dispose();
        fillGeometry.dispose();
        wireframeEdges.dispose();
        roofBaseGeometry?.dispose();
        roofShadowGeometry?.dispose();
      };
    }, [hullGeometry, fillGeometry, wireframeEdges, roofBaseGeometry, roofShadowGeometry]);

    // Cache child meshes and assign renderOrders once after mount/update instead of traversing every frame
    useEffect(() => {
      if (!groupRef.current) return;
      const entries: CachedMeshFadeEntry[] = [];

      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData.type !== 'footprint') {
          child.visible = true;

          let partType = child.userData.type;
          let p = child.parent;
          while (!partType && p) {
            if (p.userData && p.userData.type) {
              partType = p.userData.type;
              break;
            }
            p = p.parent;
          }

          const isLadder = partType === 'ladder' || !!child.userData.isLadder;
          const materials = Array.isArray(child.material) ? child.material : [child.material];

          if (partType === 'hull') {
            child.renderOrder = 10;
          } else if (partType === 'roof') {
            const isShadow = materials.some((m) => m.transparent || m.opacity < 0.999);
            child.renderOrder = isShadow ? 12 : 11;
          } else if (isLadder) {
            child.renderOrder = 13;
          } else if (partType === 'detail-fade') {
            child.renderOrder = child instanceof THREE.InstancedMesh ? 14 : 13;
          } else {
            child.renderOrder = 13;
          }

          for (let i = 0; i < materials.length; i++) {
            const mat = materials[i];
            if (mat.userData.initialOpacity === undefined) {
              mat.userData.initialOpacity = mat.opacity !== undefined ? mat.opacity : 1.0;
            }
          }

          entries.push({ mesh: child, materials, isLadder });
        }
      });

      cachedMeshesRef.current = entries;
      lastSettledOccludedRef.current = null;
    }, [hullGeometry, parts, windows, doors, ladders, attachedChimneys, acs, chimney]);

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

    useEffect(() => {
      return () => {
        wireframeMaterial.dispose();
        fillMaterial.dispose();
      };
    }, [wireframeMaterial, fillMaterial]);

    useFrame((_state, delta) => {
      if (!groupRef.current) return;
      const dt = Math.min(delta, 0.1);

      const isOccluded = occludedBuildingIdsRef.current.has(id);
      const targetOpacity = isOccluded ? 0.0 : 1.0;
      const targetWireframeOpacity = isOccluded ? 0.95 : 0.0;
      const targetFillOpacity = isOccluded ? 1.0 : 0.0;

      // Skip all mesh updates when opacity fade has completely settled
      if (
        lastSettledOccludedRef.current === isOccluded &&
        Math.abs(currentOpacity.current - targetOpacity) < 0.001 &&
        Math.abs(currentWireframeOpacity.current - targetWireframeOpacity) < 0.001 &&
        Math.abs(currentFillOpacity.current - targetFillOpacity) < 0.001
      ) {
        return;
      }

      const prevOpacity = currentOpacity.current;
      currentOpacity.current = THREE.MathUtils.lerp(prevOpacity, targetOpacity, dt * 8.0);
      if (Math.abs(currentOpacity.current - targetOpacity) < 0.001) {
        currentOpacity.current = targetOpacity;
      }

      const entries = cachedMeshesRef.current;
      const depthWriteVal = currentOpacity.current > 0.001;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const meshOpacity = entry.isLadder
          ? currentOpacity.current * 0.85 + 0.15
          : currentOpacity.current;

        for (let m = 0; m < entry.materials.length; m++) {
          const mat = entry.materials[m];
          mat.opacity = mat.userData.initialOpacity * meshOpacity;
          const targetTransparent = mat.opacity < 0.999;
          if (mat.transparent !== targetTransparent) {
            mat.transparent = targetTransparent;
            mat.needsUpdate = true;
          }
          mat.depthWrite = depthWriteVal;
        }
      }

      currentWireframeOpacity.current = THREE.MathUtils.lerp(
        currentWireframeOpacity.current,
        targetWireframeOpacity,
        dt * 8.0,
      );
      if (Math.abs(currentWireframeOpacity.current - targetWireframeOpacity) < 0.001) {
        currentWireframeOpacity.current = targetWireframeOpacity;
      }
      wireframeMaterial.opacity = currentWireframeOpacity.current;

      currentFillOpacity.current = THREE.MathUtils.lerp(
        currentFillOpacity.current,
        targetFillOpacity,
        dt * 8.0,
      );
      if (Math.abs(currentFillOpacity.current - targetFillOpacity) < 0.001) {
        currentFillOpacity.current = targetFillOpacity;
      }
      fillMaterial.opacity = currentFillOpacity.current;

      if (
        currentOpacity.current === targetOpacity &&
        currentWireframeOpacity.current === targetWireframeOpacity &&
        currentFillOpacity.current === targetFillOpacity
      ) {
        lastSettledOccludedRef.current = isOccluded;
      } else {
        lastSettledOccludedRef.current = null;
      }
    });

    return (
      <group ref={groupRef} position={posArr} userData={{ buildingId: id }}>
        <mesh geometry={hullGeometry} castShadow receiveShadow userData={{ type: 'hull' }}>
          <GridMaterial color={color} showGrid={showGrid} floorHeight={FLOOR_HEIGHT} />
        </mesh>

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

        <mesh
          geometry={fillGeometry}
          position={[0, -h / 2 + 0.05, 0]}
          userData={{ type: 'footprint' }}
        >
          <primitive object={fillMaterial} attach="material" />
        </mesh>

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
            <group key={i} position={part.pos}>
              <group position={[0, h / 2, 0]}>
                <Roof size={part.size} color={roofColor} />
              </group>
            </group>
          ))
        )}

        <group userData={{ type: 'detail-fade' }}>
          {windows.map((item, i) => (
            <BlinkingWindow
              key={i}
              position={item.pos}
              rotation={item.rot}
              size={1.0}
              color="white"
              type={isFactory ? 'industrial' : 'residential'}
              forceOn={isFactory}
            />
          ))}
        </group>

        <group userData={{ type: 'detail-fade' }}>
          {doors.map((item, i) =>
            item.type === 'industrial' ? (
              <IndustrialDoorBlock key={`door-${i}`} position={item.pos} rotation={item.rot} />
            ) : (
              <DoorBlock key={`door-${i}`} position={item.pos} rotation={item.rot} />
            ),
          )}
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
          {acs.map((item, i) =>
            item.type === 'wall' ? (
              <WallAC
                key={`ac-${i}`}
                position={new THREE.Vector3(...item.pos)}
                scale={item.scale}
                color={item.color}
                rotation={item.rotation}
                showGrid={showGrid}
              />
            ) : (
              <RoofAC
                key={`ac-${i}`}
                position={new THREE.Vector3(...item.pos)}
                scale={item.scale}
                color={item.color}
                rotation={item.rotation}
                showGrid={showGrid}
              />
            ),
          )}
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
            position={[chimney.position[0] - posArr[0], 0, chimney.position[2] - posArr[2]]}
            userData={{ type: 'detail-fade' }}
          >
            <Chimney
              position={new THREE.Vector3(0, chimney.position[1] - posArr[1], 0)}
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
