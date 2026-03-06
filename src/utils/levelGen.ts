
import * as THREE from 'three';
import { VoxelObject, GameSettings, Position } from '../types';
import { worldToIndex, GRID_SCALE, PLAYER_HEIGHT, SpatialHashGrid, CollisionBox } from './physics';

export const findSpawnPos = (
    size: number,
    halfSize: number,
    tGrid: number[][],
    collisionGrid: SpatialHashGrid,
    wGrid: number[][],
    isWaterLogic: (lx: number, lz: number) => boolean
) => {
    let bestPos = new THREE.Vector3(0, 10, 0);
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
        const rx = Math.floor(Math.random() * (size - safePadding * 2)) + safePadding;
        const rz = Math.floor(Math.random() * (size - safePadding * 2)) + safePadding;

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
                const score = getClearanceScore(rx, rz);
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

    // If no safe spot found on street, try any spot without water or tall objects
    const gridSize = size * GRID_SCALE;
    for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
            if (wGrid[x][z] === 0) {
                const logicX = (x + 0.5) / GRID_SCALE - halfSize;
                const logicZ = (z + 0.5) / GRID_SCALE - halfSize;
                const nearby = collisionGrid.query(logicX, logicZ, 0.5);
                let maxH = 0;
                for (const box of nearby) {
                    if (logicX >= box.minX && logicX <= box.maxX && logicZ >= box.minZ && logicZ <= box.maxZ) {
                        if (box.maxY > maxH) maxH = box.maxY;
                    }
                }
                if (maxH < 2.0) {
                    bestPos.set(logicX, maxH, logicZ);
                    return bestPos;
                }
            }
        }
    }

    // Ultimate fallback if map is completely filled (unlikely)
    bestPos.set(0, 10, 0);
    return bestPos;
};

export const generateCityLevel = (

    pSpawn: THREE.Vector2,
    settings: GameSettings,
    mapId: number, // ID unique to this match generation
    debugMode: boolean = false
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
    const globalWallOccupied = new Set<string>();
    const globalColumnOccupied = new Set<string>();
    const fenceLocations = new Set<string>();

    const getPosKey = (x: number, y: number, z: number) => `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;

    const baseStreetWidth = 3;
    const minBlockSize = 4;
    const maxBlockSize = 18;

    let acClusterHeat = 0.0;

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
        const maxSteps = size * 3;
        for (let i = 0; i < maxSteps; i++) {
            const width = minWidth + Math.floor(Math.random() * (maxWidth - minWidth + 1));
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
            if (riverOrientation === 0) { // N-S flow
                cz += dz;
                if (Math.random() > 0.7) cx += (Math.random() > 0.5 ? 1 : -1);
                else if (Math.abs(tx - cx) > 1) cx += dx * 0.5;
            } else { // E-W flow
                cx += dx;
                if (Math.random() > 0.7) cz += (Math.random() > 0.5 ? 1 : -1);
                else if (Math.abs(tz - cz) > 1) cz += dz * 0.5;
            }

            // Stop if reached the target edge
            if (endEdge === 0 && cz <= tz) break;
            if (endEdge === 1 && cx >= tx) break;
            if (endEdge === 2 && cz >= tz) break;
            if (endEdge === 3 && cx <= tx) break;
            if (Math.abs(cx) > halfSize + 5 || Math.abs(cz) > halfSize + 5) break;
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

    const getZoneInfo = (cx: number, cz: number, range: number) => {
        let nearHighrise = false;
        let nearFarm = false;
        const rangeStart = -range;
        const rangeEnd = range;

        for (let x = rangeStart; x <= rangeEnd; x++) {
            for (let z = rangeStart; z <= rangeEnd; z++) {
                if (x === 0 && z === 0) continue;
                // tGrid check needs logic coords (no worldToIndex scaling needed, just bounds check)
                const lx = cx + x + halfSize;
                const lz = cz + z + halfSize;

                if (lx >= 0 && lx < size && lz >= 0 && lz < size) {
                    const type = tGrid[lx][lz];
                    if (type === 2 || type === 3) nearHighrise = true;
                    if (type === 4) nearFarm = true;
                }
            }
        }
        return { nearHighrise, nearFarm };
    };

    // --- PLACE BUILDING ---
    const placeBuilding = (bx: number, bz: number, bw: number, bd: number, forcedType?: 'farm' | 'ruins' | 'house' | 'factory' | 'highrise', categoryFilter?: 'farm' | 'building' | 'ruins'): (() => void) | null => {
        acClusterHeat *= 0.99;
        const blockArea = bw * bd;

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
        let typeId = typeIdMap[selectedType];

        if (selectedType === 'farm') {
            // New Requirement: Enforce minimum width/depth of 3 voxels for the farm block
            if (bw < 3 || bd < 3) return null;

            // Check gap rule for farm (treated as construction)
            for (let i = -2; i < bw + 2; i++) {
                for (let j = -2; j < bd + 2; j++) {
                    const tx = bx + i + halfSize;
                    const tz = bz + j + halfSize;
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
                            totalBuiltArea++;
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
        if (selectedType === 'factory') { type = 'factory'; typeId = 2; }
        else if (selectedType === 'house') { type = 'house'; typeId = 1; }
        else if (selectedType === 'highrise') { type = 'highrise'; typeId = 3; }

        const availW = bw;
        const availD = bd;

        let fillW = Math.floor(availW);
        let fillD = Math.floor(availD);

        if (type === 'factory') {
            fillW = Math.max(10, fillW);
            fillD = Math.max(10, fillD);
            if (fillW > bw || fillD > bd) {
                type = 'house';
                typeId = 1;
                fillW = Math.min(fillW, bw);
                fillD = Math.min(fillD, bd);
            }
        }

        if (fillW <= 4 && fillD <= 4) {
            if (bw >= 6) fillW = 6;
            else if (bd >= 6) fillD = 6;
            else return null;
        }

        if (fillW % 2 !== 0) fillW = Math.max(4, fillW - 1);
        if (fillD % 2 !== 0) fillD = Math.max(4, fillD - 1);

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
                if (tx >= 0 && tx < size && tz >= 0 && tz < size) {
                    const nType = tGrid[tx][tz];
                    if (nType !== 0 && nType !== typeId) {
                        const nearX = ix < 0 ? -ix : (ix >= fillW ? ix - fillW + 1 : 0);
                        const nearZ = jz < 0 ? -jz : (jz >= fillD ? jz - fillD + 1 : 0);
                        if (nearX < baseStreetWidth && nearZ < baseStreetWidth) return null;
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
            height = (Math.floor(Math.random() * 2) + 1) * floorH; // 1-2 floors
        } else {
            height = (Math.floor(Math.random() * 5) + 2) * floorH; // 2-6 floors
            if (height > 3 * floorH && (fillW < 4 || fillD < 4)) height = 3 * floorH;
        }

        const canBeL = fillW >= 6 && fillD >= 6;
        const isLShape = canBeL && Math.random() > 0.4;

        let lShapeConfig = undefined;
        let cutMask: boolean[][] = Array(fillW).fill(null).map(() => Array(fillD).fill(false));

        if (isLShape) {
            const cutCorner = Math.floor(Math.random() * 4) as 0 | 1 | 2 | 3;
            let cutW = Math.max(2, Math.floor(fillW * (0.3 + Math.random() * 0.3)));
            let cutD = Math.max(2, Math.floor(fillD * (0.3 + Math.random() * 0.3)));

            if (cutW % 2 !== 0) cutW -= 1;
            if (cutD % 2 !== 0) cutD -= 1;
            if (cutW < 2) cutW = 2;
            if (cutD < 2) cutD = 2;

            lShapeConfig = {
                active: true,
                cutCorner: cutCorner,
                cutSize: [cutW, cutD] as [number, number]
            };

            for (let i = 0; i < fillW; i++) {
                for (let j = 0; j < fillD; j++) {
                    let inCut = false;
                    if (cutCorner === 0 && i >= fillW - cutW && j >= fillD - cutD) inCut = true;
                    if (cutCorner === 1 && i >= fillW - cutW && j < cutD) inCut = true;
                    if (cutCorner === 2 && i < cutW && j < cutD) inCut = true;
                    if (cutCorner === 3 && i < cutW && j >= fillD - cutD) inCut = true;
                    cutMask[i][j] = inCut;
                }
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

        const buildingWallDoorTypes = new Set<string>();

        let placedCount = 0;
        for (let i = 0; i < fillW; i++) {
            for (let j = 0; j < fillD; j++) {
                if (isLShape && cutMask[i][j]) continue;
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
                if (isLShape && cutMask[lx][lz]) return false;
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

                                const wallLength = distL + distR + 1;
                                const minDist = Math.min(distL, distR);

                                // Padding requirements based on wall length
                                // Walls >= 6: Need 2 blocks from corner for "premium" centered look
                                // Walls >= 3: Need at least 1 block from corner (centers a middle block)
                                if (wallLength >= 6 && minDist < 2) continue;
                                if (wallLength >= 3 && minDist < 1) continue;
                                if (wallLength < 3) continue;

                                let solidAirNeighbors = 0;
                                const airLocalX = i + n.dx;
                                const airLocalZ = j + n.dz;
                                if (isSolid(airLocalX + 1, airLocalZ)) solidAirNeighbors++;
                                if (isSolid(airLocalX - 1, airLocalZ)) solidAirNeighbors++;
                                if (isSolid(airLocalX, airLocalZ + 1)) solidAirNeighbors++;
                                if (isSolid(airLocalX, airLocalZ - 1)) solidAirNeighbors++;
                                if (solidAirNeighbors > 1) continue;

                                // L-Shape Inner Corner Check: for faces pointing into the cut area,
                                // recalculate wall distances along the inner wall segment only.
                                // This prevents features from being placed too close to inner corners.
                                if (isLShape && airLocalX >= 0 && airLocalX < fillW && airLocalZ >= 0 && airLocalZ < fillD && cutMask[airLocalX][airLocalZ]) {
                                    // Count only cells whose air cell is also in the cut
                                    let innerDistL = 0;
                                    let p = 1;
                                    while (isSolid(i + tX * p, j + tZ * p)) {
                                        const ax = i + tX * p + n.dx;
                                        const az = j + tZ * p + n.dz;
                                        if (ax < 0 || ax >= fillW || az < 0 || az >= fillD || !cutMask[ax][az]) break;
                                        innerDistL++;
                                        p++;
                                    }
                                    let innerDistR = 0;
                                    p = 1;
                                    while (isSolid(i - tX * p, j - tZ * p)) {
                                        const ax = i - tX * p + n.dx;
                                        const az = j - tZ * p + n.dz;
                                        if (ax < 0 || ax >= fillW || az < 0 || az >= fillD || !cutMask[ax][az]) break;
                                        innerDistR++;
                                        p++;
                                    }
                                    const innerWallLen = innerDistL + innerDistR + 1;
                                    const innerMinDist = Math.min(innerDistL, innerDistR);
                                    if (innerWallLen >= 6 && innerMinDist < 2) continue;
                                    if (innerWallLen >= 3 && innerMinDist < 1) continue;
                                    if (innerWallLen < 3) continue;
                                }

                                // Include facade ID for grouping (normal + plane offset)
                                const facadeId = `${n.dx},${n.dz}:${(n.dx !== 0 ? airX : airZ)}`;

                                const biasDist = distL - distR;

                                columns.push({
                                    worldX: airX, worldZ: airZ,
                                    dx: n.dx, dz: n.dz,
                                    rot: n.rot, rotVec: n.rotVec,
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
                rotVec: number[];
                columns: WallColumn[];
                width: number;
                height: number;
                occupancy: boolean[][];
                hasDoor: boolean;
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

                // Sort columns linearly.
                const axis = dx !== 0 ? 'worldZ' : 'worldX';
                cols.sort((a, b) => a[axis] - b[axis]);

                const vH = Math.round(height);
                facades.push({
                    id,
                    normal: n,
                    rot: cols[0].rot,
                    rotVec: cols[0].rotVec,
                    columns: cols,
                    width: cols.length,
                    height: vH,
                    occupancy: Array(cols.length).fill(null).map(() => Array(vH).fill(false)),
                    hasDoor: false
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
                    let dType: 'standard' | 'industrial' = (type === 'factory' && indDoorsCount < 1) ? 'industrial' : 'standard';
                    if (type === 'factory' && Math.random() > 0.5) dType = 'industrial';

                    const dW = dType === 'industrial' ? 4 : 2;
                    const dH = dType === 'industrial' ? 6 : 4;

                    // Define possible starting positions with at least 1-voxel pad from sides
                    const possibleStarts: number[] = [];
                    for (let x = 1; x <= f.width - dW - 1; x++) possibleStarts.push(x);

                    // Shuffle starts to allow non-centered placement
                    for (let i = possibleStarts.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [possibleStarts[i], possibleStarts[j]] = [possibleStarts[j], possibleStarts[i]];
                    }

                    for (const startX of possibleStarts) {
                        let canPlace = true;
                        // Check area for door + 1 voxel pad (sides and top)
                        for (let x = startX - 1; x <= startX + dW; x++) {
                            for (let y = 0; y <= dH; y++) {
                                if (x < 0 || x >= f.width || y >= f.height || f.occupancy[x][y]) { canPlace = false; break; }
                            }
                            if (!canPlace) break;
                            if (globalColumnOccupied.has(`${f.columns[Math.max(0, Math.min(x, f.width - 1))].worldX},${f.columns[Math.max(0, Math.min(x, f.width - 1))].worldZ}`)) { canPlace = false; break; }
                        }

                        if (canPlace) {
                            // Mark occupancy including 1-voxel pad
                            for (let x = startX - 1; x <= startX + dW; x++) {
                                for (let y = 0; y <= dH; y++) {
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
                            const worldX = (firstCol.worldX + lastCol.worldX) / 2;
                            const worldZ = (firstCol.worldZ + lastCol.worldZ) / 2;

                            assignedDoors.push({
                                pos: [(worldX - f.normal.dx * 0.5) - cx + 0.5, ly, (worldZ - f.normal.dz * 0.5) - cz + 0.5],
                                rot: f.rotVec as [number, number, number],
                                type: dType
                            });
                            f.hasDoor = true;

                            doorsPlacedCount++;
                            if (dType === 'industrial') indDoorsCount++; else stdDoorsCount++;

                            // Register door center as a slot for vertical propagation
                            const doorCenterX = startX + Math.floor(dW / 2);
                            const doorWX = (worldX - f.normal.dx * 0.5) + 0.5;
                            const doorWZ = (worldZ - f.normal.dz * 0.5) + 0.5;
                            groundSlots.push({ f, x: doorCenterX, worldPosX: doorWX, worldPosZ: doorWZ });

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
                            const worldX = (firstCol.worldX + lastCol.worldX) / 2;
                            const worldZ = (firstCol.worldZ + lastCol.worldZ) / 2;

                            const scaleY = height + 2.0;
                            attachedChimneys.push({
                                pos: [(worldX - f.normal.dx * 0.5) - cx + 0.5, (scaleY / 2) - (height / 2), (worldZ - f.normal.dz * 0.5) - cz + 0.5],
                                scale: [2.0, scaleY, 2.0],
                                color: colors.chimneyResidential,
                                smoke: Math.random() > 0.5,
                                rotation: f.rot
                            });
                        }
                    }
                }
            }

            // Guarantee: every house must have at least 1 door
            if (type === 'house' && doorsPlacedCount === 0 && facades.length > 0) {
                const dW = 2;
                const dH = 4;
                // Try widest facade first (already sorted)
                for (const f of facades) {
                    const possibleStarts: number[] = [];
                    for (let x = 1; x <= f.width - dW - 1; x++) possibleStarts.push(x);
                    // Shuffle
                    for (let i = possibleStarts.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [possibleStarts[i], possibleStarts[j]] = [possibleStarts[j], possibleStarts[i]];
                    }
                    for (const startX of possibleStarts) {
                        let canPlace = true;
                        for (let x = startX - 1; x <= startX + dW; x++) {
                            for (let y = 0; y <= dH; y++) {
                                if (x < 0 || x >= f.width || y >= f.height || f.occupancy[x][y]) { canPlace = false; break; }
                            }
                            if (!canPlace) break;
                        }
                        if (canPlace) {
                            for (let x = startX - 1; x <= startX + dW; x++) {
                                for (let y = 0; y <= dH; y++) {
                                    if (x >= 0 && x < f.width && y < f.height) f.occupancy[x][y] = true;
                                }
                            }
                            for (let x = startX; x < startX + dW; x++) {
                                globalColumnOccupied.add(`${f.columns[x].worldX},${f.columns[x].worldZ}`);
                            }
                            const doorWorldH = 4.4;
                            const ly = (doorWorldH / 2) - (height / 2);
                            const firstCol = f.columns[startX];
                            const lastCol = f.columns[startX + dW - 1];
                            const worldX = (firstCol.worldX + lastCol.worldX) / 2;
                            const worldZ = (firstCol.worldZ + lastCol.worldZ) / 2;
                            assignedDoors.push({
                                pos: [(worldX - f.normal.dx * 0.5) - cx + 0.5, ly, (worldZ - f.normal.dz * 0.5) - cz + 0.5],
                                rot: f.rotVec as [number, number, number],
                                type: 'standard'
                            });
                            doorsPlacedCount++;
                            const doorCenterX = startX + Math.floor(dW / 2);
                            const doorWX = (worldX - f.normal.dx * 0.5) + 0.5;
                            const doorWZ = (worldZ - f.normal.dz * 0.5) + 0.5;
                            groundSlots.push({ f, x: doorCenterX, worldPosX: doorWX, worldPosZ: doorWZ });
                            break;
                        }
                    }
                    if (doorsPlacedCount > 0) break;
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
                    }

                    if (canPlace) {
                        for (let ix = sWinX - 1; ix <= sWinX + winW; ix++) {
                            for (let iy = sWinY - 1; iy <= sWinY + winH; iy++) f.occupancy[ix][iy] = true;
                        }

                        const firstCol = f.columns[Math.max(0, sWinX)];
                        const lastCol = f.columns[Math.min(f.width - 1, sWinX + winW - 1)];
                        const worldX = (firstCol.worldX + lastCol.worldX) / 2 - f.normal.dx * 0.5 + 0.5;
                        const worldZ = (firstCol.worldZ + lastCol.worldZ) / 2 - f.normal.dz * 0.5 + 0.5;
                        const worldYWin = (winBase + (winH / 2)) - (height / 2);

                        assignedWindows.push({
                            pos: [worldX - cx, worldYWin, worldZ - cz],
                            rot: f.rotVec as [number, number, number]
                        });
                        groundFloorHasWindow = true;
                        groundSlots.push({ f, x });
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
                        }
                        if (canPlace) {
                            for (let ix = sWinX - 1; ix <= sWinX + winW; ix++) {
                                for (let iy = sWinY - 1; iy <= sWinY + winH; iy++) f.occupancy[ix][iy] = true;
                            }
                            const firstCol = f.columns[sWinX];
                            const lastCol = f.columns[sWinX + winW - 1];
                            const wX = (firstCol.worldX + lastCol.worldX) / 2 - f.normal.dx * 0.5 + 0.5;
                            const wZ = (firstCol.worldZ + lastCol.worldZ) / 2 - f.normal.dz * 0.5 + 0.5;
                            const wY = (winBase + (winH / 2)) - (height / 2);
                            assignedWindows.push({
                                pos: [wX - cx, wY, wZ - cz],
                                rot: f.rotVec as [number, number, number]
                            });
                            groundFloorHasWindow = true;
                            groundSlots.push({ f, x });
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
                        const acW = 3;
                        const acH = 2;
                        const acBase = floorBase + 2;
                        if (acBase + acH >= height) { /* skip AC */ } else {
                            const acGroundY = Math.floor(acBase);
                            const sAX = x - Math.floor(acW / 2);
                            const sAY = acGroundY - Math.floor(acH / 2);

                            let canPlace = true;
                            for (let ix = sAX - 1; ix <= sAX + acW; ix++) {
                                for (let iy = sAY - 1; iy <= sAY + acH; iy++) {
                                    if (ix < 1 || ix >= f.width - 1 || iy < 1 || iy >= f.height - 1 || f.occupancy[ix][iy]) {
                                        canPlace = false; break;
                                    }
                                }
                                if (!canPlace) break;
                            }

                            if (canPlace) {
                                for (let ix = sAX - 1; ix <= sAX + acW; ix++) {
                                    for (let iy = sAY - 1; iy <= sAY + acH; iy++) f.occupancy[ix][iy] = true;
                                }

                                const col = f.columns[x];
                                assignedACs.push({
                                    pos: [col.worldX + 0.5 - cx, (acBase + acH / 2) - (height / 2), col.worldZ + 0.5 - cz],
                                    scale: [3, 2, 1],
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
                    const winW = type === 'factory' ? 4 : 1;
                    const winH = type === 'factory' ? 2 : 1;
                    const winBaseSlot = floorBase + PLAYER_HEIGHT - winH;
                    if (winBaseSlot + winH >= height) continue;
                    const groundYWin = Math.floor(winBaseSlot);
                    const sWinX = x - Math.floor(winW / 2);
                    const sWinY = groundYWin;
                    let canPlaceWin = true;
                    for (let ix = sWinX - 1; ix <= sWinX + winW; ix++) {
                        for (let iy = sWinY - 1; iy <= sWinY + winH; iy++) {
                            if (ix < 1 || ix >= f.width - 1 || iy < 1 || iy >= f.height - 1 || f.occupancy[ix][iy]) {
                                canPlaceWin = false; break;
                            }
                        }
                        if (!canPlaceWin) break;
                    }

                    if (canPlaceWin) {
                        for (let ix = sWinX - 1; ix <= sWinX + winW; ix++) {
                            for (let iy = sWinY - 1; iy <= sWinY + winH; iy++) f.occupancy[ix][iy] = true;
                        }

                        const firstCol = f.columns[Math.max(0, sWinX)];
                        const lastCol = f.columns[Math.min(f.width - 1, sWinX + winW - 1)];
                        // Use slot's world position if available (door-originated), else compute from columns
                        const worldX = slot.worldPosX !== undefined
                            ? slot.worldPosX
                            : (firstCol.worldX + lastCol.worldX) / 2 - f.normal.dx * 0.5 + 0.5;
                        const worldZ = slot.worldPosZ !== undefined
                            ? slot.worldPosZ
                            : (firstCol.worldZ + lastCol.worldZ) / 2 - f.normal.dz * 0.5 + 0.5;
                        const worldYWin = (winBaseSlot + (winH / 2)) - (height / 2);

                        assignedWindows.push({
                            pos: [worldX - cx, worldYWin, worldZ - cz],
                            rot: f.rotVec as [number, number, number]
                        });
                    }
                }
            }

            // PASS 3: Ladders on multi-story buildings
            if (numFloors >= 2 && Math.random() < 0.6) {
                // Shuffle facades so ladder placement is random, but prioritize non-door walls
                const shuffledFacades = [...facades].sort((a, b) => {
                    if (a.hasDoor !== b.hasDoor) return a.hasDoor ? 1 : -1;
                    return Math.random() - 0.5;
                });
                let ladderPlaced = false;

                for (const f of shuffledFacades) {
                    if (ladderPlaced) break;
                    if (f.width < 3) continue; // Need at least 3 columns for padding

                    // Ladder is 1 column wide, full height of building
                    const ladderW = 1;
                    const ladderH = Math.round(height);

                    // Try positions with at least 1-voxel padding from each side
                    const possiblePositions: number[] = [];
                    for (let x = 1; x <= f.width - ladderW - 1; x++) {
                        possiblePositions.push(x);
                    }
                    // Shuffle positions for randomness
                    for (let i = possiblePositions.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [possiblePositions[i], possiblePositions[j]] = [possiblePositions[j], possiblePositions[i]];
                    }

                    for (const startX of possiblePositions) {
                        // Check full-height occupancy for ladder + 1 voxel pad sides
                        let canPlace = true;
                        for (let x = startX - 1; x <= startX + ladderW; x++) {
                            for (let y = 0; y < ladderH; y++) {
                                if (x < 0 || x >= f.width || y >= f.height || f.occupancy[x][y]) {
                                    canPlace = false;
                                    break;
                                }
                            }
                            if (!canPlace) break;
                        }

                        if (canPlace) {
                            // Mark occupancy
                            for (let x = startX - 1; x <= startX + ladderW; x++) {
                                for (let y = 0; y < ladderH; y++) {
                                    if (x >= 0 && x < f.width && y < f.height) {
                                        f.occupancy[x][y] = true;
                                    }
                                }
                            }

                            const col = f.columns[startX];
                            const worldX = col.worldX - f.normal.dx * 0.5 + 0.5;
                            const worldZ = col.worldZ - f.normal.dz * 0.5 + 0.5;
                            const worldY = 0; // Center-relative Y = 0 means vertically centered

                            assignedLadders.push({
                                pos: [worldX - cx, worldY, worldZ - cz],
                                rot: f.rotVec as [number, number, number],
                                height: height
                            });

                            ladderPlaced = true;
                            break;
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

                    // Fixed height: 1.0 unit
                    const acH = 1.0;

                    // Range calculation
                    const rangeX = fillW - 2 * pad - visualW;
                    const rangeZ = fillD - 2 * pad - visualD;

                    if (rangeX < 0 || rangeZ < 0) continue;

                    // Random position within safe zone (integers for grid index)
                    const rx = Math.floor(Math.random() * (rangeX + 1)) + pad;
                    const rz = Math.floor(Math.random() * (rangeZ + 1)) + pad;

                    let overlap = false;

                    // Check L-Shape mask overlap for the actual visual footprint
                    if (isLShape) {
                        for (let wx = 0; wx < visualW; wx++) {
                            for (let wz = 0; wz < visualD; wz++) {
                                const gridX = rx + wx;
                                const gridZ = rz + wz;
                                if (gridX >= 0 && gridX < fillW && gridZ >= 0 && gridZ < fillD) {
                                    if (cutMask[gridX][gridZ]) overlap = true;
                                }
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
                            // Chimney is always 2x2. Verify that 2x2 footprint also clears cutMask.
                            let chimneyOverlap = false;
                            if (isLShape) {
                                for (let wx = 0; wx < 2; wx++) {
                                    for (let wz = 0; wz < 2; wz++) {
                                        const cX = Math.floor(checkX + fillW / 2 - 1);
                                        const cZ = Math.floor(checkZ + fillD / 2 - 1);
                                        if (cutMask[cX + wx]?.[cZ + wz]) chimneyOverlap = true;
                                    }
                                }
                            }

                            if (!chimneyOverlap) {
                                // Industrial chimneys always start from the roof
                                let chimneyHeight = 4.0 + Math.random() * 8.0;
                                // Positioned so its base is exactly at the building height
                                let ly = (height / 2) + (chimneyHeight / 2);


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
                lShape: lShapeConfig,
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

    // Pass 1: Buildings (Constructions)
    placeInPass('building');
    // Pass 2: Farms (Plantations)
    placeInPass('farm');
    // Pass 3: Ruins
    placeInPass('ruins');

    function placeInPass(cat: 'farm' | 'building' | 'ruins') {
        let x = -halfSize + 2;
        let clusterX = 0;

        while (x < halfSize - 2) {
            let blockW = Math.floor(Math.random() * (maxBlockSize - minBlockSize + 1)) + minBlockSize;
            if (blockW % 2 !== 0) blockW -= 1;
            blockW = Math.max(4, blockW);
            if (x + blockW >= halfSize - 1) break;

            // Decide if this strip will attempt to form Z-axis pairs
            const stripPairZ = Math.random() > 0.5;
            const maxZ = stripPairZ ? 2 : 1;

            // If this strip has Z-pairs, it must be isolated in X
            if (stripPairZ && clusterX > 0) {
                x += baseStreetWidth;
                clusterX = 0;
            }

            let z = -halfSize + 2;
            let clusterZ = 0;
            let placedInStrip = false;

            while (z < halfSize - 2) {
                let blockD = Math.floor(Math.random() * (maxBlockSize - minBlockSize + 1)) + minBlockSize;
                if (blockD % 2 !== 0) blockD -= 1;
                blockD = Math.max(4, blockD);
                if (z + blockD >= halfSize - 1) break;

                // Limit adjacent constructions in Z direction based on strip mode
                if (clusterZ >= maxZ) {
                    z += baseStreetWidth;
                    clusterZ = 0;
                    continue;
                }

                const dec = placeBuilding(x, z, blockW, blockD, undefined, cat);
                if (dec) {
                    decorators.push(dec);
                    z += blockD;
                    clusterZ++;
                    placedInStrip = true;
                } else {
                    z += baseStreetWidth;
                    clusterZ = 0;
                }
            }

            x += blockW;
            if (placedInStrip) {
                if (stripPairZ) {
                    // Isolated strip (already contains Z-pairs or singletons)
                    x += baseStreetWidth;
                    clusterX = 0;
                } else {
                    clusterX++;
                    if (clusterX >= 2) {
                        // End of X-axis pair
                        x += baseStreetWidth;
                        clusterX = 0;
                    }
                }
            } else {
                clusterX = 0;
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

        if (obj.type === 'wheat') {
            // Wheat should be non-collidable for gameplay (hiding)
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

        // For L-shaped buildings, create two boxes instead of one
        if (obj.lShape && obj.lShape.active) {
            const [cutW, cutD] = obj.lShape.cutSize;
            const corner = obj.lShape.cutCorner;

            // Main box and remaining box depend on cut corner
            // Building footprint spans: [posX - w/2, posX + w/2] x [posZ - d/2, posZ + d/2]
            const bMinX = posX - w / 2;
            const bMaxX = posX + w / 2;
            const bMinZ = posZ - d / 2;
            const bMaxZ = posZ + d / 2;

            if (corner === 0) { // NE cut (max X, max Z)
                // Box 1: Full width, reduced depth (bottom part)
                collisionGrid.insert({ minX: bMinX, minY: botY, minZ: bMinZ, maxX: bMaxX, maxY: collisionTop, maxZ: bMaxZ - cutD });
                // Box 2: Reduced width, full depth for uncovered part
                collisionGrid.insert({ minX: bMinX, minY: botY, minZ: bMaxZ - cutD, maxX: bMaxX - cutW, maxY: collisionTop, maxZ: bMaxZ });
            } else if (corner === 1) { // SE cut (max X, min Z)
                collisionGrid.insert({ minX: bMinX, minY: botY, minZ: bMinZ + cutD, maxX: bMaxX, maxY: collisionTop, maxZ: bMaxZ });
                collisionGrid.insert({ minX: bMinX, minY: botY, minZ: bMinZ, maxX: bMaxX - cutW, maxY: collisionTop, maxZ: bMinZ + cutD });
            } else if (corner === 2) { // SW cut (min X, min Z)
                collisionGrid.insert({ minX: bMinX, minY: botY, minZ: bMinZ + cutD, maxX: bMaxX, maxY: collisionTop, maxZ: bMaxZ });
                collisionGrid.insert({ minX: bMinX + cutW, minY: botY, minZ: bMinZ, maxX: bMaxX, maxY: collisionTop, maxZ: bMinZ + cutD });
            } else if (corner === 3) { // NW cut (min X, max Z)
                collisionGrid.insert({ minX: bMinX, minY: botY, minZ: bMinZ, maxX: bMaxX, maxY: collisionTop, maxZ: bMaxZ - cutD });
                collisionGrid.insert({ minX: bMinX + cutW, minY: botY, minZ: bMaxZ - cutD, maxX: bMaxX, maxY: collisionTop, maxZ: bMaxZ });
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

            // The climbable zone extends slightly outward from the wall
            const zoneRadius = 1.2;
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
    const spawnPos = new THREE.Vector3(0, 10, 0);

    // Populate sGrid with Water where applicable (if not overwritten by objects)
    for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
            if (wGrid[x][z] === 1 && sGrid[x][z] === 0) {
                sGrid[x][z] = 1; // Water
            }
        }
    }

    // Randomize flow: 50% to 150% of base flow, snapped to integers 0-5 (matching UI steps)
    const baseRandom = settings.riverFlow * (0.5 + Math.random() * 1.0);
    const randomFlow = Math.round(THREE.MathUtils.clamp(baseRandom, 0, 5));

    return { objects, collisionGrid, bGrid, wGrid, sGrid, tGrid, spawnPos, ladderZones, riverOrientation: hasRiver ? riverOrientation : -1, riverFlow: hasRiver ? randomFlow : 0 };
};
