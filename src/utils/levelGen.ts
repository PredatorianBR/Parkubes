import * as THREE from 'three';
import { VoxelObject, GameSettings, Position } from '../types';
import { worldToIndex, GRID_SCALE, PLAYER_HEIGHT, SpatialHashGrid } from './physics';

function simplifyPolygonPoints(pts: [number, number][]): [number, number][] {
    if (pts.length <= 2) return pts;
    const result: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
        const prev = pts[(i - 1 + pts.length) % pts.length];
        const curr = pts[i];
        const next = pts[(i + 1) % pts.length];
        
        const dx1 = curr[0] - prev[0];
        const dz1 = curr[1] - prev[1];
        const dx2 = next[0] - curr[0];
        const dz2 = next[1] - curr[1];
        
        const cross = dx1 * dz2 - dz1 * dx2;
        if (cross !== 0) {
            result.push(curr);
        }
    }
    return result;
}

export const findSpawnPos = (
    size: number,
    halfSize: number,
    tGrid: number[][],
    collisionGrid: SpatialHashGrid,
    wGrid: number[][],
    isWaterLogic: (lx: number, lz: number) => boolean,
    quadrant?: 1 | 2 | 3 | 4
) => {
    const bestPos = new THREE.Vector3(0, 10, 0);
    let bestScore = -1;
    let foundAny = false;

    // Helper to evaluate distance to nearest object (non-0 in tGrid, water, or map edge)
    const getClearanceScore = (rx: number, rz: number): number => {
        let radius = 1;
        while (radius < 25) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    if (Math.abs(dx) === radius || Math.abs(dz) === radius) {
                        const cx = rx + dx;
                        const cz = rz + dz;
                        // Map edges
                        if (cx < 0 || cx >= size || cz < 0 || cz >= size) return radius;
                        // Obstacles (Buildings, Ruins, etc.)
                        if (tGrid[cx][cz] !== 0) return radius;
                    }
                }
            }
            radius++;
        }
        return radius;
    };

    for (let k = 0; k < 1000; k++) {
        // Try random positions within a safer inner bound (avoiding map edges completely)
        const safePadding = 10;
        const centerMargin = 8; // Assure they don't spawn in the middle
        let minX = safePadding, maxX = size - safePadding;
        let minZ = safePadding, maxZ = size - safePadding;
        
        if (quadrant === 1) { minX = halfSize + centerMargin; maxZ = halfSize - centerMargin; }
        else if (quadrant === 2) { maxX = halfSize - centerMargin; maxZ = halfSize - centerMargin; }
        else if (quadrant === 3) { maxX = halfSize - centerMargin; minZ = halfSize + centerMargin; }
        else if (quadrant === 4) { minX = halfSize + centerMargin; minZ = halfSize + centerMargin; }

        const rx = Math.floor(Math.random() * (maxX - minX)) + minX;
        const rz = Math.floor(Math.random() * (maxZ - minZ)) + minZ;

        // Check if it's street (0) and not water
        const logicX = rx - halfSize;
        const logicZ = rz - halfSize;

        if (tGrid[rx][rz] === 0 && !isWaterLogic(logicX, logicZ)) {
            // Query collision boxes at this position to get ground height
            const nearby = collisionGrid.query(logicX, logicZ, 0.5);
            let maxH = 0;
            for (const box of nearby) {
                if (logicX >= box.minX && logicX <= box.maxX && logicZ >= box.minZ && logicZ <= box.maxZ) {
                    if (box.maxY > maxH) maxH = box.maxY;
                }
            }
            if (maxH < 2.0) {
                const distFromCenter = Math.sqrt(logicX * logicX + logicZ * logicZ);
                const distBonus = (distFromCenter / halfSize) * 15.0; // Stronger bonus for being far from center
                const score = getClearanceScore(rx, rz) + distBonus;
                if (score > bestScore) {
                    bestScore = score;
                    // Ao nível do chão
                    bestPos.set(logicX, maxH, logicZ);
                    foundAny = true;
                }
            }
        }
    }

    if (foundAny) return bestPos;

    // If no safe spot found on street, try any spot in the requested quadrant without water
    // Restrict to the outer 60% of the quadrant to ensure they look distinct from center
    if (quadrant) {
        let minX = 10, maxX = size - 10;
        let minZ = 10, maxZ = size - 10;
        const outerMargin = Math.floor(size * 0.2); // Avoid the inner 20%
        
        if (quadrant === 1) { minX = halfSize + outerMargin; maxZ = halfSize - outerMargin; }
        else if (quadrant === 2) { maxX = halfSize - outerMargin; maxZ = halfSize - outerMargin; }
        else if (quadrant === 3) { maxX = halfSize - outerMargin; minZ = halfSize + outerMargin; }
        else if (quadrant === 4) { minX = halfSize + outerMargin; minZ = halfSize + outerMargin; }

        for (let k = 0; k < 100; k++) {
            const rx = Math.floor(Math.random() * (maxX - minX)) + minX;
            const rz = Math.floor(Math.random() * (maxZ - minZ)) + minZ;
            const logicX = rx - halfSize;
            const logicZ = rz - halfSize;
            if (!isWaterLogic(logicX, logicZ)) {
                return new THREE.Vector3(logicX, 0, logicZ);
            }
        }
    }

    // Ultimate fallback if map is completely filled (unlikely)
    bestPos.set(0, 0, 0);
    return bestPos;
};

export const generateCityLevel = (

    pSpawn: THREE.Vector2,
    settings: GameSettings,
    mapId: number // ID unique to this match generation
) => {
    // --- LOCAL SCOPED VARIABLES (Reset every function call) ---
    const objects: VoxelObject[] = [];

    const currentArea: Record<'farm' | 'ruins' | 'house' | 'factory' | 'highrise', number> = {
        farm: 0,
        ruins: 0,
        house: 0,
        factory: 0,
        highrise: 0
    };

    let totalBuiltArea = 0;

    const size = settings.worldSize;
    const halfSize = Math.floor(size / 2);

    // Grids (Scaled Up for Physics Precision)
    const gridSize = size * GRID_SCALE;
    const collisionGrid = new SpatialHashGrid(size); // 3D Collision Boxes
    const bGrid: number[][] = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0)); // Bridge Grid
    const wGrid: number[][] = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0)); // Water Grid
    const sGrid: number[][] = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0)); // Surface Grid (0: Grass, 1: Water, 2: Street, 3: Hard)

    // Type Grid remains Logic Resolution (1x1) for building placement logic
    const tGrid: number[][] = Array(size).fill(null).map(() => Array(size).fill(0));

    // Tracking Sets
    const globalColumnOccupied = new Set<string>();
    const fenceLocations = new Set<string>();

    const baseStreetWidth = 3; // Minimum street width requested by user
    const minBlockSize = 6; // Allow tiny 6x6 filler blocks
    const maxBlockSize = 18;

    const uid = (prefix: string) => `${prefix}_m${mapId}`;

    const colors = {
        house: ['#f8fafc', '#f1f5f9', '#e2e8f0', '#fefce8', '#f0fdf4', '#eff6ff', '#fff1f2'],
        brick: '#7f1d1d',
        highrise: ['#cbd5e1', '#94a3b8', '#64748b', '#f8fafc', '#e2e8f0'],
        factory: ['#1e293b', '#0f172a', '#334155', '#3f3f46', '#27272a'],
        ruin: '#78716c',
        acIndustrial: '#475569',
        acResidential: '#e2e8f0',
        chimneyResidential: '#7f1d1d',
        chimneyIndustrial: '#94a3b8',
        fenceWood: '#d4a373'
    };

    // Helper to check water presence at logic coordinate
    const isWaterLogic = (lx: number, lz: number) => {
        const startX = worldToIndex(lx, halfSize, size);
        const startZ = worldToIndex(lz, halfSize, size);
        if (startX >= 0 && startX < gridSize && startZ >= 0 && startZ < gridSize) {
            return wGrid[startX][startZ] === 1;
        }
        return false;
    };

    // --- RIVER GENERATION ---
    let riverOrientation = -1;
    const hasRiver = settings.riverWidth >= 1 && Math.random() > 0.01;
    if (hasRiver) {
        // 0: North, 1: East, 2: South, 3: West
        const startEdge = Math.floor(Math.random() * 4);
        // FORCE target to be the opposite side to ensure it crosses the map
        const endEdge = (startEdge + 2) % 4;

        let cx = 0;
        let cz = 0;

        // Set Start Position exactly on the edge
        if (startEdge === 0) { cx = Math.floor(Math.random() * (size - 14)) + 7 - halfSize; cz = -halfSize; }
        else if (startEdge === 1) { cx = halfSize; cz = Math.floor(Math.random() * (size - 14)) + 7 - halfSize; }
        else if (startEdge === 2) { cx = Math.floor(Math.random() * (size - 14)) + 7 - halfSize; cz = halfSize; }
        else { cx = -halfSize; cz = Math.floor(Math.random() * (size - 14)) + 7 - halfSize; }

        // Set Target Position on the Opposite Edge
        let tx = 0;
        let tz = 0;
        if (endEdge === 0) { tx = Math.floor(Math.random() * (size - 14)) + 7 - halfSize; tz = -halfSize - 2; }
        else if (endEdge === 1) { tx = halfSize + 2; tz = Math.floor(Math.random() * (size - 14)) + 7 - halfSize; }
        else if (endEdge === 2) { tx = Math.floor(Math.random() * (size - 14)) + 7 - halfSize; tz = halfSize + 2; }
        else { tx = -halfSize - 2; tz = Math.floor(Math.random() * (size - 14)) + 7 - halfSize; }

        riverOrientation = startEdge;

        // Width: setting is the maximum, minimum is max - 2 (but at least 1)
        const maxWidth = settings.riverWidth;
        const minWidth = Math.max(1, maxWidth - 2);

        // Walk from Start to Finish
        const maxSteps = size * 4;
        for (let i = 0; i < maxSteps; i++) {
            // A nascente do rio sempre deve ser o mais grosso que aquele rio puder (USER REQUEST)
            const width = i < 8
                ? maxWidth
                : minWidth + Math.floor(Math.random() * (maxWidth - minWidth + 1));
            const rWidth = Math.round(width / 2);

            for (let wx = -rWidth; wx < rWidth; wx++) {
                for (let wz = -rWidth; wz < rWidth; wz++) {
                    const logicX = Math.floor(cx + wx);
                    const logicZ = Math.floor(cz + wz);
                    const startX = worldToIndex(logicX, halfSize, size);
                    const startZ = worldToIndex(logicZ, halfSize, size);

                    for (let sx = 0; sx < GRID_SCALE; sx++) {
                        for (let sz = 0; sz < GRID_SCALE; sz++) {
                            const hx = startX + sx;
                            const hz = startZ + sz;
                            if (hx >= 0 && hx < gridSize && hz >= 0 && hz < gridSize) {
                                wGrid[hx][hz] = 1;
                            }
                        }
                    }
                }
            }

            // Move towards target
            const dx = Math.sign(tx - cx);
            const dz = Math.sign(tz - cz);

            // Controlled movement to target with small random curves
            if (riverOrientation % 2 === 0) { // N-S flow (North-South or South-North)
                cz += dz;
                if (Math.random() > 0.7) cx += (Math.random() > 0.5 ? 1 : -1);
                else if (Math.abs(tx - cx) > 1) cx += dx * 0.5;
            } else { // E-W flow (East-West or West-East)
                cx += dx;
                if (Math.random() > 0.7) cz += (Math.random() > 0.5 ? 1 : -1);
                else if (Math.abs(tz - cz) > 1) cz += dz * 0.5;
            }

            // Stop if reached the target edge
            if (endEdge === 0 && cz <= tz) break;
            if (endEdge === 1 && cx >= tx) break;
            if (endEdge === 2 && cz >= tz) break;
            if (endEdge === 3 && cx <= tx) break;
            if (Math.abs(cx) > halfSize + 10 || Math.abs(cz) > halfSize + 10) break;
        }
    }

    // --- CALCULATE VALID AREA (excluding edges and water) ---
    let totalValidArea = 0;
    for (let lx = -halfSize + 2; lx < halfSize - 2; lx++) {
        for (let lz = -halfSize + 2; lz < halfSize - 2; lz++) {
            if (!isWaterLogic(lx, lz)) {
                totalValidArea++;
            }
        }
    }

    // --- PLACE BUILDING ---
    const placeBuilding = (bx: number, bz: number, bw: number, bd: number, forcedType?: 'farm' | 'ruins' | 'house' | 'factory' | 'highrise', categoryFilter?: 'farm' | 'building' | 'ruins'): (() => void) | null => {
        let selectedType: 'farm' | 'ruins' | 'house' | 'factory' | 'highrise' = 'house';

        if (forcedType) {
            selectedType = forcedType;
        } else {
            const targetAreas = {
                farm: (settings.ratios.farm / 100) * totalValidArea,
                ruins: (settings.ratios.ruins / 100) * totalValidArea,
                house: (settings.ratios.house / 100) * totalValidArea,
                factory: (settings.ratios.factory / 100) * totalValidArea,
                highrise: (settings.ratios.highrise / 100) * totalValidArea,
            };

            const eligibleTargets = (['farm', 'ruins', 'house', 'factory', 'highrise'] as const).filter(
                t => currentArea[t] < targetAreas[t]
            );

            // Filter based on requested category
            let eligibleTypes: ('farm' | 'ruins' | 'house' | 'factory' | 'highrise')[] = [];
            if (categoryFilter === 'farm') {
                eligibleTypes = eligibleTargets.filter(t => t === 'farm');
            } else if (categoryFilter === 'building') {
                eligibleTypes = eligibleTargets.filter(t => t === 'house' || t === 'factory' || t === 'highrise');
            } else if (categoryFilter === 'ruins') {
                eligibleTypes = eligibleTargets.filter(t => t === 'ruins');
            } else {
                eligibleTypes = [...eligibleTargets];
            }

            if (eligibleTypes.length === 0) return null;

            // Pick amongst eligible using ratios as weights
            let totalWeight = 0;
            eligibleTypes.forEach(t => totalWeight += settings.ratios[t]);

            if (totalWeight <= 0) return null;

            const rand = Math.random() * totalWeight;
            let acc = 0;
            for (const t of eligibleTypes) {
                acc += settings.ratios[t];
                if (rand <= acc) {
                    selectedType = t;
                    break;
                }
            }
        }

        const typeIdMap = { house: 1, factory: 2, highrise: 3, farm: 4, ruins: 5 };
        const typeId = typeIdMap[selectedType];

        if (selectedType === 'farm') {
            // New Requirement: Enforce minimum width/depth of 3 voxels for the farm block
            if (bw < 3 || bd < 3) return null;

            // Check gap rule for farm (treated as construction)
            for (let i = -2; i < bw + 2; i++) {
                for (let j = -2; j < bd + 2; j++) {
                    const tx = bx + i + halfSize;
                    const tz = bz + j + halfSize;
                    
                    if (isWaterLogic(bx + i, bz + j)) return null; // USER REQUEST: 2 voxels de distancia do rio

                    if (tx >= 0 && tx < size && tz >= 0 && tz < size) {
                        const nType = tGrid[tx][tz];
                        if (nType !== 0 && nType !== 4) { // 4 is farm
                            const nearX = i < 0 ? -i : (i >= bw ? i - bw + 1 : 0);
                            const nearZ = j < 0 ? -j : (j >= bd ? j - bd + 1 : 0);
                            if (nearX < baseStreetWidth && nearZ < baseStreetWidth) return null;
                        }
                    }
                }
            }

            // Enforce that the resulting terrestrial area (after river cutting) also respects the minimum width/depth of 3
            let minLX = bw, maxLX = -1, minLZ = bd, maxLZ = -1;
            let possibleCount = 0;
            for (let i = 0; i < bw; i++) {
                for (let j = 0; j < bd; j++) {
                    if (!isWaterLogic(bx + i, bz + j)) {
                        possibleCount++;
                        if (i < minLX) minLX = i;
                        if (i > maxLX) maxLX = i;
                        if (j < minLZ) minLZ = j;
                        if (j > maxLZ) maxLZ = j;
                    }
                }
            }

            const landW = maxLX - minLX + 1;
            const landD = maxLZ - minLZ + 1;
            if (landW < 3 || landD < 3 || possibleCount < 9) return null; // USER REQUEST: minimum 3x3 (9 voxels)
            let placedCount = 0;
            for (let i = 0; i < bw; i++) {
                for (let j = 0; j < bd; j++) {
                    const logicX = bx + i;
                    const logicZ = bz + j;
                    const tx = logicX + halfSize;
                    const tz = logicZ + halfSize;
                    if (tx >= 0 && tx < size && tz >= 0 && tz < size) {
                        if (!isWaterLogic(logicX, logicZ)) {
                            tGrid[tx][tz] = 4; // Mark as Farm
                            placedCount++;
                        }
                    }
                }
            }
            currentArea.farm += placedCount;
            totalBuiltArea += placedCount;
            return () => { };
        }

        if (selectedType === 'ruins') {
            const numRuins = Math.max(1, Math.floor((bw * bd) / 4));
            const ruinItems: { rx: number, rz: number, h: number }[] = [];

            for (let i = 0; i < numRuins; i++) {
                const rx = bx + Math.floor(Math.random() * bw);
                const rz = bz + Math.floor(Math.random() * bd);

                let canPlace = true;
                const ruinGap = 4; // Minimum distance from buildings/houses/factories
                for (let dx = -ruinGap; dx < 2 + ruinGap; dx++) {
                    for (let dz = -ruinGap; dz < 2 + ruinGap; dz++) {
                        const checkX = rx + dx;
                        const checkZ = rz + dz;
                        
                        // Check water gap (min 2 voxels)
                        const isWaterGap = dx >= -2 && dx < 4 && dz >= -2 && dz < 4;
                        if (isWaterGap && isWaterLogic(checkX, checkZ)) {
                            canPlace = false;
                        }

                        const tx = checkX + halfSize;
                        const tz = checkZ + halfSize;
                        if (tx < 0 || tx >= size || tz < 0 || tz >= size) {
                            if (dx >= 0 && dx < 2 && dz >= 0 && dz < 2) canPlace = false;
                        } else {
                            const nType = tGrid[tx][tz];
                            if (nType !== 0 && nType !== 5) {
                                const nearX = dx < 0 ? -dx : (dx >= 2 ? dx - 2 + 1 : 0);
                                const nearZ = dz < 0 ? -dz : (dz >= 2 ? dz - 2 + 1 : 0);
                                if (nearX < ruinGap && nearZ < ruinGap) canPlace = false;
                            } else if (nType === 5 && dx >= 0 && dx < 2 && dz >= 0 && dz < 2) {
                                canPlace = false;
                            }
                        }
                    }
                }

                if (canPlace && !isWaterLogic(rx, rz) && !isWaterLogic(rx + 1, rz + 1)) {
                    for (let dx = 0; dx < 2; dx++) {
                        for (let dz = 0; dz < 2; dz++) {
                            const tx = rx + dx + halfSize;
                            const tz = rz + dz + halfSize;
                            tGrid[tx][tz] = 5; // Mark as ruin
                            currentArea.ruins++;
                        }
                    }
                    const h = 1.0 + Math.random() * 2.8;
                    ruinItems.push({ rx, rz, h });
                }
            }
            return () => {
                ruinItems.forEach(item => {
                    objects.push({
                        id: uid(`ruin-${item.rx}-${item.rz}`),
                        position: [item.rx + 1, item.h / 2, item.rz + 1],
                        scale: [2, item.h, 2],
                        color: colors.ruin,
                        type: 'ruin'
                    });
                });
            };
        }

        let type: 'house' | 'highrise' | 'factory' = 'house';
        if (selectedType === 'factory') { type = 'factory'; }
        else if (selectedType === 'house') { type = 'house'; }
        else if (selectedType === 'highrise') { type = 'highrise'; }

        const availW = bw;
        const availD = bd;

        let fillW = Math.floor(availW);
        let fillD = Math.floor(availD);

        // Factories will now dynamically fit the plot size without requiring a 10x10 minimum space.

        if (fillW % 2 !== 0) fillW -= 1;
        if (fillD % 2 !== 0) fillD -= 1;

        if (fillW < 6 || fillD < 6) return null;

        const alignX = Math.random();
        const alignZ = Math.random();

        let startX = bx;
        if (alignX < 0.3) startX = bx;
        else if (alignX > 0.7) startX = bx + (bw - fillW);
        else startX = bx + Math.floor((bw - fillW) / 2);

        let startZ = bz;
        if (alignZ < 0.3) startZ = bz;
        else if (alignZ > 0.7) startZ = bz + (bd - fillD);
        else startZ = bz + Math.floor((bd - fillD) / 2);

        // Gap check for buildings
        for (let ix = -2; ix < fillW + 2; ix++) {
            for (let jz = -2; jz < fillD + 2; jz++) {
                const tx = startX + ix + halfSize;
                const tz = startZ + jz + halfSize;
                
                if (isWaterLogic(startX + ix, startZ + jz)) return null;

                if (tx >= 0 && tx < size && tz >= 0 && tz < size) {
                    const nType = tGrid[tx][tz];
                    if (nType !== 0 && nType !== typeId) {
                        // Allow buildings to be closer to each other.
                        return null;
                    }
                }
            }
        }

        for (let i = 0; i < fillW; i++) {
            for (let j = 0; j < fillD; j++) {
                const lx = startX + i;
                const lz = startZ + j;
                const tx = lx + halfSize;
                const tz = lz + halfSize;

                if (tx >= 0 && tx < size && tz >= 0 && tz < size) {
                    if (isWaterLogic(lx, lz) || tGrid[tx][tz] !== 0) return null;
                }
            }
        }

        const floorH = PLAYER_HEIGHT * 1.5; // One floor = 1.5 characters
        let height = floorH;
        if (type === 'house') {
            height = (Math.floor(Math.random() * 2) + 1) * floorH; // 1-2 floors
        } else if (type === 'factory') {
            height = (Math.floor(Math.random() * 3) + 1) * floorH; // 1-3 floors
        } else {
            // Highrise: 2-3 floors
            height = (Math.floor(Math.random() * 2) + 2) * floorH;
            if (height > 3 * floorH && (fillW < 4 || fillD < 4)) height = 3 * floorH;
        }

        let mask = Array(fillW).fill(null).map(() => Array(fillD).fill(true));

        if (fillW >= 6 && fillD >= 6 && Math.random() > 0.3) {
             const numCuts = Math.floor(Math.random() * 3) + 1;
             const tempMask = mask.map(row => [...row]);
             for(let c=0; c<numCuts; c++) {
                 let cutW = Math.max(2, Math.floor(fillW * (0.2 + Math.random() * 0.3)));
                 let cutD = Math.max(2, Math.floor(fillD * (0.2 + Math.random() * 0.3)));
                 if (cutW % 2 !== 0) cutW -= 1;
                 if (cutD % 2 !== 0) cutD -= 1;
                 if (cutW < 2) cutW = 2;
                 if (cutD < 2) cutD = 2;
                 
                 const edge = Math.floor(Math.random() * 4);
                 let sx = 0, sz = 0;
                 if (edge === 0) { sx = fillW - cutW; sz = fillD - cutD; }
                 else if (edge === 1) { sx = fillW - cutW; sz = 0; }
                 else if (edge === 2) { sx = 0; sz = 0; }
                 else if (edge === 3) { sx = 0; sz = fillD - cutD; }

                 for(let i=0; i<cutW; i++) {
                     for(let j=0; j<cutD; j++) {
                         if(sx+i >=0 && sx+i < fillW && sz+j >=0 && sz+j < fillD) {
                             tempMask[sx+i][sz+j] = false;
                         }
                     }
                 }
             }

             let trueCount = 0;
             let startNode: [number, number] | null = null;
             for (let i = 0; i < fillW; i++) {
                 for (let j = 0; j < fillD; j++) {
                     if (tempMask[i][j]) {
                         trueCount++;
                         if (!startNode) startNode = [i, j];
                     }
                 }
             }

             let hasPinch = false;
             for (let i = 0; i < fillW - 1; i++) {
                 for (let j = 0; j < fillD - 1; j++) {
                     const a = tempMask[i][j];
                     const b = tempMask[i+1][j];
                     const c = tempMask[i][j+1];
                     const d = tempMask[i+1][j+1];
                     if ((a && d && !b && !c) || (!a && !d && b && c)) {
                         hasPinch = true; break;
                     }
                 }
             }

             if (startNode && trueCount >= 9 && !hasPinch) {
                 let visitedNodes = 0;
                 const queue = [startNode];
                 const visited = Array(fillW).fill(null).map(() => Array(fillD).fill(false));
                 visited[startNode[0]][startNode[1]] = true;
                 
                 while (queue.length > 0) {
                     const [cx, cz] = queue.shift()!;
                     visitedNodes++;
                     const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
                     for (const [dx, dz] of neighbors) {
                         const nx = cx + dx;
                         const nz = cz + dz;
                         if (nx >= 0 && nx < fillW && nz >= 0 && nz < fillD && tempMask[nx][nz] && !visited[nx][nz]) {
                             visited[nx][nz] = true;
                             queue.push([nx, nz]);
                         }
                     }
                 }
                 if (visitedNodes === trueCount) {
                     mask = tempMask;
                 }
             }
        }
        
        const outlineEdges = new Map<string, [number, number]>();
        const addEdge = (x1: number, z1: number, x2: number, z2: number) => { outlineEdges.set(`${x1},${z1}`, [x2, z2]); };
        for(let x=0; x<fillW; x++) {
            for(let z=0; z<fillD; z++) {
                if (mask[x][z]) {
                    if (z === 0 || !mask[x][z-1]) addEdge(x, z, x+1, z);
                    if (x === fillW-1 || !mask[x+1][z]) addEdge(x+1, z, x+1, z+1);
                    if (z === fillD-1 || !mask[x][z+1]) addEdge(x+1, z+1, x, z+1);
                    if (x === 0 || !mask[x-1][z]) addEdge(x, z+1, x, z);
                }
            }
        }
        
        const points: [number, number][] = [];
        if (outlineEdges.size > 0) {
            const startKey = outlineEdges.keys().next().value;
            let currentKey = startKey;
            while(true) {
                const [x, z] = currentKey.split(',').map(Number);
                points.push([x, z]);
                const nextNode = outlineEdges.get(currentKey);
                if (!nextNode) break;
                currentKey = `${nextNode[0]},${nextNode[1]}`;
                if (currentKey === startKey) break;
            }
        }

        const variant = Math.floor(Math.random() * 4);
        const buildingId = uid(`bldg-${bx}-${bz}`);

        const cx = startX + fillW / 2;
        const cz = startZ + fillD / 2;
        const objType = type === 'house' ? 'box' : type;

        let baseColor = colors.house[0];
        if (type === 'house') baseColor = colors.house[Math.floor(Math.random() * colors.house.length)];
        if (type === 'highrise') baseColor = colors.highrise[Math.floor(Math.random() * colors.highrise.length)];
        if (type === 'factory') baseColor = colors.factory[Math.floor(Math.random() * colors.factory.length)];

        const assignedWindows: { pos: Position, rot: [number, number, number] }[] = [];
        const attachedChimneys: { pos: Position, scale: Position, color: string, smoke?: boolean, rotation?: number }[] = [];
        const assignedDoors: { pos: Position, rot: [number, number, number], type: 'standard' | 'industrial' }[] = [];
        const assignedACs: { pos: Position, scale: Position, color: string, rotation: number, type: 'wall' | 'roof' }[] = [];
        const assignedLadders: { pos: Position, rot: [number, number, number], height: number }[] = [];

        let placedCount = 0;
        for (let i = 0; i < fillW; i++) {
            for (let j = 0; j < fillD; j++) {
                if (!mask[i][j]) continue;
                const lx = startX + i;
                const lz = startZ + j;
                const tx = lx + halfSize;
                const tz = lz + halfSize;
                if (tx >= 0 && tx < size && tz >= 0 && tz < size) {
                    tGrid[tx][tz] = typeId;
                    placedCount++;
                }
            }
        }
        currentArea[type] += placedCount;
        totalBuiltArea += placedCount;

        return () => {
            const numFloors = Math.max(1, Math.floor(height / floorH));

            type WallColumn = {
                worldX: number, worldZ: number,
                dx: number, dz: number,
                rot: number,
                rotVec: number[],
                minDist: number,
                biasDist: number,
                facadeId: string
            };
            const columns: WallColumn[] = [];

            const isSolid = (lx: number, lz: number) => {
                if (lx < 0 || lx >= fillW || lz < 0 || lz >= fillD) return false;
                if (!mask[lx][lz]) return false;
                return true;
            };

            const neighbors = [
                { dx: 1, dz: 0, rot: Math.PI / 2, rotVec: [0, Math.PI / 2, 0] },
                { dx: -1, dz: 0, rot: -Math.PI / 2, rotVec: [0, -Math.PI / 2, 0] },
                { dx: 0, dz: 1, rot: 0, rotVec: [0, 0, 0] },
                { dx: 0, dz: -1, rot: Math.PI, rotVec: [0, Math.PI, 0] }
            ];

            for (let i = 0; i < fillW; i++) {
                for (let j = 0; j < fillD; j++) {
                    if (!isSolid(i, j)) continue;

                    for (const n of neighbors) {
                        const nx = i + n.dx;
                        const nz = j + n.dz;

                        if (!isSolid(nx, nz)) {
                            const airX = startX + i + n.dx;
                            const airZ = startZ + j + n.dz;
                            const tx = airX + halfSize;
                            const tz = airZ + halfSize;

                            if (tx >= 0 && tx < size && tz >= 0 && tz < size && tGrid[tx][tz] === 0) {
                                const tX = -n.dz;
                                const tZ = n.dx;

                                // Calculate distance to nearest corner in both directions
                                let distL = 0;
                                while (isSolid(i + tX * (distL + 1), j + tZ * (distL + 1))) distL++;
                                let distR = 0;
                                while (isSolid(i - tX * (distR + 1), j - tZ * (distR + 1))) distR++;

                                const minDist = Math.min(distL, distR);

                                // Groups columns into facades based on normal and the plane coordinate
                                const solidX = startX + i;
                                const solidZ = startZ + j;
                                const facadeId = `${n.dx},${n.dz}:${(n.dx !== 0 ? solidX : solidZ)}`;
                                const biasDist = distL - distR;

                                columns.push({
                                    worldX: solidX, worldZ: solidZ,
                                    dx: n.dx, dz: n.dz,
                                    rot: n.rot, rotVec: n.rotVec as [number, number, number],
                                    minDist: minDist,
                                    biasDist: biasDist,
                                    facadeId: facadeId
                                });
                            }
                        }
                    }
                }
            }


            // --- NEW GRID-BASED DECORATION LOGIC ---
            type Facade = {
                id: string;
                normal: { dx: number, dz: number };
                rot: number;
                rotVec: [number, number, number];
                columns: WallColumn[];
                width: number;
                height: number;
                occupancy: boolean[][];
                hasDoor: boolean;
                hasWindow: boolean;
            };

            const facades: Facade[] = [];
            const facadeMap = new Map<string, WallColumn[]>();
            columns.forEach(col => {
                if (!facadeMap.has(col.facadeId)) facadeMap.set(col.facadeId, []);
                facadeMap.get(col.facadeId)!.push(col);
            });

            facadeMap.forEach((cols, id) => {
                const parts = id.split(':');
                const [dx, dz] = parts[0].split(',').map(Number);
                const n = { dx, dz };

                // Sort columns linearly along the facade plane.
                const axis = dx !== 0 ? 'worldZ' : 'worldX';
                cols.sort((a, b) => a[axis] - b[axis]);

                // Split columns into contiguous groups.
                const groups: WallColumn[][] = [];
                if (cols.length > 0) {
                    let currentGroup: WallColumn[] = [cols[0]];
                    for (let i = 1; i < cols.length; i++) {
                        const prev = cols[i - 1];
                        const curr = cols[i];
                        // If coordinates differ by more than 1 in the sorted axis, they are not contiguous.
                        if (Math.abs(curr[axis] - prev[axis]) > 1) {
                            groups.push(currentGroup);
                            currentGroup = [curr];
                        } else {
                            currentGroup.push(curr);
                        }
                    }
                    groups.push(currentGroup);
                }

                const vH = Math.round(height);
                groups.forEach((groupCols, groupIdx) => {
                    facades.push({
                        id: `${id}_g${groupIdx}`,
                        normal: n,
                        rot: groupCols[0].rot,
                        rotVec: groupCols[0].rotVec as [number, number, number],
                        columns: groupCols,
                        width: groupCols.length,
                        height: vH,
                        occupancy: Array(groupCols.length).fill(null).map(() => Array(vH).fill(false)),
                        hasDoor: false,
                        hasWindow: false
                    });
                });
            });

            let doorsPlacedCount = 0;
            let indDoorsCount = 0;
            let stdDoorsCount = 0;
            let maxDoors = 1;
            if (type === 'factory') {
                maxDoors = (fillW >= 12 && fillD >= 12) ? 3 : 2;
            } else if (type === 'house') {
                maxDoors = (fillW >= 10 && fillD >= 10) ? 2 : 1;
            } else if (fillW >= 10 && fillD >= 10) {
                maxDoors = 2;
            }
            let hasChimney = false;

            // Sort facades by width to prioritize large faces for doors/chimneys
            facades.sort((a, b) => b.width - a.width);

            // Slots for vertical propagation (doors + ground-floor windows define columns)
            const groundSlots: { f: typeof facades[0], x: number, worldPosX?: number, worldPosZ?: number }[] = [];
            // PASS 1: Doors and Chimneys (High Priority)
            for (const f of facades) {
                const isNearMapEdge = f.columns.some(col => Math.abs(col.worldX) > (halfSize - 6) || Math.abs(col.worldZ) > (halfSize - 6));

                // Try to place doors on ground level
                if (doorsPlacedCount < maxDoors) {
                    let dType: 'standard' | 'industrial' = 'standard';
                    
                    if (type === 'factory') {
                        if (indDoorsCount < 1) {
                            dType = 'industrial'; // First door must be industrial
                        } else if (stdDoorsCount < 1 && Math.random() > 0.5) {
                            dType = 'standard'; // Optional second door is standard
                        } else {
                            continue; // Already has requested doors or lost the roll
                        }
                    } else if (type === 'house') {
                        dType = 'standard';
                    } else {
                        // Highrise or other
                        dType = Math.random() > 0.2 ? 'standard' : 'industrial';
                    }

                    const dW = dType === 'industrial' ? 4 : 2;
                    const dH = dType === 'industrial' ? 6 : 4;

                    // Relaxed padding for factories: if industrial door is too wide for 1-voxel padding, use 0-voxel padding
                    let pad = 1;
                    if (type === 'factory' && dType === 'industrial' && f.width < dW + 2) {
                        if (f.width >= dW) pad = 0;
                        else continue; // Still too narrow
                    } else if (f.width < dW + 2 * pad) {
                        continue; // Narrow facade for this type
                    }

                    // Define possible starting positions
                    const possibleStarts: number[] = [];
                    for (let x = pad; x <= f.width - dW - pad; x++) possibleStarts.push(x);

                    // Shuffle starts to allow non-centered placement
                    for (let i = possibleStarts.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [possibleStarts[i], possibleStarts[j]] = [possibleStarts[j], possibleStarts[i]];
                    }

                    for (const startX of possibleStarts) {
                        let canPlace = true;
                        // Check area for door + pad
                        for (let x = startX - pad; x <= startX + dW + (pad - 1); x++) {
                            for (let y = 0; y < dH; y++) {
                                if (x < 0 || x >= f.width || y >= f.height || f.occupancy[x][y]) { canPlace = false; break; }
                            }
                            if (!canPlace) break;
                            if (globalColumnOccupied.has(`${f.columns[Math.max(0, Math.min(x, f.width - 1))].worldX},${f.columns[Math.max(0, Math.min(x, f.width - 1))].worldZ}`)) { canPlace = false; break; }
                        }

                        if (canPlace) {
                            // Mark occupancy including pad
                            for (let x = startX - pad; x <= startX + dW + (pad - 1); x++) {
                                for (let y = 0; y < dH; y++) {
                                    if (x >= 0 && x < f.width && y < f.height) f.occupancy[x][y] = true;
                                }
                            }
                            // Global occupancy for the columns actually used by the door
                            for (let x = startX; x < startX + dW; x++) {
                                globalColumnOccupied.add(`${f.columns[x].worldX},${f.columns[x].worldZ}`);
                            }

                            const doorWorldH = dType === 'industrial' ? 6.0 : 4.4;
                            const ly = (doorWorldH / 2) - (height / 2);
                            const firstCol = f.columns[startX];
                            const lastCol = f.columns[startX + dW - 1];
                            const midX = (firstCol.worldX + lastCol.worldX + 1) / 2;
                            const midZ = (firstCol.worldZ + lastCol.worldZ + 1) / 2;
                            const worldX = midX + 0.501 * f.normal.dx;
                            const worldZ = midZ + 0.501 * f.normal.dz;

                            assignedDoors.push({
                                pos: [worldX - cx, ly, worldZ - cz],
                                rot: f.rotVec,
                                type: dType
                            });
                            f.hasDoor = true;

                            doorsPlacedCount++;
                            if (dType === 'industrial') indDoorsCount++; else stdDoorsCount++;

                            // Register door center as a slot for vertical propagation
                            const doorCenterX = startX + Math.floor(dW / 2);
                            groundSlots.push({ f, x: doorCenterX, worldPosX: worldX, worldPosZ: worldZ });

                            break; // Door successfully placed for this facade
                        }
                    }
                }

                // Try to place chimney if residential and has space
                if (type === 'house' && !hasChimney && f.width >= 6 && !isNearMapEdge && Math.random() < 0.4) {
                    const cW = 2;
                    const cX = Math.random() > 0.5 ? 1 : f.width - 1 - cW;
                    if (cX >= 1 && cX + cW <= f.width - 1) {
                        let canPlace = true;
                        // Check area for chimney + 1 voxel pad left/right
                        for (let x = cX - 1; x <= cX + cW; x++) {
                            for (let y = 0; y < f.height; y++) {
                                if (x < 0 || x >= f.width || f.occupancy[x][y]) { canPlace = false; break; }
                            }
                            if (!canPlace) break;
                            if (globalColumnOccupied.has(`${f.columns[Math.max(0, Math.min(x, f.width - 1))].worldX},${f.columns[Math.max(0, Math.min(x, f.width - 1))].worldZ}`)) { canPlace = false; break; }
                        }

                        if (canPlace) {
                            for (let x = cX - 1; x <= cX + cW; x++) {
                                for (let y = 0; y < f.height; y++) f.occupancy[x][y] = true;
                                globalColumnOccupied.add(`${f.columns[x].worldX},${f.columns[x].worldZ}`);
                            }

                            hasChimney = true;
                            const firstCol = f.columns[cX];
                            const lastCol = f.columns[cX + cW - 1];
                            const midX = (firstCol.worldX + lastCol.worldX + 1) / 2;
                            const midZ = (firstCol.worldZ + lastCol.worldZ + 1) / 2;
                            const worldX = midX + 0.501 * f.normal.dx;
                            const worldZ = midZ + 0.501 * f.normal.dz;

                            const scaleY = height + 2.0;
                            attachedChimneys.push({
                                pos: [worldX - cx, (scaleY / 2) - (height / 2), worldZ - cz],
                                scale: [2.0, scaleY, 2.0],
                                color: colors.chimneyResidential,
                                smoke: Math.random() > 0.5,
                                rotation: f.rot
                            });
                        }
                    }
                }
            }

            // Guarantee: every building must have at least 1 door. Factories MUST have 1 industrial door.
            if ((doorsPlacedCount === 0 || (type === 'factory' && indDoorsCount === 0)) && facades.length > 0) {
                const isFactory = type === 'factory';
                // Try facades for a door
                for (const f of facades) {
                    const dType: 'industrial' | 'standard' = (isFactory && indDoorsCount === 0) ? 'industrial' : 'standard';
                    const dW = dType === 'industrial' ? 4 : 2;
                    const dH = dType === 'industrial' ? 6 : 4;

                    // Try with padding 1 first, then 0 if factory needs industrial
                    for (let pad = 1; pad >= 0; pad--) {
                        if (f.width < dW + 2 * pad) continue;
                        
                        const possibleStarts: number[] = [];
                        for (let x = pad; x <= f.width - dW - pad; x++) possibleStarts.push(x);

                        // Shuffle
                        for (let i = possibleStarts.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [possibleStarts[i], possibleStarts[j]] = [possibleStarts[j], possibleStarts[i]];
                        }
                        for (const startX of possibleStarts) {
                            let canPlace = true;
                            // Relaxed guarantee: only check direct occupancy, ignore pads if pad is 0
                            for (let x = startX - pad; x <= startX + dW + (pad - 1); x++) {
                                for (let y = 0; y < dH; y++) {
                                    if (x < 0 || x >= f.width || y >= f.height || f.occupancy[x][y]) { canPlace = false; break; }
                                }
                                if (!canPlace) break;
                            }
                            if (canPlace) {
                                for (let x = startX - pad; x <= startX + dW + (pad - 1); x++) {
                                    for (let y = 0; y < dH; y++) {
                                        if (x >= 0 && x < f.width && y < f.height) f.occupancy[x][y] = true;
                                    }
                                }
                                for (let x = startX; x < startX + dW; x++) {
                                    globalColumnOccupied.add(`${f.columns[x].worldX},${f.columns[x].worldZ}`);
                                }

                                const doorWorldH = dType === 'industrial' ? 6.0 : 4.4;
                                const ly = (doorWorldH / 2) - (height / 2);
                                const firstCol = f.columns[startX];
                                const lastCol = f.columns[startX + dW - 1];
                                const midX = (firstCol.worldX + lastCol.worldX + 1) / 2;
                                const midZ = (firstCol.worldZ + lastCol.worldZ + 1) / 2;
                                const worldX = midX + 0.501 * f.normal.dx;
                                const worldZ = midZ + 0.501 * f.normal.dz;

                                assignedDoors.push({
                                    pos: [worldX - cx, ly, worldZ - cz],
                                    rot: f.rotVec,
                                    type: dType
                                });

                                doorsPlacedCount++;
                                if (dType === 'industrial') indDoorsCount++; else stdDoorsCount++;
                                
                                const doorCenterX = startX + Math.floor(dW / 2);
                                groundSlots.push({ f, x: doorCenterX, worldPosX: worldX, worldPosZ: worldZ });
                                break;
                            }
                        }
                        if (isFactory && indDoorsCount > 0) break;
                        if (!isFactory && doorsPlacedCount > 0) break;
                    }
                    if (isFactory && indDoorsCount > 0) break;
                    if (!isFactory && doorsPlacedCount > 0) break;
                }
            }

            // PASS 2: Windows and Wall ACs (Column-based from ground floor)
            const winInterval = type === 'factory' ? 6 : (type === 'highrise' ? 3 : 4);
            const floorsWithWallAC = new Array(numFloors).fill(false);
            let factoryWallACs = 0;
            let groundFloorHasWindow = false;

            // Phase A: Place ground-floor windows and record slots
            for (const f of facades) {
                const floorBase = 0 * floorH;
                const startOffset = Math.floor((f.width % winInterval) / 2) || 2;

                for (let x = startOffset; x < f.width - 2; x += winInterval) {
                    const winW = type === 'factory' ? 4 : 1;
                    const winH = type === 'factory' ? 2 : 1;
                    // Top of window aligns with player height
                    const winBase = floorBase + PLAYER_HEIGHT - winH;
                    if (winBase + winH >= height) continue;
                    const groundY = Math.floor(winBase);
                    if (f.occupancy[x][groundY]) continue;

                    const sWinX = x - Math.floor(winW / 2);
                    const sWinY = groundY;

                    let canPlace = true;
                    for (let ix = sWinX - 1; ix <= sWinX + winW; ix++) {
                        for (let iy = sWinY - 1; iy <= sWinY + winH; iy++) {
                            if (ix < 1 || ix >= f.width - 1 || iy < 1 || iy >= f.height - 1 || f.occupancy[ix][iy]) {
                                canPlace = false; break;
                            }
                        }
                        if (!canPlace) break;
                        // NEW: Global occupancy check
                        if (globalColumnOccupied.has(`${f.columns[Math.max(0, Math.min(ix, f.width - 1))].worldX},${f.columns[Math.max(0, Math.min(ix, f.width - 1))].worldZ}`)) {
                            canPlace = false; break;
                        }
                    }

                    if (canPlace) {
                        for (let ix = sWinX - 1; ix <= sWinX + winW; ix++) {
                            for (let iy = sWinY - 1; iy <= sWinY + winH; iy++) f.occupancy[ix][iy] = true;
                        }
                        // NEW: Mark global occupancy
                        for (let ix = sWinX; ix < sWinX + winW; ix++) {
                            globalColumnOccupied.add(`${f.columns[ix].worldX},${f.columns[ix].worldZ}`);
                        }

                         const firstCol = f.columns[Math.max(0, sWinX)];
                         const lastCol = f.columns[Math.min(f.width - 1, sWinX + winW - 1)];
                         const midX = (firstCol.worldX + lastCol.worldX + 1) / 2;
                         const midZ = (firstCol.worldZ + lastCol.worldZ + 1) / 2;
                         const worldX = midX + 0.501 * f.normal.dx;
                         const worldZ = midZ + 0.501 * f.normal.dz;
                         const worldYWin = (winBase + (winH / 2)) - (height / 2);

                         assignedWindows.push({
                             pos: [worldX - cx, worldYWin, worldZ - cz],
                             rot: f.rotVec
                         });
                         f.hasWindow = true;
                         groundFloorHasWindow = true;
                         groundSlots.push({ f, x, worldPosX: worldX, worldPosZ: worldZ });
                    }
                }
            }

            // Force at least one ground-floor window if none were placed
            if (!groundFloorHasWindow && facades.length > 0) {
                const floorBase = 0 * floorH;
                const winW = type === 'factory' ? 4 : 1;
                const winH = type === 'factory' ? 2 : 1;
                const winBase = floorBase + PLAYER_HEIGHT - winH;
                const groundY = Math.floor(winBase);

                for (const f of facades) {
                    if (winBase + winH >= height) break;
                    for (let x = 1; x <= f.width - winW - 1; x++) {
                        const sWinX = x;
                        const sWinY = groundY;
                        let canPlace = true;
                        for (let ix = sWinX - 1; ix <= sWinX + winW; ix++) {
                            for (let iy = sWinY - 1; iy <= sWinY + winH; iy++) {
                                if (ix < 1 || ix >= f.width - 1 || iy < 1 || iy >= f.height - 1 || f.occupancy[ix][iy]) {
                                    canPlace = false; break;
                                }
                            }
                            if (!canPlace) break;
                            // NEW: Global occupancy check
                            if (globalColumnOccupied.has(`${f.columns[Math.max(0, Math.min(ix, f.width - 1))].worldX},${f.columns[Math.max(0, Math.min(ix, f.width - 1))].worldZ}`)) {
                                canPlace = false; break;
                            }
                        }
                        if (canPlace) {
                            for (let ix = sWinX - 1; ix <= sWinX + winW; ix++) {
                                for (let iy = sWinY - 1; iy <= sWinY + winH; iy++) f.occupancy[ix][iy] = true;
                            }
                            // NEW: Mark global occupancy
                            for (let ix = sWinX; ix < sWinX + winW; ix++) {
                                globalColumnOccupied.add(`${f.columns[ix].worldX},${f.columns[ix].worldZ}`);
                            }
                             const firstCol = f.columns[sWinX];
                             const lastCol = f.columns[sWinX + winW - 1];
                             const midX = (firstCol.worldX + lastCol.worldX + 1) / 2;
                             const midZ = (firstCol.worldZ + lastCol.worldZ + 1) / 2;
                             const worldX = midX + 0.501 * f.normal.dx;
                             const worldZ = midZ + 0.501 * f.normal.dz;
                             const wY = (winBase + (winH / 2)) - (height / 2);
                             assignedWindows.push({
                                 pos: [worldX - cx, wY, worldZ - cz],
                                 rot: f.rotVec
                             });
                             f.hasWindow = true;
                             groundFloorHasWindow = true;
                             groundSlots.push({ f, x, worldPosX: worldX, worldPosZ: worldZ });
                            break;
                        }
                    }
                    if (groundFloorHasWindow) break;
                }
            }

            // Phase B: Propagate slots upward through all upper floors
            for (let level = 1; level < numFloors; level++) {
                const floorBase = level * floorH;

                for (const slot of groundSlots) {
                    const f = slot.f;
                    const x = slot.x;

                    // Decide: window or wall AC?
                    let placeAC = false;
                    if (Math.random() < 0.2) {
                        if (type === 'factory' && factoryWallACs < 1) placeAC = true;
                        if ((type === 'house' || type === 'highrise') && !floorsWithWallAC[level]) placeAC = true;
                    }

                    if (placeAC) {
                        const isFactory = type === 'factory';
                        const acW = isFactory ? 4 : 3; // Use even width for factories to match even windows/doors
                        const acH = 2;
                        const acBase = floorBase + 2;
                        if (acBase + acH >= height) { /* skip AC */ } else {
                            const acGroundY = Math.floor(acBase);
                            const sx = x - Math.floor(acW / 2);
                            const sy = acGroundY - Math.floor(acH / 2);

                            let canPlace = true;
                            for (let ix = sx - 1; ix <= sx + acW; ix++) {
                                for (let iy = sy - 1; iy <= sy + acH; iy++) {
                                    if (ix < 1 || ix >= f.width - 1 || iy < 1 || iy >= f.height - 1 || f.occupancy[ix][iy]) {
                                        canPlace = false; break;
                                    }
                                }
                                if (!canPlace) break;
                            }

                            if (canPlace) {
                                for (let ix = sx - 1; ix <= sx + acW; ix++) {
                                    for (let iy = sy - 1; iy <= sy + acH; iy++) f.occupancy[ix][iy] = true;
                                }
                                // Mark global occupancy
                                for (let ix = sx; ix < sx + acW; ix++) {
                                    globalColumnOccupied.add(`${f.columns[ix].worldX},${f.columns[ix].worldZ}`);
                                }

                                 const firstCol = f.columns[Math.max(0, sx)];
                                 const lastCol = f.columns[Math.min(f.width - 1, sx + acW - 1)];
                                 const midX = (firstCol.worldX + lastCol.worldX + 1) / 2;
                                 const midZ = (firstCol.worldZ + lastCol.worldZ + 1) / 2;

                                 // Compute face position (surface: back at 0.51 if depth=0.6)
                                 const worldX = slot.worldPosX !== undefined
                                     ? slot.worldPosX + 0.31 * f.normal.dx
                                     : midX + 0.81 * f.normal.dx;
                                 const worldZ = slot.worldPosZ !== undefined
                                     ? slot.worldPosZ + 0.31 * f.normal.dz
                                     : midZ + 0.81 * f.normal.dz;

                                 assignedACs.push({
                                     pos: [worldX - cx, (acBase + acH / 2) - (height / 2), worldZ - cz],
                                     scale: [isFactory ? 4 : 3, 2, 1],
                                    color: type === 'house' ? colors.acResidential : colors.acIndustrial,
                                    rotation: f.rot,
                                    type: 'wall'
                                });
                                if (type === 'factory') factoryWallACs++;
                                floorsWithWallAC[level] = true;
                                continue;
                            }
                        } // end acBase height check
                    }

                    // Fallback: place window at this slot
                    const winBaseSlot = floorBase + PLAYER_HEIGHT - (type === 'factory' ? 2 : 1);
                    if (winBaseSlot + (type === 'factory' ? 2 : 1) >= height) continue;
                    const groundYWin = Math.floor(winBaseSlot);

                    let canPlaceWin = false;
                    let selectedWinW = type === 'factory' ? 4 : 1;
                    let selectedWinH = type === 'factory' ? 2 : 1;

                    // Try priority size
                    const checkPlacement = (w: number, h: number) => {
                        const sx = x - Math.floor(w / 2);
                        for (let ix = sx - 1; ix <= sx + w; ix++) {
                            for (let iy = groundYWin - 1; iy <= groundYWin + h; iy++) {
                                if (ix < 0 || ix >= f.width || iy < 0 || iy >= f.height || f.occupancy[ix][iy]) return false;
                            }
                        }
                        return true;
                    };

                    if (checkPlacement(selectedWinW, selectedWinH)) {
                        canPlaceWin = true;
                    } else if (type === 'factory' && checkPlacement(2, 2)) {
                        // Fallback to standard for factory if industrial fails
                        canPlaceWin = true;
                        selectedWinW = 2;
                        selectedWinH = 2;
                    }

                    if (canPlaceWin) {
                        const sx = x - Math.floor(selectedWinW / 2);
                        for (let ix = sx - 1; ix <= sx + selectedWinW; ix++) {
                            for (let iy = groundYWin - 1; iy <= groundYWin + selectedWinH; iy++) f.occupancy[ix][iy] = true;
                        }
                        for (let ix = sx; ix < sx + selectedWinW; ix++) {
                            globalColumnOccupied.add(`${f.columns[ix].worldX},${f.columns[ix].worldZ}`);
                        }
                        
                        const firstCol = f.columns[Math.max(0, sx)];
                        const lastCol = f.columns[Math.min(f.width - 1, sx + selectedWinW - 1)];
                        const midX = (firstCol.worldX + lastCol.worldX + 1) / 2;
                        const midZ = (firstCol.worldZ + lastCol.worldZ + 1) / 2;

                        // Use slot's world position if available (door-originated), else compute from columns
                        const worldX = slot.worldPosX !== undefined
                            ? slot.worldPosX
                            : midX + 0.501 * f.normal.dx;
                        const worldZ = slot.worldPosZ !== undefined
                            ? slot.worldPosZ
                            : midZ + 0.501 * f.normal.dz;
                        const worldYWin = (winBaseSlot + (selectedWinH / 2)) - (height / 2);

                        assignedWindows.push({
                            pos: [worldX - cx, worldYWin, worldZ - cz],
                            rot: f.rotVec
                        });
                        f.hasWindow = true;
                    }
                }
            }

            // PASS 3: Ladders - Prioritize empty walls (no door, no window)
            // One ladder per building limit is enforced by ladderPlaced flag.
            let ladderPlaced = false;

            if (facades.length > 0 && numFloors > 1) {
                // Shuffle facades for random selection
                const shuffledFacades = [...facades].sort(() => Math.random() - 0.5);

                // Priority 1: Empty walls (no door, no window)
                for (const f of shuffledFacades) {
                    if (ladderPlaced) break;
                    if (f.hasDoor || f.hasWindow) continue;
                    if (f.width < 3) continue;

                    const ladderW = 1;
                    const ladderH = Math.round(height);
                    const possiblePositions: number[] = [];
                    for (let x = 1; x <= f.width - ladderW - 1; x++) possiblePositions.push(x);
                    for (let i = possiblePositions.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [possiblePositions[i], possiblePositions[j]] = [possiblePositions[j], possiblePositions[i]];
                    }

                    for (const startX of possiblePositions) {
                        let canPlace = true;
                        for (let x = startX - 1; x <= startX + ladderW; x++) {
                            for (let y = 0; y < ladderH; y++) {
                                if (x < 0 || x >= f.width || y >= f.height || f.occupancy[x][y]) {
                                    canPlace = false; break;
                                }
                            }
                            if (!canPlace) break;
                            // NEW: Global occupancy check
                            if (globalColumnOccupied.has(`${f.columns[Math.max(0, Math.min(x, f.width - 1))].worldX},${f.columns[Math.max(0, Math.min(x, f.width - 1))].worldZ}`)) {
                                canPlace = false; break;
                            }
                        }

                        if (canPlace) {
                            for (let x = startX - 1; x <= startX + ladderW; x++) {
                                for (let y = 0; y < ladderH; y++) {
                                    if (x >= 0 && x < f.width && y < f.height) f.occupancy[x][y] = true;
                                }
                            }
                            // NEW: Mark global occupancy
                            for (let x = startX; x < startX + ladderW; x++) {
                                globalColumnOccupied.add(`${f.columns[x].worldX},${f.columns[x].worldZ}`);
                            }
                            const col = f.columns[startX];
                            const midX = col.worldX + 0.5;
                            const midZ = col.worldZ + 0.5;
                            const worldX = midX + 0.6 * f.normal.dx;
                            const worldZ = midZ + 0.6 * f.normal.dz;
                            const worldY = 0.5;
                            assignedLadders.push({
                                pos: [worldX - cx, worldY, worldZ - cz],
                                rot: f.rotVec,
                                height: height + 1.0
                            });
                            ladderPlaced = true;
                            break;
                        }
                    }
                }

                // Priority 2: Fallback to existing logic for multi-story/factories (if no ladder placed yet)
                if (!ladderPlaced && (numFloors >= 2 || type === 'factory') && Math.random() < 0.6) {
                    for (const f of shuffledFacades) {
                        if (ladderPlaced) break;
                        if (f.hasDoor) continue; // Still respect no ladders on doors
                        if (f.width < 3) continue;

                        const ladderW = 1;
                        const ladderH = Math.round(height);
                        const possiblePositions: number[] = [];
                        for (let x = 1; x <= f.width - ladderW - 1; x++) possiblePositions.push(x);
                        for (let i = possiblePositions.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [possiblePositions[i], possiblePositions[j]] = [possiblePositions[j], possiblePositions[i]];
                        }

                        for (const startX of possiblePositions) {
                            let canPlace = true;
                            for (let x = startX - 1; x <= startX + ladderW; x++) {
                                for (let y = 0; y < ladderH; y++) {
                                    if (x < 0 || x >= f.width || y >= f.height || f.occupancy[x][y]) {
                                        canPlace = false; break;
                                    }
                                }
                                if (!canPlace) break;
                                // NEW: Global occupancy check
                                if (globalColumnOccupied.has(`${f.columns[Math.max(0, Math.min(x, f.width - 1))].worldX},${f.columns[Math.max(0, Math.min(x, f.width - 1))].worldZ}`)) {
                                    canPlace = false; break;
                                }
                            }

                            if (canPlace) {
                                for (let x = startX - 1; x <= startX + ladderW; x++) {
                                    for (let y = 0; y < ladderH; y++) {
                                        if (x >= 0 && x < f.width && y < f.height) f.occupancy[x][y] = true;
                                    }
                                }
                                // NEW: Mark global occupancy
                                for (let x = startX; x < startX + ladderW; x++) {
                                    globalColumnOccupied.add(`${f.columns[x].worldX},${f.columns[x].worldZ}`);
                                }
                                const col = f.columns[startX];
                                const midX = col.worldX + 0.5;
                                const midZ = col.worldZ + 0.5;
                                const worldX = midX + 0.6 * f.normal.dx;
                                const worldZ = midZ + 0.6 * f.normal.dz;

                                const worldY = 0.5;
                                assignedLadders.push({
                                    pos: [worldX - cx, worldY, worldZ - cz],
                                    rot: f.rotVec,
                                    height: height + 1.0
                                });
                                ladderPlaced = true;
                                break;
                            }
                        }
                    }
                }
            }

            if (type === 'factory') {
                // UPDATED: Increase count to up to 3 objects
                const numRoofObjs = Math.floor(Math.random() * 3) + 1;

                for (let k = 0; k < numRoofObjs; k++) {
                    // FIXED: Increase padding to 2 to ensure objects are never on the very edge
                    const pad = 2;

                    // If building is too small to have padded interior (need at least 5x5 to have 1 center voxel with pad 2), skip
                    if (fillW < 5 || fillD < 5) continue;

                    // Calculate max available dimension for an object
                    const availObjW = fillW - 2 * pad;
                    const availObjD = fillD - 2 * pad;

                    if (availObjW < 1 || availObjD < 1) continue;

                    let acW = 1;
                    let acD = 1;

                    // "Fabricas menores" logic: Scale ACs down for small footprints
                    if (fillW < 12 || fillD < 12) {
                        // Prefer 2x2 ACs for small buildings, occasionally 4x2 if space permits
                        acW = (availObjW >= 4 && Math.random() > 0.7) ? 4 : 2;
                        acD = (availObjD >= 4 && Math.random() > 0.7) ? 4 : 2;
                    } else {
                        // Constant 2x2 dimensions as requested for grid alignment
                        acW = 2;
                        acD = 2;
                    }

                    const acRot = Math.floor(Math.random() * 4) * (Math.PI / 2);
                    let visualW = acW;
                    let visualD = acD;
                    if (Math.abs(Math.sin(acRot)) > 0.5) {
                        visualW = acD;
                        visualD = acW;
                    }

                    // Fixed height: 2.0 units (Minimum height as requested)
                    const acH = 2.0;

                    // Range calculation
                    const rangeX = fillW - 2 * pad - visualW;
                    const rangeZ = fillD - 2 * pad - visualD;

                    if (rangeX < 0 || rangeZ < 0) continue;

                    // Random position within safe zone (integers for grid index)
                    const rx = Math.floor(Math.random() * (rangeX + 1)) + pad;
                    const rz = Math.floor(Math.random() * (rangeZ + 1)) + pad;

                    let overlap = false;

                    // Check Procedural mask overlap for the actual visual footprint
                    for (let wx = 0; wx < visualW; wx++) {
                        for (let wz = 0; wz < visualD; wz++) {
                            const gridX = rx + wx;
                            const gridZ = rz + wz;
                            if (gridX >= 0 && gridX < fillW && gridZ >= 0 && gridZ < fillD) {
                                if (!mask[gridX][gridZ]) overlap = true;
                            }
                        }
                    }

                    // Relative position from center calc
                    // Using .0 or .5 snapped centers
                    const checkX = rx - fillW / 2 + visualW / 2;
                    const checkZ = rz - fillD / 2 + visualD / 2;

                    // Overlap Check (using approximate radius)
                    for (const ac of assignedACs) {
                        const dx = ac.pos[0] - checkX;
                        const dz = ac.pos[2] - checkZ;
                        if (Math.sqrt(dx * dx + dz * dz) < 2.5) overlap = true;
                    }
                    for (const ch of attachedChimneys) {
                        const dx = ch.pos[0] - checkX;
                        const dz = ch.pos[2] - checkZ;
                        if (Math.sqrt(dx * dx + dz * dz) < 2.5) overlap = true;
                    }

                    if (!overlap) {
                        const isChimney = Math.random() > 0.6;
                        const worldX = cx + checkX;
                        const worldZ = cz + checkZ;
                        const isNearMapEdge = Math.abs(worldX) > (halfSize - 6) || Math.abs(worldZ) > (halfSize - 6);

                        if (isChimney && !isNearMapEdge) {
                            // Chimney is always 2x2. Verify that 2x2 footprint also clears mask.
                            let chimneyOverlap = false;
                            for (let wx = 0; wx < 2; wx++) {
                                for (let wz = 0; wz < 2; wz++) {
                                    const cX = Math.floor(checkX + fillW / 2 - 1);
                                    const cZ = Math.floor(checkZ + fillD / 2 - 1);
                                    if (cX + wx >= 0 && cX + wx < fillW && cZ + wz >= 0 && cZ + wz < fillD && !mask[cX + wx]?.[cZ + wz]) chimneyOverlap = true;
                                }
                            }

                            if (!chimneyOverlap) {
                                // Industrial chimneys always start from the roof
                                const chimneyHeight = 4.0 + Math.random() * 8.0;
                                // Positioned so its base is exactly at the building height
                                const ly = (height / 2) + (chimneyHeight / 2);

                                attachedChimneys.push({
                                    pos: [checkX, ly, checkZ],
                                    scale: [2, chimneyHeight, 2],
                                    color: colors.chimneyIndustrial,
                                    smoke: true,
                                    rotation: 0
                                });
                            }
                        } else {
                            const posY = height / 2 + acH / 2;
                            assignedACs.push({
                                pos: [checkX, posY, checkZ],
                                scale: [acW, acH, acD],
                                color: colors.acIndustrial,
                                rotation: acRot,
                                type: 'roof'
                            });
                        }
                    }
                }
            }

            const buildingObj: VoxelObject = {
                id: buildingId,
                position: [cx, height / 2, cz],
                scale: [fillW, height, fillD],
                color: baseColor,
                type: objType,
                shape: { active: true, points: simplifyPolygonPoints(points), mask },
                variant: variant,
                windows: assignedWindows,
                attachedChimneys: attachedChimneys,
                doors: assignedDoors,
                acs: assignedACs,
                ladders: assignedLadders
            };
            objects.push(buildingObj);
        };
    };

    // --- MAIN LOOP ---
    const decorators: (() => void)[] = [];

    // --- CITY LAYOUT GENERATION (BSP Slicer) ---
    interface Plot { x: number; z: number; w: number; d: number; }
    const plots: Plot[] = [{
        x: -halfSize + 2,
        z: -halfSize + 2,
        w: size - 4,
        d: size - 4
    }];

    const finalPlots: Plot[] = [];

    while (plots.length > 0) {
        const p = plots.shift()!;
        
        if (p.w <= maxBlockSize && p.d <= maxBlockSize) {
            // Plot is small enough, but check if we want to randomly slice it anyway for variation
            if (p.w >= minBlockSize * 2 + baseStreetWidth || p.d >= minBlockSize * 2 + baseStreetWidth) {
                if (Math.random() > 0.15) { 
                     // Force continue to slice
                } else {
                     finalPlots.push(p);
                     continue;
                }
            } else {
                if (p.w >= minBlockSize && p.d >= minBlockSize) finalPlots.push(p);
                continue;
            }
        }

        let splitHoriz = p.d > p.w;
        if (p.d >= minBlockSize * 2 + baseStreetWidth && p.w >= minBlockSize * 2 + baseStreetWidth) {
             splitHoriz = p.d > p.w ? Math.random() > 0.2 : Math.random() > 0.8;
        }

        if (splitHoriz) {
            if (p.d < minBlockSize * 2 + baseStreetWidth) {
                if (p.w >= minBlockSize * 2 + baseStreetWidth) splitHoriz = false; // Fallback to vertical
                else {
                    if (p.w >= minBlockSize && p.d >= minBlockSize) finalPlots.push(p);
                    continue;
                }
            }
        }
        
        if (!splitHoriz) {
            if (p.w < minBlockSize * 2 + baseStreetWidth) {
                 if (p.d >= minBlockSize * 2 + baseStreetWidth) splitHoriz = true; // Fallback to horizontal
                 else {
                     if (p.w >= minBlockSize && p.d >= minBlockSize) finalPlots.push(p);
                     continue;
                 }
            }
        }

        if (splitHoriz) {
            // The split point must leave at least minBlockSize space on both sides
            const splitZ = minBlockSize + Math.floor(Math.random() * (p.d - baseStreetWidth - minBlockSize * 2 + 1));
            plots.push({ x: p.x, z: p.z, w: p.w, d: splitZ });
            plots.push({ x: p.x, z: p.z + splitZ + baseStreetWidth, w: p.w, d: p.d - splitZ - baseStreetWidth });
        } else {
            const splitX = minBlockSize + Math.floor(Math.random() * (p.w - baseStreetWidth - minBlockSize * 2 + 1));
            plots.push({ x: p.x, z: p.z, w: splitX, d: p.d });
            plots.push({ x: p.x + splitX + baseStreetWidth, z: p.z, w: p.w - splitX - baseStreetWidth, d: p.d });
        }
    }

    // Shuffle finalPlots to balance type generation
    for (let i = finalPlots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [finalPlots[i], finalPlots[j]] = [finalPlots[j], finalPlots[i]];
    }

    let pIndex = 0;
    while (pIndex < finalPlots.length) {
        const plot = finalPlots[pIndex];
        pIndex++;
        const dec = placeBuilding(plot.x, plot.z, plot.w, plot.d);
        if (dec) {
            decorators.push(dec);
        } else {
             // Subdivide if it failed (e.g. hit water or small fit rules)
             const splitHoriz = plot.d > plot.w;
             if (splitHoriz && plot.d >= minBlockSize * 2 + baseStreetWidth) {
                 const splitZ = Math.floor((plot.d - baseStreetWidth) / 2);
                 finalPlots.push({ x: plot.x, z: plot.z, w: plot.w, d: Math.max(minBlockSize, splitZ) });
                 finalPlots.push({ x: plot.x, z: plot.z + splitZ + baseStreetWidth, w: plot.w, d: Math.max(minBlockSize, plot.d - splitZ - baseStreetWidth) });
             } else if (!splitHoriz && plot.w >= minBlockSize * 2 + baseStreetWidth) {
                 const splitX = Math.floor((plot.w - baseStreetWidth) / 2);
                 finalPlots.push({ x: plot.x, z: plot.z, w: Math.max(minBlockSize, splitX), d: plot.d });
                 finalPlots.push({ x: plot.x + splitX + baseStreetWidth, z: plot.z, w: Math.max(minBlockSize, plot.w - splitX - baseStreetWidth), d: plot.d });
             }
        }
    }

    // --- DECORATIONS PHASE (Step 6) ---
    // Execute building decorators
    decorators.forEach(d => d());

    // Fences
    const visitedForFences = new Set<string>();
    for (let x = 0; x < size; x++) {
        for (let z = 0; z < size; z++) {
            const type = tGrid[x][z];
            const key = `${x},${z}`;
            if (type === 4 && !visitedForFences.has(key)) {
                // Determine cluster for this type
                let clusterMinX = x, clusterMaxX = x, clusterMinZ = z, clusterMaxZ = z;
                const clusterTiles: [number, number][] = [];
                const clusterSet = new Set<string>();
                const queue: [number, number][] = [[x, z]];

                clusterSet.add(key);
                visitedForFences.add(key);

                while (queue.length > 0) {
                    const [cx, cz] = queue.shift()!;
                    clusterTiles.push([cx, cz]);
                    clusterMinX = Math.min(clusterMinX, cx);
                    clusterMaxX = Math.max(clusterMaxX, cx);
                    clusterMinZ = Math.min(clusterMinZ, cz);
                    clusterMaxZ = Math.max(clusterMaxZ, cz);

                    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
                    for (const [ndx, ndz] of neighbors) {
                        const nx = cx + ndx;
                        const nz = cz + ndz;
                        if (nx >= 0 && nx < size && nz >= 0 && nz < size && tGrid[nx][nz] === type) {
                            const nkey = `${nx},${nz}`;
                            if (!clusterSet.has(nkey)) {
                                clusterSet.add(nkey);
                                visitedForFences.add(nkey);
                                queue.push([nx, nz]);
                            }
                        }
                    }
                }

                const clusterW = clusterMaxX - clusterMinX + 1;
                const clusterD = clusterMaxZ - clusterMinZ + 1;

                // Minimum 3x3 cluster to warrant a fence for Farms
                if (clusterW >= 3 && clusterD >= 3) {
                    for (const [tx, tz] of clusterTiles) {
                        let isEdge = false;
                        let touchesWater = false;
                        const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
                        for (const [dx, dz] of neighbors) {
                            const nx = tx + dx;
                            const nz = tz + dz;
                            if (nx < 0 || nx >= size || nz < 0 || nz >= size || tGrid[nx][nz] !== 4) {
                                isEdge = true;
                                if (isWaterLogic(nx - halfSize, nz - halfSize)) {
                                    touchesWater = true;
                                }
                            }
                        }
                        if (isEdge && !touchesWater && Math.random() > 0.02) {
                            fenceLocations.add(`${tx},${tz}`);
                        }
                    }
                }
            }
        }
    }

    fenceLocations.forEach(loc => {
        const [xStr, zStr] = loc.split(',');
        const x = parseInt(xStr);
        const z = parseInt(zStr);

        const neighbors = {
            n: fenceLocations.has(`${x},${z - 1}`),
            s: fenceLocations.has(`${x},${z + 1}`),
            e: fenceLocations.has(`${x + 1},${z}`),
            w: fenceLocations.has(`${x - 1},${z}`)
        };

        const lx = x - halfSize + 0.5; // Center of the tile
        const lz = z - halfSize + 0.5;

        const neighborCount = [neighbors.n, neighbors.s, neighbors.e, neighbors.w].filter(Boolean).length;
        const isStraightNS = neighbors.n && neighbors.s && !neighbors.e && !neighbors.w;
        const isStraightEW = !neighbors.n && !neighbors.s && neighbors.e && neighbors.w;

        let shouldBePost = (x + z) % 2 === 0;
        if (neighborCount === 1) shouldBePost = true; // Terminal pieces must be posts
        if (neighborCount > 2) shouldBePost = true; // Junctions must be posts
        if (neighborCount === 2 && !isStraightNS && !isStraightEW) shouldBePost = true; // Corners must be posts

        objects.push({
            id: uid(`fence-${x}-${z}`),
            position: [lx, 0, lz], // Anchored to base floor
            scale: [2, 1.66, 2], // Height scaled to ~2.0 units (half the 4.0 player)
            color: colors.fenceWood,
            type: 'fence',
            neighbors: neighbors,
            isPost: shouldBePost
        });
    });

    // Wheat (Decoration for Farms)
    for (let x = 0; x < size; x++) {
        for (let z = 0; z < size; z++) {
            if (tGrid[x][z] === 4) {
                // Skip planting on the exact edge where a fence is located
                if (fenceLocations.has(`${x},${z}`)) continue;

                const logicX = x - halfSize + 0.5; // Center of the tile
                const logicZ = z - halfSize + 0.5;

                // Exactly 1 huge crop cluster per farm block
                const scaleY = PLAYER_HEIGHT;
                objects.push({
                    id: uid(`wheat-${logicX}-${logicZ}`),
                    position: [logicX, 0, logicZ], // Anchor geometry bottom to floor
                    scale: [1.0, scaleY, 1.0], // Full 1.0 thickness
                    rotation: Math.random() * Math.PI * 2, // Random Y Rotation
                    color: '#fde047',
                    type: 'wheat'
                });
            }
        }
    }

    // Foliage (Flowers and Grass clumps) - Updated to be larger clusters
    const foliageClusterCount = Math.floor(size * (settings.ratios.foliage / 20) * 1.5);
    const flowerColors = ['#f43f5e', '#ec4899', '#d946ef', '#a855f7', '#8b5cf6', '#3b82f6', '#0ea5e9', '#ef4444', '#f97316', '#14b8a6', '#facc15'];
    for (let i = 0; i < foliageClusterCount; i++) {
        let attempts = 20;
        while (attempts > 0) {
            const x = Math.floor(Math.random() * (size - 6)) + 3;
            const z = Math.floor(Math.random() * (size - 6)) + 3;

            // Check for a small clear area (2x2)
            let clusterClear = true;
            for (let dx = 0; dx < 2; dx++) {
                for (let dz = 0; dz < 2; dz++) {
                    if (x + dx >= size || z + dz >= size || tGrid[x + dx][z + dz] !== 0 || isWaterLogic(x + dx - halfSize, z + dz - halfSize)) {
                        clusterClear = false;
                        break;
                    }
                }
                if (!clusterClear) break;
            }

            if (clusterClear) {
                // Determine cluster dimensions (between 1x2 and 2x2 voxels visually)
                const cW = 1 + (Math.random() > 0.5 ? 1 : 0);
                const cD = 1 + (Math.random() > 0.5 ? 1 : 0);

                const logicX = x - halfSize + (cW / 2);
                const logicZ = z - halfSize + (cD / 2);

                objects.push({
                    id: uid(`foliage-${x}-${z}-${i}`),
                    position: [logicX, 0, logicZ],
                    scale: [cW, 1.2, cD], // Taller and wider
                    rotation: Math.random() * Math.PI,
                    color: flowerColors[Math.floor(Math.random() * flowerColors.length)],
                    type: 'foliage'
                });
                break;
            }
            attempts--;
        }
    }

    // --- BUILD 3D COLLISION BOXES ---
    objects.forEach(obj => {
        // --- CUSTOM FENCE COLLISION (Thin 3D Boxes) ---
        if (obj.type === 'fence') {
            const logicWX = obj.position[0];
            const logicWZ = obj.position[2];
            const cellSize = 1.0 / GRID_SCALE;

            // Pillar box (1.2 tall)
            collisionGrid.insert({
                minX: logicWX - cellSize / 2,
                minY: 0,
                minZ: logicWZ - cellSize / 2,
                maxX: logicWX + cellSize / 2,
                maxY: 1.2,
                maxZ: logicWZ + cellSize / 2
            });

            // Neighbor rails as thin boxes
            if (obj.neighbors?.s) {
                collisionGrid.insert({
                    minX: logicWX - cellSize / 2,
                    minY: 0,
                    minZ: logicWZ + cellSize / 2,
                    maxX: logicWX + cellSize / 2,
                    maxY: 1.0,
                    maxZ: logicWZ + cellSize * 1.5
                });
            }
            if (obj.neighbors?.e) {
                collisionGrid.insert({
                    minX: logicWX + cellSize / 2,
                    minY: 0,
                    minZ: logicWZ - cellSize / 2,
                    maxX: logicWX + cellSize * 1.5,
                    maxY: 1.0,
                    maxZ: logicWZ + cellSize / 2
                });
            }
            return;
        }

        if (obj.type === 'wheat' || obj.type === 'foliage') {
            // Wheat and foliage should be non-collidable for gameplay
            return;
        }

        const w = obj.scale[0];
        const h = obj.scale[1];
        const d = obj.scale[2];

        const posX = obj.position[0];
        const posY = obj.position[1];
        const posZ = obj.position[2];

        const topY = posY + h / 2;
        const botY = posY - h / 2;
        const collisionTop = topY + (obj.type !== 'ruin' ? 0.3 : 0);

        // Procedural building footprints using multiple collision strips
        if (obj.shape && obj.shape.active) {
            const { mask } = obj.shape;
            const mWidth = mask.length;
            const mDepth = mask[0].length;
            
            const startX = posX - w / 2;
            const startZ = posZ - d / 2;

            for (let i = 0; i < mWidth; i++) {
                let j = 0;
                while (j < mDepth) {
                    if (mask[i][j]) {
                        // Find how long this run is in Z
                        let runLength = 1;
                        while (j + runLength < mDepth && mask[i][j + runLength]) {
                            runLength++;
                        }
                        
                        // Insert a collision box for this 1xRun strip
                        collisionGrid.insert({
                            minX: startX + i,
                            minY: botY,
                            minZ: startZ + j,
                            maxX: startX + i + 1,
                            maxY: collisionTop,
                            maxZ: startZ + j + runLength
                        });
                        
                        j += runLength;
                    } else {
                        j++;
                    }
                }
            }
        } else {
            // Standard rectangular building: one box
            if (botY > 1.0) {
                // Elevated object → bridge grid (keep legacy behavior)
                const startXLogic = posX - w / 2;
                const startZLogic = posZ - d / 2;
                const startXHigh = Math.round((startXLogic + halfSize) * GRID_SCALE);
                const startZHigh = Math.round((startZLogic + halfSize) * GRID_SCALE);
                const wHigh = Math.round(w * GRID_SCALE);
                const dHigh = Math.round(d * GRID_SCALE);
                for (let ix = 0; ix < wHigh; ix++) {
                    for (let iz = 0; iz < dHigh; iz++) {
                        const gridX = startXHigh + ix;
                        const gridZ = startZHigh + iz;
                        if (gridX >= 0 && gridX < gridSize && gridZ >= 0 && gridZ < gridSize) {
                            bGrid[gridX][gridZ] = Math.max(bGrid[gridX][gridZ], collisionTop);
                        }
                    }
                }
            } else {
                // Ground-level object → 3D collision box
                collisionGrid.insert({
                    minX: posX - w / 2,
                    minY: botY,
                    minZ: posZ - d / 2,
                    maxX: posX + w / 2,
                    maxY: collisionTop,
                    maxZ: posZ + d / 2
                });
            }
        }
    });

    // --- SECOND PASS: collision boxes for ALL DETAILS (chimneys, ACs) ---
    objects.forEach(obj => {
        const details = [
            ...(obj.attachedChimneys || []).map(c => ({ ...c, isChimney: true, detailType: 'chimney' })),
            ...(obj.acs || []).map(a => ({ ...a, isChimney: false, detailType: a.type }))
        ];

        details.forEach(det => {
            let dW = det.scale[0];
            const dH = det.scale[1];
            let dD = det.scale[2];

            if (det.rotation !== undefined && Math.abs(Math.sin(det.rotation)) > 0.5) {
                const temp = dW;
                dW = dD;
                dD = temp;
            }

            const absX = obj.position[0] + det.pos[0];
            const absY = obj.position[1] + det.pos[1];
            const absZ = obj.position[2] + det.pos[2];

            const topH = absY + dH / 2;
            const botH = absY - dH / 2;

            // Insert 3D collision box for the detail
            collisionGrid.insert({
                minX: absX - dW / 2,
                minY: botH,
                minZ: absZ - dD / 2,
                maxX: absX + dW / 2,
                maxY: topH,
                maxZ: absZ + dD / 2
            });
        });
    });

    // --- THIRD PASS: Collect ladder zones for physics ---
    const ladderZones: { minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, faceAngle: number, railX: number, railZ: number }[] = [];
    objects.forEach(obj => {
        if (!obj.ladders || obj.ladders.length === 0) return;
        obj.ladders.forEach(ladder => {
            // Ladder pos is relative to building center (obj.position)
            const absX = obj.position[0] + ladder.pos[0];
            const absZ = obj.position[2] + ladder.pos[2];
            const buildingBottom = obj.position[1] - obj.scale[1] / 2;
            const buildingTop = obj.position[1] + obj.scale[1] / 2;

            // Ladder rotation rotY is the facade outward normal angle.
            // Player should face INTO the wall = opposite of outward normal = rotY + PI
            const rotY = ladder.rot[1];
            let faceAngle = rotY + Math.PI;
            // Normalize to [-PI, PI]
            if (faceAngle > Math.PI) faceAngle -= Math.PI * 2;
            if (faceAngle < -Math.PI) faceAngle += Math.PI * 2;

            // The climbable zone extends slightly outward from the wall
            const zoneRadius = 2.0;
            ladderZones.push({
                minX: absX - zoneRadius,
                minY: buildingBottom,
                minZ: absZ - zoneRadius,
                maxX: absX + zoneRadius,
                maxY: buildingTop + 1.0, // Allow climbing slightly past the top
                maxZ: absZ + zoneRadius,
                faceAngle,
                railX: absX,
                railZ: absZ
            });
        });
    });

    // --- DEFAULT SPAWN POINT (Menu/Preview) ---
    // Ensure we pick a real ground position in a random quadrant for the initial reveal
    const spawnQuad = (Math.floor(Math.random() * 4) + 1) as 1 | 2 | 3 | 4;
    const spawnPos = findSpawnPos(size, halfSize, tGrid, collisionGrid, wGrid, isWaterLogic, spawnQuad);

    // Populate sGrid with Water where applicable (if not overwritten by objects)
    for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
            if (wGrid[x][z] === 1 && sGrid[x][z] === 0) {
                sGrid[x][z] = 1; // Water
            }
        }
    }

    return { objects, collisionGrid, bGrid, wGrid, sGrid, tGrid, spawnPos, ladderZones, riverOrientation: hasRiver ? riverOrientation : -1, riverFlow: hasRiver ? settings.riverFlow : 0, worldSize: size };
};
