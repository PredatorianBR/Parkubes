
import * as THREE from 'three';

// --- CONSTANTS ---
export const GRID_SCALE = 1; // 1 Grid cell per 1 World Unit (1.0m precision)

export const GRAVITY = 60.0;
export const JUMP_FORCE = 18.0;
export const CLIMB_SPEED = 12.0;
export const MOVE_SPEED_BASE = 16.0;
export const ROLL_SPEED_MULT = 1.3;
export const CLIMB_THRESHOLD = 0.6;
export const MAX_CLIMB_HEIGHT = 1000.0;
export const PLAYER_HEIGHT = 4.0;
export const GROUND_DEPTH = 5.0; // PLAYER_HEIGHT + 1
export const FALL_DAMAGE_HEIGHT = 7.0;
export const PLAYER_RADIUS = 0.8; // Slightly reduced to fit better in 0.5m gaps if needed

// Water Physics
export const WATER_DEPTH_LEVEL = -2.6; // Character floats with head out (surface -0.2 - body 2.4)
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

// --- HELPERS ---

// UPDATED: Now maps to high-resolution grid
export const worldToIndex = (val: number, halfSize: number, worldSize: number) =>
    THREE.MathUtils.clamp(Math.floor((val + halfSize) * GRID_SCALE), 0, (worldSize * GRID_SCALE) - 1);

export const isOutOfBounds = (x: number, z: number, halfSize: number) =>
    x < -halfSize || x > halfSize || z < -halfSize || z > halfSize;

export const getTerrainHeight = (
    x: number,
    z: number,
    currentY: number,
    occupancyGrid: number[][],
    bridgeGrid: number[][],
    waterGrid: number[][],
    worldSize: number
) => {
    const halfSize = Math.floor(worldSize / 2);
    // Boundary check remains on World Units
    if (isOutOfBounds(x, z, halfSize)) return -Infinity;

    const ix = worldToIndex(x, halfSize, worldSize);
    const iz = worldToIndex(z, halfSize, worldSize);

    const baseH = occupancyGrid[ix]?.[iz] || 0;
    const bridgeH = bridgeGrid[ix]?.[iz] || 0;
    const isWater = waterGrid[ix]?.[iz] === 1;

    // Bridge Logic
    if (bridgeH > 0) {
        if (currentY >= bridgeH - 1.0) return bridgeH;
        // If under bridge, check if water or ground
        return isWater ? WATER_DEPTH_LEVEL : baseH;
    }

    if (isWater && baseH === 0) {
        return WATER_DEPTH_LEVEL;
    }

    return baseH;
};

export const getCeilingHeight = (
    x: number,
    z: number,
    currentY: number,
    bridgeGrid: number[][],
    worldSize: number
) => {
    const halfSize = Math.floor(worldSize / 2);
    const ix = worldToIndex(x, halfSize, worldSize);
    const iz = worldToIndex(z, halfSize, worldSize);
    const bridgeH = bridgeGrid[ix]?.[iz] || 0;

    if (bridgeH > 0 && currentY < bridgeH - 1.0) {
        return bridgeH - 1.0;
    }
    return Infinity;
};

const resolveWallCollisions = (pos: THREE.Vector3, world: { oGrid: number[][]; bGrid: number[][]; wGrid: number[][]; size: number }) => {
    const radius = PLAYER_RADIUS;

    // Scan range in WORLD UNITS
    const minX = pos.x - radius;
    const maxX = pos.x + radius;
    const minZ = pos.z - radius;
    const maxZ = pos.z + radius;

    // Convert to Grid Indices loop
    // We iterate through every 0.5m cell that the player touches
    const startX = Math.floor((minX + (world.size / 2)) * GRID_SCALE);
    const endX = Math.floor((maxX + (world.size / 2)) * GRID_SCALE);
    const startZ = Math.floor((minZ + (world.size / 2)) * GRID_SCALE);
    const endZ = Math.floor((maxZ + (world.size / 2)) * GRID_SCALE);

    let pushed = false;
    const halfSize = Math.floor(world.size / 2);

    for (let ix = startX; ix <= endX; ix++) {
        for (let iz = startZ; iz <= endZ; iz++) {
            // Convert back to World Center of this cell for distance check
            // Cell index i corresponds to world range: [i/SCALE - half, (i+1)/SCALE - half]
            // Center = (i + 0.5)/SCALE - half
            const cellCenterX = (ix + 0.5) / GRID_SCALE - halfSize;
            const cellCenterZ = (iz + 0.5) / GRID_SCALE - halfSize;

            // Safe lookup
            if (ix < 0 || ix >= world.size * GRID_SCALE || iz < 0 || iz >= world.size * GRID_SCALE) continue;

            const baseH = world.oGrid[ix][iz] || 0;
            const bridgeH = world.bGrid[ix][iz] || 0;
            const isWater = world.wGrid[ix][iz] === 1;

            // Determine effective floor height at this specific sub-cell
            let h = baseH;
            if (bridgeH > 0) {
                if (pos.y >= bridgeH - 1.0) h = bridgeH;
                else if (isWater && baseH === 0) h = WATER_DEPTH_LEVEL;
            } else if (isWater && baseH === 0) {
                h = WATER_DEPTH_LEVEL;
            }

            // Treat any terrain higher than feet + threshold as a wall
            if (h > pos.y + 0.6) {
                // AABB vs Circle(Sphere) collision
                // The cell is a box of size 1/GRID_SCALE
                const cellSize = 1.0 / GRID_SCALE;
                const vMinX = cellCenterX - cellSize / 2;
                const vMaxX = cellCenterX + cellSize / 2;
                const vMinZ = cellCenterZ - cellSize / 2;
                const vMaxZ = cellCenterZ + cellSize / 2;

                // Find closest point on box to circle center
                const closeX = Math.max(vMinX, Math.min(pos.x, vMaxX));
                const closeZ = Math.max(vMinZ, Math.min(pos.z, vMaxZ));

                const dx = pos.x - closeX;
                const dz = pos.z - closeZ;
                const distSq = dx * dx + dz * dz;

                if (distSq < radius * radius && distSq > 0.00001) {
                    const dist = Math.sqrt(distSq);
                    const penetration = radius - dist;
                    const nx = dx / dist;
                    const nz = dz / dist;
                    pos.x += nx * penetration;
                    pos.z += nz * penetration;
                    pushed = true;
                }
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
    isClimbing: boolean;
    isCharging: boolean;
    isRolling: boolean;
    didStepUp: boolean;
    stamina: number;
    stunned: boolean;
    stumbleTimer: number;
    stumbleVel: THREE.Vector3;
    airTimeHigh: number;
    lastDir: THREE.Vector2;
    noiseLevel: number;
}

interface PhysicsInput {
    dt: number;
    moveDir: THREE.Vector3;
    actions: { jump: boolean; charge: boolean; climb: boolean; run: boolean; attemptRoll: boolean };
    stats: { speed: number; climbSpeed: number };
    world: { oGrid: number[][]; bGrid: number[][]; wGrid: number[][]; size: number };
}

export const updateEntityPhysics = (
    current: PhysicsState,
    input: PhysicsInput
): PhysicsState => {
    const next = {
        ...current,
        vel: current.vel.clone(),
        pos: current.pos.clone(),
        stumbleVel: current.stumbleVel.clone(),
        noiseLevel: NOISE_IDLE,
        isRolling: current.isRolling,
        didStepUp: false
    };
    const { dt, moveDir, actions, stats, world } = input;

    // 0. Environment Check
    const groundHeightCurrent = getTerrainHeight(next.pos.x, next.pos.z, next.pos.y, world.oGrid, world.bGrid, world.wGrid, world.size);
    const isInWater = next.pos.y < -0.5 && groundHeightCurrent <= WATER_DEPTH_LEVEL;

    // 1. Status Effects (Stun / Stumble)
    if (next.stunned) {
        next.stamina = Math.min(100, next.stamina + STAMINA_RECOVERY_IDLE * dt);
        const groundH = getTerrainHeight(next.pos.x, next.pos.z, next.pos.y, world.oGrid, world.bGrid, world.wGrid, world.size);

        if (next.stumbleTimer > 0) next.stumbleTimer -= dt;

        if (next.stumbleVel.lengthSq() > 0.01 && next.isGrounded) {
            const dx = next.stumbleVel.x * dt;
            const dz = next.stumbleVel.z * dt;
            const targetX = next.pos.x + dx;
            const targetZ = next.pos.z + dz;
            const tH = getTerrainHeight(targetX, targetZ, next.pos.y, world.oGrid, world.bGrid, world.wGrid, world.size);

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

            const hitWall = resolveWallCollisions(next.pos, world);
            if (hitWall) next.stumbleVel.set(0, 0, 0);
        } else {
            next.stumbleVel.set(0, 0, 0);
        }

        if (next.pos.y > groundH) {
            next.vel.y -= GRAVITY * dt;
            next.pos.y += next.vel.y * dt;
            resolveWallCollisions(next.pos, world);
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
    const ceilingH = getCeilingHeight(next.pos.x, next.pos.z, next.pos.y, world.bGrid, world.size);

    if (!next.isGrounded && !next.isClimbing) {
        next.vel.y -= GRAVITY * dt;
        next.airTimeHigh = Math.max(next.airTimeHigh, next.pos.y);
    }

    // Charge logic
    if (actions.charge && next.isGrounded && !next.isClimbing && !next.isRolling) {
        next.isCharging = true;
    } else {
        next.isCharging = false;
    }

    // Jump
    if (actions.jump && next.isGrounded && !next.isClimbing && !next.isRolling) {
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

    // 3. Horizontal Movement
    next.isClimbing = false;

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

    // Running in water drains stamina but doesn't give much speed boost
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

    if (isMoving && next.isGrounded && !next.isCharging) {
        next.noiseLevel = isRunning ? NOISE_RUN : NOISE_WALK;
        if (next.isRolling) next.noiseLevel = NOISE_RUN;
    }

    if (isMoving) {
        if (!next.isRolling) {
            next.lastDir.set(currentMoveDir.x, currentMoveDir.z).normalize();
        }

        const axes = [new THREE.Vector3(currentMoveDir.x, 0, 0), new THREE.Vector3(0, 0, currentMoveDir.z)];
        const halfSize = Math.floor(world.size / 2);
        const minBound = -halfSize + PLAYER_RADIUS + 0.01;
        const maxBound = halfSize - PLAYER_RADIUS - 0.01;

        for (const axis of axes) {
            if (axis.lengthSq() === 0) continue;
            if (next.isClimbing) break;

            const targetX = next.pos.x + axis.x * speed;
            const targetZ = next.pos.z + axis.z * speed;

            if (targetX < minBound || targetX > maxBound || targetZ < minBound || targetZ > maxBound) continue;

            // With higher resolution, we check slightly further ahead to clear small gaps
            const lookAheadDist = PLAYER_RADIUS + 0.1;
            const checkX = next.pos.x + (axis.x > 0 ? lookAheadDist : (axis.x < 0 ? -lookAheadDist : 0));
            const checkZ = next.pos.z + (axis.z > 0 ? lookAheadDist : (axis.z < 0 ? -lookAheadDist : 0));

            const targetH = getTerrainHeight(checkX, checkZ, next.pos.y, world.oGrid, world.bGrid, world.wGrid, world.size);

            const heightDiff = targetH - next.pos.y;
            const isAbyss = targetH === -Infinity;
            const climbMax = MAX_CLIMB_HEIGHT;

            const isWaterExit = isInWater && heightDiff > 0 && heightDiff <= (Math.abs(WATER_DEPTH_LEVEL) + 0.5);
            const isWall = (heightDiff > CLIMB_THRESHOLD && !isWaterExit);

            const ceilingAtTarget = getCeilingHeight(targetX, targetZ, Math.max(targetH, next.pos.y), world.bGrid, world.size);
            const hasHeadroom = (ceilingAtTarget === Infinity) || (ceilingAtTarget - Math.max(targetH, next.pos.y) >= PLAYER_HEIGHT);

            if (!isWall && !isAbyss && hasHeadroom) {
                const canStepUp = heightDiff <= CLIMB_THRESHOLD || isWaterExit;

                if (targetH > next.pos.y + 0.05 && canStepUp) {
                    next.didStepUp = true;
                    next.pos.y = targetH;
                    next.vel.y = 0;
                }
                next.pos.x = targetX;
                next.pos.z = targetZ;
            }

            if (isWall && !next.stunned && heightDiff <= climbMax && hasHeadroom) {
                const autoClimbThreshold = 2.1;
                const tryingToClimb = (actions.climb || heightDiff <= autoClimbThreshold) && !next.isRolling;

                const isSmallObstacle = heightDiff <= 1.5;
                const canStartClimb = isSmallObstacle || next.stamina > 10;

                if (tryingToClimb && canStartClimb) {
                    next.isClimbing = true;
                    next.isCharging = false;
                    next.vel.y = CLIMB_SPEED;

                    if (!isSmallObstacle) {
                        next.stamina -= STAMINA_CLIMB_COST * dt;
                    }

                    next.noiseLevel = Math.max(next.noiseLevel, NOISE_CLIMB);
                    next.pos.x = current.pos.x;
                    next.pos.z = current.pos.z;
                    break;
                }
            }
        }
    }

    next.pos.y += next.vel.y * dt;

    if (!next.isClimbing && next.vel.y <= 0) {
        // Resolve collisions twice to prevent corner sticking
        resolveWallCollisions(next.pos, world);
        resolveWallCollisions(next.pos, world);
    }

    // 6. Landing / Grounding
    let groundH = getTerrainHeight(next.pos.x, next.pos.z, next.pos.y, world.oGrid, world.bGrid, world.wGrid, world.size);

    // Prevent snapping up to walls while moving
    if (groundH > next.pos.y + 1.2) {
        groundH = -Infinity;
    }

    const safeGround = groundH === -Infinity ? -10 : groundH;

    if (next.pos.y <= safeGround) {
        // Fall damage logic
        if (!next.isGrounded && next.vel.y < -5.0 && safeGround > WATER_DEPTH_LEVEL + 0.1) {
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
                    const safeVx = THREE.MathUtils.clamp(moveX, -maxVel, maxVel);
                    const safeVz = THREE.MathUtils.clamp(moveZ, -maxVel, maxVel);
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
    } else {
        next.isGrounded = false;
        next.isCharging = false;
    }

    return next;
};
