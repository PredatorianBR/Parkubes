
import * as THREE from 'three';
import { VoxelObject, GameSettings, Position } from '../types';
import { worldToIndex, GRID_SCALE, PLAYER_HEIGHT } from './physics';

export const findSpawnPos = (
    size: number,
    halfSize: number,
    tGrid: number[][],
    oGrid: number[][],
    wGrid: number[][],
    isWaterLogic: (lx: number, lz: number) => boolean
) => {
    let spawnPos = new THREE.Vector3(0, 0, 0);
    const gridSize = size * GRID_SCALE;

    for (let k = 0; k < 1000; k++) {
        // Try random positions within a safer inner bound (avoiding map edges completely)
        const safePadding = 10;
        const rx = Math.floor(Math.random() * (size - safePadding * 2)) + safePadding;
        const rz = Math.floor(Math.random() * (size - safePadding * 2)) + safePadding;

        // Check if it's street (0) and not water
        const logicX = rx - halfSize;
        const logicZ = rz - halfSize;

        const gx = worldToIndex(logicX, halfSize, size);
        const gz = worldToIndex(logicZ, halfSize, size);

        // Check if tGrid is street/empty AND oGrid is not too high (avoid spawning inside objects)
        if (tGrid[rx][rz] === 0 && !isWaterLogic(logicX, logicZ) && oGrid[gx][gz] < 2.0) {
            const groundH = oGrid[gx][gz];
            spawnPos.set(logicX, groundH + 1.0, logicZ);
            return spawnPos;
        }
    }

    // If no safe spot found on street, try ANY spot that isn't too high
    for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
            if (oGrid[x][z] < 2.0 && wGrid[x][z] === 0) {
                const logicX = (x + 0.5) / GRID_SCALE - halfSize;
                const logicZ = (z + 0.5) / GRID_SCALE - halfSize;
                spawnPos.set(logicX, oGrid[x][z] + 1.0, logicZ);
                return spawnPos;
            }
        }
    }

    // Ultimate fallback if map is completely filled (unlikely)
    spawnPos.set(0, 10, 0);
    return spawnPos;
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
    const oGrid: number[][] = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0)); // Height Grid
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

        // Randomize width: 50% to 150% of base width, snapped to integers 1-6
        const baseWidth = settings.riverWidth;
        const randomWidth = Math.round(THREE.MathUtils.clamp(baseWidth * (0.5 + Math.random() * 1.0), 1, 6));

        // Walk from Start to Finish
        const maxSteps = size * 3;
        for (let i = 0; i < maxSteps; i++) {
            const width = Math.floor(Math.random() * (randomWidth * 0.5)) + randomWidth;
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
                for (let dx = -2; dx < 2 + 2; dx++) {
                    for (let dz = -2; dz < 2 + 2; dz++) {
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
                                if (nearX < 2 && nearZ < 2) canPlace = false;
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

        let height = 6;
        if (type === 'house') {
            height = (Math.floor(Math.random() * 3) + 3) * 2;
        } else if (type === 'factory') {
            height = (Math.floor(Math.random() * 4) + 4) * 2;
        } else {
            height = (Math.floor(Math.random() * 7) + 5) * 2;
            if (height > 16 && (fillW < 4 || fillD < 4)) height = 16;
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
            const floorH = 6;
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

            // Stability: Group by facade and pick the best (most centered) spots first
            const columnsByFacade: Record<string, WallColumn[]> = {};
            columns.forEach(col => {
                if (!columnsByFacade[col.facadeId]) columnsByFacade[col.facadeId] = [];
                columnsByFacade[col.facadeId].push(col);
            });

            // Sort each facade by minDist (descending) 
            // For EVEN walls, minDist will be equal for two middle blocks. 
            // We use biasDist to pick a consistent side (the one with slightly more left padding)
            Object.values(columnsByFacade).forEach(list => {
                list.sort((a, b) => {
                    if (b.minDist !== a.minDist) return b.minDist - a.minDist;
                    // If minDist is equal, it's an even wall middle. 
                    // Prefer biasDist = 1 (left-leaning middle) for consistent "feel"
                    return b.biasDist - a.biasDist;
                });
            });

            // Create a flat list that alternates between facades to distribute features evenly
            const distributedColumns: WallColumn[] = [];
            const facadeIds = Object.keys(columnsByFacade);
            let maxColsPerFacade = 0;
            facadeIds.forEach(id => maxColsPerFacade = Math.max(maxColsPerFacade, columnsByFacade[id].length));

            for (let i = 0; i < maxColsPerFacade; i++) {
                facadeIds.forEach(id => {
                    if (columnsByFacade[id][i]) distributedColumns.push(columnsByFacade[id][i]);
                });
            }

            let doorsPlacedCount = 0;
            let indDoorsCount = 0;
            let stdDoorsCount = 0;
            let maxDoors = 1;
            if (type === 'factory') {
                maxDoors = (fillW >= 12 && fillD >= 12) ? 3 : 2;
            } else if (fillW >= 10 && fillD >= 10) {
                maxDoors = 2;
            }
            let hasChimney = false;

            let factoryWallACs = 0;
            const floorsWithWallAC = new Array(numFloors).fill(false);

            for (const col of distributedColumns) {
                const tX = -col.dz;
                const tZ = col.dx;
                const colKey = `${col.worldX},${col.worldZ}`;
                const colKeyL = `${col.worldX + tX},${col.worldZ + tZ}`;
                const colKeyR = `${col.worldX - tX},${col.worldZ - tZ}`;
                const colKeyL2 = `${col.worldX + tX * 2},${col.worldZ + tZ * 2}`;
                const colKeyR2 = `${col.worldX - tX * 2},${col.worldZ - tZ * 2}`;

                if (
                    globalColumnOccupied.has(colKey) ||
                    globalColumnOccupied.has(colKeyL) ||
                    globalColumnOccupied.has(colKeyR) ||
                    globalColumnOccupied.has(colKeyL2) ||
                    globalColumnOccupied.has(colKeyR2)
                ) {
                    continue;
                }

                let feature: 'door' | 'chimney' | 'window' | 'ac' | 'none' = 'none';
                const rand = Math.random();

                if (type === 'house' && !hasChimney && (fillW >= 8 || fillD >= 8) && rand < 0.4) {
                    feature = 'chimney';
                } else if (doorsPlacedCount < maxDoors) {
                    if (type === 'factory') {
                        if (indDoorsCount < 1) feature = 'door';
                        else if (stdDoorsCount < 1) feature = 'door';
                        else if (rand < 0.5) feature = 'door';
                        else feature = 'window';
                    } else {
                        feature = 'door';
                    }
                } else {
                    if (assignedWindows.length === 0) {
                        feature = 'window';
                    } else {
                        if (type === 'factory' && rand < 0.15) feature = 'ac';
                        else if (rand < 0.4) feature = 'window';

                        if (height > 4 && feature === 'none') {
                            feature = 'window';
                        }
                    }
                }

                if (feature === 'none') continue;
                globalColumnOccupied.add(colKey);
                globalColumnOccupied.add(colKeyL);
                globalColumnOccupied.add(colKeyR);

                if (feature === 'door') {
                    let dType: 'standard' | 'industrial' = 'standard';
                    if (type === 'factory') {
                        if (indDoorsCount < 1) dType = 'industrial';
                        else if (stdDoorsCount < 1) dType = 'standard';
                        else dType = Math.random() > 0.5 ? 'industrial' : 'standard';
                    }
                    const wallKey = `${col.dx},${col.dz}:${dType}`;
                    if (buildingWallDoorTypes.has(wallKey)) {
                        feature = 'window';
                    } else {
                        buildingWallDoorTypes.add(wallKey);
                        const doorHeight = dType === 'industrial' ? 6.0 : 4.4;
                        const ly = (doorHeight / 2) - (height / 2);
                        const tX = -col.dz;
                        const tZ = col.dx;
                        const shift = (Math.abs(col.biasDist) % 2 !== 0) ? Math.sign(col.biasDist) * 0.5 : 0;
                        const lx = (col.worldX - (col.dx * 0.5) + 0.5 + tX * shift) - cx;
                        const lz = (col.worldZ - (col.dz * 0.5) + 0.5 + tZ * shift) - cz;

                        assignedDoors.push({
                            pos: [lx, ly, lz],
                            rot: col.rotVec as [number, number, number],
                            type: dType
                        });
                        globalWallOccupied.add(getPosKey(col.worldX, 1.25, col.worldZ));
                        // Mark as occupied for doors (standard covers ~2 voxels, industrial ~4)
                        globalColumnOccupied.add(colKey);
                        globalColumnOccupied.add(colKeyL);
                        globalColumnOccupied.add(colKeyR);
                        if (dType === 'industrial') {
                            // Extra padding for wide industrial doors
                            const colKeyL2 = `${col.worldX + tX * 2},${col.worldZ + tZ * 2}`;
                            const colKeyR2 = `${col.worldX - tX * 2},${col.worldZ - tZ * 2}`;
                            globalColumnOccupied.add(colKeyL2);
                            globalColumnOccupied.add(colKeyR2);
                        }

                        doorsPlacedCount++;
                        if (dType === 'industrial') indDoorsCount++; else stdDoorsCount++;

                        for (let f = 1; f < numFloors; f++) {
                            const worldY = (f * floorH) + 3.0;
                            if (worldY + 0.5 < height) {
                                const lyWin = worldY - (height / 2);
                                const tX = -col.dz;
                                const tZ = col.dx;
                                const shift = (Math.abs(col.biasDist) % 2 !== 0) ? Math.sign(col.biasDist) * 0.5 : 0;
                                const lxWin = (col.worldX - (col.dx * 0.5) + 0.5 + tX * shift) - cx;
                                const lzWin = (col.worldZ - (col.dz * 0.5) + 0.5 + tZ * shift) - cz;
                                assignedWindows.push({
                                    pos: [lxWin, lyWin, lzWin],
                                    rot: col.rotVec as [number, number, number]
                                });
                                globalWallOccupied.add(getPosKey(col.worldX, worldY, col.worldZ));
                            }
                        }
                        continue;
                    }
                }

                if (feature === 'window') {
                    for (let f = 0; f < numFloors; f++) {
                        const worldY = (f * floorH) + 3.0;
                        if (worldY + 0.5 < height) {
                            // CRITICAL FIX: Check if ground floor is already occupied by a door/detail
                            if (f === 0 && globalWallOccupied.has(getPosKey(col.worldX, 1.25, col.worldZ))) {
                                continue;
                            }

                            const ly = worldY - (height / 2);
                            const tX = -col.dz;
                            const tZ = col.dx;
                            const shift = (Math.abs(col.biasDist) % 2 !== 0) ? Math.sign(col.biasDist) * 0.5 : 0;
                            const lx = (col.worldX - (col.dx * 0.5) + 0.5 + tX * shift) - cx;
                            const lz = (col.worldZ - (col.dz * 0.5) + 0.5 + tZ * shift) - cz;

                            let canPlaceAC = true;
                            if (Math.random() < 0.2 && f > 0) {
                                if (type === 'factory' && factoryWallACs >= 1) canPlaceAC = false;
                                if ((type === 'house' || type === 'highrise') && floorsWithWallAC[f]) canPlaceAC = false;
                            } else {
                                canPlaceAC = false;
                            }

                            if (canPlaceAC) {
                                // Wall AC Size Increased: 2.5 width, 1.8 height, 1.2 depth
                                // To be mounted on wall (depth 1.2, half is 0.6):
                                // AirCenter distance to WallSurface is 0.5.
                                // AC Center should be WallSurface + HalfDepth (0.6) = AirCenter - 0.5 + 0.6 = AirCenter + 0.1.
                                const tX = -col.dz;
                                const tZ = col.dx;
                                const shift = (Math.abs(col.biasDist) % 2 !== 0) ? Math.sign(col.biasDist) * 0.5 : 0;
                                const offset = -0.1; // -0.1 to pull it "out" of the air towards the wall
                                const lxAC = (col.worldX - (col.dx * offset) + 0.5 + tX * shift) - cx;
                                const lzAC = (col.worldZ - (col.dz * offset) + 0.5 + tZ * shift) - cz;

                                assignedACs.push({
                                    pos: [lxAC, ly, lzAC],
                                    scale: [2.5, 1.8, 1.2], // Larger Wall AC size
                                    color: type === 'house' ? colors.acResidential : colors.acIndustrial,
                                    rotation: col.rot,
                                    type: 'wall'
                                });

                                if (type === 'factory') factoryWallACs++;
                                if (type === 'house' || type === 'highrise') floorsWithWallAC[f] = true;
                            } else {
                                assignedWindows.push({
                                    pos: [lx, ly, lz],
                                    rot: col.rotVec as [number, number, number]
                                });
                            }
                            globalWallOccupied.add(getPosKey(col.worldX, worldY, col.worldZ));
                        }
                    }
                }
                else if (feature === 'ac') {
                    // Standalone Wall AC Logic
                    for (let f = 1; f < numFloors; f++) {
                        const worldY = (f * floorH) + 3.0;
                        if (worldY + 3.0 < height) { // Needs space for 2 height
                            const ly = worldY - (height / 2);
                            let canPlaceAC = true;
                            if (type === 'factory' && factoryWallACs >= 1) canPlaceAC = false;
                            if ((type === 'house' || type === 'highrise') && floorsWithWallAC[f]) canPlaceAC = false;

                            if (canPlaceAC) {
                                const tX = -col.dz;
                                const tZ = col.dx;
                                const shift = (Math.abs(col.biasDist) % 2 !== 0) ? Math.sign(col.biasDist) * 0.5 : 0;
                                const offset = -0.1;
                                const lxAC = (col.worldX - (col.dx * offset) + 0.5 + tX * shift) - cx;
                                const lzAC = (col.worldZ - (col.dz * offset) + 0.5 + tZ * shift) - cz;

                                assignedACs.push({
                                    pos: [lxAC, ly, lzAC],
                                    scale: [2.8, 2.0, 1.2], // Larger Standalone Wall AC size
                                    color: colors.acIndustrial,
                                    rotation: col.rot,
                                    type: 'wall'
                                });
                                if (type === 'factory') factoryWallACs++;
                                if (type === 'house' || type === 'highrise') floorsWithWallAC[f] = true;
                            } else {
                                const winLy = worldY - (height / 2);
                                const tX = -col.dz;
                                const tZ = col.dx;
                                const shift = (Math.abs(col.biasDist) % 2 !== 0) ? Math.sign(col.biasDist) * 0.5 : 0;
                                const winLx = (col.worldX - (col.dx * 0.5) + 0.5 + tX * shift) - cx;
                                const winLz = (col.worldZ - (col.dz * 0.5) + 0.5 + tZ * shift) - cz;
                                assignedWindows.push({
                                    pos: [winLx, winLy, winLz],
                                    rot: col.rotVec as [number, number, number]
                                });
                            }
                            globalWallOccupied.add(getPosKey(col.worldX, worldY, col.worldZ));
                        }
                    }
                }
                else if (feature === 'chimney') {
                    hasChimney = true;
                    const faceX = col.worldX;
                    const faceZ = col.worldZ;
                    const scaleY = height + 2.0;
                    const ly = (scaleY / 2) - (height / 2);
                    const tX = -col.dz;
                    const tZ = col.dx;
                    const shimneyShift = (Math.abs(col.biasDist) % 2 !== 0) ? Math.sign(col.biasDist) * 0.5 : 0.5;

                    const offsetX = -col.dx * 0.5;
                    const offsetZ = -col.dz * 0.5;

                    attachedChimneys.push({
                        pos: [(faceX + offsetX) - cx + 0.5 + tX * shimneyShift, ly, (faceZ + offsetZ) - cz + 0.5 + tZ * shimneyShift],
                        scale: [2.0, scaleY, 2.0],
                        color: colors.chimneyResidential,
                        smoke: Math.random() > 0.5,
                        rotation: col.rot
                    });

                    for (let f = 0; f < numFloors; f++) {
                        const worldY = (f * floorH) + 3.0;
                        if (worldY < height) globalWallOccupied.add(getPosKey(col.worldX, worldY, col.worldZ));
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
                        if (isChimney) {
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
                acs: assignedACs
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

    // --- AUTOMATIC COLLISION ADJUSTMENT STEP (HIGH RES) ---
    objects.forEach(obj => {
        // --- CUSTOM FENCE COLLISION (1 Voxel Precision) ---
        if (obj.type === 'fence') {
            // Fences are on logic grid vertices (0.5 bounds)
            // Visual X = worldX. We map it directly to the exact sub-cell representing that vertex
            const logicWX = obj.position[0];
            const logicWZ = obj.position[2];

            const startX = worldToIndex(logicWX, halfSize, size);
            const startZ = worldToIndex(logicWZ, halfSize, size);

            // Pillar: the exact Vertex maps to the bottom-right of the cell (startX-1, startZ-1)
            // But visually, the sub-voxel aligns better with the tile it "starts"
            const ix = startX;
            const iz = startZ;

            if (ix >= 0 && ix < gridSize && iz >= 0 && iz < gridSize) {
                oGrid[ix][iz] = 1.2; // Pillar Height
            }

            // Neighbor Logic to create "thin" walls (1 voxel thick)
            if (obj.neighbors?.s) {
                if (ix >= 0 && ix < gridSize && iz + 1 < gridSize) {
                    oGrid[ix][iz + 1] = 1.0;
                }
            }
            if (obj.neighbors?.e) {
                if (ix + 1 < gridSize && iz >= 0 && iz < gridSize) {
                    oGrid[ix + 1][iz] = 1.0;
                }
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

        const startXLogic = obj.position[0] - w / 2;
        const startZLogic = obj.position[2] - d / 2;

        const startXHigh = Math.round((startXLogic + halfSize) * GRID_SCALE);
        const startZHigh = Math.round((startZLogic + halfSize) * GRID_SCALE);

        const wHigh = Math.round(w * GRID_SCALE);
        const dHigh = Math.round(d * GRID_SCALE);

        // Determine surface type
        let surfaceType = 3; // Default Hard/Stone
        if (obj.type === 'ruin') surfaceType = 3;
        else if (obj.type === 'box' || obj.type === 'factory' || obj.type === 'highrise') surfaceType = 3;

        for (let ix = 0; ix < wHigh; ix++) {
            for (let iz = 0; iz < dHigh; iz++) {
                // Determine if this high-res voxel is inside the cut area
                if (obj.lShape && obj.lShape.active) {
                    const [cutW, cutD] = obj.lShape.cutSize;
                    const corner = obj.lShape.cutCorner;

                    const cutWHigh = Math.round(cutW * GRID_SCALE);
                    const cutDHigh = Math.round(cutD * GRID_SCALE);

                    let isCut = false;

                    if (corner === 0) { // Max X, Max Z
                        if (ix >= wHigh - cutWHigh && iz >= dHigh - cutDHigh) isCut = true;
                    } else if (corner === 1) { // Max X, Min Z
                        if (ix >= wHigh - cutWHigh && iz < cutDHigh) isCut = true;
                    } else if (corner === 2) { // Min X, Min Z
                        if (ix < cutWHigh && iz < cutDHigh) isCut = true;
                    } else if (corner === 3) { // Min X, Max Z
                        if (ix < cutWHigh && iz >= dHigh - cutDHigh) isCut = true;
                    }

                    if (isCut) continue;
                }

                const gridX = startXHigh + ix;
                const gridZ = startZHigh + iz;

                if (gridX >= 0 && gridX < gridSize && gridZ >= 0 && gridZ < gridSize) {
                    // Update Surface Grid
                    // sGrid[gridX][gridZ] = surfaceType; // REMOVED: Always grass on ground



                    const topY = obj.position[1] + h / 2;
                    const collisionH = topY + (obj.type !== 'ruin' ? 0.3 : 0);
                    if (obj.position[1] - h / 2 > 1.0) {
                        bGrid[gridX][gridZ] = Math.max(bGrid[gridX][gridZ], collisionH);
                    } else {
                        oGrid[gridX][gridZ] = Math.max(oGrid[gridX][gridZ], collisionH);
                    }
                }
            }
        }
    });

    // --- SECOND PASS: collision logic for ALL DETAILS (so they sit correctly on populated grids) ---
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

            let absX = obj.position[0] + det.pos[0];
            const absY = obj.position[1] + det.pos[1];
            let absZ = obj.position[2] + det.pos[2];

            const dStartX = Math.round((absX - dW / 2 + halfSize) * GRID_SCALE);
            const dStartZ = Math.round((absZ - dD / 2 + halfSize) * GRID_SCALE);
            const dWHigh = Math.round(dW * GRID_SCALE);
            const dDHigh = Math.round(dD * GRID_SCALE);

            for (let dx = 0; dx < dWHigh; dx++) {
                for (let dz = 0; dz < dDHigh; dz++) {
                    const gridX = dStartX + dx;
                    const gridZ = dStartZ + dz;

                    if (gridX >= 0 && gridX < gridSize && gridZ >= 0 && gridZ < gridSize) {
                        const topH = absY + dH / 2;
                        if (absY - dH / 2 > 2.0) {
                            if (oGrid[gridX][gridZ] > 0) {
                                oGrid[gridX][gridZ] = Math.max(oGrid[gridX][gridZ], topH);
                            } else {
                                bGrid[gridX][gridZ] = Math.max(bGrid[gridX][gridZ], topH);
                            }
                        } else {
                            oGrid[gridX][gridZ] = Math.max(oGrid[gridX][gridZ], topH);
                        }
                    }
                }
            }
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

    return { objects, oGrid, bGrid, wGrid, sGrid, tGrid, spawnPos, riverOrientation: hasRiver ? riverOrientation : -1, riverFlow: hasRiver ? randomFlow : 0 };
};
