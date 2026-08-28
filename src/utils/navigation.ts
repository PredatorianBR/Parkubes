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

export class NavigationGraph {
  public nodes: Map<string, NavNode> = new Map();
  public edges: Map<string, NavEdge[]> = new Map();
  private gridBuckets: Map<number, NavNode[]> = new Map();
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

    this.buildNodes(mapData);
    this.buildEdges(mapData);
  }

  private buildNodes(mapData: {
    collisionGrid: SpatialHashGrid;
    bGrid: number[][];
    wGrid: number[][];
    ladderZones?: { minX: number; minZ: number; maxX: number; maxZ: number; minY: number; maxY: number }[];
  }) {
    const { collisionGrid, bGrid, wGrid, ladderZones } = mapData;

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
            
            // All building rooftops (low buildings, highrises, factories) can be accessible standable nodes
            const allowRooftop = topY >= 2.0;

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

          // Check if position itself is inside or overlapping any building structure
          const checkBoxes = collisionGrid.query(worldX, worldZ, PLAYER_RADIUS);
          let isInsideBuilding = false;

          for (const box of checkBoxes) {
            // Check if Y height is below the building top (inside building interior/ground footprint)
            if (
              y < box.maxY - 0.1 &&
              worldX >= box.minX - 0.1 &&
              worldX <= box.maxX + 0.1 &&
              worldZ >= box.minZ - 0.1 &&
              worldZ <= box.maxZ + 0.1
            ) {
              isInsideBuilding = true;
              break;
            }
          }

          if (isInsideBuilding) {
            return; // Skip node inside building interior!
          }

          // Check if position itself is blocked (clearance of 0.25m so nodes adjacent to wall faces are preserved)
          if (!isPositionBlocked(worldX, y, worldZ, collisionGrid, 0.25)) {
            const isWaterVal = wGrid[gx]?.[gz] === 1 && y < 0;
            const id = `${gx},${gz},${y.toFixed(2)}`;

            // Clamp node world coordinates so they remain physically reachable by the AI
            const reachMin = -this.halfSize + PLAYER_RADIUS + 0.12;
            const reachMax = this.halfSize - PLAYER_RADIUS - 0.12;
            const nodeX = Math.max(reachMin, Math.min(reachMax, worldX));
            const nodeZ = Math.max(reachMin, Math.min(reachMax, worldZ));

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
        this.nodes.forEach((other) => {
          if (other.gx === ngx && other.gz === ngz && Math.abs(other.y - node.y) < 1.5) {
            foundNeighbor = true;
          }
        });

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

    // 1. Establish grid-adjacent edges (Walk, Climb, Drop)
    this.nodes.forEach((node) => {
      const edgeList = this.edges.get(node.id)!;

      neighborsOffsets.forEach(([dx, dz]) => {
        const ngx = node.gx + dx;
        const ngz = node.gz + dz;

        // Query all nodes at the neighbor grid cell
        this.nodes.forEach((other) => {
          if (other.gx !== ngx || other.gz !== ngz) return;

          const heightDiff = other.y - node.y;

          // Transition Type Evaluation
          if (Math.abs(heightDiff) <= CLIMB_THRESHOLD) {
            // WALKING transition
            // Check if path is horizontally blocked by a wall between node and other
            const midX = (node.x + other.x) / 2;
            const midZ = (node.z + other.z) / 2;
            const midY = (node.y + other.y) / 2;

            if (!isPositionBlocked(midX, midY, midZ, collisionGrid, 0.25)) {
              const dist = Math.sqrt((node.x - other.x) ** 2 + (node.z - other.z) ** 2);
              let cost = dist;

              // Water traversal penalty
              if (other.isWater) cost += dist * 1.5;

              edgeList.push({ target: other, type: 'walk', cost });
            }
          } else if (heightDiff > CLIMB_THRESHOLD && heightDiff <= MAX_SCALABLE_HEIGHT) {
            // CLIMBING transition (only 1-story buildings <= MAX_SCALABLE_HEIGHT or low obstacles are scalable without a ladder)
            // Make sure we have a clear path to the destination ledge
            if (!isPositionBlocked(other.x, other.y, other.z, collisionGrid, 0.25)) {
              const dCellX = Math.abs(node.gx - other.gx);
              const dCellZ = Math.abs(node.gz - other.gz);
              const isDiagonal = dCellX > 0 && dCellZ > 0;
              const dist =
                Math.sqrt((node.x - other.x) ** 2 + (node.z - other.z) ** 2) + heightDiff;
              // Climb penalty so AI will use walkways/ladders when available instead of scaling walls.
              // Heavily penalize diagonal corner climbs (+15.0) so straight-line wall face climbing is always preferred.
              const diagonalPenalty = isDiagonal ? 15.0 : 0;
              const cost = dist + (heightDiff <= 2.8 ? 10.0 : 25.0) + diagonalPenalty;
              edgeList.push({ target: other, type: 'climb', cost });
            }
          } else if (heightDiff < -CLIMB_THRESHOLD) {
            // DROPPING transition: connect directly to adjacent lower node without any checks
            const dCellX = Math.abs(node.gx - other.gx);
            const dCellZ = Math.abs(node.gz - other.gz);
            const isDiagonal = dCellX > 0 && dCellZ > 0;
            const horizDist = Math.hypot(node.x - other.x, node.z - other.z);
            // Straight direct drops have lowest cost; diagonal drops have penalty
            const cost = horizDist + Math.abs(heightDiff) * 0.15 + (isDiagonal ? 10.0 : 0);
            edgeList.push({ target: other, type: 'drop', cost });
          }
        });
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
      // topNode and roofNode should be on the roof platform (forward into the roof in direction of faceAngle).
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
      // Fast and reliable ladder slide down cost
      const slideCost = heightDiff * 0.8 + 1.0;

      this.edges.get(footId)!.push({ target: topNode, type: 'ladder', cost: climbCost });
      this.edges.get(topId)!.push({ target: footNode, type: 'ladder', cost: slideCost });

      // Connect topNode to roofNode bi-directionally (mount/dismount from/to roof)
      this.edges.get(topId)!.push({ target: roofNode, type: 'walk', cost: 1.0 });
      this.edges.get(roofId)!.push({ target: topNode, type: 'walk', cost: 1.0 });

      // Connect groundApproachNode and roofNode to nearby ground/roof walking nodes
      this.nodes.forEach((other) => {
        if (
          other.id === groundApproachId ||
          other.id === footId ||
          other.id === topId ||
          other.id === roofId
        )
          return;

        const distGround = Math.hypot(other.x - groundApproachNode.x, other.z - groundApproachNode.z);
        if (distGround <= 3.5 && Math.abs(other.y - groundApproachNode.y) <= 1.5) {
          this.edges.get(other.id)?.push({ target: groundApproachNode, type: 'walk', cost: distGround });
          this.edges.get(groundApproachId)!.push({ target: other, type: 'walk', cost: distGround });
        }

        const distRoof = Math.hypot(other.x - roofNode.x, other.z - roofNode.z);
        if (distRoof <= 3.5 && Math.abs(other.y - roofNode.y) <= 1.5) {
          this.edges.get(other.id)?.push({ target: roofNode, type: 'walk', cost: distRoof });
          this.edges.get(roofId)!.push({ target: other, type: 'walk', cost: distRoof });
        }
      });
    });

    // 3. Establish rooftop jump connections across gaps between buildings
    this.nodes.forEach((node) => {
      // Only jump from elevated positions (roofs / elevated ledges)
      if (node.y < 2.5) return;

      const edgeList = this.edges.get(node.id)!;

      this.nodes.forEach((other) => {
        if (other.id === node.id) return;
        // Jump target must also be an elevated position or roof platform
        if (other.y < 2.0) return;

        const dx = other.x - node.x;
        const dz = other.z - node.z;
        const distXZ = Math.sqrt(dx * dx + dz * dz);
        const heightDiff = other.y - node.y;

        // Max realistic horizontal jump distance calculation:
        // Peak jump distance is achievable when target is same or lower height
        // Upward jump with ledge grab (+2.5m max height reach): max ~5.5m gap
        // Flat/Downward jump (0m to -4.0m): max ~7.5m gap
        const maxAchievableDist = heightDiff > 0 ? 5.5 - heightDiff * 0.8 : 7.5;

        if (distXZ < 1.6 || distXZ > maxAchievableDist) return;

        // Max upward jump with ledge grab: +2.5m (jump height + ledge grab reach)
        // Max downward jump: -4.0m (roof to lower roof)
        if (heightDiff > 2.5 || heightDiff < -4.0) return;

        // Check clear air trajectory between node and other
        const steps = Math.max(3, Math.ceil(distXZ / 0.7));
        let trajectoryBlocked = false;

        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const px = node.x + dx * t;
          const pz = node.z + dz * t;
          // Calculate height arc (parabolic jump curve, peak near middle)
          const arcY = Math.max(node.y, other.y) + Math.sin(t * Math.PI) * 1.0;

          if (isPositionBlocked(px, arcY, pz, collisionGrid, PLAYER_RADIUS - 0.15)) {
            trajectoryBlocked = true;
            break;
          }
        }

        if (!trajectoryBlocked) {
          // Verify both takeoff and landing positions are at/near building ledges or rooftop edges
          // Mark takeoff and landing nodes as edges so they visual/logical edge nodes
          node.isEdge = true;
          other.isEdge = true;

          // Jump cost: distXZ * 1.1 + 2.0 penalty
          // Ground drop + walk + climb back up costs 25+, so jump is heavily favored
          const cost = distXZ * 1.1 + 2.0;
          edgeList.push({ target: other, type: 'jump', cost });
        }
      });
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
   * Find the closest node in the navigation graph to a 3D world position.
   */
  public findClosestNode(pos: THREE.Vector3): NavNode | null {
    let closest: NavNode | null = null;
    let minDist = Infinity;

    // Fast grid lookup first
    const gx = worldToIndex(pos.x, this.halfSize, this.worldSize);
    const gz = worldToIndex(pos.z, this.halfSize, this.worldSize);

    // Scan nearby grid cells (5x5 search window around the lookup cell)
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const cx = gx + dx;
        const cz = gz + dz;

        if (cx >= 0 && cx < this.worldSize && cz >= 0 && cz < this.worldSize) {
          const bucket = this.gridBuckets.get(cx * 1000 + cz);
          if (bucket) {
            for (let i = 0; i < bucket.length; i++) {
              const node = bucket[i];
              const dy = pos.y - node.y;
              const yWeight = pos.y >= 2.0 ? 4.0 : 1.0;
              const d = (pos.x - node.x) ** 2 + (pos.z - node.z) ** 2 + dy * dy * yWeight;
              if (d < minDist) {
                minDist = d;
                closest = node;
              }
            }
          }
        }
      }
    }

    // Fallback: full scan if lookup failed (e.g. out of grid bounds)
    if (!closest) {
      this.nodes.forEach((node) => {
        const dy = pos.y - node.y;
        const yWeight = pos.y >= 2.0 ? 4.0 : 1.0;
        const d = (pos.x - node.x) ** 2 + (pos.z - node.z) ** 2 + dy * dy * yWeight;
        if (d < minDist) {
          minDist = d;
          closest = node;
        }
      });
    }

    return closest;
  }

  /**
   * Runs A* algorithm to find the path from startPos to endPos.
   * Returns an array of NavNodes representing the path, or null if no path is found.
   */
  public findPath(startPos: THREE.Vector3, endPos: THREE.Vector3): NavNode[] | null {
    const startNode = this.findClosestNode(startPos);
    const endNode = this.findClosestNode(endPos);

    if (!startNode || !endNode) return null;
    if (startNode.id === endNode.id) return [startNode];

    // A* open and closed sets
    const openSet: NavNode[] = [startNode];
    const openSetIds = new Set<string>([startNode.id]);
    const closedSet = new Set<string>();
    const cameFrom: Map<string, NavNode> = new Map();

    const gScore: Map<string, number> = new Map();
    gScore.set(startNode.id, 0);

    const fScore: Map<string, number> = new Map();
    fScore.set(startNode.id, startPos.distanceTo(endPos));

    let iterations = 0;
    const maxIterations = 3000;

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;

      // Fast min-fScore search without array allocations or sorting
      let lowestIdx = 0;
      let lowestF = fScore.get(openSet[0].id) ?? Infinity;
      for (let i = 1; i < openSet.length; i++) {
        const f = fScore.get(openSet[i].id) ?? Infinity;
        if (f < lowestF) {
          lowestF = f;
          lowestIdx = i;
        }
      }

      const current = openSet[lowestIdx];
      // Fast swap and pop to remove current in O(1)
      openSet[lowestIdx] = openSet[openSet.length - 1];
      openSet.pop();
      openSetIds.delete(current.id);
      closedSet.add(current.id);

      // Target reached! Reconstruct path.
      if (current.id === endNode.id) {
        const path: NavNode[] = [current];
        let currId = current.id;
        while (cameFrom.has(currId)) {
          const parent = cameFrom.get(currId)!;
          path.unshift(parent);
          currId = parent.id;
        }

        // Strict Accessibility Validation:
        // 1. Buildings <= 1 floor (<= MAX_SCALABLE_HEIGHT) are scalable via wall vault/climb.
        // 2. Buildings > 1 floor (> MAX_SCALABLE_HEIGHT) are ONLY accessible via ladders or rooftop jumps.
        // 3. If any step scales > MAX_SCALABLE_HEIGHT without a ladder, or reaches an inaccessible node above that height, discard route.
        for (let i = 0; i < path.length - 1; i++) {
          const fromNode = path[i];
          const toNode = path[i + 1];
          const edgeType = this.getEdgeType(fromNode, toNode);
          const heightDiff = toNode.y - fromNode.y;

          // Wall climbing higher than 1-story building height is prohibited
          if (heightDiff > MAX_SCALABLE_HEIGHT && edgeType !== 'ladder') {
            return null; // Discard invalid route!
          }

          // Ascending to a height > MAX_SCALABLE_HEIGHT requires a ladder or jump
          if (
            toNode.y > MAX_SCALABLE_HEIGHT &&
            heightDiff > CLIMB_THRESHOLD &&
            edgeType !== 'ladder' &&
            edgeType !== 'jump'
          ) {
            return null; // Discard invalid route!
          }
        }

        return path;
      }

      const neighbors = this.edges.get(current.id) || [];
      for (let i = 0; i < neighbors.length; i++) {
        const edge = neighbors[i];
        const neighbor = edge.target;

        const tentativeGScore = (gScore.get(current.id) ?? Infinity) + edge.cost;

        if (tentativeGScore < (gScore.get(neighbor.id) ?? Infinity)) {
          cameFrom.set(neighbor.id, current);
          gScore.set(neighbor.id, tentativeGScore);

          // Euclidean distance heuristic
          const dx = neighbor.x - endNode.x;
          const dy = neighbor.y - endNode.y;
          const dz = neighbor.z - endNode.z;
          const h = Math.sqrt(dx * dx + dy * dy + dz * dz);
          fScore.set(neighbor.id, tentativeGScore + h);

          if (!openSetIds.has(neighbor.id)) {
            openSet.push(neighbor);
            openSetIds.add(neighbor.id);
          }
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
  ): boolean {
    // If height difference is too large, direct flat walking is not possible
    if (Math.abs(from.y - to.y) > 0.6) return false;

    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) return true;

    const stepSize = 0.6;
    const steps = Math.ceil(dist / stepSize);
    const borderMargin = PLAYER_RADIUS + 0.05;

    for (let s = 1; s <= steps; s++) {
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

      // Check obstacle collisions
      if (isPositionBlocked(px, py, pz, collisionGrid, 0.25)) {
        return false;
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

      // Look ahead to find the furthest directly walkable node across the open space
      const maxLookahead = path.length - 1;
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

      smoothed.push(path[furthestIdx]);
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
      if (distToSeeker < 5.0) return;

      const distToAi = Math.hypot(node.x - currentAiPos.x, node.z - currentAiPos.z);

      let score = 0;
      score += Math.min(distToSeeker, 35.0) * 3.0;
      score -= distToAi * 0.4;

      if (node.y >= 2.5) score += 25.0;
      if (node.isCorner) score += 15.0;
      if (node.isWater) score -= 40.0;

      const distToBorder = Math.min(
        this.halfSize - Math.abs(node.x),
        this.halfSize - Math.abs(node.z),
      );
      if (distToBorder < 2.5) score -= 30.0;

      candidates.push({ node, initialScore: score });
    });

    if (candidates.length === 0) return null;

    // Sort to get the top 12 best candidates
    candidates.sort((a, b) => b.initialScore - a.initialScore);
    const topCandidates = candidates.slice(0, 12);

    // Fast pass 2: Run Line of Sight check ONLY on the top 12 candidates
    const seekerEye = new THREE.Vector3(seekerPos.x, seekerPos.y + 1.5, seekerPos.z);
    let bestNode: NavNode | null = topCandidates[0].node;
    let highestFinalScore = -Infinity;

    for (let i = 0; i < topCandidates.length; i++) {
      const { node, initialScore } = topCandidates[i];
      const nodeEye = new THREE.Vector3(node.x, node.y + 1.0, node.z);
      const hasLOS = checkLineOfSight(seekerEye, nodeEye, collisionGrid);

      const finalScore = initialScore + (!hasLOS ? 70.0 : 0);
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
