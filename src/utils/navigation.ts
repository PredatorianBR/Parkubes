import * as THREE from 'three';
import {
  worldToIndex,
  getTerrainHeight,
  getCeilingHeight,
  isPositionBlocked,
  checkLineOfSight,
  SpatialHashGrid,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  CLIMB_THRESHOLD,
  FLOOR_HEIGHT,
  MAX_JUMP_DISTANCE,
  calculateMaxJumpDistance,
} from './physics';
import { VoxelObject } from '../types';

export const MAX_SCALABLE_HEIGHT = FLOOR_HEIGHT + 0.5; // 6.5m (1 floor height limit: only <= 1 floor is scalable without ladder)

export type EdgeType = 'walk' | 'climb' | 'drop' | 'ladder' | 'jump';

export interface NavNode {
  id: string; // Format: "gx,gz,y"
  gx: number;
  gz: number;
  x: number; // world X
  y: number; // world Y
  z: number; // world Z
  isWater: boolean;
  isCorner: boolean; // close to walls/corners
  isEdge: boolean; // on a roof ledge/edge
}

export interface NavEdge {
  target: NavNode;
  type: EdgeType;
  cost: number;
}

/**
 * High-performance MinBinaryHeap / PriorityQueue for A* pathfinding.
 */
export class MinBinaryHeap<T> {
  private heap: { element: T; priority: number }[] = [];

  constructor() {}

  public get size(): number {
    return this.heap.length;
  }

  public isEmpty(): boolean {
    return this.heap.length === 0;
  }

  public push(element: T, priority: number): void {
    this.heap.push({ element, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  public pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0].element;
    const bottom = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  public peek(): T | undefined {
    return this.heap.length > 0 ? this.heap[0].element : undefined;
  }

  private bubbleUp(index: number): void {
    const item = this.heap[index];
    while (index > 0) {
      const parentIdx = (index - 1) >> 1;
      const parent = this.heap[parentIdx];
      if (item.priority >= parent.priority) break;
      this.heap[index] = parent;
      index = parentIdx;
    }
    this.heap[index] = item;
  }

  private sinkDown(index: number): void {
    const length = this.heap.length;
    const item = this.heap[index];
    while (true) {
      const leftIdx = (index << 1) + 1;
      const rightIdx = leftIdx + 1;
      let smallestIdx = index;
      let smallestPriority = item.priority;

      if (leftIdx < length && this.heap[leftIdx].priority < smallestPriority) {
        smallestIdx = leftIdx;
        smallestPriority = this.heap[leftIdx].priority;
      }
      if (rightIdx < length && this.heap[rightIdx].priority < smallestPriority) {
        smallestIdx = rightIdx;
      }
      if (smallestIdx === index) break;

      this.heap[index] = this.heap[smallestIdx];
      index = smallestIdx;
    }
    this.heap[index] = item;
  }

  public clear(): void {
    this.heap.length = 0;
  }
}

export class NavigationGraph {
  public nodes: Map<string, NavNode> = new Map();
  public nodesArray: NavNode[] = [];
  public edges: Map<string, NavEdge[]> = new Map();
  public ladderZones: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
    faceAngle: number;
    railX: number;
    railZ: number;
  }[] = [];
  private gridBuckets: Map<number, NavNode[]> = new Map();
  public collisionGrid?: SpatialHashGrid;
  public bGrid: number[][] = [];
  public wGrid: number[][] = [];
  private worldSize: number;
  private halfSize: number;

  constructor(mapData: {
    objects: VoxelObject[];
    collisionGrid: SpatialHashGrid;
    bGrid: number[][];
    wGrid: number[][];
    sGrid: number[][];
    tGrid: number[][];
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
    worldSize: number;
  }) {
    this.worldSize = mapData.worldSize;
    this.halfSize = Math.floor(mapData.worldSize / 2);
    this.ladderZones = mapData.ladderZones || [];
    this.collisionGrid = mapData.collisionGrid;
    this.bGrid = mapData.bGrid || [];
    this.wGrid = mapData.wGrid || [];

    this.buildNodes(mapData);
    this.nodesArray = Array.from(this.nodes.values());
    this.buildEdges(mapData);
  }

  private buildNodes(mapData: {
    objects?: VoxelObject[];
    collisionGrid: SpatialHashGrid;
    bGrid: number[][];
    wGrid: number[][];
    ladderZones?: { minX: number; minZ: number; maxX: number; maxZ: number; minY: number; maxY: number }[];
  }) {
    const { collisionGrid, bGrid, wGrid, ladderZones, objects } = mapData;

    // 1. Probing nodes across the grid XZ coordinates
    for (let gx = 0; gx < this.worldSize; gx++) {
      for (let gz = 0; gz < this.worldSize; gz++) {
        const worldX = gx + 0.5 - this.halfSize;
        const worldZ = gz + 0.5 - this.halfSize;

        // Gather unique standing heights at this cell
        const uniqueHeights = new Set<number>();

        // Check ground / water height
        const groundH = getTerrainHeight(
          worldX,
          worldZ,
          0,
          collisionGrid,
          bGrid,
          wGrid,
          this.worldSize,
        );
        if (groundH !== -Infinity) {
          const ceil = getCeilingHeight(
            worldX,
            worldZ,
            groundH,
            collisionGrid,
            bGrid,
            this.worldSize,
          );
          if (ceil === Infinity || ceil - groundH >= PLAYER_HEIGHT) {
            uniqueHeights.add(groundH);
          }
        }

        // Probe building rooftop heights by querying boxes
        const nearbyBoxes = collisionGrid.query(worldX, worldZ, 0.5);
        for (const box of nearbyBoxes) {
          // Check if box contains XZ
          if (
            worldX >= box.minX &&
            worldX <= box.maxX &&
            worldZ >= box.minZ &&
            worldZ <= box.maxZ
          ) {
            const topY = box.maxY;
            // All surfaces and rooftops (low obstacles, ruins, AC units, containers, low buildings, highrises, factories) can be accessible standable nodes
            const allowRooftop = topY >= 0.5;

            if (allowRooftop) {
              // Check headroom
              const ceil = getCeilingHeight(
                worldX,
                worldZ,
                topY,
                collisionGrid,
                bGrid,
                this.worldSize,
              );
              if (ceil === Infinity || ceil - topY >= PLAYER_HEIGHT) {
                uniqueHeights.add(topY);
              }
            }
          }
        }

        // Add NavNode for each standable height found
        uniqueHeights.forEach((y) => {
          // Check if position is within reachable physics boundaries
          const borderMargin = PLAYER_RADIUS - 0.36;
          const minBound = -this.halfSize + borderMargin;
          const maxBound = this.halfSize - borderMargin;
          if (worldX < minBound || worldX > maxBound || worldZ < minBound || worldZ > maxBound) {
            return; // Out of bounds, cannot walk here
          }

          // 1. Strict Building Interior Footprint Check:
          // Never allow a ground or lower-level node inside the footprint/interior of a building
          if (bGrid[gx]?.[gz] !== undefined && bGrid[gx][gz] > 0.5 && y < bGrid[gx][gz] - 0.1) {
            return; // Skip node inside building footprint!
          }

          // Check if position itself is inside or overlapping any building collision box
          const checkBoxes = collisionGrid.query(worldX, worldZ, PLAYER_RADIUS + 0.2);
          let isInsideBuilding = false;

          for (const box of checkBoxes) {
            // Check if Y height is inside building interior volume (between minY and maxY - 0.35)
            if (
              y >= box.minY + 0.1 &&
              y < box.maxY - 0.35 &&
              worldX >= box.minX - 0.05 &&
              worldX <= box.maxX + 0.05 &&
              worldZ >= box.minZ - 0.05 &&
              worldZ <= box.maxZ + 0.05
            ) {
              isInsideBuilding = true;
              break;
            }
          }

          if (isInsideBuilding) {
            return; // Skip node inside building interior!
          }

          // Check if position itself is blocked
          if (!isPositionBlocked(worldX, y, worldZ, collisionGrid, y >= 0.5 ? 0.15 : 0.35)) {
            const isWaterVal = wGrid[gx]?.[gz] === 1 && y < 0;
            const id = `${gx},${gz},${y.toFixed(2)}`;

            // Clamp node world coordinates so they remain physically reachable by the AI
            const reachMin = -this.halfSize + PLAYER_RADIUS + 0.12;
            const reachMax = this.halfSize - PLAYER_RADIUS - 0.12;
            let nodeX = Math.max(reachMin, Math.min(reachMax, worldX));
            let nodeZ = Math.max(reachMin, Math.min(reachMax, worldZ));

            // Corner & Wall Clearance Nudging:
            // Calculate repulsive offset away from vertical obstacle walls/corners to ensure
            // nodes don't hug walls or clip quinas (minimum clearance >= PLAYER_RADIUS + 0.10)
            const targetClearance = PLAYER_RADIUS + 0.10; // ~0.90m
            const nearbyObstacles = collisionGrid.query(nodeX, nodeZ, targetClearance + 0.25);
            let pushX = 0;
            let pushZ = 0;

            for (const box of nearbyObstacles) {
              if (y + 0.1 < box.maxY && y + PLAYER_HEIGHT - 0.1 > box.minY) {
                const closeX = Math.max(box.minX, Math.min(nodeX, box.maxX));
                const closeZ = Math.max(box.minZ, Math.min(nodeZ, box.maxZ));
                const dx = nodeX - closeX;
                const dz = nodeZ - closeZ;
                const distSq = dx * dx + dz * dz;

                if (distSq < targetClearance * targetClearance && distSq > 0.00001) {
                  const dist = Math.sqrt(distSq);
                  const pushDist = targetClearance - dist;
                  pushX += (dx / dist) * pushDist;
                  pushZ += (dz / dist) * pushDist;
                }
              }
            }

            if (Math.abs(pushX) > 0.001 || Math.abs(pushZ) > 0.001) {
              // Clamp push offset within cell boundaries (max offset 0.40m)
              const maxPush = 0.40;
              const pushLen = Math.hypot(pushX, pushZ);
              if (pushLen > maxPush) {
                pushX = (pushX / pushLen) * maxPush;
                pushZ = (pushZ / pushLen) * maxPush;
              }

              const candX = Math.max(reachMin, Math.min(reachMax, nodeX + pushX));
              const candZ = Math.max(reachMin, Math.min(reachMax, nodeZ + pushZ));

              // Verify candidate offset position is not blocked and supported
              if (!isPositionBlocked(candX, y, candZ, collisionGrid, 0.40)) {
                if (y <= 0.5) {
                  nodeX = candX;
                  nodeZ = candZ;
                } else {
                  // If on roof/elevated surface, ensure the nudged position still has floor support
                  const floorH = getTerrainHeight(candX, candZ, y, collisionGrid, bGrid, wGrid, this.worldSize, 0.6);
                  if (Math.abs(floorH - y) <= 0.6) {
                    nodeX = candX;
                    nodeZ = candZ;
                  }
                }
              }
            }

            const nodeObj: NavNode = {
              id,
              gx,
              gz,
              x: nodeX,
              y,
              z: nodeZ,
              isWater: isWaterVal,
              isCorner: false, // will compute next
              isEdge: false, // will compute next
            };
            this.nodes.set(id, nodeObj);

            const bucketKey = gx * 1000 + gz;
            let bucket = this.gridBuckets.get(bucketKey);
            if (!bucket) {
              bucket = [];
              this.gridBuckets.set(bucketKey, bucket);
            }
            bucket.push(nodeObj);
          }
        });
      }
    }

    // 1.5 Guaranteed Rooftop Nodes for Every Building Object in the Map
    if (objects && objects.length > 0) {
      objects.forEach((obj) => {
        const isBuildingObj =
          obj.type === 'house' ||
          obj.type === 'factory' ||
          obj.type === 'highrise' ||
          obj.type === 'ruin' ||
          obj.type === 'container' ||
          obj.type === 'bridge';
        if (!isBuildingObj) return;

        const w = obj.scale[0];
        const d = obj.scale[2];
        const minX = obj.position[0] - w / 2;
        const maxX = obj.position[0] + w / 2;
        const minZ = obj.position[2] - d / 2;
        const maxZ = obj.position[2] + d / 2;
        const roofY = obj.position[1] + obj.scale[1] / 2 + (obj.type !== 'ruin' ? 0.3 : 0);

        // Check if any node already exists on this building roof
        let countOnRoof = 0;
        this.nodes.forEach((n) => {
          if (
            Math.abs(n.y - roofY) <= 0.6 &&
            n.x >= minX - 0.1 &&
            n.x <= maxX + 0.1 &&
            n.z >= minZ - 0.1 &&
            n.z <= maxZ + 0.1
          ) {
            countOnRoof++;
          }
        });

        // If no nodes on this roof, generate guaranteed rooftop nodes
        if (countOnRoof === 0) {
          const samplePoints: { x: number; z: number }[] = [];

          // Center of roof
          samplePoints.push({ x: obj.position[0], z: obj.position[2] });

          // Quadrants for larger roofs
          if (w >= 3.0 && d >= 3.0) {
            const offX = Math.max(0.6, w * 0.25);
            const offZ = Math.max(0.6, d * 0.25);
            samplePoints.push({ x: obj.position[0] - offX, z: obj.position[2] - offZ });
            samplePoints.push({ x: obj.position[0] + offX, z: obj.position[2] - offZ });
            samplePoints.push({ x: obj.position[0] - offX, z: obj.position[2] + offZ });
            samplePoints.push({ x: obj.position[0] + offX, z: obj.position[2] + offZ });
          }

          samplePoints.forEach((pt) => {
            const reachMin = -this.halfSize + PLAYER_RADIUS + 0.12;
            const reachMax = this.halfSize - PLAYER_RADIUS - 0.12;
            const ptX = Math.max(reachMin, Math.min(reachMax, pt.x));
            const ptZ = Math.max(reachMin, Math.min(reachMax, pt.z));

            const ceil = getCeilingHeight(ptX, ptZ, roofY, collisionGrid, bGrid, this.worldSize);
            if (ceil !== Infinity && ceil - roofY < PLAYER_HEIGHT) return;

            // Check if blocked by high obstacle
            if (isPositionBlocked(ptX, roofY, ptZ, collisionGrid, 0.15)) return;

            const gx = worldToIndex(ptX, this.halfSize, this.worldSize);
            const gz = worldToIndex(ptZ, this.halfSize, this.worldSize);
            const id = `bldg_roof_${obj.id}_${ptX.toFixed(1)}_${ptZ.toFixed(1)}`;

            if (!this.nodes.has(id)) {
              const nodeObj: NavNode = {
                id,
                gx,
                gz,
                x: ptX,
                y: roofY,
                z: ptZ,
                isWater: false,
                isCorner: false,
                isEdge: true,
              };
              this.nodes.set(id, nodeObj);

              const bucketKey = gx * 1000 + gz;
              let bucket = this.gridBuckets.get(bucketKey);
              if (!bucket) {
                bucket = [];
                this.gridBuckets.set(bucketKey, bucket);
              }
              bucket.push(nodeObj);
            }
          });
        }
      });
    }

    // 2. Compute isCorner (proximity to walls/obstacles)
    this.nodes.forEach((node) => {
      const checkRadius = PLAYER_RADIUS + 0.3; // Check slightly outside player radius
      const boxes = collisionGrid.query(node.x, node.z, checkRadius);
      for (const box of boxes) {
        // If there's an obstacle overlapping with node's height space
        if (node.y + 0.1 < box.maxY && node.y + PLAYER_HEIGHT - 0.1 > box.minY) {
          // Check horizontal overlap
          const closeX = Math.max(box.minX, Math.min(node.x, box.maxX));
          const closeZ = Math.max(box.minZ, Math.min(node.z, box.maxZ));
          const dx = node.x - closeX;
          const dz = node.z - closeZ;
          if (dx * dx + dz * dz < checkRadius * checkRadius) {
            node.isCorner = true;
            break;
          }
        }
      }
    });

    // 3. Compute isEdge (near ledges on roofs)
    this.nodes.forEach((node) => {
      if (node.y <= 2.0) return; // ignore ground edges

      // Check adjacent cells. If any neighbor doesn't have a similar height, node is on an edge.
      const directions = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ];

      let onEdge = false;
      for (const [dx, dz] of directions) {
        const ngx = node.gx + dx;
        const ngz = node.gz + dz;
        if (ngx < 0 || ngx >= this.worldSize || ngz < 0 || ngz >= this.worldSize) {
          onEdge = true; // map boundary
          break;
        }

        // Check if any node exists in neighbor cell within safe height difference (e.g. 1.0 unit)
        let foundNeighbor = false;
        const neighborBucket = this.gridBuckets.get(ngx * 1000 + ngz);
        if (neighborBucket) {
          for (let i = 0; i < neighborBucket.length; i++) {
            if (Math.abs(neighborBucket[i].y - node.y) < 1.5) {
              foundNeighbor = true;
              break;
            }
          }
        }

        if (!foundNeighbor) {
          onEdge = true;
          break;
        }
      }
      node.isEdge = onEdge;
    });
  }

  private buildEdges(mapData: {
    collisionGrid: SpatialHashGrid;
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
  }) {
    const { collisionGrid, ladderZones } = mapData;

    // Initialize edge lists
    this.nodes.forEach((node) => {
      this.edges.set(node.id, []);
    });

    const neighborsOffsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];

    // 1. Establish grid-adjacent edges (Walk, Climb, Drop) using spatial grid buckets
    this.nodes.forEach((node) => {
      const edgeList = this.edges.get(node.id)!;

      neighborsOffsets.forEach(([dx, dz]) => {
        const ngx = node.gx + dx;
        const ngz = node.gz + dz;

        const neighborBucket = this.gridBuckets.get(ngx * 1000 + ngz);
        if (!neighborBucket) return;

        // Query nodes at the neighbor grid cell
        for (let i = 0; i < neighborBucket.length; i++) {
          const other = neighborBucket[i];
          const heightDiff = other.y - node.y;

          // Transition Type Evaluation
          if (Math.abs(heightDiff) <= CLIMB_THRESHOLD) {
            // WALKING transition
            const isDiagonal = dx !== 0 && dz !== 0;

            // In grid navigation, diagonal movement across a building corner is forbidden
            // if either orthogonal adjacent cell is blocked (inside a building or missing node at this height)
            if (isDiagonal) {
              const orth1Bucket = this.gridBuckets.get((node.gx + dx) * 1000 + node.gz);
              const orth2Bucket = this.gridBuckets.get(node.gx * 1000 + (node.gz + dz));
              const hasOrth1 = orth1Bucket?.some((n) => Math.abs(n.y - node.y) <= CLIMB_THRESHOLD);
              const hasOrth2 = orth2Bucket?.some((n) => Math.abs(n.y - node.y) <= CLIMB_THRESHOLD);
              if (!hasOrth1 || !hasOrth2) {
                return; // Do not cut through building walls or corners diagonally!
              }
            }

            // Multi-point corridor sampling along the edge to ensure no building or wall is intersected
            const checkRadius = isDiagonal ? PLAYER_RADIUS + 0.05 : 0.55;
            let corridorBlocked = false;

            for (const t of [0.25, 0.5, 0.75]) {
              const px = node.x + (other.x - node.x) * t;
              const pz = node.z + (other.z - node.z) * t;
              const py = node.y + (other.y - node.y) * t;

              if (isPositionBlocked(px, py, pz, collisionGrid, checkRadius)) {
                corridorBlocked = true;
                break;
              }

              if (py > 0.5) {
                const floorH = getTerrainHeight(px, pz, py, collisionGrid, this.bGrid, this.wGrid, this.worldSize, 0.6);
                if (Math.abs(floorH - py) > 0.6) {
                  corridorBlocked = true;
                  break;
                }
              }
            }

            if (!corridorBlocked) {
              const dist = Math.hypot(node.x - other.x, node.z - other.z);
              let cost = dist;

              // Water traversal penalty: swimming in water drastically reduces speed (WATER_MOVE_SPEED_MULT = 0.4)
              // and takes extra effort to enter/exit, making land paths and jumping over water heavily preferred.
              if (other.isWater || node.isWater) {
                cost += dist * 3.5 + 4.0;
              }

              // Corner avoidance cost: prefer wider, clearer paths around quinas
              if (other.isCorner || node.isCorner) cost += 0.4;

              edgeList.push({ target: other, type: 'walk', cost });
            }
          } else if (heightDiff > CLIMB_THRESHOLD && heightDiff <= MAX_SCALABLE_HEIGHT) {
            // CLIMBING transition (for any low obstacles, rooftops, or surfaces <= 1 floor)
            const midX = (node.x + other.x) / 2;
            const midZ = (node.z + other.z) / 2;
            const midY = Math.max(node.y, other.y);

            if (
              !isPositionBlocked(other.x, other.y, other.z, collisionGrid, 0.4) &&
              !isPositionBlocked(midX, midY, midZ, collisionGrid, 0.4)
            ) {
              const horizDist = Math.hypot(node.x - other.x, node.z - other.z);
              // If the building has a ladder, apply penalty to prefer the ladder route for whole building climbs
              const hasLadderOnRoof = ladderZones.some((zone) => {
                if (Math.abs(other.y - zone.maxY) > 1.5) return false;
                return Math.hypot(other.x - zone.railX, other.z - zone.railZ) <= 18.0;
              });
              const ladderPenalty = hasLadderOnRoof && heightDiff > 3.0 ? 50.0 : 0;
              // Obstacle Climb Cost: Climbing obstacles takes stamina and effort, making walking around on flat ground preferred
              const baseClimbCost = 16.0;
              const heightCost = heightDiff * 4.0;
              const cost = horizDist + baseClimbCost + heightCost + ladderPenalty;
              edgeList.push({ target: other, type: 'climb', cost });
            }
          } else if (heightDiff < -CLIMB_THRESHOLD) {
            // DROPPING transition: connect to adjacent lower node with safety cost
            const midX = (node.x + other.x) / 2;
            const midZ = (node.z + other.z) / 2;
            const midY = Math.max(node.y, other.y);

            if (
              !isPositionBlocked(other.x, other.y, other.z, collisionGrid, 0.4) &&
              !isPositionBlocked(midX, midY, midZ, collisionGrid, 0.4)
            ) {
              const horizDist = Math.hypot(node.x - other.x, node.z - other.z);
              const dropCost = Math.abs(heightDiff) > MAX_SCALABLE_HEIGHT ? 50.0 : Math.abs(heightDiff) * 0.5;
              const cost = horizDist + dropCost;
              edgeList.push({ target: other, type: 'drop', cost });
            }
          }
        }
      });
    });

    // 2. Establish ladder connections with explicit foot and top nodes
    ladderZones.forEach((zone, index) => {
      const railX = zone.railX;
      const railZ = zone.railZ;
      const bottomY = zone.minY;
      const topY = zone.maxY;

      // Create explicit foot node and top node for the ladder
      const footId = `ladder_foot_${index}`;
      const topId = `ladder_top_${index}`;

      const footY = bottomY;

      const footNode: NavNode = {
        id: footId,
        gx: worldToIndex(railX, this.halfSize, this.worldSize),
        gz: worldToIndex(railZ, this.halfSize, this.worldSize),
        x: railX,
        y: footY,
        z: railZ,
        isWater: false,
        isCorner: false,
        isEdge: false,
      };

      // Ladder rotation faceAngle points INTO the building (towards the wall/roof).
      const topDist = 0.5;
      const topX = railX + Math.sin(zone.faceAngle) * topDist;
      const topZ = railZ + Math.cos(zone.faceAngle) * topDist;

      const topNode: NavNode = {
        id: topId,
        gx: worldToIndex(topX, this.halfSize, this.worldSize),
        gz: worldToIndex(topZ, this.halfSize, this.worldSize),
        x: topX,
        y: topY,
        z: topZ,
        isWater: false,
        isCorner: false,
        isEdge: true,
      };

      // Create explicit ground approach node placed 1.0m in front of the ladder foot on the ground (away from wall)
      const groundApproachId = `ladder_ground_${index}`;
      const groundDist = 1.0;
      const groundApproachX = railX - Math.sin(zone.faceAngle) * groundDist;
      const groundApproachZ = railZ - Math.cos(zone.faceAngle) * groundDist;

      const groundApproachNode: NavNode = {
        id: groundApproachId,
        gx: worldToIndex(groundApproachX, this.halfSize, this.worldSize),
        gz: worldToIndex(groundApproachZ, this.halfSize, this.worldSize),
        x: groundApproachX,
        y: footY,
        z: groundApproachZ,
        isWater: false,
        isCorner: false,
        isEdge: false,
      };

      // Create explicit roof dismount node placed 1.8m into the roof in the direction of the ladder faceAngle
      const roofId = `ladder_roof_${index}`;
      const dismountDist = 1.8;
      const roofX = railX + Math.sin(zone.faceAngle) * dismountDist;
      const roofZ = railZ + Math.cos(zone.faceAngle) * dismountDist;

      const roofNode: NavNode = {
        id: roofId,
        gx: worldToIndex(roofX, this.halfSize, this.worldSize),
        gz: worldToIndex(roofZ, this.halfSize, this.worldSize),
        x: roofX,
        y: topY,
        z: roofZ,
        isWater: false,
        isCorner: false,
        isEdge: false,
      };

      this.nodes.set(groundApproachId, groundApproachNode);
      this.nodes.set(footId, footNode);
      this.nodes.set(topId, topNode);
      this.nodes.set(roofId, roofNode);

      [groundApproachNode, footNode, topNode, roofNode].forEach((nodeObj) => {
        const bucketKey = nodeObj.gx * 1000 + nodeObj.gz;
        let bucket = this.gridBuckets.get(bucketKey);
        if (!bucket) {
          bucket = [];
          this.gridBuckets.set(bucketKey, bucket);
        }
        bucket.push(nodeObj);
      });

      this.edges.set(groundApproachId, []);
      this.edges.set(footId, []);
      this.edges.set(topId, []);
      this.edges.set(roofId, []);

      // Connect groundApproachNode to footNode bi-directionally
      this.edges.get(groundApproachId)!.push({ target: footNode, type: 'walk', cost: 1.0 });
      this.edges.get(footId)!.push({ target: groundApproachNode, type: 'walk', cost: 1.0 });

      // Connect foot and top with ladder edges (BI-DIRECTIONAL: climb up & slide down)
      const heightDiff = topY - bottomY;
      const climbCost = heightDiff * 1.2 + 2.0;
      const slideCost = heightDiff * 0.8 + 1.0;

      this.edges.get(footId)!.push({ target: topNode, type: 'ladder', cost: climbCost });
      this.edges.get(topId)!.push({ target: footNode, type: 'ladder', cost: slideCost });

      // Connect topNode to roofNode bi-directionally (mount/dismount from/to roof)
      this.edges.get(topId)!.push({ target: roofNode, type: 'walk', cost: 1.0 });
      this.edges.get(roofId)!.push({ target: topNode, type: 'walk', cost: 1.0 });

      // Connect groundApproachNode and roofNode to nearby ground/roof walking nodes using local bucket scan
      const scanDist = 4;
      for (let dx = -scanDist; dx <= scanDist; dx++) {
        for (let dz = -scanDist; dz <= scanDist; dz++) {
          const gBucket = this.gridBuckets.get((groundApproachNode.gx + dx) * 1000 + (groundApproachNode.gz + dz));
          if (gBucket) {
            for (let i = 0; i < gBucket.length; i++) {
              const other = gBucket[i];
              if (
                other.id === groundApproachId ||
                other.id === footId ||
                other.id === topId ||
                other.id === roofId
              )
                continue;
              const distGround = Math.hypot(other.x - groundApproachNode.x, other.z - groundApproachNode.z);
              if (distGround <= 3.5 && Math.abs(other.y - groundApproachNode.y) <= 1.5) {
                const midX = (other.x + groundApproachNode.x) / 2;
                const midZ = (other.z + groundApproachNode.z) / 2;
                const midY = (other.y + groundApproachNode.y) / 2;
                if (!isPositionBlocked(midX, midY, midZ, collisionGrid, 0.25)) {
                  this.edges.get(other.id)?.push({ target: groundApproachNode, type: 'walk', cost: distGround });
                  this.edges.get(groundApproachId)!.push({ target: other, type: 'walk', cost: distGround });
                }
              }
            }
          }

          const rBucket = this.gridBuckets.get((roofNode.gx + dx) * 1000 + (roofNode.gz + dz));
          if (rBucket) {
            for (let i = 0; i < rBucket.length; i++) {
              const other = rBucket[i];
              if (
                other.id === groundApproachId ||
                other.id === footId ||
                other.id === topId ||
                other.id === roofId
              )
                continue;
              const distRoof = Math.hypot(other.x - roofNode.x, other.z - roofNode.z);
              if (distRoof <= 3.5 && Math.abs(other.y - roofNode.y) <= 1.5) {
                const midX = (other.x + roofNode.x) / 2;
                const midZ = (other.z + roofNode.z) / 2;
                const midY = (other.y + roofNode.y) / 2;
                if (!isPositionBlocked(midX, midY, midZ, collisionGrid, 0.25)) {
                  this.edges.get(other.id)?.push({ target: roofNode, type: 'walk', cost: distRoof });
                  this.edges.get(roofId)!.push({ target: other, type: 'walk', cost: distRoof });
                }
              }
            }
          }
        }
      }
    });

    // 3. Establish jump connections across gaps between buildings and across rivers/water channels
    this.nodes.forEach((node) => {
      // Jump from elevated positions (roofs / ledges) or from dry land across rivers/water gaps
      if (node.isWater) return;

      const edgeList = this.edges.get(node.id)!;
      const jumpRadius = 8; // Max grid distance for jumps

      for (let dx = -jumpRadius; dx <= jumpRadius; dx++) {
        for (let dz = -jumpRadius; dz <= jumpRadius; dz++) {
          if (dx === 0 && dz === 0) continue;
          const targetBucket = this.gridBuckets.get((node.gx + dx) * 1000 + (node.gz + dz));
          if (!targetBucket) continue;

          for (let i = 0; i < targetBucket.length; i++) {
            const other = targetBucket[i];
            if (other.id === node.id || other.isWater) continue;

            const ddx = other.x - node.x;
            const ddz = other.z - node.z;
            const distXZ = Math.sqrt(ddx * ddx + ddz * ddz);
            const heightDiff = other.y - node.y;

            // Enforce maximum safe physical jump limit calculated from gravity, jump velocity, and sprint speed
            const maxAchievableDist = calculateMaxJumpDistance(heightDiff);
            if (distXZ < 1.4 || distXZ > maxAchievableDist) continue;
            if (heightDiff > 2.0 || heightDiff < -4.0) continue;

            // If they are directly walkable on flat terrain with no gap or water, prefer normal walking edges
            if (Math.abs(heightDiff) <= 0.6 && this.isDirectWalkable(node, other, collisionGrid)) {
              continue;
            }

            // Check clear air trajectory between node and other
            const steps = Math.max(3, Math.ceil(distXZ / 0.7));
            let trajectoryBlocked = false;

            for (let s = 1; s < steps; s++) {
              const t = s / steps;
              const px = node.x + ddx * t;
              const pz = node.z + ddz * t;
              const arcY = Math.max(node.y, other.y) + Math.sin(t * Math.PI) * 1.0;

              if (isPositionBlocked(px, arcY, pz, collisionGrid, PLAYER_RADIUS - 0.15)) {
                trajectoryBlocked = true;
                break;
              }
            }

            if (!trajectoryBlocked) {
              node.isEdge = true;
              other.isEdge = true;
              const cost = distXZ * 1.1 + 1.5;
              edgeList.push({ target: other, type: 'jump', cost });
            }
          }
        }
      }
    });
  }

  /**
   * Helper to get the EdgeType connecting two nodes, if any exists.
   */
  public getEdgeType(from: NavNode, to: NavNode): EdgeType | null {
    const edges = this.edges.get(from.id);
    if (!edges) return null;
    const edge = edges.find((e) => e.target.id === to.id);
    return edge ? edge.type : null;
  }

  /**
   * Calculates the total navigation cost/distance of a path from a given starting position.
   */
  public calculatePathCost(
    startPos: { x: number; y: number; z: number },
    nodes: { x: number; y: number; z: number; edgeType?: EdgeType | null; id?: string }[],
    startIndex: number = 0,
  ): number {
    if (!nodes || nodes.length === 0 || startIndex >= nodes.length) return 0;

    let totalCost = 0;
    let prev = startPos;

    for (let i = startIndex; i < nodes.length; i++) {
      const curr = nodes[i];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dz = curr.z - prev.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      let stepCost = dist + Math.abs(dy);

      const edgeType = curr.edgeType;
      if (edgeType === 'climb') {
        stepCost += 16.0 + Math.abs(dy) * 4.0;
      } else if (edgeType === 'ladder') {
        stepCost += 10.0 + Math.abs(dy) * 2.5;
      } else if (edgeType === 'jump') {
        stepCost += dist * 1.1 + 2.0;
      } else if (edgeType === 'drop') {
        stepCost += Math.abs(dy) * 0.2;
      }

      totalCost += stepCost;
      prev = curr;
    }

    return totalCost;
  }

  /**
   * Finds the nearest ladder zone associated with a given building position (e.g. a rooftop node or building coordinate).
   */
  public findLadderForBuilding(
    pos: { x: number; y: number; z: number },
    maxDistance: number = 25.0,
  ): {
    zone: {
      minX: number;
      minY: number;
      minZ: number;
      maxX: number;
      maxY: number;
      maxZ: number;
      faceAngle: number;
      railX: number;
      railZ: number;
    };
    index: number;
    groundNode: NavNode | null;
    footNode: NavNode | null;
    topNode: NavNode | null;
    roofNode: NavNode | null;
  } | null {
    if (!this.ladderZones || this.ladderZones.length === 0) return null;

    let bestZone: any = null;
    let bestIndex = -1;
    let bestDist = Infinity;

    for (let i = 0; i < this.ladderZones.length; i++) {
      const zone = this.ladderZones[i];
      // Check height compatibility (the ladder reaches near the target height or covers its ascent)
      const heightMatch = Math.abs(pos.y - zone.maxY) <= 2.0 || (pos.y >= zone.minY && pos.y <= zone.maxY + 1.5);
      if (!heightMatch && pos.y >= 2.0) continue;

      const dist = Math.hypot(pos.x - zone.railX, pos.z - zone.railZ);
      if (dist < bestDist && dist <= maxDistance) {
        bestDist = dist;
        bestZone = zone;
        bestIndex = i;
      }
    }

    if (!bestZone || bestIndex === -1) return null;

    return {
      zone: bestZone,
      index: bestIndex,
      groundNode: this.nodes.get(`ladder_ground_${bestIndex}`) || null,
      footNode: this.nodes.get(`ladder_foot_${bestIndex}`) || null,
      topNode: this.nodes.get(`ladder_top_${bestIndex}`) || null,
      roofNode: this.nodes.get(`ladder_roof_${bestIndex}`) || null,
    };
  }

  /**
   * Find the closest node in the navigation graph to a 3D world position.
   */
  public findClosestNode(pos: THREE.Vector3): NavNode | null {
    let closest: NavNode | null = null;
    let minDist = Infinity;

    // Fast grid lookup first
    const gx = worldToIndex(pos.x, this.halfSize, this.worldSize);
    const gz = worldToIndex(pos.z, this.halfSize, this.worldSize);

    const scratchP = new THREE.Vector3();
    const scratchN = new THREE.Vector3();

    // Ring search around lookup cell (up to 8 cells distance in O(1))
    for (let r = 0; r <= 8; r++) {
      let foundInRing = false;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = gx + dx;
          const cz = gz + dz;

          if (cx >= 0 && cx < this.worldSize && cz >= 0 && cz < this.worldSize) {
            const bucket = this.gridBuckets.get(cx * 1000 + cz);
            if (bucket) {
              for (let i = 0; i < bucket.length; i++) {
                const node = bucket[i];
                const dy = node.y - pos.y;
                const upPenalty = dy > 0.8 ? (dy > 2.0 ? dy * dy * 35.0 : dy * dy * 12.0) : 0;
                const yWeight = pos.y >= 2.0 ? 4.0 : 2.0;

                // Penalize nodes separated from pos by a building wall
                let losPenalty = 0;
                if (this.collisionGrid && Math.abs(dy) <= 1.0) {
                  scratchP.set(pos.x, pos.y + 0.5, pos.z);
                  scratchN.set(node.x, node.y + 0.5, node.z);
                  if (!checkLineOfSight(scratchP, scratchN, this.collisionGrid)) {
                    losPenalty = 2000.0;
                  }
                }

                const d = (pos.x - node.x) ** 2 + (pos.z - node.z) ** 2 + dy * dy * yWeight + upPenalty + losPenalty;
                if (d < minDist) {
                  minDist = d;
                  closest = node;
                  foundInRing = true;
                }
              }
            }
          }
        }
      }
      if (foundInRing && closest && minDist < 100.0) break;
    }

    // Fallback: fast scan on cached nodesArray if out of grid bounds
    if (!closest && this.nodesArray.length > 0) {
      for (let i = 0; i < this.nodesArray.length; i++) {
        const node = this.nodesArray[i];
        const dy = node.y - pos.y;
        const upPenalty = dy > 0.8 ? (dy > 2.0 ? dy * dy * 35.0 : dy * dy * 12.0) : 0;
        const yWeight = pos.y >= 2.0 ? 4.0 : 2.0;

        let losPenalty = 0;
        if (this.collisionGrid && Math.abs(dy) <= 1.0) {
          scratchP.set(pos.x, pos.y + 0.5, pos.z);
          scratchN.set(node.x, node.y + 0.5, node.z);
          if (!checkLineOfSight(scratchP, scratchN, this.collisionGrid)) {
            losPenalty = 2000.0;
          }
        }

        const d = (pos.x - node.x) ** 2 + (pos.z - node.z) ** 2 + dy * dy * yWeight + upPenalty + losPenalty;
        if (d < minDist) {
          minDist = d;
          closest = node;
        }
      }
    }

    return closest;
  }

  /**
   * Runs A* algorithm to find the path from startPos to endPos.
   * Supports options to avoid/penalize specific nodes or add variation cost.
   * Returns an array of NavNodes representing the path, or null if no path is found.
   */
  public findPath(
    startPos: THREE.Vector3,
    endPos: THREE.Vector3,
    options?: {
      avoidNodeIds?: Set<string>;
      penalizedNodeIds?: Set<string>;
      variationCost?: number;
    },
  ): NavNode[] | null {
    const startNode = this.findClosestNode(startPos);
    const endNode = this.findClosestNode(endPos);

    if (!startNode || !endNode) return null;
    if (startNode.id === endNode.id) return [startNode];

    // Fast MinBinaryHeap Priority Queue for O(log N) extraction
    const openSet = new MinBinaryHeap<NavNode>();
    const closedSet = new Set<string>();
    const cameFrom: Map<string, NavNode> = new Map();

    const gScore: Map<string, number> = new Map();
    gScore.set(startNode.id, 0);

    const fScore: Map<string, number> = new Map();
    const initialF = startPos.distanceTo(endPos);
    fScore.set(startNode.id, initialF);

    openSet.push(startNode, initialF);

    let iterations = 0;
    const maxIterations = 6000;

    while (!openSet.isEmpty() && iterations < maxIterations) {
      iterations++;

      const current = openSet.pop()!;
      if (closedSet.has(current.id)) continue;
      closedSet.add(current.id);

      // Target reached! Reconstruct path.
      if (current.id === endNode.id) {
        const path: NavNode[] = [current];
        let currId = current.id;
        const visitedInPath = new Set<string>([currId]);
        while (cameFrom.has(currId)) {
          const parent = cameFrom.get(currId)!;
          if (visitedInPath.has(parent.id)) {
            break; // Prevent infinite cycle
          }
          visitedInPath.add(parent.id);
          path.unshift(parent);
          currId = parent.id;
        }

        // Strict Accessibility Validation:
        // 1. Objects and surfaces with height difference <= 1 floor (<= MAX_SCALABLE_HEIGHT) are scalable via wall vault/climb.
        // 2. Vertical steps > 1 floor (> MAX_SCALABLE_HEIGHT) are ONLY accessible via ladders or rooftop jumps.
        // 3. If any step scales > MAX_SCALABLE_HEIGHT without a ladder, discard route.
        for (let i = 0; i < path.length - 1; i++) {
          const fromNode = path[i];
          const toNode = path[i + 1];
          const edgeType = this.getEdgeType(fromNode, toNode);
          toNode.edgeType =
            edgeType ??
            (toNode.y < fromNode.y - 1.0
              ? 'drop'
              : toNode.y > fromNode.y + CLIMB_THRESHOLD
                ? 'climb'
                : 'walk');
          const heightDiff = toNode.y - fromNode.y;

          // Scaling higher than 1-story step height without a ladder is prohibited
          if (heightDiff > MAX_SCALABLE_HEIGHT && edgeType !== 'ladder') {
            return null; // Discard invalid route!
          }
        }

        return path;
      }

      const neighbors = this.edges.get(current.id) || [];
      for (let i = 0; i < neighbors.length; i++) {
        const edge = neighbors[i];
        const neighbor = edge.target;

        // Skip avoid nodes (except start and target end node)
        if (
          options?.avoidNodeIds &&
          options.avoidNodeIds.has(neighbor.id) &&
          neighbor.id !== endNode.id &&
          neighbor.id !== startNode.id
        ) {
          continue;
        }

        let edgeCost = edge.cost;
        if (options?.penalizedNodeIds && options.penalizedNodeIds.has(neighbor.id) && neighbor.id !== endNode.id) {
          edgeCost += 50.0;
        }
        if (options?.variationCost) {
          // Deterministic pseudo-random variation per node coordinate
          const h = (Math.sin(neighbor.x * 12.9898 + neighbor.z * 78.233) * 43758.5453) % 1;
          edgeCost += Math.abs(h) * options.variationCost;
        }

        const tentativeGScore = (gScore.get(current.id) ?? Infinity) + edgeCost;

        if (tentativeGScore < (gScore.get(neighbor.id) ?? Infinity)) {
          cameFrom.set(neighbor.id, current);
          gScore.set(neighbor.id, tentativeGScore);

          // Euclidean distance heuristic (admissible for shortest path)
          const dx = neighbor.x - endNode.x;
          const dy = neighbor.y - endNode.y;
          const dz = neighbor.z - endNode.z;
          const h = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const f = tentativeGScore + h;
          fScore.set(neighbor.id, f);

          openSet.push(neighbor, f);
        }
      }
    }

    // Path not found or iteration limit reached
    return null;
  }

  /**
   * Checks if a straight-line corridor between two positions on flat/walkable terrain
   * is free of collision obstacles and within map boundaries.
   */
  public isDirectWalkable(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    collisionGrid: SpatialHashGrid,
    clearanceRadius: number = PLAYER_RADIUS + 0.05,
  ): boolean {
    // If height difference is too large, direct flat walking is not possible
    if (Math.abs(from.y - to.y) > 0.8) return false;

    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) return true;

    // 1. Raycast Line of Sight check at torso and knee height to detect any intersecting building boxes or fences
    const startEye = new THREE.Vector3(from.x, from.y + 1.2, from.z);
    const endEye = new THREE.Vector3(to.x, to.y + 1.2, to.z);
    if (!checkLineOfSight(startEye, endEye, collisionGrid)) {
      return false; // Obstacle or building blocks direct line of sight!
    }

    const startKnee = new THREE.Vector3(from.x, from.y + 0.4, from.z);
    const endKnee = new THREE.Vector3(to.x, to.y + 0.4, to.z);
    if (!checkLineOfSight(startKnee, endKnee, collisionGrid)) {
      return false; // Low obstacle blocks direct line of sight!
    }

    // 2. Fine-grained step corridor check (every 0.25m)
    const stepSize = 0.25;
    const steps = Math.ceil(dist / stepSize);
    const borderMargin = PLAYER_RADIUS - 0.35;

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = from.x + dx * t;
      const pz = from.z + dz * t;
      const py = from.y;

      // Check boundary bounds
      if (
        px < -this.halfSize + borderMargin ||
        px > this.halfSize - borderMargin ||
        pz < -this.halfSize + borderMargin ||
        pz > this.halfSize - borderMargin
      ) {
        return false;
      }

      // Check building grid (bGrid) footprint
      const ix = worldToIndex(px, this.halfSize, this.worldSize);
      const iz = worldToIndex(pz, this.halfSize, this.worldSize);
      if (this.bGrid && this.bGrid[ix]?.[iz] !== undefined && this.bGrid[ix][iz] > 0.5) {
        if (py < this.bGrid[ix][iz] - 0.1) {
          return false; // Point intersects building footprint!
        }
      }

      // Check obstacle collisions with player clearance to prevent corner clipping
      if (isPositionBlocked(px, py, pz, collisionGrid, clearanceRadius)) {
        return false;
      }

      // Check solid ground support if elevated above ground level
      if (py > 0.5) {
        const floorH = getTerrainHeight(
          px,
          pz,
          py,
          collisionGrid,
          this.bGrid,
          this.wGrid,
          this.worldSize,
          0.6,
        );
        if (Math.abs(floorH - py) > 0.6) {
          return false; // Gap or drop detected!
        }
      } else if (from.y >= -0.5 && to.y >= -0.5) {
        // Ground-level check: if walking between dry land points, any water cell is a water gap / river
        if (this.wGrid && this.wGrid[ix]?.[iz] === 1) {
          return false; // Water channel / river detected along ground path!
        }
      }
    }

    return true;
  }

  /**
   * Smooths an A* path (String Pulling) by merging consecutive collinear/direct walkable
   * nodes on the same height, while strictly preserving action nodes (jumps, ladders, climbs).
   */
  public smoothPath(path: NavNode[], collisionGrid: SpatialHashGrid): NavNode[] {
    if (path.length <= 2) return path;

    const smoothed: NavNode[] = [path[0]];
    let currIdx = 0;

    while (currIdx < path.length - 1) {
      let furthestIdx = currIdx + 1;

      // Look ahead up to 8 nodes to find the furthest directly walkable node across open space
      const maxLookahead = Math.min(path.length - 1, currIdx + 8);
      for (let nextIdx = maxLookahead; nextIdx > currIdx + 1; nextIdx--) {
        // Stop lookahead if there is a special transition (jump, ladder, climb, drop)
        let hasSpecialTransition = false;
        for (let k = currIdx; k < nextIdx; k++) {
          const edgeType = this.getEdgeType(path[k], path[k + 1]);
          const heightDiff = Math.abs(path[k].y - path[k + 1].y);
          if (
            (edgeType && edgeType !== 'walk') ||
            heightDiff > CLIMB_THRESHOLD ||
            path[k].id.includes('ladder') ||
            path[k + 1].id.includes('ladder')
          ) {
            hasSpecialTransition = true;
            break;
          }
        }
        if (!hasSpecialTransition && this.isDirectWalkable(path[currIdx], path[nextIdx], collisionGrid)) {
          furthestIdx = nextIdx;
          break;
        }
      }

      const nextNode = { ...path[furthestIdx] };
      nextNode.edgeType =
        path[furthestIdx].edgeType ??
        this.getEdgeType(path[currIdx], path[furthestIdx]) ??
        (nextNode.y < path[currIdx].y - 1.0
          ? 'drop'
          : nextNode.y > path[currIdx].y + CLIMB_THRESHOLD
            ? 'climb'
            : 'walk');
      smoothed.push(nextNode);
      currIdx = furthestIdx;
    }

    return smoothed;
  }

  /**
   * Evaluates and selects the best hiding spot for a Hider AI based on:
   * 1. Distance from seeker (further is safer)
   * 2. Line of sight blockage (breaking LOS gives huge bonus)
   * 3. Elevation & rooftop cover
   * 4. Escape safety (not trapped in corners)
   */
  public evaluateHidingSpots(
    seekerPos: THREE.Vector3,
    currentAiPos: THREE.Vector3,
    collisionGrid: SpatialHashGrid,
  ): NavNode | null {
    if (this.nodes.size === 0) return null;

    // Fast pass 1: Score all nodes geometrically without expensive raycasting
    const candidates: { node: NavNode; initialScore: number }[] = [];

    this.nodes.forEach((node) => {
      const distToSeeker = Math.hypot(node.x - seekerPos.x, node.z - seekerPos.z);
      if (distToSeeker < 6.0) return;

      const distToAi = Math.hypot(node.x - currentAiPos.x, node.z - currentAiPos.z);

      let score = 0;
      score += Math.min(distToSeeker, 40.0) * 4.0;
      score -= distToAi * 0.35;

      if (node.y >= 2.5) score += 30.0;
      if (node.isCorner) score += 20.0;
      if (node.isWater) score -= 40.0;

      const distToBorder = Math.min(
        this.halfSize - Math.abs(node.x),
        this.halfSize - Math.abs(node.z),
      );
      if (distToBorder < 2.5) score -= 30.0;

      candidates.push({ node, initialScore: score });
    });

    if (candidates.length === 0) return null;

    // Sort to get the top 24 best candidates
    candidates.sort((a, b) => b.initialScore - a.initialScore);
    const topCandidates = candidates.slice(0, 24);

    // Fast pass 2: Run Line of Sight check ONLY on top candidates
    const seekerEye = new THREE.Vector3(seekerPos.x, seekerPos.y + 1.5, seekerPos.z);
    let bestNode: NavNode | null = topCandidates[0].node;
    let highestFinalScore = -Infinity;

    for (let i = 0; i < topCandidates.length; i++) {
      const { node, initialScore } = topCandidates[i];
      const nodeEye = new THREE.Vector3(node.x, node.y + 1.0, node.z);
      const hasLOS = checkLineOfSight(seekerEye, nodeEye, collisionGrid);

      const finalScore = initialScore + (!hasLOS ? 120.0 : -80.0);
      if (finalScore > highestFinalScore) {
        highestFinalScore = finalScore;
        bestNode = node;
      }
    }

    return bestNode;
  }

  /**
   * Selects strategic search targets / vantage points for a Seeker AI:
   * 1. If searching near last known position: looks for elevated rooftop vantage points with LOS towards the spot
   * 2. If scouting/patrolling: prioritizes elevated vantage points across unvisited quadrants
   */
  public findStrategicVantageTarget(
    currentPos: THREE.Vector3,
    lastKnownPos: THREE.Vector3 | null,
    visitedQuadrants: Set<number>,
    collisionGrid: SpatialHashGrid,
  ): NavNode | null {
    if (this.nodes.size === 0) return null;

    // Helper for quadrant
    const getQuad = (x: number, z: number): number => {
      if (x >= 0 && z >= 0) return 1;
      if (x < 0 && z >= 0) return 2;
      if (x < 0 && z < 0) return 3;
      return 4;
    };

    if (lastKnownPos) {
      const candidates: { node: NavNode; score: number }[] = [];
      this.nodes.forEach((node) => {
        const distToLast = Math.hypot(node.x - lastKnownPos.x, node.z - lastKnownPos.z);
        if (distToLast < 2.0 || distToLast > 22.0) return;

        let score = 0;
        if (node.y >= 2.5) score += 30.0 + node.y * 2.0;
        score -= Math.hypot(node.x - currentPos.x, node.z - currentPos.z) * 0.5;
        candidates.push({ node, score });
      });

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const top = candidates.slice(0, 8);
        const targetEye = new THREE.Vector3(lastKnownPos.x, lastKnownPos.y + 1.0, lastKnownPos.z);

        let bestNode: NavNode | null = top[0].node;
        let highest = -Infinity;
        for (const item of top) {
          const nodeEye = new THREE.Vector3(item.node.x, item.node.y + 1.5, item.node.z);
          const hasLOS = checkLineOfSight(nodeEye, targetEye, collisionGrid);
          const finalScore = item.score + (hasLOS ? 50.0 : 0);
          if (finalScore > highest) {
            highest = finalScore;
            bestNode = item.node;
          }
        }
        return bestNode;
      }
    }

    // General patrol/scout search: pure mathematical scoring (zero raycasts!)
    let bestPatrolNode: NavNode | null = null;
    let highestPatrolScore = -Infinity;

    this.nodes.forEach((node) => {
      const edges = this.edges.get(node.id);
      if (!edges || edges.length === 0) return;

      const distToCurr = Math.hypot(node.x - currentPos.x, node.z - currentPos.z);
      if (distToCurr < 6.0) return;

      const quad = getQuad(node.x, node.z);
      let score = 0;

      if (!visitedQuadrants.has(quad)) {
        score += 50.0;
      }

      // Balance between elevated vantage points and ground-level hiding spots/corners
      if (node.y >= 2.5) {
        score += 30.0 + node.y * 2.0;
      } else if (node.isCorner) {
        score += 35.0; // Check corners and alleys on the ground
      }

      score += Math.min(distToCurr, 25.0);
      if (node.isWater) score -= 40.0;

      if (score > highestPatrolScore) {
        highestPatrolScore = score;
        bestPatrolNode = node;
      }
    });

    return bestPatrolNode;
  }

  /**
   * Finds a guaranteed reachable patrol target across quadrants and returns both
   * the target node and the precomputed smoothed path.
   */
  public findReachablePatrolTarget(
    currentPos: THREE.Vector3,
    visitedQuadrants: Set<number>,
    collisionGrid: SpatialHashGrid,
  ): { target: NavNode; path: NavNode[] } | null {
    if (this.nodes.size === 0) return null;

    const getQuad = (x: number, z: number): number => {
      if (x >= 0 && z >= 0) return 1;
      if (x < 0 && z >= 0) return 2;
      if (x < 0 && z < 0) return 3;
      return 4;
    };

    const candidates: { node: NavNode; score: number }[] = [];

    this.nodes.forEach((node) => {
      const edges = this.edges.get(node.id);
      if (!edges || edges.length === 0) return;
      if (node.isWater) return;

      const distToCurr = Math.hypot(node.x - currentPos.x, node.z - currentPos.z);
      if (distToCurr < 6.0) return;

      const quad = getQuad(node.x, node.z);
      let score = 0;

      if (!visitedQuadrants.has(quad)) {
        score += 60.0;
      }

      // High priority for street corners, alleys, and ground covers where players hide
      if (node.isCorner) score += 35.0;
      if (node.y < 2.0) score += 20.0;
      if (node.y >= 2.5) score += 15.0;

      score += Math.min(distToCurr, 25.0);

      candidates.push({ node, score });
    });

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score);

    // Test reachable path on top candidate nodes
    const topCandidates = candidates.slice(0, 12);
    for (let i = 0; i < topCandidates.length; i++) {
      const candidate = topCandidates[i].node;
      const targetPos = new THREE.Vector3(candidate.x, candidate.y, candidate.z);
      const rawPath = this.findPath(currentPos, targetPos);
      if (rawPath && rawPath.length > 1) {
        const smoothedPath = this.smoothPath(rawPath, collisionGrid);
        return { target: candidate, path: smoothedPath };
      }
    }

    return null;
  }

  /**
   * Finds the best nearby hiding spots / corners to search when investigating
   * an area where visual contact was lost or noise was heard.
   */
  public findNearbySearchSpots(
    searchOrigin: THREE.Vector3,
    minRadius: number = 3.0,
    maxRadius: number = 18.0,
    excludeNodeIds?: Set<string>,
  ): NavNode[] {
    if (this.nodes.size === 0) return [];

    const candidates: { node: NavNode; score: number }[] = [];

    this.nodes.forEach((node) => {
      if (excludeNodeIds && excludeNodeIds.has(node.id)) return;
      if (node.isWater) return;
      const edges = this.edges.get(node.id);
      if (!edges || edges.length === 0) return;

      const dist = Math.hypot(node.x - searchOrigin.x, node.z - searchOrigin.z);
      if (dist < minRadius || dist > maxRadius) return;

      let score = 0;
      // High score for corners, covers, and elevated perches
      if (node.isCorner) score += 40.0;
      if (node.y >= 2.0) score += 25.0;

      // Distance score: prefer moderate distances (5m - 14m)
      score += (1.0 - Math.abs(dist - 8.0) / maxRadius) * 20.0;

      candidates.push({ node, score });
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 4).map((c) => c.node);
  }
}
