
import * as THREE from 'three';
import { GRID_SCALE, worldToIndex } from './physics';

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
    settings: { worldSize: number }
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

    // Simple A* 
    const openSet: { x: number, z: number, g: number, f: number, parent?: any }[] = [];
    const closedSet = new Set<string>();

    const startNode = { ...startIdx, g: 0, f: heuristic(startIdx, goalIdx) };
    openSet.push(startNode);

    const maxIterations = 500; // Limit search for performance
    let iterations = 0;

    while (openSet.length > 0 && iterations < maxIterations) {
        iterations++;
        // Sort by f score
        openSet.sort((a, b) => a.f - b.f);
        const current = openSet.shift()!;

        if (current.x === goalIdx.x && current.z === goalIdx.z) {
            return reconstructPath(current, halfSize, settings.worldSize, mapData);
        }

        closedSet.add(`${current.x},${current.z}`);

        // Neighbors
        const neighbors = [
            { x: current.x + 1, z: current.z }, { x: current.x - 1, z: current.z },
            { x: current.x, z: current.z + 1 }, { x: current.x, z: current.z - 1 },
            { x: current.x + 1, z: current.z + 1 }, { x: current.x - 1, z: current.z - 1 },
            { x: current.x + 1, z: current.z - 1 }, { x: current.x - 1, z: current.z + 1 },
        ];

        for (let n of neighbors) {
            if (n.x < 0 || n.x >= gridSize || n.z < 0 || n.z >= gridSize) continue;
            if (closedSet.has(`${n.x},${n.z}`)) continue;

            const currentHeight = getNavHeight(current.x, current.z, mapData);
            const nHeight = getNavHeight(n.x, n.z, mapData);

            // Accessability check
            // 1. Check if water
            if (mapData.wGrid[n.x][n.z] === 1 && nHeight < 0.5) continue; 
            // 2. Check height difference (climb limit)
            if (Math.abs(nHeight - currentHeight) > 2.0) continue; 
            // 3. Collision check (placeholder, simplified since we have grids)
            // If the difference between map-data-height and indexed-height is too large, it might be an obstacle
            // But bGrid and tGrid already represent top surfaces.

            const dist = (n.x !== current.x && n.z !== current.z) ? 1.414 : 1.0;
            const gScore = current.g + dist;
            
            let neighborInOpen = openSet.find(o => o.x === n.x && o.z === n.z);
            if (!neighborInOpen) {
                openSet.push({
                    x: n.x,
                    z: n.z,
                    g: gScore,
                    f: gScore + heuristic(n, goalIdx),
                    parent: current
                });
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
