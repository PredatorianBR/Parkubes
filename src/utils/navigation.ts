
import * as THREE from 'three';
import { GRID_SCALE, worldToIndex } from './physics';

// Force rebuild
export function computeAIPath(
    start: THREE.Vector3,
    goal: THREE.Vector3,
    mapData: { 
        collisionGrid: any, 
        bGrid: number[][], 
        tGrid: number[][], 
        wGrid: number[][],
        worldSize: number 
    },
    settings: { worldSize: number },
    threat?: THREE.Vector3
): THREE.Vector3[] {
    const halfSize = Math.floor(settings.worldSize / 2);
    const gridSize = settings.worldSize * GRID_SCALE;

    const startIdx = {
        x: worldToIndex(start.x, halfSize, settings.worldSize),
        z: worldToIndex(start.z, halfSize, settings.worldSize)
    };
    const goalIdx = {
        x: worldToIndex(goal.x, halfSize, settings.worldSize),
        z: worldToIndex(goal.z, halfSize, settings.worldSize)
    };

    // Clamp goals within grid
    goalIdx.x = THREE.MathUtils.clamp(goalIdx.x, 0, gridSize - 1);
    goalIdx.z = THREE.MathUtils.clamp(goalIdx.z, 0, gridSize - 1);
    startIdx.x = THREE.MathUtils.clamp(startIdx.x, 0, gridSize - 1);
    startIdx.z = THREE.MathUtils.clamp(startIdx.z, 0, gridSize - 1);

    if (startIdx.x === goalIdx.x && startIdx.z === goalIdx.z) return [];

    // Simple A* with Map-based openSet for O(1) lookup instead of O(n)
    const openSet: { x: number, z: number, g: number, f: number, parent?: any }[] = [];
    const openSetMap = new Map<string, { x: number, z: number, g: number, f: number, parent?: any }>();
    const closedSet = new Set<string>();

    const startNode = { ...startIdx, g: 0, f: heuristic(startIdx, goalIdx) };
    openSet.push(startNode);
    openSetMap.set(`${startIdx.x},${startIdx.z}`, startNode);

    const startTime = performance.now();
    const maxIterations = 150; // Reduced from 250: prefer faster incomplete path over blocking
    let iterations = 0;
    const THREAT_AVOIDANCE_RADIUS = threat ? 5.0 : 0; // Keep distance from threat
    const threatGridPos = threat ? {
        x: worldToIndex(threat.x, halfSize, settings.worldSize),
        z: worldToIndex(threat.z, halfSize, settings.worldSize)
    } : null;

    while (openSet.length > 0 && iterations < maxIterations) {
        iterations++;
        
        // Anti-stutter: Aggressive budget for dense maps (3ms per iteration check)
        if (iterations % 20 === 0 && performance.now() - startTime > 3) {
            break;
        }
        // Find node with lowest f score
        let bestIdx = 0;
        for (let i = 1; i < openSet.length; i++) {
            if (openSet[i].f < openSet[bestIdx].f) {
                bestIdx = i;
            }
        }
        const current = openSet.splice(bestIdx, 1)[0];
        const currentKey = `${current.x},${current.z}`;
        openSetMap.delete(currentKey);
        closedSet.add(currentKey);

        if (current.x === goalIdx.x && current.z === goalIdx.z) {
            return reconstructPath(current, halfSize, settings.worldSize, mapData);
        }

        // Neighbors
        const neighbors = [
            { x: current.x + 1, z: current.z }, { x: current.x - 1, z: current.z },
            { x: current.x, z: current.z + 1 }, { x: current.x, z: current.z - 1 },
            { x: current.x + 1, z: current.z + 1 }, { x: current.x - 1, z: current.z - 1 },
            { x: current.x + 1, z: current.z - 1 }, { x: current.x - 1, z: current.z + 1 },
        ];

        for (let n of neighbors) {
            if (n.x < 0 || n.x >= gridSize || n.z < 0 || n.z >= gridSize) continue;
            const nKey = `${n.x},${n.z}`;
            if (closedSet.has(nKey)) continue;

            const currentHeight = getNavHeight(current.x, current.z, mapData);
            const nHeight = getNavHeight(n.x, n.z, mapData);

            // Accessability check
            // 1. Check if water
            if (mapData.wGrid[n.x][n.z] === 1 && nHeight < 0.5) continue; 
            // 2. Check height difference (climb limit)
            if (Math.abs(nHeight - currentHeight) > 2.0) continue;

            const dist = (n.x !== current.x && n.z !== current.z) ? 1.414 : 1.0;
            let gScore = current.g + dist;
            
            let neighborInOpen = openSetMap.get(nKey);
            if (!neighborInOpen) {
                const newNode = {
                    x: n.x,
                    z: n.z,
                    g: gScore,
                    f: gScore + heuristic(n, goalIdx),
                    parent: current
                };

                // Apply Threat Avoidance Penalty
                if (threatGridPos) {
                    const dx = n.x - threatGridPos.x;
                    const dz = n.z - threatGridPos.z;
                    const distToThreat = Math.sqrt(dx * dx + dz * dz);
                    const safeRadius = 10.0; // Avoidance radius in grid units
                    
                    if (distToThreat < safeRadius) {
                        // Exponential penalty the closer it is
                        const penalty = Math.pow((safeRadius - distToThreat) / safeRadius, 2) * 200.0;
                        newNode.g += penalty;
                        newNode.f += penalty;
                    }
                }

                openSet.push(newNode);
                openSetMap.set(nKey, newNode);
            } else if (gScore < neighborInOpen.g) {
                neighborInOpen.g = gScore;
                neighborInOpen.f = gScore + heuristic(n, goalIdx);
                neighborInOpen.parent = current;
            }
        }
    }

    return []; // No path found or too long
}

function heuristic(a: { x: number, z: number }, b: { x: number, z: number }) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

function getNavHeight(x: number, z: number, mapData: any): number {
    const th = mapData.tGrid[x]?.[z] ?? 0;
    const bh = mapData.bGrid[x]?.[z] ?? 0;
    return Math.max(th, bh);
}

function reconstructPath(node: any, halfSize: number, worldSize: number, mapData: any): THREE.Vector3[] {
    const path: THREE.Vector3[] = [];
    let current = node;
    while (current) {
        const worldX = (current.x + 0.5) / GRID_SCALE - halfSize;
        const worldZ = (current.z + 0.5) / GRID_SCALE - halfSize;
        const worldY = getNavHeight(current.x, current.z, mapData);
        path.unshift(new THREE.Vector3(worldX, worldY, worldZ));
        current = current.parent;
    }
    return path;
}
