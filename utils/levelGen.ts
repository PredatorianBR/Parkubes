
import * as THREE from 'three';
import { VoxelObject, GameSettings, Position } from '../types';
import { worldToIndex, GRID_SCALE } from './physics';

export const generateCityLevel = (
    pSpawn: THREE.Vector2, 
    settings: GameSettings,
    mapId: number // ID unique to this match generation
) => {
    // --- LOCAL SCOPED VARIABLES (Reset every function call) ---
    const objects: VoxelObject[] = [];
    const size = settings.worldSize;
    const halfSize = Math.floor(size / 2);
    
    // Grids (Scaled Up for Physics Precision)
    const gridSize = size * GRID_SCALE;
    const oGrid: number[][] = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0)); // Height Grid
    const bGrid: number[][] = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0)); // Bridge Grid
    const wGrid: number[][] = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0)); // Water Grid
    
    // Type Grid remains Logic Resolution (1x1) for building placement logic
    const tGrid: number[][] = Array(size).fill(null).map(() => Array(size).fill(0)); 
    
    // Tracking Sets
    const globalWallOccupied = new Set<string>();
    const globalColumnOccupied = new Set<string>(); 
    const fenceLocations = new Set<string>();

    const getPosKey = (x: number, y: number, z: number) => `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;

    const baseStreetWidth = 2;
    const minBlockSize = 2; 
    const maxBlockSize = 9; 

    let acClusterHeat = 0.0; 

    const uid = (prefix: string) => `${prefix}_m${mapId}`;

    const colors = {
        house: ['#f8fafc', '#f1f5f9', '#e2e8f0', '#fefce8', '#f0fdf4', '#eff6ff', '#fff1f2'],
        brick: '#7f1d1d',
        highrise: ['#cbd5e1', '#94a3b8', '#64748b', '#f8fafc', '#e2e8f0'], 
        factory: ['#1e293b', '#0f172a', '#334155', '#3f3f46', '#27272a'], 
        streetAsphalt: '#333333',
        streetDirt: '#78350f',
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
    const hasRiver = settings.riverWidth > 0 && Math.random() > 0.1; 
    if (hasRiver) {
        const orientation = Math.random() > 0.5 ? 0 : 1;
        let cx = orientation === 0 ? Math.floor(Math.random() * (size - 10)) + 5 - halfSize : -halfSize;
        let cz = orientation === 0 ? -halfSize : Math.floor(Math.random() * (size - 10)) + 5 - halfSize;
        const steps = size + 5; 
        
        for(let i = 0; i < steps; i++) {
            const width = Math.floor(Math.random() * settings.riverWidth) + 1;
            for(let wx = -Math.floor(width/2); wx < Math.ceil(width/2); wx++) {
                for(let wz = -Math.floor(width/2); wz < Math.ceil(width/2); wz++) {
                     const logicX = cx + wx;
                     const logicZ = cz + wz;
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
            if (orientation === 0) {
                cz += 1; cx += Math.floor(Math.random() * 3) - 1;
            } else {
                cx += 1; cz += Math.floor(Math.random() * 3) - 1;
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
    const placeBuilding = (bx: number, bz: number, bw: number, bd: number, forcedType?: 'factory') => {
        const rand = Math.random() * 100;
        const ratios = settings.ratios;
        acClusterHeat *= 0.99;

        const tFarm = ratios.farm;
        const tRuins = tFarm + ratios.ruins;
        const tHouse = tRuins + ratios.house;
        const tFactory = tHouse + ratios.factory;
        const tHighrise = tFactory + ratios.highrise;
        
        if (!forcedType && rand < tFarm) {
            if (!((bw >= 2 && bd >= 4) || (bw >= 4 && bd >= 2))) return null; 

            for(let i=0; i<bw; i++) {
                for(let j=0; j<bd; j++) {
                     const logicX = bx + i;
                     const logicZ = bz + j;
                     const tx = logicX + halfSize;
                     const tz = logicZ + halfSize;
                     if(tx >= 0 && tx < size && tz >= 0 && tz < size) {
                         if (!isWaterLogic(logicX, logicZ)) {
                             tGrid[tx][tz] = 4; // Mark as Farm
                         }
                     }
                }
            }
            return null; 
        }
        
        if (!forcedType && rand < tRuins) {
            const numRuins = Math.max(1, Math.floor((bw * bd) / 4));
            for(let i=0; i<numRuins; i++) {
                const rx = bx + Math.floor(Math.random() * bw);
                const rz = bz + Math.floor(Math.random() * bd);
                const tx = rx + halfSize;
                const tz = rz + halfSize;
                
                if(tx >= 0 && tx < size && tz >= 0 && tz < size) {
                    if (!isWaterLogic(rx, rz) && tGrid[tx][tz] !== 4) {
                        const h = Math.random() > 0.7 ? 2 : 1;
                        objects.push({
                            id: uid(`ruin-${rx}-${rz}`),
                            position: [rx, h/2, rz],
                            scale: [1, h, 1],
                            color: colors.ruin,
                            type: 'ruin'
                        });
                    }
                }
            }
            return null;
        }

        if (!forcedType && rand > tHighrise) return null; 

        let type: 'house' | 'highrise' | 'factory' = 'house';
        let typeId = 1;
        
        if (forcedType) {
            type = forcedType;
            typeId = 2;
        } else if (rand < tHouse) {
            type = 'house';
            typeId = 1;
        } else if (rand < tFactory) {
            type = 'factory';
            typeId = 2;
        } else {
            type = 'highrise';
            typeId = 3;
        }

        const availW = Math.max(2, bw - Math.random() * 2); 
        const availD = Math.max(2, bd - Math.random() * 2);
        
        let fillW = Math.floor(availW);
        let fillD = Math.floor(availD);

        if (type === 'factory') {
            fillW = Math.max(3, fillW);
            fillD = Math.max(3, fillD);
            if (fillW > bw || fillD > bd) {
                type = 'house';
                typeId = 1;
                fillW = Math.min(fillW, bw);
                fillD = Math.min(fillD, bd);
            }
        }

        if (fillW === 2 && fillD === 2) {
            if (bw >= 3) fillW = 3;
            else if (bd >= 3) fillD = 3;
            else return null;
        }
        
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

        for(let i = 0; i < fillW; i++) {
            for(let j = 0; j < fillD; j++) {
                 const lx = startX + i;
                 const lz = startZ + j;
                 const tx = lx + halfSize;
                 const tz = lz + halfSize;

                 if(tx >= 0 && tx < size && tz >= 0 && tz < size) {
                     if (isWaterLogic(lx, lz) || tGrid[tx][tz] !== 0) return null;
                 }
            }
        }

        let height = 3;
        if (type === 'house') {
            height = Math.floor(Math.random() * 3) + 3; 
        } else if (type === 'factory') {
            height = Math.floor(Math.random() * 4) + 4; 
        } else {
            height = Math.floor(Math.random() * 7) + 5; 
            if (height > 8 && (fillW < 4 || fillD < 4)) height = 8; 
        }

        const canBeL = fillW >= 3 && fillD >= 3;
        const isLShape = canBeL && Math.random() > 0.4; 

        let lShapeConfig = undefined;
        let cutMask: boolean[][] = Array(fillW).fill(null).map(() => Array(fillD).fill(false));

        if (isLShape) {
            const cutCorner = Math.floor(Math.random() * 4) as 0|1|2|3;
            const cutW = Math.max(1, Math.floor(fillW * (0.3 + Math.random() * 0.3))); 
            const cutD = Math.max(1, Math.floor(fillD * (0.3 + Math.random() * 0.3)));
            
            lShapeConfig = {
                active: true,
                cutCorner: cutCorner,
                cutSize: [cutW, cutD] as [number, number]
            };

            for(let i=0; i<fillW; i++) {
                for(let j=0; j<fillD; j++) {
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

        const cx = startX + (fillW - 1) / 2;
        const cz = startZ + (fillD - 1) / 2;
        const objType = type === 'house' ? 'box' : type; 
        
        let baseColor = colors.house[0];
        if (type === 'house') baseColor = colors.house[Math.floor(Math.random() * colors.house.length)];
        if (type === 'highrise') baseColor = colors.highrise[Math.floor(Math.random() * colors.highrise.length)];
        if (type === 'factory') baseColor = colors.factory[Math.floor(Math.random() * colors.factory.length)];

        const assignedWindows: { pos: Position, rot: [number,number,number] }[] = [];
        const attachedChimneys: { pos: Position, scale: Position, color: string, smoke?: boolean, rotation?: number }[] = [];
        const assignedDoors: { pos: Position, rot: [number,number,number], type: 'standard' | 'industrial' }[] = [];
        const assignedACs: { pos: Position, scale: Position, color: string, rotation: number, type: 'wall' | 'roof' }[] = [];

        const buildingWallDoorTypes = new Set<string>();

        for(let i = 0; i < fillW; i++) {
            for(let j = 0; j < fillD; j++) {
                if (isLShape && cutMask[i][j]) continue; 
                const lx = startX + i;
                const lz = startZ + j;
                const tx = lx + halfSize;
                const tz = lz + halfSize;
                if(tx >= 0 && tx < size && tz >= 0 && tz < size) {
                    tGrid[tx][tz] = typeId;
                }
            }
        }

        const floorH = 3; 
        const numFloors = Math.max(1, Math.floor(height / floorH));

        type WallColumn = {
            worldX: number, worldZ: number,
            dx: number, dz: number,
            rot: number,
            rotVec: number[]
        };
        const columns: WallColumn[] = [];

        const isSolid = (lx: number, lz: number) => {
            if (lx < 0 || lx >= fillW || lz < 0 || lz >= fillD) return false;
            if (isLShape && cutMask[lx][lz]) return false;
            return true;
        };

        const neighbors = [
            { dx: 1, dz: 0, rot: Math.PI/2, rotVec: [0, Math.PI/2, 0] }, 
            { dx: -1, dz: 0, rot: -Math.PI/2, rotVec: [0, -Math.PI/2, 0] },
            { dx: 0, dz: 1, rot: 0, rotVec: [0, 0, 0] },
            { dx: 0, dz: -1, rot: Math.PI, rotVec: [0, Math.PI, 0] }
        ];

        for(let i = 0; i < fillW; i++) {
            for(let j = 0; j < fillD; j++) {
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
                            const hasLeft = isSolid(i + tX, j + tZ);
                            const hasRight = isSolid(i - tX, j - tZ);
                            if (!hasLeft || !hasRight) continue;

                            let solidAirNeighbors = 0;
                            const airLocalX = i + n.dx;
                            const airLocalZ = j + n.dz;
                            if (isSolid(airLocalX + 1, airLocalZ)) solidAirNeighbors++;
                            if (isSolid(airLocalX - 1, airLocalZ)) solidAirNeighbors++;
                            if (isSolid(airLocalX, airLocalZ + 1)) solidAirNeighbors++;
                            if (isSolid(airLocalX, airLocalZ - 1)) solidAirNeighbors++;
                            if (solidAirNeighbors > 1) continue;

                            columns.push({
                                worldX: airX, worldZ: airZ,
                                dx: n.dx, dz: n.dz,
                                rot: n.rot, rotVec: n.rotVec
                            });
                        }
                    }
                }
            }
        }

        columns.sort(() => Math.random() - 0.5);

        let doorsPlacedCount = 0;
        let indDoorsCount = 0;
        let stdDoorsCount = 0;
        const maxDoors = (fillW > 4 || fillD > 4) ? 2 : 1;
        let hasChimney = false; 

        let factoryWallACs = 0;
        const floorsWithWallAC = new Array(numFloors).fill(false); 

        for (const col of columns) {
            const tX = -col.dz; 
            const tZ = col.dx;
            const colKey = `${col.worldX},${col.worldZ}`;
            const colKeyL = `${col.worldX + tX},${col.worldZ + tZ}`;
            const colKeyR = `${col.worldX - tX},${col.worldZ - tZ}`;
            
            if (globalColumnOccupied.has(colKey) || globalColumnOccupied.has(colKeyL) || globalColumnOccupied.has(colKeyR)) {
                continue;
            }

            let feature: 'door' | 'chimney' | 'window' | 'ac' | 'none' = 'none';
            const rand = Math.random();

            if (type === 'house' && !hasChimney && rand < 0.4) {
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
                    else if (rand < 0.7) feature = 'window'; 
                    
                    if (height > 4 && feature === 'none') {
                        feature = 'window';
                    }
                }
            }

            if (feature === 'none') continue;
            globalColumnOccupied.add(colKey);

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
                     const doorHeight = dType === 'industrial' ? 3.0 : 2.2;
                     const ly = (doorHeight/2) - (height/2);
                     const lx = (col.worldX - (col.dx * 0.5)) - cx;
                     const lz = (col.worldZ - (col.dz * 0.5)) - cz;

                     assignedDoors.push({
                         pos: [lx, ly, lz],
                         rot: col.rotVec as [number,number,number],
                         type: dType
                     });
                     globalWallOccupied.add(getPosKey(col.worldX, 1.25, col.worldZ));
                     doorsPlacedCount++;
                     if (dType === 'industrial') indDoorsCount++; else stdDoorsCount++;
                     
                     for (let f = 1; f < numFloors; f++) {
                         const worldY = (f * floorH) + 1.5; 
                         if (worldY + 0.5 < height) {
                             const lyWin = worldY - (height/2);
                             const lxWin = (col.worldX - (col.dx * 0.495)) - cx;
                             const lzWin = (col.worldZ - (col.dz * 0.495)) - cz;
                             assignedWindows.push({
                                 pos: [lxWin, lyWin, lzWin],
                                 rot: col.rotVec as [number,number,number]
                             });
                             globalWallOccupied.add(getPosKey(col.worldX, worldY, col.worldZ));
                         }
                     }
                     continue; 
                }
            }

            if (feature === 'window') {
                for (let f = 0; f < numFloors; f++) {
                    const worldY = (f * floorH) + 1.5;
                    if (worldY + 0.5 < height) {
                        const ly = worldY - (height/2);
                        const lx = (col.worldX - (col.dx * 0.495)) - cx;
                        const lz = (col.worldZ - (col.dz * 0.495)) - cz;
                        
                        let canPlaceAC = true;
                        if (Math.random() < 0.2 && f > 0) {
                            if (type === 'factory' && factoryWallACs >= 1) canPlaceAC = false;
                            if ((type === 'house' || type === 'highrise') && floorsWithWallAC[f]) canPlaceAC = false;
                        } else {
                            canPlaceAC = false;
                        }

                        if (canPlaceAC) {
                            // AC POSITIONING:
                            // Wall AC Size reduced to be realistic: 0.85 width, 0.6 height, 0.4 depth
                            // To be mounted on wall (depth 1, half is 0.5):
                            // Center should be shifted towards the wall.
                            // AirCenter distance to WallSurface is 0.5.
                            // AC Center should be WallSurface + HalfDepth (0.2) = AirCenter - 0.5 + 0.2 = AirCenter - 0.3.
                            const offset = 0.3;
                            const lxAC = (col.worldX - (col.dx * offset)) - cx;
                            const lzAC = (col.worldZ - (col.dz * offset)) - cz;

                            assignedACs.push({
                                pos: [lxAC, ly, lzAC],
                                scale: [0.85, 0.6, 0.4], 
                                color: type === 'house' ? colors.acResidential : colors.acIndustrial,
                                rotation: col.rot,
                                type: 'wall'
                            });
                            
                            if (type === 'factory') factoryWallACs++;
                            if (type === 'house' || type === 'highrise') floorsWithWallAC[f] = true;
                        } else {
                            assignedWindows.push({
                                 pos: [lx, ly, lz],
                                 rot: col.rotVec as [number,number,number]
                            });
                        }
                        globalWallOccupied.add(getPosKey(col.worldX, worldY, col.worldZ));
                    }
                }
            } 
            else if (feature === 'ac') {
                 // Standalone Wall AC Logic
                 for (let f = 1; f < numFloors; f++) {
                     const worldY = (f * floorH) + 1.5;
                     if (worldY + 1.5 < height) { // Needs space for 2 height
                         const ly = worldY - (height/2);
                         let canPlaceAC = true;
                         if (type === 'factory' && factoryWallACs >= 1) canPlaceAC = false;
                         if ((type === 'house' || type === 'highrise') && floorsWithWallAC[f]) canPlaceAC = false;

                         if (canPlaceAC) {
                             const offset = 0.3;
                             const lxAC = (col.worldX - (col.dx * offset)) - cx;
                             const lzAC = (col.worldZ - (col.dz * offset)) - cz;
                             
                             assignedACs.push({
                                pos: [lxAC, ly, lzAC],
                                scale: [0.85, 0.6, 0.4],
                                color: colors.acIndustrial,
                                rotation: col.rot,
                                type: 'wall'
                            });
                            if (type === 'factory') factoryWallACs++;
                            if (type === 'house' || type === 'highrise') floorsWithWallAC[f] = true;
                         } else {
                             const winLy = worldY - (height/2);
                             const winLx = (col.worldX - (col.dx * 0.495)) - cx;
                             const winLz = (col.worldZ - (col.dz * 0.495)) - cz;
                             assignedWindows.push({
                                 pos: [winLx, winLy, winLz],
                                 rot: col.rotVec as [number,number,number]
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
                 const scaleY = height + 1.2;
                 const ly = (scaleY / 2) - (height / 2);
                 const offsetX = -col.dx * 0.5;
                 const offsetZ = -col.dz * 0.5;

                 attachedChimneys.push({
                     pos: [faceX + offsetX - cx, ly, faceZ + offsetZ - cz],
                     scale: [1.0, scaleY, 1.0], 
                     color: colors.chimneyResidential,
                     smoke: Math.random() > 0.5, 
                     rotation: col.rot
                 });
                 
                 for (let f = 0; f < numFloors; f++) {
                     const worldY = (f * floorH) + 1.5;
                     if (worldY < height) globalWallOccupied.add(getPosKey(col.worldX, worldY, col.worldZ));
                 }
            }
        }

        if (type === 'factory') {
            const numRoofObjs = Math.floor(Math.random() * 3); 
            for (let k = 0; k < numRoofObjs; k++) {
                const pad = 1;
                if (fillW <= 2 || fillD <= 2) continue; 
                
                // ADJUSTED: Random Roof AC Size for Factories
                // Width/Depth between 2 and 4. Height fixed at 3.
                const acW = Math.floor(Math.random() * 3) + 2; // 2, 3, or 4
                const acD = Math.floor(Math.random() * 3) + 2; // 2, 3, or 4
                const acH = 3.0;
                
                // Ensure it fits within the roof with padding
                const maxRx = fillW - 2 * pad - acW;
                const maxRz = fillD - 2 * pad - acD;

                if (maxRx <= 0 || maxRz <= 0) continue;

                const rx = Math.floor(Math.random() * maxRx) + pad;
                const rz = Math.floor(Math.random() * maxRz) + pad;
                
                let overlap = false;
                const checkX = rx - (fillW-1)/2 + acW/2;
                const checkZ = rz - (fillD-1)/2 + acD/2;
                
                for (const ac of assignedACs) {
                    if (ac.type === 'roof') {
                         const dx = ac.pos[0] - checkX;
                         const dz = ac.pos[2] - checkZ;
                         if (Math.sqrt(dx*dx + dz*dz) < 2.5) overlap = true;
                    }
                }
                for (const ch of attachedChimneys) {
                     const dx = ch.pos[0] - checkX;
                     const dz = ch.pos[2] - checkZ;
                     if (Math.sqrt(dx*dx + dz*dz) < 2.5) overlap = true;
                }

                if (!overlap) {
                    const isChimney = Math.random() > 0.6; 
                    if (isChimney) {
                        const scaleY = 1.5 + Math.random() * 1.5; 
                        attachedChimneys.push({
                            pos: [checkX, height/2 + scaleY/2, checkZ], 
                            scale: [1, scaleY, 1], 
                            color: colors.chimneyIndustrial,
                            smoke: true,
                            rotation: 0
                        });
                    } else {
                        // Position Y: Base aligned with roof top.
                        // Building Top Y (absolute) = height.
                        // AC Center Y = height + acH/2.
                        // Relative to Building Center (height/2): (height + acH/2) - height/2 = height/2 + acH/2.
                        const posY = height/2 + acH/2;

                        assignedACs.push({
                            pos: [checkX, posY, checkZ],
                            scale: [acW, acH, acD], 
                            color: colors.acIndustrial,
                            rotation: Math.floor(Math.random() * 4) * (Math.PI / 2),
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
        return type;
    };

    // --- MAIN LOOP ---
    let x = -halfSize + 1;
    while(x < halfSize - 1) {
        const currentStreetWidth = Math.random() > 0.8 ? baseStreetWidth + 1 : baseStreetWidth;
        const blockW = Math.floor(Math.random() * (maxBlockSize - minBlockSize + 1)) + minBlockSize;
        if (x + blockW >= halfSize) break; 
        
        let z = -halfSize + 1;
        while(z < halfSize - 1) {
            const blockD = Math.floor(Math.random() * (maxBlockSize - minBlockSize + 1)) + minBlockSize;
            if (z + blockD >= halfSize) break; 
            
            let safeBlockW = blockW;
            let safeBlockD = blockD;
            if (safeBlockW === 2 && safeBlockD === 2) {
                safeBlockD = 3;
            }
            if (z + safeBlockD >= halfSize) break;

            const placedType = placeBuilding(x, z, safeBlockW, safeBlockD);
            let nextZ = z + safeBlockD + currentStreetWidth;

            if (placedType === 'factory') {
                 const gap = 3; 
                 const twinZ = z + safeBlockD + gap;
                 const twinBlockD = Math.max(3, Math.min(6, halfSize - 1 - twinZ));
                 if (twinBlockD >= 3 && twinZ + twinBlockD < halfSize) {
                     placeBuilding(x, twinZ, safeBlockW, twinBlockD, 'factory');
                     nextZ = twinZ + twinBlockD + currentStreetWidth;
                 }
            }
            z = nextZ;
        }
        x += blockW + currentStreetWidth;
    }

    for (let lx = -halfSize; lx < halfSize; lx++) {
        for (let lz = -halfSize; lz < halfSize; lz++) {
            const tx = lx + halfSize;
            const tz = lz + halfSize;
            if (tx >= 0 && tx < size && tz >= 0 && tz < size) {
                if (!isWaterLogic(lx, lz) && tGrid[tx][tz] === 0) {
                    const zone = getZoneInfo(lx, lz, 5);
                    const isDirt = zone.nearFarm && !zone.nearHighrise;
                    objects.push({
                        id: uid(`street-${lx}-${lz}`),
                        position: [lx, -0.48, lz], 
                        scale: [1, 0.05, 1],
                        color: isDirt ? colors.streetDirt : colors.streetAsphalt,
                        type: 'street'
                    });
                }
            }
        }
    }

    for (let x = 0; x < size; x++) {
        for (let z = 0; z < size; z++) {
            if (tGrid[x][z] === 4) {
                let isEdge = false;
                const neighbors = [[1,0], [-1,0], [0,1], [0,-1]];
                for (const [dx, dz] of neighbors) {
                    const nx = x + dx;
                    const nz = z + dz;
                    if (nx < 0 || nx >= size || nz < 0 || nz >= size || tGrid[nx][nz] !== 4) {
                        isEdge = true;
                    }
                }
                if (isEdge) {
                    if (Math.random() > 0.02) {
                        fenceLocations.add(`${x},${z}`);
                    }
                }
            }
        }
    }

    // --- AUTOMATIC COLLISION ADJUSTMENT STEP (HIGH RES) ---
    objects.forEach(obj => {
        if (obj.type === 'street') return;
        
        // --- CUSTOM FENCE COLLISION (1 Voxel Precision) ---
        if (obj.type === 'fence') {
            // Revert the visual offset to get Logic Coordinates for collision mapping
            // Visual X = worldX - 0.25. So Logic World X = Visual X + 0.25.
            const logicWX = Math.round(obj.position[0] + 0.25);
            const logicWZ = Math.round(obj.position[2] + 0.25);
            
            const startX = worldToIndex(logicWX, halfSize, size);
            const startZ = worldToIndex(logicWZ, halfSize, size);
            
            // Shift collision to align with visual offset (-0.25) which corresponds to Left/Top sub-cell (index - 1)
            const ix = startX - 1;
            const iz = startZ - 1;
            
            // Fence Logic: A tile is 2x2 sub-voxels.
            // Pillar: Always at (0,0) of the tile (Top-Left).
            if (ix >= 0 && ix < gridSize && iz >= 0 && iz < gridSize) {
                oGrid[ix][iz] = 1.2; // Pillar Height
            }

            // Neighbor Logic to create "thin" walls (1 voxel thick)
            // South Connection: Connects (ix, iz) to (ix, iz + 2) via (ix, iz + 1)
            if (obj.neighbors?.s) {
                if (ix >= 0 && ix < gridSize && iz + 1 < gridSize) {
                    oGrid[ix][iz + 1] = 1.0; 
                }
            }
            // East Connection: Connects (ix, iz) to (ix + 2, iz) via (ix + 1, iz)
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
                    const topY = obj.position[1] + h / 2;
                    // FIX: Remove 'fence' check as it's already returned early, causing type mismatch error
                    const collisionH = topY + (obj.type !== 'ruin' ? 0.3 : 0);
                    if (obj.position[1] - h/2 > 1.0) {
                         bGrid[gridX][gridZ] = Math.max(bGrid[gridX][gridZ], collisionH);
                    } else {
                         oGrid[gridX][gridZ] = Math.max(oGrid[gridX][gridZ], collisionH);
                    }
                }
            }
        }

        const details = [
            ...(obj.attachedChimneys || []).map(c => ({...c, isChimney: true, detailType: 'chimney' })),
            ...(obj.acs || []).map(a => ({...a, isChimney: false, detailType: a.type }))
        ];

        details.forEach(det => {
            const dW = det.scale[0];
            const dH = det.scale[1];
            const dD = det.scale[2];
            
            let absX = obj.position[0] + det.pos[0];
            const absY = obj.position[1] + det.pos[1];
            let absZ = obj.position[2] + det.pos[2];

            const dStartX = Math.round((absX - dW / 2 + halfSize) * GRID_SCALE);
            const dStartZ = Math.round((absZ - dD / 2 + halfSize) * GRID_SCALE);
            const dWHigh = Math.round(dW * GRID_SCALE);
            const dDHigh = Math.round(dD * GRID_SCALE);

            for(let dx = 0; dx < dWHigh; dx++) {
                for(let dz = 0; dz < dDHigh; dz++) {
                     const gridX = dStartX + dx;
                     const gridZ = dStartZ + dz;

                     if (gridX >= 0 && gridX < gridSize && gridZ >= 0 && gridZ < gridSize) {
                         const topH = absY + dH / 2;
                         if (absY - dH/2 > 2.0) {
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

    // --- CALCULATE RANDOM SPAWN POINT ---
    let spawnPos = new THREE.Vector3(0, 10, 0); // Fallback
    for(let k=0; k<100; k++) {
        // Try random positions
        const rx = Math.floor(Math.random() * size);
        const rz = Math.floor(Math.random() * size);
        
        // Check if it's street (0) and not water
        const logicX = rx - halfSize;
        const logicZ = rz - halfSize;
        
        if (tGrid[rx][rz] === 0 && !isWaterLogic(logicX, logicZ)) {
             spawnPos.set(logicX, 2, logicZ);
             break;
        }
    }

    return { objects, oGrid, bGrid, wGrid, spawnPos };
};
