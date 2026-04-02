
import * as THREE from 'three';

// --- CONSTANTS ---
export const GRID_SCALE = 1;

export const GRAVITY = 60.0;
export const JUMP_FORCE = 18.0;
export const CLIMB_SPEED = 10.0;
export const MOVE_SPEED_BASE = 10.0;
export const ROLL_SPEED_MULT = 1.3;
export const CLIMB_THRESHOLD = 0.6;
export const MAX_CLIMB_HEIGHT = 1000.0;
export const LADDER_CLIMB_SPEED = 8.0;
export const PLAYER_HEIGHT = 4.0;
export const FLOOR_HEIGHT = PLAYER_HEIGHT * 1.5; // One floor = 6.0 units
export const GROUND_DEPTH = 4.0; // Terreno e Rio com profundidade 4
export const FALL_DAMAGE_HEIGHT = 7.0;
export const PLAYER_RADIUS = 0.8;

// Water Physics
export const WATER_DEPTH_LEVEL = -2.0; // Nível de flutuação padrão (pés do boneco)
export const WATER_MOVE_SPEED_MULT = 0.4;
export const WATER_JUMP_DAMPING = 0.6;

// Stamina Costs & Recovery
export const STAMINA_JUMP_COST = 15.0;
export const STAMINA_RUN_COST = 20.0;
export const STAMINA_CLIMB_COST = 35.0;
export const STAMINA_RECOVERY_IDLE = 25.0;
export const STAMINA_RECOVERY_WALK = 5.0;

// Noise Levels 
export const NOISE_IDLE = 0;
export const NOISE_WALK = 0;
export const NOISE_CLIMB = 6.0;
export const NOISE_RUN = 14.0;
export const NOISE_JUMP = 10.0;
export const NOISE_LAND = 12.0;

// --- 3D COLLISION BOX ---
export interface CollisionBox {
    minX: number; minY: number; minZ: number;
    maxX: number; maxY: number; maxZ: number;
}

// --- SPATIAL HASH GRID ---
const CELL_SIZE = 4; // Each spatial cell covers 4x4 world units (XZ)

export class SpatialHashGrid {
    private cells: Map<number, CollisionBox[]> = new Map();
    private worldHalf: number;
    private gridW: number;

    constructor(worldSize: number) {
        this.worldHalf = Math.floor(worldSize / 2);
        this.gridW = Math.ceil(worldSize / CELL_SIZE) + 1;
    }

    private key(cx: number, cz: number): number {
        return cx * 10000 + cz; // fast key for reasonable world sizes
    }

    clear() {
        this.cells.clear();
    }

    insert(box: CollisionBox) {
        const x0 = Math.floor((box.minX + this.worldHalf) / CELL_SIZE);
        const x1 = Math.floor((box.maxX + this.worldHalf) / CELL_SIZE);
        const z0 = Math.floor((box.minZ + this.worldHalf) / CELL_SIZE);
        const z1 = Math.floor((box.maxZ + this.worldHalf) / CELL_SIZE);
        for (let cx = x0; cx <= x1; cx++) {
            for (let cz = z0; cz <= z1; cz++) {
                const k = this.key(cx, cz);
                let list = this.cells.get(k);
                if (!list) { list = []; this.cells.set(k, list); }
                list.push(box);
            }
        }
    }

    /** Return all boxes that could overlap with a sphere of given radius around (x,z) */
    query(x: number, z: number, radius: number): CollisionBox[] {
        const r = radius + 0.5; // small margin
        const x0 = Math.floor((x - r + this.worldHalf) / CELL_SIZE);
        const x1 = Math.floor((x + r + this.worldHalf) / CELL_SIZE);
        const z0 = Math.floor((z - r + this.worldHalf) / CELL_SIZE);
        const z1 = Math.floor((z + r + this.worldHalf) / CELL_SIZE);
        const seen = new Set<CollisionBox>();
        const result: CollisionBox[] = [];
        for (let cx = x0; cx <= x1; cx++) {
            for (let cz = z0; cz <= z1; cz++) {
                const list = this.cells.get(this.key(cx, cz));
                if (!list) continue;
                for (const box of list) {
                    if (!seen.has(box)) {
                        seen.add(box);
                        result.push(box);
                    }
                }
            }
        }
        return result;
    }

    /** Return all boxes stored in the grid (for debug visualization) */
    getAllBoxes(): CollisionBox[] {
        const seen = new Set<CollisionBox>();
        const result: CollisionBox[] = [];
        this.cells.forEach(list => {
            for (const box of list) {
                if (!seen.has(box)) {
                    seen.add(box);
                    result.push(box);
                }
            }
        });
        return result;
    }
}

// --- HELPERS ---

export const worldToIndex = (val: number, halfSize: number, worldSize: number) =>
    THREE.MathUtils.clamp(Math.floor((val + halfSize) * GRID_SCALE), 0, (worldSize * GRID_SCALE) - 1);

export const isOutOfBounds = (x: number, z: number, halfSize: number) =>
    x < -halfSize || x > halfSize || z < -halfSize || z > halfSize;

/**
 * Get the ground (floor) height at a world position by querying 3D collision boxes.
 * Ground = top of the highest box whose top is at or below the player's feet + threshold.
 * Also handles water and bridge grids for legacy behavior.
 */
export const getTerrainHeight = (
    x: number,
    z: number,
    currentY: number,
    collisionGrid: SpatialHashGrid,
    bridgeGrid: number[][],
    waterGrid: number[][],
    worldSize: number,
    threshold: number = CLIMB_THRESHOLD
) => {
    const halfSize = Math.floor(worldSize / 2);
    if (isOutOfBounds(x, z, halfSize)) return -Infinity;

    const ix = worldToIndex(x, halfSize, worldSize);
    const iz = worldToIndex(z, halfSize, worldSize);
    const bridgeH = bridgeGrid[ix]?.[iz] || 0;
    const isWater = waterGrid[ix]?.[iz] === 1;

    // Query nearby boxes
    const nearby = collisionGrid.query(x, z, 0.5);
    let bestGround = 0; // default ground is 0

    for (const box of nearby) {
        // Check XZ overlap: player point must be inside box XZ footprint
        if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;

        // The top of this box could be our ground if we're standing on it or near it
        const boxTop = box.maxY;

        // Consider boxes whose top is below us (we can stand on them)
        // Use a generous threshold so falling players don't miss building tops
        if (boxTop <= currentY + threshold + 0.1) {
            if (boxTop > bestGround) {
                bestGround = boxTop;
            }
        }
    }



    // Bridge Logic (legacy bridge grid still used for bridges)
    if (bridgeH > 0) {
        if (currentY >= bridgeH - 1.0) return Math.max(bestGround, bridgeH);
        // Under bridge
        if (isWater && bestGround <= 0) return WATER_DEPTH_LEVEL;
        return bestGround;
    }

    if (isWater && bestGround <= 0) {
        return WATER_DEPTH_LEVEL;
    }

    return bestGround;
};

/**
 * Get ceiling height above the player by querying 3D collision boxes.
 * Ceiling = bottom of the lowest box that is above the player's head.
 */
export const getCeilingHeight = (
    x: number,
    z: number,
    currentY: number,
    collisionGrid: SpatialHashGrid,
    bridgeGrid: number[][],
    worldSize: number
) => {
    const halfSize = Math.floor(worldSize / 2);
    const ix = worldToIndex(x, halfSize, worldSize);
    const iz = worldToIndex(z, halfSize, worldSize);
    const bridgeH = bridgeGrid[ix]?.[iz] || 0;

    let ceiling = Infinity;

    // Check bridge grid (legacy)
    if (bridgeH > 0 && currentY < bridgeH - 1.0) {
        ceiling = Math.min(ceiling, bridgeH - 1.0);
    }

    // Query 3D boxes for ceilings
    const nearby = collisionGrid.query(x, z, 0.5);
    for (const box of nearby) {
        // XZ overlap check
        if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;

        // Box is above the player (bottom of box is above player head)
        if (box.minY > currentY + 0.1 && box.minY < ceiling) {
            ceiling = box.minY;
        }
    }

    return ceiling;
};

/**
 * Simple Raycasting for Line of Sight.
 * Returns true if the path is clear between start and end.
 */
export const checkLineOfSight = (
    start: THREE.Vector3,
    end: THREE.Vector3,
    collisionGrid: SpatialHashGrid
): boolean => {
    const dist = start.distanceTo(end);
    if (dist <= 0) return true;
    
    const stepSize = 0.5;
    const dir = new THREE.Vector3().subVectors(end, start).normalize();
    const probe = new THREE.Vector3();
    
    for (let d = stepSize; d < dist; d += stepSize) {
        probe.copy(start).addScaledVector(dir, d);
        const boxes = collisionGrid.query(probe.x, probe.z, 0.1);
        for (const box of boxes) {
            if (probe.y >= box.minY && probe.y <= box.maxY) {
                if (probe.x >= box.minX && probe.x <= box.maxX && probe.z >= box.minZ && probe.z <= box.maxZ) {
                    return false;
                }
            }
        }
    }
    return true;
};

/**
 * 3D AABB collision resolution: push the player's cylinder out of any overlapping boxes.
 * Uses proper 3D overlap tests – the player is modeled as a vertical cylinder.
 */
const resolveWallCollisions = (
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    world: { collisionGrid: SpatialHashGrid; bGrid: number[][]; wGrid: number[][]; size: number }
) => {
    const radius = PLAYER_RADIUS;
    const feetY = pos.y;
    const headY = pos.y + PLAYER_HEIGHT;

    // Query all boxes near the player
    const nearby = world.collisionGrid.query(pos.x, pos.z, radius + 1.0);
    let pushed = false;

    for (const box of nearby) {
        // 1. Vertical overlap check: player cylinder [feetY, headY] vs box [minY, maxY]
        // Use a 2.0 epsilon so falling fast doesn't trigger side-ward push
        if (feetY >= box.maxY - 2.0 || headY <= box.minY) continue;

        // 2. Horizontal: closest point on box XZ to player center, then circle test
        const closeX = Math.max(box.minX, Math.min(pos.x, box.maxX));
        const closeZ = Math.max(box.minZ, Math.min(pos.z, box.maxZ));

        const dx = pos.x - closeX;
        const dz = pos.z - closeZ;
        const distSq = dx * dx + dz * dz;

        if (distSq < radius * radius) {
            if (distSq > 0.00001) {
                // Push out horizontally
                const dist = Math.sqrt(distSq);
                const penetration = radius - dist;
                const nx = dx / dist;
                const nz = dz / dist;
                pos.x += nx * penetration;
                pos.z += nz * penetration;

                // Zero out velocity component going INTO the wall
                const velDot = vel.x * nx + vel.z * nz;
                if (velDot < 0) {
                    vel.x -= velDot * nx;
                    vel.z -= velDot * nz;
                }

                pushed = true;
            } else {
                // Player center is exactly inside the box – pick smallest push axis
                const pushDistances = [
                    { axis: 'x', dir: 1, dist: box.maxX - pos.x + radius },
                    { axis: 'x', dir: -1, dist: pos.x - box.minX + radius },
                    { axis: 'z', dir: 1, dist: box.maxZ - pos.z + radius },
                    { axis: 'z', dir: -1, dist: pos.z - box.minZ + radius }
                ];
                pushDistances.sort((a, b) => a.dist - b.dist);
                const best = pushDistances[0];
                if (best.axis === 'x') {
                    pos.x += best.dir * best.dist;
                    if (best.dir * vel.x < 0) vel.x = 0;
                } else {
                    pos.z += best.dir * best.dist;
                    if (best.dir * vel.z < 0) vel.z = 0;
                }
                pushed = true;
            }
        }
    }
    return pushed;
};

// --- PHYSICS ENGINE ---

interface PhysicsState {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    isGrounded: boolean;
    isCharging: boolean;
    isRolling: boolean;
    stamina: number;
    stunned: boolean;
    stumbleTimer: number;
    stumbleVel: THREE.Vector3;
    airTimeHigh: number;
    lastDir: THREE.Vector2;
    noiseLevel: number;
    isClimbing: boolean;
    ladderFaceAngle: number;
    isLadderSliding: boolean;
    isNearLadder: boolean;
    isLadderHanging: boolean;
    isLadderMounting: boolean;
    ladderMountTimer: number;
    isWallClimbing: boolean;
    wallClimbProgress: number;
    wallClimbDir: THREE.Vector2;
}

interface PhysicsInput {
    dt: number;
    moveDir: THREE.Vector3;
    actions: { jump: boolean; charge: boolean; climb: boolean; run: boolean; attemptRoll: boolean, ladderUp: boolean, ladderDown: boolean, grabLadder: boolean };
    stats: { speed: number; climbSpeed: number };
    world: { collisionGrid: SpatialHashGrid; bGrid: number[][]; wGrid: number[][]; size: number; ladderZones: { minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, faceAngle: number, railX: number, railZ: number }[]; riverOrientation: number; riverFlow: number };
}

export const updateEntityPhysics = (
    current: PhysicsState,
    input: PhysicsInput
): PhysicsState => {
    const next = current; // Mutate current state directly to avoid GC allocations
    next.noiseLevel = NOISE_IDLE;
    // Reset wall climbing state each frame; it will be re-set if a ledge is actively being scaled
    next.isWallClimbing = false;
    const { dt, moveDir, actions, stats, world } = input;

    // 0. Environment Check
    const radius = PLAYER_RADIUS;
    const halfSize = Math.floor(world.size / 2);
    const checkPoints = [
        [0, 0],
        [radius * 0.7, 0],
        [-radius * 0.7, 0],
        [0, radius * 0.7],
        [0, -radius * 0.7],
        [radius * 0.5, radius * 0.5],
        [-radius * 0.5, radius * 0.5],
        [radius * 0.5, -radius * 0.5],
        [-radius * 0.5, -radius * 0.5]
    ];

    let pointsInWater = 0;
    for (const [ox, oz] of checkPoints) {
        const ix = worldToIndex(next.pos.x + ox, halfSize, world.size);
        const iz = worldToIndex(next.pos.z + oz, halfSize, world.size);
        if (world.wGrid[ix]?.[iz] === 1) {
            pointsInWater++;
        }
    }

    const waterRatio = pointsInWater / checkPoints.length;
    const isInWater = waterRatio > 0 && next.pos.y < -0.3;
    const cGrid = world.collisionGrid;

    // --- CURRENT FLOW (MOVED TO END) ---
    // Moved to end of function to ensure it persists

    // 1. Status Effects (Stun / Stumble)
    if (next.stunned) {
        next.stamina = Math.min(100, next.stamina + STAMINA_RECOVERY_IDLE * dt);
        const groundH = getTerrainHeight(next.pos.x, next.pos.z, next.pos.y, cGrid, world.bGrid, world.wGrid, world.size, CLIMB_THRESHOLD);

        if (next.stumbleTimer > 0) next.stumbleTimer -= dt;

        if (next.stumbleVel.lengthSq() > 0.01 && next.isGrounded) {
            const dx = next.stumbleVel.x * dt;
            const dz = next.stumbleVel.z * dt;
            const targetX = next.pos.x + dx;
            const targetZ = next.pos.z + dz;
            const tH = getTerrainHeight(targetX, targetZ, next.pos.y, cGrid, world.bGrid, world.wGrid, world.size, CLIMB_THRESHOLD);

            if (tH > -Infinity && tH <= next.pos.y + 0.5) {
                next.pos.x = targetX;
                next.pos.z = targetZ;
            } else {
                next.stumbleVel.set(0, 0, 0);
            }

            // Higher friction in water
            const friction = isInWater ? 8.0 : 5.0;
            const drag = Math.max(0, 1.0 - (friction * dt));
            next.stumbleVel.multiplyScalar(drag);

            const hitWall = resolveWallCollisions(next.pos, next.vel, world);
            if (hitWall) next.stumbleVel.set(0, 0, 0);
        } else {
            next.stumbleVel.set(0, 0, 0);
        }

        if (next.pos.y > groundH) {
            next.vel.y -= GRAVITY * dt;
            next.pos.y += next.vel.y * dt;
            resolveWallCollisions(next.pos, next.vel, world);
        } else {
            next.pos.y = groundH;
            next.vel.y = 0;
            next.isGrounded = true;
        }

        next.isCharging = false;
        next.isRolling = false;
        return next;
    } else {
        next.stumbleTimer = 0;
        next.stumbleVel.set(0, 0, 0);
    }

    // 2. Vertical Physics
    const ceilingH = getCeilingHeight(next.pos.x, next.pos.z, next.pos.y, cGrid, world.bGrid, world.size);

    if (!next.isGrounded) {
        next.vel.y -= GRAVITY * dt;
        next.airTimeHigh = Math.max(next.airTimeHigh, next.pos.y);
    }

    // Charge logic
    if (actions.charge && next.isGrounded && !next.isRolling) {
        next.isCharging = true;
    } else {
        next.isCharging = false;
    }

    // --- LADDER ZONE DETECTION (early, so jump can be suppressed) ---
    let onLadder = false;
    let matchedLadderAngle = 0;
    let railX = 0, railZ = 0, ladderMinY = 0, ladderMaxY = 0;
    if (world.ladderZones && world.ladderZones.length > 0) {
        const px = next.pos.x;
        const py = next.pos.y;
        const pz = next.pos.z;

        for (const zone of world.ladderZones) {
            // XZ containment check
            if (px < zone.minX || px > zone.maxX || pz < zone.minZ || pz > zone.maxZ) continue;
            // Y range: generous — allow from slightly below ladder bottom to above ladder top (for roof grabs)
            // Player feet (py) can be anywhere from below the ladder to above the top
            if (py >= zone.minY - 1.0 && py <= zone.maxY + 2.0) {
                onLadder = true;
                matchedLadderAngle = zone.faceAngle;
                railX = zone.railX;
                railZ = zone.railZ;
                ladderMinY = zone.minY;
                ladderMaxY = zone.maxY;
                break;
            }
        }
    }

    const alreadyOnLadder = current.isClimbing || current.isLadderHanging || current.isLadderSliding;

    // Jump — suppress if player is grabbing a ladder (SPACE to grab instead of jump)
    const suppressJumpForLadder = onLadder && actions.grabLadder && !alreadyOnLadder;
    if (actions.jump && next.isGrounded && !next.isRolling && !suppressJumpForLadder) {
        if (next.pos.y + PLAYER_HEIGHT + 0.5 < ceilingH) {
            if (next.stamina >= STAMINA_JUMP_COST) {
                // Dampened jump in water
                const jumpForce = isInWater ? JUMP_FORCE * WATER_JUMP_DAMPING : JUMP_FORCE;

                next.vel.y = jumpForce;
                next.isGrounded = false;
                next.isCharging = false;
                next.noiseLevel = Math.max(next.noiseLevel, NOISE_JUMP);
                next.stamina -= STAMINA_JUMP_COST;
            }
        }
    }

    if (next.pos.y + PLAYER_HEIGHT > ceilingH && next.vel.y > 0) {
        next.pos.y = ceilingH - PLAYER_HEIGHT - 0.01;
        next.vel.y = 0;
    }

    if (onLadder && !isInWater) {
        next.isNearLadder = true;
        next.ladderFaceAngle = matchedLadderAngle;
        
        // --- DETERMINE IF PLAYER WANTS TO RELEASE FROM LADDER ---
        // Release: player is already on ladder AND presses jump (SPACE)
        // Two cases: (a) pressing a direction → leap off, (b) just SPACE alone → drop off
        const wantsRelease = actions.jump && alreadyOnLadder;

        if (wantsRelease) {
            // RELEASE / JUMP OFF LADDER
            const hasDirection = moveDir.lengthSq() > 0.1 || actions.ladderDown;
            if (hasDirection && next.stamina >= STAMINA_JUMP_COST) {
                // Leap away from the ladder backwards
                next.vel.y = JUMP_FORCE * 0.7;
                const pushOut = 1.5;
                next.pos.x -= Math.sin(matchedLadderAngle) * pushOut;
                next.pos.z -= Math.cos(matchedLadderAngle) * pushOut;
                next.isGrounded = false;
                next.isCharging = false;
                next.noiseLevel = Math.max(next.noiseLevel, NOISE_JUMP);
                next.stamina -= STAMINA_JUMP_COST;
                next.lastDir.set(-Math.sin(matchedLadderAngle), -Math.cos(matchedLadderAngle));
            }
            // Clear all ladder states on release
            next.isClimbing = false;
            next.isLadderSliding = false;
            next.isLadderHanging = false;
            next.isLadderMounting = false;
            next.ladderMountTimer = 0;
        } else {
            // --- LADDER INTERACTION (grab, climb, slide, hang) ---
            next.ladderFaceAngle = matchedLadderAngle;
            let ladderVelY = 0;
            let dismounting = false;

            // Determine player height relative to ladder
            const isOnRoof = next.isGrounded && next.pos.y > ladderMinY + 1.0;
            const isAtBottom = next.pos.y <= ladderMinY + 0.1;

            // --- GRAB DETECTION ---
            // From ground (near base): press SPACE to grab
            const wantsGrab = actions.grabLadder && !alreadyOnLadder;
            let autoGrab = false;

            if (wantsGrab && isOnRoof) {
                // Grabbing from roof → mount transition
                autoGrab = true;
                if (!current.isLadderMounting) {
                    next.ladderMountTimer = 0.5;
                }
            } else if (wantsGrab && !isOnRoof) {
                // Grabbing from ground level → directly attach
                autoGrab = true;
            }

            // --- MOVEMENT INTENT ---
            const isMovingUp = (actions.ladderUp || (actions.grabLadder && !alreadyOnLadder && !isOnRoof)) && next.stamina > 0 && (alreadyOnLadder || autoGrab);
            const canMoveDown = actions.ladderDown && next.pos.y > ladderMinY + 0.1;
            const isMovingDown = canMoveDown && !isMovingUp && (alreadyOnLadder || autoGrab);

            // --- DISMOUNT AT BOTTOM ---
            if (isAtBottom && !isMovingUp && alreadyOnLadder) {
                dismounting = true;
            }

            // --- DIRECTION/DISTANCE FROM RAIL ---
            const dirX = Math.sin(matchedLadderAngle);
            const dirZ = Math.cos(matchedLadderAngle);
            const distFromRail = (next.pos.x - railX) * dirX + (next.pos.z - railZ) * dirZ;

            const isNearTop = next.pos.y > ladderMaxY - 0.5 && !next.isLadderMounting && next.ladderMountTimer <= 0;
            const isWalkingIntoRoof = alreadyOnLadder && !next.isLadderMounting && distFromRail > 0.05 && distFromRail < 1.5 && next.pos.y >= ladderMaxY - 0.1;

            // --- STATE TRANSITIONS ---
            if (isMovingUp || (isNearTop && alreadyOnLadder && !actions.ladderDown) || (isWalkingIntoRoof && !actions.ladderDown)) {
                if ((isNearTop || isWalkingIntoRoof) && !next.isLadderMounting) {
                    // TOP DISMOUNT: Enhanced cinematic mantle onto roof
                    // Two phases: reaching/pulling over + final surge
                    const nearTopProgress = (next.pos.y - (ladderMaxY - 0.5)) / 0.5;
                    const glideSpeed = nearTopProgress > 0.5 ? 5.5 : 4.0;
                    const liftSpeed = nearTopProgress > 0.5 ? 4.5 : 3.0;
                    
                    next.pos.x += dirX * glideSpeed * dt;
                    next.pos.z += dirZ * glideSpeed * dt;
                    
                    if (next.pos.y < ladderMaxY) {
                        next.pos.y += liftSpeed * dt; 
                    } else {
                        next.pos.y = ladderMaxY;
                    }
                    
                    next.vel.y = 0; 
                    if (next.pos.y >= ladderMaxY - 0.1) {
                        // Snap to actual roof collision height instead of ladderMaxY
                        const roofH = getTerrainHeight(next.pos.x, next.pos.z, next.pos.y, cGrid, world.bGrid, world.wGrid, world.size, 2.0);
                        if (roofH > ladderMinY) {
                            next.pos.y = roofH;
                        }
                        next.isClimbing = false;
                        next.isGrounded = true;
                    } else {
                        next.isClimbing = true;
                    }

                    if (distFromRail >= 1.5) {
                        dismounting = true;
                    }

                    next.isLadderSliding = false;
                    next.isLadderHanging = false;
                } else {
                    // CLIMB UP
                    ladderVelY = CLIMB_SPEED;
                    next.stamina = Math.max(0, next.stamina - STAMINA_CLIMB_COST * dt);
                    next.isClimbing = true;
                    next.isLadderSliding = false;
                    next.isLadderHanging = false;
                    next.noiseLevel = Math.max(next.noiseLevel, NOISE_CLIMB);
                    next.lastDir.set(Math.sin(matchedLadderAngle), Math.cos(matchedLadderAngle));
                }
            } else if (isMovingDown) {
                // SLIDE DOWN
                ladderVelY = -12.0;
                next.isClimbing = false;
                next.isLadderSliding = true;
                next.isLadderHanging = false;
            } else if ((alreadyOnLadder || autoGrab) && !dismounting) {
                // HANG / CLING (gravity disabled, no vertical movement)
                ladderVelY = 0;
                next.isClimbing = true;
                next.isLadderSliding = false;
                next.isLadderHanging = true;
                next.stamina = Math.min(100, next.stamina + STAMINA_RECOVERY_WALK * dt);
            }

            // --- RAIL LOCK: Snap player to ladder rails ---
            const isEngaged = alreadyOnLadder || autoGrab;
            if (!dismounting && isEngaged) {
                if ((autoGrab || next.ladderMountTimer > 0) && next.pos.y > ladderMaxY - 1.0) {
                    // MOUNTING FROM ROOF: smooth transition down
                    next.isLadderMounting = true;
                    const lerpSpeed = 8.0 * dt;
                    next.pos.x += (railX - next.pos.x) * lerpSpeed;
                    next.pos.z += (railZ - next.pos.z) * lerpSpeed;
                    
                    if (next.ladderMountTimer > 0) {
                        next.pos.y -= 2.0 * dt;
                        next.ladderMountTimer -= dt;
                        if (next.ladderMountTimer < 0) next.ladderMountTimer = 0;
                    }
                } else {
                    // NORMAL RAIL LOCK: smooth suck in
                    next.isLadderMounting = false;
                    const lerpSpeed = 15.0 * dt;
                    next.pos.x += (railX - next.pos.x) * lerpSpeed;
                    next.pos.z += (railZ - next.pos.z) * lerpSpeed;
                }

                if (isMovingUp) {
                    next.vel.y = Math.max(next.vel.y, ladderVelY);
                } else {
                    next.vel.y = ladderVelY;
                }
                next.isGrounded = false;
            }

            // Reset fall tracking and prevent other actions while on ladder
            if (!dismounting && isEngaged) {
                next.isCharging = false;
                next.isRolling = false;
                next.airTimeHigh = next.pos.y;
            }

            // Clear ladder states on dismount
            if (dismounting) {
                next.isClimbing = false;
                next.isLadderSliding = false;
                next.isLadderHanging = false;
                next.isLadderMounting = false;
                next.ladderMountTimer = 0;
            }
        }

        // Ceiling check while on ladder
        if (next.pos.y + PLAYER_HEIGHT > ceilingH && next.vel.y > 0) {
            next.pos.y = ceilingH - PLAYER_HEIGHT - 0.01;
            next.vel.y = 0;
        }
    } else if (!onLadder && alreadyOnLadder) {
        // Player left the ladder zone while in a ladder state → clear states
        next.isClimbing = false;
        next.isLadderSliding = false;
        next.isLadderHanging = false;
        next.isLadderMounting = false;
        next.ladderMountTimer = 0;
    }

    // 3. Horizontal Movement
    // next.isClimbing = false; // Removed with climbing logic

    // Apply Water Speed Penalty
    let moveSpeedMult = isInWater ? WATER_MOVE_SPEED_MULT : 1.0;

    let speed = stats.speed * MOVE_SPEED_BASE * moveSpeedMult * dt;
    let currentMoveDir = moveDir.clone();

    if (next.isRolling) {
        currentMoveDir.set(next.lastDir.x, 0, next.lastDir.y).normalize();
        speed *= ROLL_SPEED_MULT;
    }

    let isRunning = false;
    const isMoving = currentMoveDir.lengthSq() > 0;
    const isLadderState = next.isClimbing || next.isLadderSliding || next.isLadderHanging;

    // Running in water drains stamina but doesn't give much speed boost
    if (!isLadderState) {
        if (actions.run && next.stamina > 0 && isMoving && !next.isCharging && !next.isRolling) {
            // Scale speed boost based on stamina: 100% -> 1.5x, 0% -> 1.0x
            const staminaFactor = next.stamina / 100.0;
            speed *= 1.0 + (0.5 * staminaFactor);

            next.stamina -= STAMINA_RUN_COST * dt;
            isRunning = true;
        } else {
            const recoveryRate = isMoving ? STAMINA_RECOVERY_WALK : STAMINA_RECOVERY_IDLE;
            next.stamina = Math.min(100, next.stamina + recoveryRate * dt);
        }
    }

    if (isMoving && next.isGrounded && !next.isCharging) {
        next.noiseLevel = isRunning ? NOISE_RUN : NOISE_WALK;
        if (next.isRolling) next.noiseLevel = NOISE_RUN;
    }

    if (isMoving) {
        if (!next.isRolling) {
            next.lastDir.set(currentMoveDir.x, currentMoveDir.z).normalize();
        }

        const startX = next.pos.x;
        const startZ = next.pos.z;

        // Pre-allocate axes to avoid new vector creation in hot loop
        const moveAxisX = currentMoveDir.x;
        const moveAxisZ = currentMoveDir.z;
        
        const halfSize = Math.floor(world.size / 2);
        const minBound = -halfSize + PLAYER_RADIUS + 0.01;
        const maxBound = halfSize - PLAYER_RADIUS - 0.01;

        // 2 passes for movement on X and Z axis
        for (let pass = 0; pass < 2; pass++) {
            const isXAxis = pass === 0;
            const axisVal = isXAxis ? moveAxisX : moveAxisZ;
            
            if (axisVal === 0) continue;

            const targetX = next.pos.x + (isXAxis ? axisVal * speed : 0);
            const targetZ = next.pos.z + (!isXAxis ? axisVal * speed : 0);

            if (targetX < minBound || targetX > maxBound || targetZ < minBound || targetZ > maxBound) continue;

            // With higher resolution, we check slightly further ahead
            const lookAheadDist = PLAYER_RADIUS + 0.1;
            const checkX = next.pos.x + (isXAxis ? (axisVal > 0 ? lookAheadDist : -lookAheadDist) : 0);
            const checkZ = next.pos.z + (!isXAxis ? (axisVal > 0 ? lookAheadDist : -lookAheadDist) : 0);

            const targetH = getTerrainHeight(checkX, checkZ, next.pos.y, cGrid, world.bGrid, world.wGrid, world.size, CLIMB_THRESHOLD);

            let heightDiff = targetH - next.pos.y;
            const isAbyss = targetH === -Infinity;

            // Water exit: detect when player is in water and moving toward dry land
            // Use generous threshold covering full water depth + margin
            const isWaterExit = isInWater && heightDiff > 0 && heightDiff <= (Math.abs(WATER_DEPTH_LEVEL) + 1.0);

            // 3D Wall Check: query collision boxes at the target position
            let isBlockedBy3DWall = false;
            let wallTopHeight = 0;
            const nearbyBoxes = cGrid.query(targetX, targetZ, radius);
            for (const box of nearbyBoxes) {
                // Ignore boxes that are short enough to step onto automatically
                if (next.pos.y + CLIMB_THRESHOLD >= box.maxY || next.pos.y + PLAYER_HEIGHT <= box.minY) continue;
                const cX = Math.max(box.minX, Math.min(targetX, box.maxX));
                const cZ = Math.max(box.minZ, Math.min(targetZ, box.maxZ));
                const ddx = targetX - cX;
                const ddz = targetZ - cZ;
                if (ddx * ddx + ddz * ddz < radius * radius) {
                    isBlockedBy3DWall = true;
                    if (box.maxY > wallTopHeight) wallTopHeight = box.maxY;
                }
            }

            // If 3D wall detected, use the actual wall top for height difference
            // But skip this override during water exit — the shore is not a "wall"
            if (isBlockedBy3DWall && wallTopHeight > next.pos.y + CLIMB_THRESHOLD && !isWaterExit) {
                heightDiff = wallTopHeight - next.pos.y;
            }

            let climbingLedge = false;
            // Se o muro for alto o suficiente para bloquear, mas o topo estiver abaixo da cabeça do jogador (pos.y + PLAYER_HEIGHT)
            // Cancela a escalada de borda se o jogador estiver em uma escada (onLadder)
            if (isBlockedBy3DWall && wallTopHeight > next.pos.y + CLIMB_THRESHOLD && wallTopHeight <= next.pos.y + PLAYER_HEIGHT && !isWaterExit && !onLadder) {
                const ceilingAtLedge = getCeilingHeight(targetX, targetZ, wallTopHeight, cGrid, world.bGrid, world.size);
                if (ceilingAtLedge === Infinity || ceilingAtLedge - wallTopHeight >= PLAYER_HEIGHT) {
                    climbingLedge = true;
                }
            }

            if (climbingLedge && next.stamina > 0) {
                next.vel.y = Math.max(next.vel.y, CLIMB_SPEED);
                next.stamina = Math.max(0, next.stamina - STAMINA_CLIMB_COST * dt);
                // Track wall climbing state for animation
                next.isWallClimbing = true;
                next.wallClimbProgress = Math.min(1.0, next.wallClimbProgress + dt * 3.0);
                if (isXAxis) {
                    next.lastDir.set(Math.sign(axisVal), 0);
                    next.wallClimbDir.set(Math.sign(axisVal), 0);
                } else {
                    next.lastDir.set(0, Math.sign(axisVal));
                    next.wallClimbDir.set(0, Math.sign(axisVal));
                }
            }

            // Water exit bypasses wall detection for the shore edge
            const isWall = (heightDiff > CLIMB_THRESHOLD && !isWaterExit) || (isBlockedBy3DWall && !isWaterExit);

            const ceilingAtTarget = getCeilingHeight(targetX, targetZ, Math.max(targetH, next.pos.y), cGrid, world.bGrid, world.size);
            const hasHeadroom = (ceilingAtTarget === Infinity) || (ceilingAtTarget - Math.max(targetH, next.pos.y) >= PLAYER_HEIGHT);

            if (!isWall && !isAbyss && hasHeadroom) {
                const canStepUp = heightDiff <= CLIMB_THRESHOLD || isWaterExit;

                if (targetH > next.pos.y + 0.05 && canStepUp) {
                    if (isWaterExit) {
                        // Smooth but fast rise out of water
                        const lerpSpeed = 6.0 * dt;
                        next.pos.y = next.pos.y + (targetH - next.pos.y) * Math.min(lerpSpeed, 1.0);
                        next.vel.y = Math.max(next.vel.y, 3.0); // upward boost to help climb out
                    } else {
                        next.pos.y = targetH;
                        next.vel.y = 0;
                    }
                }
                next.pos.x = targetX;
                next.pos.z = targetZ;
            }
        }

        if (next.isClimbing || next.isLadderSliding || next.isLadderHanging) {
            next.pos.x = startX;
            next.pos.z = startZ;
        }

        // --- WATER EDGE AUTO-CLIMB ---
        // When player is in water, grounded, and moving toward shore,
        // give an upward velocity boost to help them climb out automatically
        if (isInWater && next.isGrounded && next.pos.y <= WATER_DEPTH_LEVEL + 0.1) {
            const aheadX = next.pos.x + next.lastDir.x * (PLAYER_RADIUS + 0.5);
            const aheadZ = next.pos.z + next.lastDir.y * (PLAYER_RADIUS + 0.5);
            const aheadIx = worldToIndex(aheadX, halfSize, world.size);
            const aheadIz = worldToIndex(aheadZ, halfSize, world.size);
            const aheadIsWater = world.wGrid[aheadIx]?.[aheadIz] === 1;

            // If dry land is ahead, push player upward
            if (!aheadIsWater) {
                next.vel.y = Math.max(next.vel.y, 8.0);
                next.isGrounded = false;
            }
        }
    }

    next.pos.y += next.vel.y * dt;

    // 6. Landing / Grounding
    let groundH = getTerrainHeight(next.pos.x, next.pos.z, next.pos.y, cGrid, world.bGrid, world.wGrid, world.size, onLadder ? -0.1 : 2.0);

    // Prevent snapping up to walls while moving
    if (groundH > next.pos.y + 1.2) {
        groundH = -Infinity;
    }

    const safeGround = groundH === -Infinity ? 0 : groundH;

    if (next.pos.y <= safeGround) {
        // Fall damage logic
        const isClimbingState = next.isClimbing || next.isLadderSliding || next.isLadderHanging;
        if (!next.isGrounded && next.vel.y < -5.0 && safeGround > WATER_DEPTH_LEVEL + 0.1 && !isClimbingState) {
            const fallDist = next.airTimeHigh - safeGround;
            if (fallDist > FALL_DAMAGE_HEIGHT) {
                if (actions.attemptRoll) {
                    next.isRolling = true;
                    next.stunned = false;
                    next.noiseLevel = Math.max(next.noiseLevel, NOISE_LAND);
                } else {
                    next.stunned = true;
                    next.noiseLevel = Math.max(next.noiseLevel, NOISE_LAND + 5);
                    const moveX = (next.pos.x - current.pos.x) / dt;
                    const moveZ = (next.pos.z - current.pos.z) / dt;
                    const maxVel = 20.0;
                    // Push backwards upon hard landing to give room for the faceplant animation (avoids clipping into walls)
                    const knockback = 15.0;
                    const safeVx = THREE.MathUtils.clamp(moveX, -maxVel, maxVel) - (next.lastDir.x * knockback);
                    const safeVz = THREE.MathUtils.clamp(moveZ, -maxVel, maxVel) - (next.lastDir.y * knockback);
                    next.stumbleVel.set(safeVx, 0, safeVz);
                }
            } else {
                next.noiseLevel = Math.max(next.noiseLevel, NOISE_LAND);
            }
        } else if (!next.isGrounded) {
            next.noiseLevel = Math.max(next.noiseLevel, NOISE_LAND);
        }

        next.isGrounded = true;
        next.airTimeHigh = safeGround;
        next.pos.y = safeGround;
        next.vel.y = 0;
        // Reset wall climbing state on landing
        next.isWallClimbing = false;
        next.wallClimbProgress = 0;

        // --- WATER EDGE ANTI-CLIPPING ---
        // When idling in water near shore, push player away from dry land
        // to prevent the body from clipping through the ground edge.
        // Only apply when NOT moving — if moving, the player is likely trying to exit.
        if (safeGround <= WATER_DEPTH_LEVEL + 0.1 && moveDir.lengthSq() === 0) {
            const edgeCheckDist = radius + 0.2;
            const edgeAngles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4];
            let pushX = 0;
            let pushZ = 0;
            let landCount = 0;

            for (const angle of edgeAngles) {
                const checkX = next.pos.x + Math.cos(angle) * edgeCheckDist;
                const checkZ = next.pos.z + Math.sin(angle) * edgeCheckDist;
                const edgeIx = worldToIndex(checkX, halfSize, world.size);
                const edgeIz = worldToIndex(checkZ, halfSize, world.size);
                const edgeIsWater = world.wGrid[edgeIx]?.[edgeIz] === 1;

                if (!edgeIsWater) {
                    // This direction has dry land — accumulate push away from it
                    pushX -= Math.cos(angle);
                    pushZ -= Math.sin(angle);
                    landCount++;
                }
            }

            if (landCount > 0) {
                const pushLen = Math.sqrt(pushX * pushX + pushZ * pushZ);
                if (pushLen > 0.01) {
                    const pushStrength = radius * 0.8;
                    next.pos.x += (pushX / pushLen) * pushStrength * dt * 8;
                    next.pos.z += (pushZ / pushLen) * pushStrength * dt * 8;
                }
            }
        }
    } else {
        next.isGrounded = false;
        next.isCharging = false;
    }

    // Resolve wall collisions AFTER landing logic to prevent sideways teleportation
    resolveWallCollisions(next.pos, next.vel, world);
    resolveWallCollisions(next.pos, next.vel, world);

    // --- FINAL CURRENT FLOW APPLICATION ---
    if (isInWater && world.riverOrientation !== -1) {
        // Sync speed with floating particles in VoxelWater.tsx
        // Particles move at: (p.speed + 1.0) * (Math.max(1.0, riverFlow) / 3.0)
        // Average p.speed is 2.5, so average speed is 3.5 * (Math.max(1.0, riverFlow) / 3.0)
        const flowStrength = Math.max(1.0, world.riverFlow) * (3.5 / 3.0) * waterRatio;
        const riverMargin = PLAYER_RADIUS + 0.1;

        const push = new THREE.Vector3(0, 0, 0);
        if (world.riverOrientation === 0) push.z = flowStrength * dt;      // N->S
        else if (world.riverOrientation === 2) push.z = -flowStrength * dt; // S->N
        else if (world.riverOrientation === 3) push.x = flowStrength * dt;  // W->E
        else if (world.riverOrientation === 1) push.x = -flowStrength * dt; // E->W

        // Buoyancy removed to prevent grounding oscillation

        next.pos.add(push);

        // Resolve multiple times to prevent corner sticking when pushed by current
        for (let i = 0; i < 3; i++) {
            resolveWallCollisions(next.pos, next.vel, world);
        }
    }

    // Final map boundary clamping (Global)
    const GLOBAL_MARGIN = PLAYER_RADIUS + 0.1;
    const minBoundFinal = -halfSize + GLOBAL_MARGIN;
    const maxBoundFinal = halfSize - GLOBAL_MARGIN;
    next.pos.x = THREE.MathUtils.clamp(next.pos.x, minBoundFinal, maxBoundFinal);
    next.pos.z = THREE.MathUtils.clamp(next.pos.z, minBoundFinal, maxBoundFinal);

    return next;
};
