import * as THREE from 'three';
import {
  worldToIndex,
  getTerrainHeight,
  getCeilingHeight,
  isPositionBlocked,
  SpatialHashGrid,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  CLIMB_THRESHOLD,
} from './physics';
import { VoxelObject } from '../types';

export type EdgeType = 'walk' | 'climb' | 'drop' | 'ladder';

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
  }) {
    const { collisionGrid, bGrid, wGrid } = mapData;

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

        // Add NavNode for each standable height found
        uniqueHeights.forEach((y) => {
          // Check if position is within reachable physics boundaries
          const borderMargin = PLAYER_RADIUS - 0.36;
          const minBound = -this.halfSize + borderMargin;
          const maxBound = this.halfSize - borderMargin;
          if (worldX < minBound || worldX > maxBound || worldZ < minBound || worldZ > maxBound) {
            return; // Out of bounds, cannot walk here
          }

          // Check if position itself is blocked (cylinder collision)
          if (!isPositionBlocked(worldX, y, worldZ, collisionGrid, PLAYER_RADIUS - 0.36)) {
            const isWaterVal = wGrid[gx]?.[gz] === 1 && y < 0;
            const id = `${gx},${gz},${y.toFixed(2)}`;

            this.nodes.set(id, {
              id,
              gx,
              gz,
              x: worldX,
              y,
              z: worldZ,
              isWater: isWaterVal,
              isCorner: false, // will compute next
              isEdge: false, // will compute next
            });
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

            if (!isPositionBlocked(midX, midY, midZ, collisionGrid, PLAYER_RADIUS - 0.36)) {
              const dist = Math.sqrt((node.x - other.x) ** 2 + (node.z - other.z) ** 2);
              let cost = dist;

              // Apply penalties for a smooth steering path
              if (other.isEdge) cost += 3.0; // avoid walking right next to rooftop dropoffs
              if (other.isWater) cost += dist * 1.5; // penalize water traversal (speed is 40%)

              edgeList.push({ target: other, type: 'walk', cost });
            }
          } else if (heightDiff > CLIMB_THRESHOLD && heightDiff <= PLAYER_HEIGHT) {
            // CLIMBING transition (climbing low obstacles / ledges)
            // Make sure we have a clear path to the ledge
            const midX = (node.x + other.x) / 2;
            const midZ = (node.z + other.z) / 2;
            // Check at destination height
            if (!isPositionBlocked(midX, other.y, midZ, collisionGrid, PLAYER_RADIUS - 0.36)) {
              const dist =
                Math.sqrt((node.x - other.x) ** 2 + (node.z - other.z) ** 2) + heightDiff;
              // Add extra cost penalty so the AI prefers flat ground but will climb if much shorter
              const cost = dist + 10.0;
              edgeList.push({ target: other, type: 'climb', cost });
            }
          } else if (heightDiff < -CLIMB_THRESHOLD && heightDiff >= -7.0) {
            // DROPPING transition (safe drops)
            const midX = (node.x + other.x) / 2;
            const midZ = (node.z + other.z) / 2;
            if (!isPositionBlocked(midX, node.y, midZ, collisionGrid, PLAYER_RADIUS - 0.36)) {
              const dist =
                Math.sqrt((node.x - other.x) ** 2 + (node.z - other.z) ** 2) + Math.abs(heightDiff);
              const cost = dist + 2.0; // minor penalty for dropping down
              edgeList.push({ target: other, type: 'drop', cost });
            }
          }
        });
      });
    });

    // 2. Establish ladder connections
    ladderZones.forEach((zone) => {
      const ladderNodes: NavNode[] = [];

      // Gather all nodes located near the ladder's XZ footprint
      const padX = 1.0;
      const padZ = 1.0;
      this.nodes.forEach((node) => {
        if (
          node.x >= zone.minX - padX &&
          node.x <= zone.maxX + padX &&
          node.z >= zone.minZ - padZ &&
          node.z <= zone.maxZ + padZ &&
          node.y >= zone.minY - 1.0 &&
          node.y <= zone.maxY + 2.0
        ) {
          ladderNodes.push(node);
        }
      });

      if (ladderNodes.length >= 2) {
        // Find node closest to the bottom of the ladder
        let bottomNode = ladderNodes[0];
        let topNode = ladderNodes[0];

        ladderNodes.forEach((node) => {
          if (node.y < bottomNode.y) bottomNode = node;
          if (node.y > topNode.y) topNode = node;
        });

        // Connect them via a ladder edge if they represent different heights
        if (topNode.y > bottomNode.y + 1.0) {
          const heightDiff = topNode.y - bottomNode.y;
          const ladderClimbCost = heightDiff * 2.0 + 8.0; // climbing takes some time

          const bottomEdges = this.edges.get(bottomNode.id)!;
          bottomEdges.push({
            target: topNode,
            type: 'ladder',
            cost: ladderClimbCost,
          });

          const topEdges = this.edges.get(topNode.id)!;
          topEdges.push({
            target: bottomNode,
            type: 'ladder',
            cost: heightDiff * 0.5 + 2.0, // sliding down is fast
          });
        }
      }
    });
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

    // Scan nearby grid cells (3x3 search window around the lookup cell)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = gx + dx;
        const cz = gz + dz;

        if (cx >= 0 && cx < this.worldSize && cz >= 0 && cz < this.worldSize) {
          this.nodes.forEach((node) => {
            if (node.gx === cx && node.gz === cz) {
              const d = pos.distanceTo(new THREE.Vector3(node.x, node.y, node.z));
              if (d < minDist) {
                minDist = d;
                closest = node;
              }
            }
          });
        }
      }
    }

    // Fallback: full scan if lookup failed (e.g. out of grid bounds)
    if (!closest) {
      this.nodes.forEach((node) => {
        const d = pos.distanceTo(new THREE.Vector3(node.x, node.y, node.z));
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
    const cameFrom: Map<string, NavNode> = new Map();

    const gScore: Map<string, number> = new Map();
    gScore.set(startNode.id, 0);

    const fScore: Map<string, number> = new Map();
    fScore.set(startNode.id, startPos.distanceTo(endPos));

    const nodePos = (n: NavNode) => new THREE.Vector3(n.x, n.y, n.z);

    while (openSet.length > 0) {
      // Sort open set to get node with lowest fScore (simple priority queue)
      openSet.sort((a, b) => (fScore.get(a.id) ?? Infinity) - (fScore.get(b.id) ?? Infinity));
      const current = openSet.shift()!;

      // Target reached! Reconstruct path.
      if (current.id === endNode.id) {
        const path: NavNode[] = [current];
        let currId = current.id;
        while (cameFrom.has(currId)) {
          const parent = cameFrom.get(currId)!;
          path.unshift(parent);
          currId = parent.id;
        }
        return path;
      }

      const neighbors = this.edges.get(current.id) || [];
      for (const edge of neighbors) {
        const neighbor = edge.target;
        const tentativeGScore = (gScore.get(current.id) ?? Infinity) + edge.cost;

        if (tentativeGScore < (gScore.get(neighbor.id) ?? Infinity)) {
          cameFrom.set(neighbor.id, current);
          gScore.set(neighbor.id, tentativeGScore);

          // fScore = gScore + Euclidean distance heuristic
          const h = nodePos(neighbor).distanceTo(nodePos(endNode));
          fScore.set(neighbor.id, tentativeGScore + h);

          if (!openSet.some((n) => n.id === neighbor.id)) {
            openSet.push(neighbor);
          }
        }
      }
    }

    // Path not found
    return null;
  }
}
