import * as THREE from 'three';
import { GameMode, GameStatus, LadderState, VisualState } from '../types';
import {
  CLIMB_SPEED,
  CLIMB_THRESHOLD,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SpatialHashGrid,
  STAMINA_CLIMB_COST,
  STAMINA_JUMP_COST,
  STAMINA_LADDER_CLIMB_COST,
  checkLineOfSight,
  getTerrainHeight,
  isPositionBlocked,
  worldToIndex,
} from './physics';
import { EdgeType, LadderZone, MAX_SCALABLE_HEIGHT, NavNode, NavigationGraph } from './navigation';

export interface AIWaypoint {
  id?: string;
  x: number;
  y: number;
  z: number;
  edgeType?: EdgeType | null;
  isCorner?: boolean;
}

export interface WhiskerHit {
  isBlocked: boolean;
  hitPoint: THREE.Vector3;
  dist: number;
}

export interface AIInput {
  moveDir: THREE.Vector3;
  jump: boolean;
  run: boolean;
  ladderUp: boolean;
  ladderDown: boolean;
  grabLadder: boolean;
  charge: boolean;
  climb: boolean;
  attemptRoll: boolean;
}

export interface AIContext {
  // Physics state refs
  pos: React.MutableRefObject<THREE.Vector3>;
  vel: React.MutableRefObject<THREE.Vector3>;
  lastDir: React.MutableRefObject<THREE.Vector2>;
  isGrounded: React.MutableRefObject<boolean>;
  isCharging: React.MutableRefObject<boolean>;
  isRolling: React.MutableRefObject<boolean>;
  stamina: React.MutableRefObject<number>;
  isExhausted: React.MutableRefObject<boolean>;
  stunTimer: React.MutableRefObject<number>;
  jumpDelayTimer: React.MutableRefObject<number>;
  airTimeHighPoint: React.MutableRefObject<number>;
  jumpPressedPrev: React.MutableRefObject<boolean>;
  rollTimer: React.MutableRefObject<number>;
  jumpBufferTimer: React.MutableRefObject<number>;
  stumbleTimer: React.MutableRefObject<number>;
  stumbleVelocity: React.MutableRefObject<THREE.Vector3>;
  landingAnimTimer: React.MutableRefObject<number>;
  lastFallDist: React.MutableRefObject<number>;
  prevPos: React.MutableRefObject<THREE.Vector3>;
  smoothedMoveSpeed: React.MutableRefObject<number>;
  ladderState: React.MutableRefObject<LadderState>;
  noiseLevelRef: React.MutableRefObject<number>;

  // Navigation & Decision refs
  path: React.MutableRefObject<AIWaypoint[]>;
  pathIndex: React.MutableRefObject<number>;
  pathRecalcTimer: React.MutableRefObject<number>;
  lastPathTarget: React.MutableRefObject<THREE.Vector3>;
  hidingSpot: React.MutableRefObject<THREE.Vector3>;
  targetPosRef: React.MutableRefObject<THREE.Vector3>;
  lastKnownPlayerPos: React.MutableRefObject<THREE.Vector3>;
  playerLastVel: React.MutableRefObject<THREE.Vector3>;
  lastKnownPlayerDir: React.MutableRefObject<THREE.Vector3>;
  hasLastKnownPlayerPos: React.MutableRefObject<boolean>;
  heardEmojiTimer: React.MutableRefObject<number>;
  localSearchCount: React.MutableRefObject<number>;
  searchedSpotIds: React.MutableRefObject<Set<string>>;
  wanderTarget: React.MutableRefObject<THREE.Vector3>;
  wanderTargetTimer: React.MutableRefObject<number>;
  visitedQuadrants: React.MutableRefObject<Set<number>>;
  searchTimer: React.MutableRefObject<number>;
  fleeTimer: React.MutableRefObject<number>;
  wasPursuingPlayer: React.MutableRefObject<boolean>;
  isCustomDestination: React.MutableRefObject<boolean>;
  stillTimer: React.MutableRefObject<number>;
  searchLookTimer: React.MutableRefObject<number>;

  // Stuck & recovery refs
  stuckTimer: React.MutableRefObject<number>;
  waypointTimer: React.MutableRefObject<number>;
  lateralDetourDir: React.MutableRefObject<THREE.Vector3>;
  lateralDetourTimer: React.MutableRefObject<number>;
  longStuckTimer: React.MutableRefObject<number>;
  longStuckPos: React.MutableRefObject<THREE.Vector3>;
  lastProgressPos: React.MutableRefObject<THREE.Vector3>;
  lastRouteSig: React.MutableRefObject<string>;
  routeRepeatCount: React.MutableRefObject<number>;
  avoidNodeIds: React.MutableRefObject<Set<string>>;
  ladderStuckTimer: React.MutableRefObject<number>;
  prevLadderY: React.MutableRefObject<number>;

  // Whiskers refs
  whiskerCenterHit: React.MutableRefObject<WhiskerHit | null>;
  whiskerLeftHit: React.MutableRefObject<WhiskerHit | null>;
  whiskerRightHit: React.MutableRefObject<WhiskerHit | null>;
  whiskerCenterDir: React.MutableRefObject<THREE.Vector3>;
  whiskerLeftDir: React.MutableRefObject<THREE.Vector3>;
  whiskerRightDir: React.MutableRefObject<THREE.Vector3>;
  whiskerCenterLen: React.MutableRefObject<number>;
  whiskerSideLen: React.MutableRefObject<number>;

  // Visual / Gaze refs
  visualStateRef: React.MutableRefObject<Partial<VisualState>>;
  lookAtTarget: React.MutableRefObject<THREE.Vector3 | null>;
  emojiRef: React.MutableRefObject<string>;
}

// Reusable scratch vectors (zero per-frame allocations)
const scratchTargetPos = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchEyeA = new THREE.Vector3();
const scratchEyeB = new THREE.Vector3();
const scratchHead = new THREE.Vector3();
const scratchTorso = new THREE.Vector3();
const scratchFeet = new THREE.Vector3();
const scratchProjected = new THREE.Vector3();

const centerHitBuffer: WhiskerHit = { isBlocked: false, hitPoint: new THREE.Vector3(), dist: 0 };
const leftHitBuffer: WhiskerHit = { isBlocked: false, hitPoint: new THREE.Vector3(), dist: 0 };
const rightHitBuffer: WhiskerHit = { isBlocked: false, hitPoint: new THREE.Vector3(), dist: 0 };

const WHISKER_SIDE_ANGLE = (35 * Math.PI) / 180;
const COS_SIDE = Math.cos(WHISKER_SIDE_ANGLE);
const SIN_SIDE = Math.sin(WHISKER_SIDE_ANGLE);

function getQuadrant(x: number, z: number): 1 | 2 | 3 | 4 {
  if (x >= 0 && z >= 0) return 1;
  if (x < 0 && z >= 0) return 2;
  if (x < 0 && z < 0) return 3;
  return 4;
}

export function getRandomWaypoint(
  currentPos: THREE.Vector3,
  graph?: NavigationGraph | null,
  minDist: number = 8.0,
): THREE.Vector3 {
  if (!graph || !graph.nodes || graph.nodes.size === 0) {
    return new THREE.Vector3(0, 0, 0);
  }

  const nodesArray = graph.nodesArray.length > 0 ? graph.nodesArray : Array.from(graph.nodes.values());
  const validNodes: NavNode[] = [];
  for (let i = 0; i < nodesArray.length; i++) {
    const node = nodesArray[i];
    if (node.isWater) continue;
    const d = Math.hypot(node.x - currentPos.x, node.z - currentPos.z);
    if (d >= minDist) {
      const edges = graph.edges.get(node.id);
      if (edges && edges.length > 0) {
        validNodes.push(node);
      }
    }
  }

  const pool = validNodes.length > 0 ? validNodes : nodesArray;
  const randomNode = pool[Math.floor(Math.random() * pool.length)];
  return new THREE.Vector3(randomNode.x, randomNode.y, randomNode.z);
}

/**
 * Converts a NavNode array from findPath/smoothPath into AIWaypoints with resolved edge types.
 */
export function buildWaypointsFromNavPath(
  smoothed: NavNode[],
  navGraph: NavigationGraph,
): AIWaypoint[] {
  return smoothed.map((n, idx) => {
    const prevNode = idx > 0 ? smoothed[idx - 1] : null;
    const rawEdgeType = prevNode ? navGraph.getEdgeType(prevNode, n) : null;
    const diffY = prevNode ? n.y - prevNode.y : 0;
    const edgeType: EdgeType = prevNode
      ? (n.edgeType ??
        rawEdgeType ??
        (diffY < -1.0 ? 'drop' : diffY > CLIMB_THRESHOLD && diffY <= MAX_SCALABLE_HEIGHT ? 'climb' : 'walk'))
      : 'walk';
    return { id: n.id, x: n.x, y: n.y, z: n.z, edgeType, isCorner: n.isCorner };
  });
}

/**
 * Casts a horizontal whisker ray and returns collision info if blocked by an obstacle or map edge.
 */
function castWhisker(
  pos: THREE.Vector3,
  dirX: number,
  dirZ: number,
  maxLen: number,
  collisionGrid: SpatialHashGrid,
  worldSize: number,
  checkWater: boolean,
  wGrid: number[][],
  outHit: WhiskerHit,
): WhiskerHit | null {
  const halfSize = Math.floor(worldSize / 2);
  const bound = halfSize - PLAYER_RADIUS - 0.1;
  const stepSize = 0.4;
  const steps = Math.ceil(maxLen / stepSize);
  const probeRad = PLAYER_RADIUS * 0.55;

  for (let s = 1; s <= steps; s++) {
    const dist = Math.min(maxLen, s * stepSize);
    const px = pos.x + dirX * dist;
    const pz = pos.z + dirZ * dist;

    const outOfBounds = px < -bound || px > bound || pz < -bound || pz > bound;
    const blocked =
      outOfBounds ||
      isPositionBlocked(px, pos.y + 0.15, pz, collisionGrid, probeRad);

    let waterBlocked = false;
    if (!blocked && checkWater && pos.y >= -0.3 && pos.y <= 0.6) {
      const gx = worldToIndex(px, halfSize, worldSize);
      const gz = worldToIndex(pz, halfSize, worldSize);
      if (wGrid[gx]?.[gz] === 1) {
        waterBlocked = true;
      }
    }

    if (blocked || waterBlocked) {
      outHit.isBlocked = true;
      outHit.hitPoint.set(px, pos.y, pz);
      outHit.dist = dist;
      return outHit;
    }
  }

  return null;
}

/**
 * Updates 3-ray whisker sensors (center, left -35°, right +35°) in the AI's facing/heading direction.
 */
function updateWhiskerSensors(
  ai: AIContext,
  headingX: number,
  headingZ: number,
  collisionGrid: SpatialHashGrid,
  wGrid: number[][],
  worldSize: number,
  checkWater: boolean,
): { center: WhiskerHit | null; left: WhiskerHit | null; right: WhiskerHit | null } {
  const len = Math.hypot(headingX, headingZ);
  const fx = len > 0.01 ? headingX / len : ai.lastDir.current.x;
  const fz = len > 0.01 ? headingZ / len : ai.lastDir.current.y;
  const normLen = Math.hypot(fx, fz) || 1;
  const nx = fx / normLen;
  const nz = fz / normLen;

  // Left (+35° CCW) and Right (-35° CW) rotated vectors in XZ
  const lx = nx * COS_SIDE - nz * SIN_SIDE;
  const lz = nx * SIN_SIDE + nz * COS_SIDE;
  const rx = nx * COS_SIDE + nz * SIN_SIDE;
  const rz = -nx * SIN_SIDE + nz * COS_SIDE;

  ai.whiskerCenterDir.current.set(nx, 0, nz);
  ai.whiskerLeftDir.current.set(lx, 0, lz);
  ai.whiskerRightDir.current.set(rx, 0, rz);

  const cLen = ai.whiskerCenterLen.current;
  const sLen = ai.whiskerSideLen.current;
  const pos = ai.pos.current;

  const center = castWhisker(pos, nx, nz, cLen, collisionGrid, worldSize, checkWater, wGrid, centerHitBuffer);
  const left = castWhisker(pos, lx, lz, sLen, collisionGrid, worldSize, checkWater, wGrid, leftHitBuffer);
  const right = castWhisker(pos, rx, rz, sLen, collisionGrid, worldSize, checkWater, wGrid, rightHitBuffer);

  ai.whiskerCenterHit.current = center;
  ai.whiskerLeftHit.current = left;
  ai.whiskerRightHit.current = right;

  return { center, left, right };
}

export interface AIUpdateParams {
  dt: number;
  status: GameStatus;
  mode: GameMode;
  currentRound: number;
  worldSize: number;
  addDestinationMode: boolean;
  playerPos: THREE.Vector3;
  playerVel: THREE.Vector3;
  playerNoiseLevel: number;
  collisionGrid: SpatialHashGrid;
  bGrid: number[][];
  wGrid: number[][];
  ladderZones: LadderZone[];
  navGraph: NavigationGraph | null;
  onEmojiChange: (emoji: string) => void;
}

export interface AIFrameDecision {
  aiInput: AIInput;
  aiCanMove: boolean;
  isAISeeker: boolean;
  aiHasVisualContact: boolean;
  aiHasHeardNoise: boolean;
}

const reusableAiInput: AIInput = {
  moveDir: new THREE.Vector3(),
  jump: false,
  run: false,
  ladderUp: false,
  ladderDown: false,
  grabLadder: false,
  charge: false,
  climb: false,
  attemptRoll: false,
};

/**
 * Resets all AI navigation, stuck, and perception state for round start or respawn.
 */
export function resetAIStateForRound(
  ai: AIContext,
  aiSpawn: THREE.Vector3,
  navGraph: NavigationGraph | null,
): void {
  ai.pos.current.copy(aiSpawn);
  ai.prevPos.current.copy(aiSpawn);
  ai.vel.current.set(0, 0, 0);
  ai.isGrounded.current = true;
  ai.airTimeHighPoint.current = aiSpawn.y;
  ai.stamina.current = 100;
  ai.isExhausted.current = false;
  ai.stunTimer.current = 0;
  ai.stuckTimer.current = 0;
  ai.waypointTimer.current = 0;
  ai.jumpDelayTimer.current = 0;
  ai.jumpPressedPrev.current = false;
  ai.lastProgressPos.current.copy(aiSpawn);
  ai.lastRouteSig.current = '';
  ai.routeRepeatCount.current = 0;
  ai.avoidNodeIds.current.clear();
  ai.searchLookTimer.current = 0;
  ai.lateralDetourDir.current.set(0, 0, 0);
  ai.lateralDetourTimer.current = 0;
  ai.longStuckTimer.current = 0;
  ai.longStuckPos.current.copy(aiSpawn);
  ai.ladderStuckTimer.current = 0;
  ai.prevLadderY.current = aiSpawn.y;

  ai.path.current = [];
  ai.pathIndex.current = 0;
  ai.pathRecalcTimer.current = 0;
  ai.lastPathTarget.current.set(Infinity, Infinity, Infinity);

  ai.hasLastKnownPlayerPos.current = false;
  ai.lastKnownPlayerDir.current.set(0, 0, 0);
  ai.wanderTarget.current.set(0, 0, 0);
  ai.wanderTargetTimer.current = 0;
  ai.visitedQuadrants.current.clear();
  ai.searchTimer.current = 0;
  ai.localSearchCount.current = 0;
  ai.searchedSpotIds.current.clear();
  ai.wasPursuingPlayer.current = false;
  ai.fleeTimer.current = 0;
  ai.stillTimer.current = 0;
  ai.isCustomDestination.current = false;

  if (navGraph) {
    const aiTargetSpot = getRandomWaypoint(aiSpawn, navGraph, 10.0);
    ai.hidingSpot.current.copy(aiTargetSpot);
    ai.targetPosRef.current.copy(aiTargetSpot);
  }
}

/**
 * Main per-frame AI brain: perception, tactical target selection, A* pathing,
 * whisker obstacle avoidance, and parkour execution.
 */
export function updateAIDecisionAndInput(
  ai: AIContext,
  params: AIUpdateParams,
): AIFrameDecision {
  const {
    dt,
    status,
    mode,
    currentRound,
    worldSize,
    addDestinationMode,
    playerPos,
    playerVel,
    playerNoiseLevel,
    collisionGrid,
    bGrid,
    wGrid,
    ladderZones,
    navGraph,
  } = params;

  const isAISeeker = mode === GameMode.HIDE_AND_SEEK && currentRound % 2 !== 0;
  const aiIsFrozen = status === GameStatus.PREP && isAISeeker;
  const aiCanMove =
    (status === GameStatus.PLAYING || status === GameStatus.PREP || mode === GameMode.FREE) &&
    !aiIsFrozen;

  reusableAiInput.moveDir.set(0, 0, 0);
  reusableAiInput.jump = false;
  reusableAiInput.run = false;
  reusableAiInput.ladderUp = false;
  reusableAiInput.ladderDown = false;
  reusableAiInput.grabLadder = false;
  reusableAiInput.charge = false;
  reusableAiInput.climb = false;
  reusableAiInput.attemptRoll = false;

  const targetPos = scratchTargetPos.copy(
    ai.hidingSpot.current.lengthSq() > 0.1 ? ai.hidingSpot.current : ai.pos.current,
  );

  const isAIMovementActive =
    mode === GameMode.HIDE_AND_SEEK || ai.isCustomDestination.current || addDestinationMode;

  let aiHasVisualContact = false;
  let aiHasHeardNoise = false;

  if (ai.heardEmojiTimer.current > 0) {
    ai.heardEmojiTimer.current -= dt;
  }
  if (ai.lateralDetourTimer.current > 0) {
    ai.lateralDetourTimer.current = Math.max(0, ai.lateralDetourTimer.current - dt);
  }

  let isWaitingForStamina = false;

  if (isAIMovementActive && aiCanMove && navGraph) {
    const distToPlayer = ai.pos.current.distanceTo(playerPos);

    // 1. TARGET ACQUISITION & PERCEPTION
    if (mode === GameMode.HIDE_AND_SEEK && isAISeeker) {
      scratchEyeA.set(ai.pos.current.x, ai.pos.current.y + 1.4, ai.pos.current.z);
      scratchHead.set(playerPos.x, playerPos.y + 1.4, playerPos.z);
      scratchTorso.set(playerPos.x, playerPos.y + 0.7, playerPos.z);

      aiHasVisualContact =
        distToPlayer < 40.0 &&
        (checkLineOfSight(scratchEyeA, scratchHead, collisionGrid) ||
          checkLineOfSight(scratchEyeA, scratchTorso, collisionGrid));

      aiHasHeardNoise = playerNoiseLevel > 0 && distToPlayer <= playerNoiseLevel;
      if (aiHasHeardNoise) {
        ai.heardEmojiTimer.current = 1.8;
      }

      if (aiHasVisualContact) {
        // Record movement direction before overwriting lastKnownPlayerPos
        if (playerVel.x * playerVel.x + playerVel.z * playerVel.z > 0.2) {
          ai.lastKnownPlayerDir.current.set(playerVel.x, 0, playerVel.z).normalize();
        } else if (ai.hasLastKnownPlayerPos.current) {
          const dxp = playerPos.x - ai.lastKnownPlayerPos.current.x;
          const dzp = playerPos.z - ai.lastKnownPlayerPos.current.z;
          if (dxp * dxp + dzp * dzp > 0.04) {
            ai.lastKnownPlayerDir.current.set(dxp, 0, dzp).normalize();
          }
        }

        ai.hasLastKnownPlayerPos.current = true;
        ai.lastKnownPlayerPos.current.copy(playerPos);
        ai.playerLastVel.current.copy(playerVel);
        ai.searchTimer.current = 0;
        ai.localSearchCount.current = 0;
        ai.searchedSpotIds.current.clear();
        ai.avoidNodeIds.current.clear();
        ai.routeRepeatCount.current = 0;

        // Predictive interception in open ground when player is moving fast
        targetPos.copy(playerPos);
        const speedSq = playerVel.x * playerVel.x + playerVel.z * playerVel.z;
        if (distToPlayer > 4.0 && distToPlayer < 26.0 && speedSq > 4.0) {
          const leadTime = Math.min(0.45, distToPlayer / 30.0);
          scratchProjected.set(
            playerPos.x + playerVel.x * leadTime,
            playerPos.y,
            playerPos.z + playerVel.z * leadTime,
          );
          if (
            navGraph.isDirectWalkable(playerPos, scratchProjected, collisionGrid) &&
            navGraph.isDirectWalkable(ai.pos.current, scratchProjected, collisionGrid)
          ) {
            targetPos.copy(scratchProjected);
          }
        }

        const isDirectReachable =
          Math.abs(ai.pos.current.y - targetPos.y) <= 0.8 &&
          navGraph.isDirectWalkable(ai.pos.current, targetPos, collisionGrid);

        if (isDirectReachable) {
          ai.path.current = [
            { id: 'direct_catch', x: targetPos.x, y: targetPos.y, z: targetPos.z, edgeType: 'walk' },
          ];
          ai.pathIndex.current = 0;
          ai.lastPathTarget.current.copy(targetPos);
          ai.pathRecalcTimer.current = 0;
        } else {
          const isMidAction =
            !ai.isGrounded.current ||
            ai.ladderState.current.isClimbing ||
            ai.ladderState.current.isLadderMounting ||
            ai.ladderState.current.isLadderHanging;

          if (!isMidAction && (!ai.wasPursuingPlayer.current || ai.lastPathTarget.current.distanceTo(targetPos) > 3.0)) {
            ai.pathRecalcTimer.current = 999;
          }
        }
        ai.wasPursuingPlayer.current = true;
      } else if (aiHasHeardNoise) {
        if (playerVel.x * playerVel.x + playerVel.z * playerVel.z > 0.2) {
          ai.lastKnownPlayerDir.current.set(playerVel.x, 0, playerVel.z).normalize();
        }
        ai.hasLastKnownPlayerPos.current = true;
        ai.lastKnownPlayerPos.current.copy(playerPos);
        ai.playerLastVel.current.copy(playerVel);
        ai.searchTimer.current = 0;
        ai.localSearchCount.current = 0;
        ai.searchedSpotIds.current.clear();

        targetPos.copy(playerPos);

        const isMidAction =
          !ai.isGrounded.current ||
          ai.ladderState.current.isClimbing ||
          ai.ladderState.current.isLadderMounting ||
          ai.ladderState.current.isLadderHanging;

        if (!isMidAction && (!ai.wasPursuingPlayer.current || ai.lastPathTarget.current.distanceTo(targetPos) > 2.5)) {
          ai.path.current = [];
          ai.pathIndex.current = 0;
          ai.pathRecalcTimer.current = 999;
        }
        ai.wasPursuingPlayer.current = true;
      } else {
        ai.wasPursuingPlayer.current = false;

        if (ai.hasLastKnownPlayerPos.current) {
          ai.searchTimer.current += dt;
          const distToLast = ai.pos.current.distanceTo(ai.lastKnownPlayerPos.current);

          if (distToLast < 2.5 || ai.searchTimer.current > 6.5) {
            if (ai.localSearchCount.current < 3 && ai.searchTimer.current <= 6.5) {
              const searchSpots = navGraph.findNearbySearchSpots(
                ai.lastKnownPlayerPos.current,
                3.0,
                16.0,
                ai.searchedSpotIds.current,
                ai.lastKnownPlayerDir.current,
              );
              if (searchSpots && searchSpots.length > 0) {
                const spot = searchSpots[0];
                targetPos.set(spot.x, spot.y, spot.z);
                if (ai.pos.current.distanceTo(targetPos) < 1.8) {
                  ai.searchedSpotIds.current.add(spot.id);
                  ai.localSearchCount.current++;
                }
              } else {
                ai.hasLastKnownPlayerPos.current = false;
              }
            } else {
              ai.hasLastKnownPlayerPos.current = false;
              ai.searchTimer.current = 0;
              ai.localSearchCount.current = 0;
              ai.searchedSpotIds.current.clear();
            }
          } else {
            targetPos.copy(ai.lastKnownPlayerPos.current);
          }
        } else {
          // Quadrant patrol via vantage points & street corners
          ai.wanderTargetTimer.current += dt;
          const currentQuad = getQuadrant(ai.pos.current.x, ai.pos.current.z);
          ai.visitedQuadrants.current.add(currentQuad);
          if (ai.visitedQuadrants.current.size >= 4) {
            ai.visitedQuadrants.current.clear();
            ai.visitedQuadrants.current.add(currentQuad);
          }

          const distToPatrol = ai.pos.current.distanceTo(ai.wanderTarget.current);
          const needsNewPatrolTarget =
            ai.wanderTarget.current.lengthSq() < 0.1 ||
            distToPatrol < 2.0 ||
            ai.wanderTargetTimer.current > 8.0;

          if (needsNewPatrolTarget) {
            ai.wanderTargetTimer.current = 0;
            const patrol = navGraph.findReachablePatrolTarget(
              ai.pos.current,
              ai.visitedQuadrants.current,
              collisionGrid,
            );

            if (patrol) {
              ai.wanderTarget.current.set(patrol.target.x, patrol.target.y, patrol.target.z);
            } else {
              const vantage = navGraph.findStrategicVantageTarget(
                ai.pos.current,
                null,
                ai.visitedQuadrants.current,
                collisionGrid,
              );
              if (vantage) {
                ai.wanderTarget.current.set(vantage.x, vantage.y, vantage.z);
              } else {
                const rnd = getRandomWaypoint(ai.pos.current, navGraph, 12.0);
                if (rnd.lengthSq() > 0.1) {
                  ai.wanderTarget.current.copy(rnd);
                }
              }
            }
          }

          targetPos.copy(
            ai.wanderTarget.current.lengthSq() > 0.1 ? ai.wanderTarget.current : ai.pos.current,
          );
        }
      }
    } else {
      // Hider or Free mode
      ai.fleeTimer.current += dt;
      const closeToHidingSpot = ai.pos.current.distanceTo(ai.hidingSpot.current) < 1.5;

      if (mode === GameMode.HIDE_AND_SEEK) {
        const noHidingSpotSet = ai.hidingSpot.current.lengthSq() < 0.1;

        scratchEyeA.set(playerPos.x, playerPos.y + 1.4, playerPos.z);
        scratchHead.set(ai.pos.current.x, ai.pos.current.y + 1.4, ai.pos.current.z);
        scratchTorso.set(ai.pos.current.x, ai.pos.current.y + 0.7, ai.pos.current.z);
        const playerSeesAi =
          distToPlayer < 40.0 &&
          (checkLineOfSight(scratchEyeA, scratchHead, collisionGrid) ||
            checkLineOfSight(scratchEyeA, scratchTorso, collisionGrid));

        scratchEyeB.set(ai.pos.current.x, ai.pos.current.y + 1.4, ai.pos.current.z);
        scratchHead.set(playerPos.x, playerPos.y + 1.4, playerPos.z);
        scratchTorso.set(playerPos.x, playerPos.y + 0.7, playerPos.z);
        const aiSeesPlayer =
          distToPlayer < 40.0 &&
          (checkLineOfSight(scratchEyeB, scratchHead, collisionGrid) ||
            checkLineOfSight(scratchEyeB, scratchTorso, collisionGrid));

        aiHasVisualContact = playerSeesAi || aiSeesPlayer;

        aiHasHeardNoise = playerNoiseLevel > 0 && distToPlayer <= playerNoiseLevel;
        if (aiHasHeardNoise) {
          ai.heardEmojiTimer.current = 1.8;
        }

        scratchProjected.copy(playerPos).addScaledVector(playerVel, 1.5);
        const projectedDistToAi = ai.pos.current.distanceTo(scratchProjected);
        const playerMovingTowardsAi =
          aiHasHeardNoise &&
          (distToPlayer < 3.5 || (playerVel.length() > 0.4 && projectedDistToAi < distToPlayer - 0.3));

        const fleeCooldown = aiHasVisualContact && distToPlayer < 12.0 ? 0.9 : 2.0;
        const shouldFleeFromPlayer =
          (aiHasVisualContact || playerMovingTowardsAi) && ai.fleeTimer.current >= fleeCooldown;

        if (noHidingSpotSet || (!ai.isCustomDestination.current && shouldFleeFromPlayer)) {
          ai.isCustomDestination.current = false;
          ai.fleeTimer.current = 0;
          const bestSpot = navGraph.evaluateHidingSpots(
            playerPos,
            ai.pos.current,
            collisionGrid,
            playerVel,
          );
          if (bestSpot) {
            ai.hidingSpot.current.set(bestSpot.x, bestSpot.y, bestSpot.z);
            ai.path.current = [];
            ai.pathIndex.current = 0;
          } else {
            const newRandomTarget = getRandomWaypoint(ai.pos.current, navGraph, 10.0);
            if (newRandomTarget.lengthSq() > 0.1) {
              ai.hidingSpot.current.copy(newRandomTarget);
              ai.path.current = [];
              ai.pathIndex.current = 0;
            }
          }
        }
      } else {
        // Free mode: wander
        const destinationReached =
          ai.path.current.length > 0 && ai.pathIndex.current >= ai.path.current.length;
        if (
          ai.hidingSpot.current.lengthSq() < 0.1 ||
          (!ai.isCustomDestination.current && (destinationReached || closeToHidingSpot))
        ) {
          ai.isCustomDestination.current = false;
          const newRandomTarget = getRandomWaypoint(ai.pos.current, navGraph, 10.0);
          if (newRandomTarget.lengthSq() > 0.1) {
            ai.hidingSpot.current.copy(newRandomTarget);
            ai.path.current = [];
            ai.pathIndex.current = 0;
          }
        }
      }

      targetPos.copy(ai.hidingSpot.current.lengthSq() > 0.1 ? ai.hidingSpot.current : ai.pos.current);
    }

    ai.targetPosRef.current.copy(targetPos);

    // 2. STUCK DETECTION & RECOVERY
    const distFromLastCheck = ai.pos.current.distanceTo(ai.lastProgressPos.current);
    const isActivelyNavigating = ai.path.current.length > 0 && ai.pathIndex.current < ai.path.current.length;
    if (isActivelyNavigating && distFromLastCheck < 0.25) {
      ai.stuckTimer.current += dt;
    } else {
      ai.stuckTimer.current = 0;
      ai.lastProgressPos.current.copy(ai.pos.current);
    }

    // Ladder stuck check
    if (
      ai.ladderState.current.isClimbing ||
      ai.ladderState.current.isLadderSliding ||
      ai.ladderState.current.isLadderHanging
    ) {
      if (Math.abs(ai.pos.current.y - ai.prevLadderY.current) < 0.05) {
        ai.ladderStuckTimer.current += dt;
      } else {
        ai.ladderStuckTimer.current = 0;
        ai.prevLadderY.current = ai.pos.current.y;
      }
      if (ai.ladderStuckTimer.current > 3.5) {
        ai.ladderStuckTimer.current = 0;
        ai.path.current = [];
        ai.pathIndex.current = 0;
        ai.pathRecalcTimer.current = 999;
      }
    } else {
      ai.ladderStuckTimer.current = 0;
    }

    // Long stuck safeguard (> 4.5s inside 1.2m radius while actively trying to move)
    if (isActivelyNavigating && ai.pos.current.distanceTo(ai.longStuckPos.current) < 1.2) {
      ai.longStuckTimer.current += dt;
      if (ai.longStuckTimer.current > 4.5) {
        ai.longStuckTimer.current = 0;
        ai.longStuckPos.current.copy(ai.pos.current);
        ai.avoidNodeIds.current.clear();
        ai.path.current = [];
        ai.pathIndex.current = 0;
        ai.pathRecalcTimer.current = 999;
        if (!ai.isCustomDestination.current) {
          const rescueSpot = getRandomWaypoint(ai.pos.current, navGraph, 10.0);
          if (rescueSpot.lengthSq() > 0.1) {
            ai.hidingSpot.current.copy(rescueSpot);
            targetPos.copy(rescueSpot);
          }
        }
      }
    } else {
      ai.longStuckTimer.current = 0;
      ai.longStuckPos.current.copy(ai.pos.current);
    }

    const isStuck = ai.stuckTimer.current > 1.8;
    if (isStuck) {
      const blockedNode = ai.path.current[ai.pathIndex.current];
      if (blockedNode?.id && !blockedNode.id.startsWith('direct')) {
        ai.avoidNodeIds.current.add(blockedNode.id);
      }
      ai.stuckTimer.current = 0;
      ai.path.current = [];
      ai.pathIndex.current = 0;
      ai.pathRecalcTimer.current = 999;
    }

    // 3. PATH CALCULATION & RE-ROUTING
    ai.pathRecalcTimer.current += dt;

    const isHiderSettled =
      mode === GameMode.HIDE_AND_SEEK &&
      !isAISeeker &&
      !ai.isCustomDestination.current &&
      ai.pos.current.distanceTo(targetPos) < 1.5;

    const isCurrentlyMidAction =
      !ai.isGrounded.current ||
      ai.ladderState.current.isClimbing ||
      ai.ladderState.current.isLadderMounting ||
      ai.ladderState.current.isLadderHanging ||
      ai.ladderState.current.isWallClimbing;

    const needsPath =
      !isHiderSettled &&
      !isCurrentlyMidAction &&
      (ai.path.current.length === 0 ||
        ai.pathIndex.current >= ai.path.current.length ||
        ai.lastPathTarget.current.distanceTo(targetPos) > 2.5 ||
        isStuck);

    if (
      needsPath &&
      (ai.path.current.length === 0
        ? ai.pathRecalcTimer.current >= 0.15
        : ai.pathRecalcTimer.current >= 0.3)
    ) {
      ai.pathRecalcTimer.current = 0;
      ai.lastPathTarget.current.copy(targetPos);

      const isActivelyPursuing = aiHasVisualContact && isAISeeker;
      if (isActivelyPursuing) {
        ai.avoidNodeIds.current.clear();
        ai.routeRepeatCount.current = 0;
      }

      const hasAvoidNodes = ai.avoidNodeIds.current.size > 0 && !isActivelyPursuing;
      let computedPath = navGraph.findPath(ai.pos.current, targetPos, {
        avoidNodeIds: hasAvoidNodes ? ai.avoidNodeIds.current : undefined,
        penalizedNodeIds: hasAvoidNodes ? ai.avoidNodeIds.current : undefined,
        variationCost: hasAvoidNodes ? 12.0 : undefined,
      });

      if (!computedPath && hasAvoidNodes) {
        computedPath = navGraph.findPath(ai.pos.current, targetPos, {
          penalizedNodeIds: ai.avoidNodeIds.current,
          variationCost: 20.0,
        });
      }

      if (!computedPath) {
        computedPath = navGraph.findPath(ai.pos.current, targetPos);
      }

      if (computedPath && computedPath.length > 0) {
        const newSig = computedPath.map((n) => n.id).join('->');
        if (!isActivelyPursuing && newSig === ai.lastRouteSig.current && newSig.length > 0) {
          ai.routeRepeatCount.current++;
          computedPath.slice(1, -1).forEach((n) => ai.avoidNodeIds.current.add(n.id));

          if (ai.routeRepeatCount.current >= 2) {
            const altPath =
              navGraph.findPath(ai.pos.current, targetPos, {
                avoidNodeIds: ai.avoidNodeIds.current,
                penalizedNodeIds: ai.avoidNodeIds.current,
                variationCost: 12.0,
              }) ||
              navGraph.findPath(ai.pos.current, targetPos, {
                penalizedNodeIds: ai.avoidNodeIds.current,
                variationCost: 20.0,
              });

            if (altPath && altPath.length > 0) {
              const altSig = altPath.map((n) => n.id).join('->');
              if (altSig !== ai.lastRouteSig.current) {
                computedPath = altPath;
                ai.lastRouteSig.current = altSig;
              }
            } else if (!ai.isCustomDestination.current) {
              const newTarget = getRandomWaypoint(ai.pos.current, navGraph, 8.0);
              if (newTarget.lengthSq() > 0.1) {
                ai.hidingSpot.current.copy(newTarget);
                ai.avoidNodeIds.current.clear();
                ai.routeRepeatCount.current = 0;
                ai.lastRouteSig.current = '';
              }
            }
          }
        } else {
          ai.lastRouteSig.current = newSig;
          ai.routeRepeatCount.current = 1;
          if (ai.avoidNodeIds.current.size > 20) {
            ai.avoidNodeIds.current.clear();
          }
        }

        const smoothed = navGraph.smoothPath(computedPath, collisionGrid);
        ai.path.current = buildWaypointsFromNavPath(smoothed, navGraph);
        ai.pathIndex.current = 0;
      } else {
        ai.path.current = [];
        ai.pathIndex.current = 0;
        ai.avoidNodeIds.current.clear();
        ai.routeRepeatCount.current = 0;
        ai.lastRouteSig.current = '';
        if (!ai.isCustomDestination.current) {
          const newTarget = getRandomWaypoint(ai.pos.current, navGraph, 8.0);
          if (newTarget.lengthSq() > 0.1) {
            ai.hidingSpot.current.copy(newTarget);
          }
        } else {
          ai.isCustomDestination.current = false;
        }
      }
    } else if (ai.path.current.length > 0 && ai.pathIndex.current < ai.path.current.length) {
      const isActivelyPursuing = aiHasVisualContact && isAISeeker;
      if (isActivelyPursuing || ai.pathRecalcTimer.current >= 0.25) {
        if (!isActivelyPursuing) ai.pathRecalcTimer.current = 0;

        const distToTarget = ai.pos.current.distanceTo(targetPos);
        if (
          distToTarget < 35.0 &&
          Math.abs(ai.pos.current.y - targetPos.y) <= 0.8 &&
          navGraph.isDirectWalkable(ai.pos.current, targetPos, collisionGrid)
        ) {
          ai.path.current = [
            { id: 'direct_dest', x: targetPos.x, y: targetPos.y, z: targetPos.z, edgeType: 'walk' },
          ];
          ai.pathIndex.current = 0;
          ai.lastPathTarget.current.copy(targetPos);
        }
      }
    }

    // 4. WAYPOINT FOLLOWING, PRUNING, WHISKERS & PARKOUR EXECUTION
    if (ai.path.current.length > 0 && ai.pathIndex.current < ai.path.current.length) {
      // Multi-node lookahead shortcut pruning
      const lookaheadMax = Math.min(ai.path.current.length - 1, ai.pathIndex.current + 8);
      for (let k = lookaheadMax; k > ai.pathIndex.current; k--) {
        const candidateNode = ai.path.current[k];
        let canBypass = true;
        for (let j = ai.pathIndex.current; j < k; j++) {
          const edgeType = ai.path.current[j].edgeType;
          if (
            edgeType === 'ladder' ||
            edgeType === 'climb' ||
            edgeType === 'jump' ||
            edgeType === 'drop' ||
            ai.path.current[j].id?.includes('ladder')
          ) {
            canBypass = false;
            break;
          }
        }
        if (
          canBypass &&
          Math.abs(ai.pos.current.y - candidateNode.y) <= 0.6 &&
          navGraph.isDirectWalkable(ai.pos.current, candidateNode, collisionGrid)
        ) {
          ai.pathIndex.current = k;
          break;
        }
      }

      // Overshoot / Behind AI Check
      if (ai.pathIndex.current + 1 < ai.path.current.length) {
        const currNode = ai.path.current[ai.pathIndex.current];
        const nextNode = ai.path.current[ai.pathIndex.current + 1];
        if (currNode.edgeType === 'walk' && nextNode.edgeType !== 'jump') {
          const segX = nextNode.x - currNode.x;
          const segZ = nextNode.z - currNode.z;
          const segLenSq = segX * segX + segZ * segZ;
          if (segLenSq > 0.01) {
            const toAiX = ai.pos.current.x - currNode.x;
            const toAiZ = ai.pos.current.z - currNode.z;
            const proj = (toAiX * segX + toAiZ * segZ) / segLenSq;
            if (proj > 0.6 && Math.abs(ai.pos.current.y - nextNode.y) <= 0.8) {
              ai.pathIndex.current++;
            }
          }
        }
      }

      const activeNode =
        ai.pathIndex.current < ai.path.current.length
          ? ai.path.current[ai.pathIndex.current]
          : ai.path.current[ai.path.current.length - 1];
      const prevNode = ai.pathIndex.current > 0 ? ai.path.current[ai.pathIndex.current - 1] : null;
      const isClimbNode = activeNode.edgeType === 'climb';

      const distXZ = Math.hypot(ai.pos.current.x - activeNode.x, ai.pos.current.z - activeNode.z);
      const distY = Math.abs(ai.pos.current.y - activeNode.y);
      const heightDiffUp = activeNode.y - ai.pos.current.y;

      let activeLadderZone: LadderZone | undefined;
      if (ladderZones && ladderZones.length > 0) {
        activeLadderZone = ladderZones.find(
          (z) =>
            Math.hypot(activeNode.x - z.railX, activeNode.z - z.railZ) < 3.0 ||
            (Math.hypot(ai.pos.current.x - z.railX, ai.pos.current.z - z.railZ) < 3.0 &&
              ai.pos.current.y >= z.minY - 1.0 &&
              ai.pos.current.y <= z.maxY + 2.0),
        );
      }

      // Real-time Accessibility & Wall Obstruction Check
      let isNodeAccessible = true;
      const isLadderNode = activeNode.edgeType === 'ladder' || activeNode.id?.includes('ladder');
      const isJumpNode = activeNode.edgeType === 'jump';

      if (!isLadderNode) {
        if (isJumpNode) {
          const originY = prevNode ? prevNode.y : activeNode.y;
          if (
            ai.isGrounded.current &&
            ai.pos.current.y < originY - 2.5 &&
            ai.pos.current.y < activeNode.y - 2.5
          ) {
            isNodeAccessible = false;
          }
        } else if (activeNode.edgeType === 'walk') {
          if (ai.isGrounded.current && heightDiffUp > MAX_SCALABLE_HEIGHT) {
            isNodeAccessible = false;
          } else if (
            distXZ > 0.8 &&
            heightDiffUp <= 1.2 &&
            !navGraph.isDirectWalkable(ai.pos.current, activeNode, collisionGrid)
          ) {
            isNodeAccessible = false;
          }
        } else if (isClimbNode && heightDiffUp > MAX_SCALABLE_HEIGHT) {
          isNodeAccessible = false;
        }
      }

      // Real-time Frontal Wall Collision Detection
      if (isNodeAccessible && ai.isGrounded.current && !isLadderNode && !isJumpNode) {
        scratchDir.set(activeNode.x - ai.pos.current.x, 0, activeNode.z - ai.pos.current.z);
        if (scratchDir.lengthSq() > 0.01) {
          scratchDir.normalize();
          const probeDist = PLAYER_RADIUS + 0.35;
          const probeX = ai.pos.current.x + scratchDir.x * probeDist;
          const probeZ = ai.pos.current.z + scratchDir.z * probeDist;
          const isWallAhead = isPositionBlocked(
            probeX,
            ai.pos.current.y,
            probeZ,
            collisionGrid,
            PLAYER_RADIUS * 0.7,
          );

          if (isWallAhead) {
            const halfSize = Math.floor(worldSize / 2);
            const clampedProbeX = THREE.MathUtils.clamp(probeX, -halfSize + 0.1, halfSize - 0.1);
            const clampedProbeZ = THREE.MathUtils.clamp(probeZ, -halfSize + 0.1, halfSize - 0.1);
            const obstacleTopH = getTerrainHeight(
              clampedProbeX,
              clampedProbeZ,
              ai.pos.current.y,
              collisionGrid,
              bGrid,
              wGrid,
              worldSize,
              100.0,
            );
            const wallH = obstacleTopH - ai.pos.current.y;
            const canClimbObstacle =
              wallH <= MAX_SCALABLE_HEIGHT &&
              wallH > CLIMB_THRESHOLD &&
              (isClimbNode || heightDiffUp > CLIMB_THRESHOLD);
            if (!canClimbObstacle && wallH > CLIMB_THRESHOLD) {
              isNodeAccessible = false;
            }
          }
        }
      }

      if (!isNodeAccessible) {
        if (activeNode.id) {
          ai.avoidNodeIds.current.add(activeNode.id);
        }
        ai.path.current = [];
        ai.pathIndex.current = 0;
        ai.pathRecalcTimer.current = 0.3;
        ai.stuckTimer.current = 0;
        reusableAiInput.moveDir.set(0, 0, 0);
      } else {
        // Lookahead stamina budgeting
        let upcomingJumpStaminaNeeded = 0;
        let upcomingClimbStaminaNeeded = 0;

        const lookaheadLimit = Math.min(ai.path.current.length, ai.pathIndex.current + 4);
        for (let i = ai.pathIndex.current; i < lookaheadLimit; i++) {
          const node = ai.path.current[i];
          const pNode = i > 0 ? ai.path.current[i - 1] : null;
          if (node.edgeType === 'jump') {
            const jDist = pNode ? Math.hypot(node.x - pNode.x, node.z - pNode.z) : 4.0;
            const jHeight = pNode ? node.y - pNode.y : 0;
            const jumpBudget =
              STAMINA_JUMP_COST + (jDist > 3.0 ? 15.0 : 8.0) + (jHeight > 0 ? 12.0 : 5.0) + 5.0;
            upcomingJumpStaminaNeeded = Math.max(upcomingJumpStaminaNeeded, jumpBudget);
          } else if (node.edgeType === 'climb') {
            const cHeight = Math.max(1.0, pNode ? node.y - pNode.y : node.y - ai.pos.current.y);
            const climbBudget = (cHeight / CLIMB_SPEED) * STAMINA_CLIMB_COST + 18.0;
            upcomingClimbStaminaNeeded = Math.max(upcomingClimbStaminaNeeded, climbBudget);
          } else if (node.edgeType === 'ladder' || node.id?.includes('ladder')) {
            const lHeight = pNode ? Math.abs(node.y - pNode.y) : 4.0;
            const ladderBudget = (lHeight / CLIMB_SPEED) * STAMINA_LADDER_CLIMB_COST + 5.0;
            upcomingClimbStaminaNeeded = Math.max(upcomingClimbStaminaNeeded, ladderBudget);
          }
        }

        const totalUpcomingStaminaNeeded = Math.max(
          upcomingJumpStaminaNeeded,
          upcomingClimbStaminaNeeded,
        );
        const shouldConserveStamina =
          totalUpcomingStaminaNeeded > 0 && ai.stamina.current < totalUpcomingStaminaNeeded + 10.0;
        const isLowStamina = ai.stamina.current <= 25.0 || shouldConserveStamina;
        ai.isExhausted.current = ai.stamina.current <= 5.0;

        if (
          activeLadderZone &&
          (activeNode.edgeType === 'ladder' || activeNode.id?.includes('ladder'))
        ) {
          const zone = activeLadderZone;
          const distToRail = Math.hypot(
            ai.pos.current.x - zone.railX,
            ai.pos.current.z - zone.railZ,
          );
          const forwardX = Math.sin(zone.faceAngle);
          const forwardZ = Math.cos(zone.faceAngle);

          // Update whiskers forward toward ladder
          updateWhiskerSensors(ai, forwardX, forwardZ, collisionGrid, wGrid, worldSize, false);

          const isGoingUp =
            activeNode.id?.includes('top') ||
            activeNode.id?.includes('roof') ||
            activeNode.y > ai.pos.current.y + 0.5 ||
            (prevNode?.id?.includes('foot') && activeNode.id?.includes('top'));

          const isGoingDown =
            activeNode.id?.includes('foot') ||
            activeNode.id?.includes('ground') ||
            activeNode.y < ai.pos.current.y - 0.5 ||
            (prevNode?.id?.includes('top') && activeNode.id?.includes('foot'));

          if (activeNode.id?.includes('ladder_ground')) {
            scratchDir.set(activeNode.x - ai.pos.current.x, 0, activeNode.z - ai.pos.current.z);
            if (scratchDir.lengthSq() > 0.01) {
              scratchDir.normalize();
              reusableAiInput.moveDir.copy(scratchDir);
              reusableAiInput.run = false;
            }
            if (distXZ < 0.65 && distY < 1.2) {
              ai.pathIndex.current++;
            }
          } else if (activeNode.id?.includes('ladder_roof')) {
            scratchDir.set(activeNode.x - ai.pos.current.x, 0, activeNode.z - ai.pos.current.z);
            if (scratchDir.lengthSq() > 0.01) {
              scratchDir.normalize();
              reusableAiInput.moveDir.copy(scratchDir);
              reusableAiInput.run = !isLowStamina && distXZ > 1.2;
            }
            if (distXZ < 0.65 && distY < 1.2) {
              ai.pathIndex.current++;
            }
          } else if (isGoingUp) {
            const climbHeight = Math.max(1.0, zone.maxY - zone.minY);
            const baseStaminaNeeded = (climbHeight / CLIMB_SPEED) * STAMINA_LADDER_CLIMB_COST + 5.0;
            const requiredStamina = Math.min(100.0, Math.max(15.0, baseStaminaNeeded));

            if (activeNode.id?.includes('ladder_foot')) {
              scratchDir.set(zone.railX - ai.pos.current.x, 0, zone.railZ - ai.pos.current.z);
              if (distToRail > 0.4 && scratchDir.lengthSq() > 0.01) {
                scratchDir.normalize();
                reusableAiInput.moveDir.copy(scratchDir);
                reusableAiInput.run = false;
              }

              if (distToRail < 0.8) {
                if (ai.stamina.current < requiredStamina && ai.isGrounded.current) {
                  reusableAiInput.moveDir.set(0, 0, 0);
                  reusableAiInput.run = false;
                  reusableAiInput.grabLadder = false;
                  reusableAiInput.ladderUp = false;
                  ai.stuckTimer.current = 0;
                  ai.longStuckTimer.current = 0;
                  isWaitingForStamina = true;
                } else {
                  reusableAiInput.grabLadder = true;
                  reusableAiInput.ladderUp = true;
                  reusableAiInput.ladderDown = false;
                  ai.pathIndex.current++;
                }
              }
            } else {
              const isNearTop = ai.pos.current.y >= zone.maxY - 0.8;
              if (ai.stamina.current <= 0 || (ai.stamina.current < 5.0 && !ai.isGrounded.current && !isNearTop)) {
                reusableAiInput.grabLadder = true;
                reusableAiInput.ladderUp = false;
                reusableAiInput.ladderDown = false;
                reusableAiInput.moveDir.set(0, 0, 0);
                isWaitingForStamina = true;
              } else {
                reusableAiInput.grabLadder = true;
                reusableAiInput.ladderUp = true;
                reusableAiInput.ladderDown = false;
                reusableAiInput.moveDir.set(forwardX, 0, forwardZ).normalize();
              }

              if (
                (ai.pos.current.y >= zone.maxY - 0.35 && ai.isGrounded.current) ||
                ai.pos.current.y >= zone.maxY - 0.05
              ) {
                reusableAiInput.grabLadder = false;
                reusableAiInput.ladderUp = false;
                ai.pathIndex.current++;
              }
            }
          } else if (isGoingDown) {
            if (activeNode.id?.includes('ladder_top')) {
              scratchDir.set(zone.railX - ai.pos.current.x, 0, zone.railZ - ai.pos.current.z);
              if (scratchDir.lengthSq() > 0.01) {
                scratchDir.normalize();
                reusableAiInput.moveDir.copy(scratchDir);
                reusableAiInput.run = false;
              }
              if (distToRail < 0.8) {
                reusableAiInput.grabLadder = true;
                reusableAiInput.ladderDown = true;
                reusableAiInput.ladderUp = false;
                ai.pathIndex.current++;
              }
            } else {
              reusableAiInput.grabLadder = true;
              reusableAiInput.ladderDown = true;
              reusableAiInput.ladderUp = false;
              reusableAiInput.moveDir.set(forwardX, 0, forwardZ).normalize();

              if (
                (ai.pos.current.y <= zone.minY + 0.3 && ai.isGrounded.current) ||
                ai.pos.current.y <= zone.minY
              ) {
                reusableAiInput.grabLadder = false;
                reusableAiInput.ladderDown = false;
                ai.pathIndex.current++;
              }
            }
          } else {
            scratchDir.set(activeNode.x - ai.pos.current.x, 0, activeNode.z - ai.pos.current.z);
            if (scratchDir.lengthSq() > 0.01) {
              scratchDir.normalize();
              reusableAiInput.moveDir.copy(scratchDir);
            }
            if (distXZ < 0.65 && distY < 1.2) {
              ai.pathIndex.current++;
            }
          }
        } else {
          // Standard node movement (walk, jump, climb, drop)
          scratchDir.set(activeNode.x - ai.pos.current.x, 0, activeNode.z - ai.pos.current.z);
          const isDropping = activeNode.edgeType === 'drop' || activeNode.y < ai.pos.current.y - 1.2;
          const isScalableHeight =
            heightDiffUp > CLIMB_THRESHOLD && heightDiffUp <= MAX_SCALABLE_HEIGHT;
          const isScalableClimb = isClimbNode || (!isDropping && isScalableHeight);
          const isJumping =
            activeNode.edgeType === 'jump' ||
            (!isDropping &&
              !isScalableClimb &&
              activeNode.y >= ai.pos.current.y - 1.2 &&
              distXZ > 1.8 &&
              !navGraph.isDirectWalkable(ai.pos.current, activeNode, collisionGrid));

          if (scratchDir.lengthSq() > 0.01) {
            scratchDir.normalize();

            const checkWaterWhisker =
              !isJumping && !isDropping && ai.isGrounded.current && activeNode.edgeType === 'walk';
            const whiskers = updateWhiskerSensors(
              ai,
              scratchDir.x,
              scratchDir.z,
              collisionGrid,
              wGrid,
              worldSize,
              checkWaterWhisker,
            );

            // Apply whisker-based steering & wall clearance during flat walking
            if (
              !isDropping &&
              !isJumping &&
              !isScalableClimb &&
              ai.isGrounded.current &&
              activeNode.edgeType === 'walk' &&
              Math.abs(activeNode.y - ai.pos.current.y) <= 0.6
            ) {
              // 1. Short-range whisker deflection away from corners/obstacles
              const perpX = -scratchDir.z;
              const perpZ = scratchDir.x;
              let steerLateral = 0;

              if (whiskers.left && !whiskers.right) {
                steerLateral -= (1.0 - whiskers.left.dist / ai.whiskerSideLen.current) * 0.65;
              } else if (whiskers.right && !whiskers.left) {
                steerLateral += (1.0 - whiskers.right.dist / ai.whiskerSideLen.current) * 0.65;
              } else if (whiskers.center && whiskers.center.dist < 1.3 && distXZ > 1.2) {
                const leftScore = whiskers.left ? whiskers.left.dist : ai.whiskerSideLen.current + 1.0;
                const rightScore = whiskers.right ? whiskers.right.dist : ai.whiskerSideLen.current + 1.0;
                steerLateral += leftScore >= rightScore ? 0.55 : -0.55;
              }

              // 2. Micro-stuck lateral maneuver (0.75s - 1.6s)
              if (ai.stuckTimer.current > 0.75 && ai.lateralDetourTimer.current <= 0) {
                const leftFree = !whiskers.left || (whiskers.right && whiskers.left.dist > whiskers.right.dist);
                const sideSign = leftFree ? 1 : -1;
                ai.lateralDetourDir.current.set(perpX * sideSign, 0, perpZ * sideSign).normalize();
                ai.lateralDetourTimer.current = 0.45;
              }

              if (ai.lateralDetourTimer.current > 0) {
                scratchDir.addScaledVector(ai.lateralDetourDir.current, 0.7).normalize();
              } else if (Math.abs(steerLateral) > 0.01) {
                scratchDir.x += perpX * steerLateral;
                scratchDir.z += perpZ * steerLateral;
                if (scratchDir.lengthSq() > 0.01) scratchDir.normalize();
              }

              // 3. Soft wall repulsion so character cylinder stays clear of quinas
              const nearbyBoxes = collisionGrid.query(
                ai.pos.current.x,
                ai.pos.current.z,
                PLAYER_RADIUS + 0.35,
              );
              let wallPushX = 0;
              let wallPushZ = 0;
              for (const box of nearbyBoxes) {
                if (
                  ai.pos.current.y + 0.1 < box.maxY &&
                  ai.pos.current.y + PLAYER_HEIGHT - 0.1 > box.minY
                ) {
                  const closeX = Math.max(box.minX, Math.min(ai.pos.current.x, box.maxX));
                  const closeZ = Math.max(box.minZ, Math.min(ai.pos.current.z, box.maxZ));
                  const dx = ai.pos.current.x - closeX;
                  const dz = ai.pos.current.z - closeZ;
                  const dSq = dx * dx + dz * dz;
                  const safeDist = PLAYER_RADIUS + 0.15;
                  if (dSq < safeDist * safeDist && dSq > 0.0001) {
                    const d = Math.sqrt(dSq);
                    const pushMag = (safeDist - d) / safeDist;
                    wallPushX += (dx / d) * pushMag;
                    wallPushZ += (dz / d) * pushMag;
                  }
                }
              }
              if (Math.abs(wallPushX) > 0.01 || Math.abs(wallPushZ) > 0.01) {
                const perpDot = wallPushX * perpX + wallPushZ * perpZ;
                scratchDir.x += perpX * perpDot * 0.35;
                scratchDir.z += perpZ * perpDot * 0.35;
                if (scratchDir.lengthSq() > 0.01) scratchDir.normalize();
              }
            }

            reusableAiInput.moveDir.copy(scratchDir);
            reusableAiInput.run =
              !shouldConserveStamina &&
              (aiHasVisualContact && isAISeeker ? !ai.isExhausted.current : !isLowStamina);
          }

          if (isDropping) {
            reusableAiInput.run = true;
            reusableAiInput.moveDir.copy(scratchDir);
            reusableAiInput.climb = false;
            reusableAiInput.grabLadder = false;
            reusableAiInput.attemptRoll = true;
          } else if (isJumping) {
            if (ai.isGrounded.current) {
              const checkGapDistNear = 0.38;
              const checkGapDistFar = 0.85;
              const terrainAhead1 = getTerrainHeight(
                ai.pos.current.x + scratchDir.x * checkGapDistNear,
                ai.pos.current.z + scratchDir.z * checkGapDistNear,
                ai.pos.current.y,
                collisionGrid,
                bGrid,
                wGrid,
                worldSize,
              );
              const terrainAhead2 = getTerrainHeight(
                ai.pos.current.x + scratchDir.x * checkGapDistFar,
                ai.pos.current.z + scratchDir.z * checkGapDistFar,
                ai.pos.current.y,
                collisionGrid,
                bGrid,
                wGrid,
                worldSize,
              );

              const gapThresholdY = ai.pos.current.y - 1.0;
              const isAtLedgeOrWater =
                (terrainAhead1 < gapThresholdY || terrainAhead1 === -Infinity) &&
                (terrainAhead2 < gapThresholdY || terrainAhead2 === -Infinity);

              const requiredJumpStamina = distXZ > 3.5 || heightDiffUp > 0.2 ? 38.0 : 28.0;
              if (ai.stamina.current < requiredJumpStamina && distXZ > 1.8) {
                reusableAiInput.moveDir.set(0, 0, 0);
                reusableAiInput.run = false;
                reusableAiInput.jump = false;
                reusableAiInput.climb = false;
                ai.stuckTimer.current = 0;
                ai.longStuckTimer.current = 0;
                isWaitingForStamina = true;
              } else {
                reusableAiInput.run = true;
                reusableAiInput.climb = ai.stamina.current > 0;
                reusableAiInput.moveDir.copy(scratchDir);

                // Pulse jump cleanly when reaching the exact ledge/water edge
                const isMovingForward = reusableAiInput.moveDir.lengthSq() > 0.1;
                if (isAtLedgeOrWater && isMovingForward) {
                  reusableAiInput.jump = !ai.jumpPressedPrev.current;
                }
              }
            } else {
              // Airborne across gap: hold jump while rising so variable-jump gravity stays 1x,
              // and trigger Coyote jump if just stepped off the ledge
              reusableAiInput.run = true;
              reusableAiInput.climb = ai.stamina.current > 0;
              reusableAiInput.jump =
                ai.vel.current.y > 0 || (ai.vel.current.y > -4.0 && !ai.jumpPressedPrev.current);
              reusableAiInput.attemptRoll = true;
              reusableAiInput.moveDir.copy(scratchDir);
            }
          } else if (
            isScalableClimb ||
            (!isDropping &&
              !isJumping &&
              !ai.isGrounded.current &&
              activeNode.y > ai.pos.current.y - 0.4 &&
              heightDiffUp <= MAX_SCALABLE_HEIGHT &&
              distXZ < 8.0)
          ) {
            const wallClimbHeight = Math.max(1.0, activeNode.y - ai.pos.current.y);
            const requiredStamina = Math.min(
              100.0,
              (wallClimbHeight / CLIMB_SPEED) * STAMINA_CLIMB_COST + 18.0,
            );
            const isNearWall =
              distXZ <= 2.2 ||
              isPositionBlocked(
                ai.pos.current.x + scratchDir.x * (PLAYER_RADIUS + 0.45),
                ai.pos.current.y,
                ai.pos.current.z + scratchDir.z * (PLAYER_RADIUS + 0.45),
                collisionGrid,
                PLAYER_RADIUS * 0.7,
              );

            if (!isNearWall) {
              // Approaching wall from distance: walk smoothly to preserve/recover stamina without jumping
              reusableAiInput.moveDir.copy(scratchDir);
              reusableAiInput.run = !isLowStamina && !shouldConserveStamina;
              reusableAiInput.climb = ai.stamina.current >= requiredStamina;
              reusableAiInput.jump = false;
            } else if (
              ai.isGrounded.current &&
              !ai.ladderState.current.isWallClimbing &&
              ai.stamina.current < requiredStamina
            ) {
              // At wall base on ground without enough stamina: wait until fully recovered
              reusableAiInput.moveDir.set(0, 0, 0);
              reusableAiInput.run = false;
              reusableAiInput.climb = false;
              reusableAiInput.jump = false;
              ai.stuckTimer.current = 0;
              ai.longStuckTimer.current = 0;
              isWaitingForStamina = true;
            } else {
              // Ready or already climbing wall: push smoothly into wall with climb active and NO jumps
              reusableAiInput.moveDir.copy(scratchDir);
              reusableAiInput.climb = ai.stamina.current > 0;
              reusableAiInput.run = false;
              reusableAiInput.jump = false;
            }
          }

          // Early lookahead corner-cutting advance
          let advancedEarly = false;
          if (ai.pathIndex.current + 1 < ai.path.current.length) {
            const nextNode = ai.path.current[ai.pathIndex.current + 1];
            if (
              activeNode.edgeType === 'walk' &&
              nextNode.edgeType === 'walk' &&
              !activeNode.isCorner &&
              Math.abs(ai.pos.current.y - nextNode.y) <= 0.6 &&
              navGraph.isDirectWalkable(ai.pos.current, nextNode, collisionGrid)
            ) {
              ai.pathIndex.current++;
              advancedEarly = true;
            }
          }

          // Waypoint arrival advancement
          if (!advancedEarly) {
            if (isJumping) {
              const distToPrev = prevNode
                ? Math.hypot(ai.pos.current.x - prevNode.x, ai.pos.current.z - prevNode.z)
                : 999;
              const hasSolidFloorUnderCenter =
                activeNode.y <= 0.5 ||
                collisionGrid.getHighestTopBelow(
                  ai.pos.current.x,
                  ai.pos.current.z,
                  activeNode.y + 0.6,
                ) >= activeNode.y - 0.8;
              const hasCrossedToTargetRoof =
                ai.isGrounded.current &&
                Math.abs(ai.pos.current.y - activeNode.y) <= 1.0 &&
                hasSolidFloorUnderCenter &&
                (distXZ < 0.85 || (distToPrev > 2.2 && distXZ < 1.35));

              if (hasCrossedToTargetRoof) {
                ai.pathIndex.current++;
              }
            } else if (isDropping) {
              const isDropLanding =
                ai.isGrounded.current && ai.pos.current.y <= activeNode.y + 1.2;
              if ((distXZ < 1.0 && distY < 1.2) || (isDropLanding && distXZ < 1.8)) {
                ai.pathIndex.current++;
              }
            } else if (isClimbNode || (heightDiffUp > 0.2 && isScalableHeight)) {
              const isClimbLanding =
                ai.isGrounded.current && ai.pos.current.y >= activeNode.y - 0.6;
              if (isClimbLanding || (distXZ < 0.85 && distY < 1.2)) {
                ai.pathIndex.current++;
              }
            } else {
              const nextNodeInPath =
                ai.pathIndex.current + 1 < ai.path.current.length
                  ? ai.path.current[ai.pathIndex.current + 1]
                  : null;
              const arriveThreshold =
                nextNodeInPath?.edgeType === 'jump'
                  ? 0.35
                  : activeNode.isCorner
                    ? 0.45
                    : 0.75;
              if (distXZ < arriveThreshold && distY < 1.2) {
                ai.pathIndex.current++;
              }
            }
          }
        }
      }
    } else {
      // Idle or arrived: keep whiskers updated forward along lastDir
      updateWhiskerSensors(
        ai,
        ai.lastDir.current.x,
        ai.lastDir.current.y,
        collisionGrid,
        wGrid,
        worldSize,
        false,
      );
    }
  }

  // Safety checks
  if (reusableAiInput.moveDir.lengthSq() < 0.01) {
    reusableAiInput.jump = false;
    reusableAiInput.run = false;
  }

  if (ai.stamina.current <= 0) {
    reusableAiInput.climb = false;
    reusableAiInput.jump = false;
    reusableAiInput.run = false;
    reusableAiInput.ladderUp = false;
  }

  if (isWaitingForStamina) {
    ai.stuckTimer.current = 0;
  }

  // Parkour roll anticipation when falling from height
  const aiCurrentFallDist = ai.airTimeHighPoint.current - ai.pos.current.y;
  if (!ai.isGrounded.current && (aiCurrentFallDist >= 2.0 || ai.vel.current.y < -3.0)) {
    reusableAiInput.attemptRoll = true;
  }

  return {
    aiInput: reusableAiInput,
    aiCanMove,
    isAISeeker,
    aiHasVisualContact,
    aiHasHeardNoise,
  };
}

/**
 * Syncs AI visual animation state, floating status emoji, and gaze tracking after physics step.
 */
export function syncAIVisualsAndGaze(
  ai: AIContext,
  aiPhysicsOutput: {
    isCharging: boolean;
    isRolling: boolean;
    isGrounded: boolean;
    isRunning: boolean;
    isStumbling: boolean;
    effectiveStunned: boolean;
    pMoving: boolean;
    landingFactor: number;
    fallDistance: number;
    justLanded: boolean;
    isClimbing: boolean;
    isLadderSliding: boolean;
    isNearLadder: boolean;
    isLadderHanging: boolean;
    isLadderMounting: boolean;
    ladderFaceAngle: number;
    isWallClimbing: boolean;
    wallClimbProgress: number;
    noiseLevel: number;
  },
  aiInput: AIInput,
  aiHasVisualContact: boolean,
  aiHasHeardNoise: boolean,
  isAISeeker: boolean,
  params: {
    dt: number;
    status: GameStatus;
    mode: GameMode;
    worldSize: number;
    sGrid: number[][];
    playerPos: THREE.Vector3;
    collisionGrid: SpatialHashGrid;
    alwaysShowAI: boolean;
    aiCharacterGroup: THREE.Group | null;
    aiStaminaFill: HTMLDivElement | null;
    aiStaminaGroup: HTMLDivElement | null;
    playerLookAtTarget: React.MutableRefObject<THREE.Vector3 | null>;
    playerSeesAiRef: React.MutableRefObject<boolean>;
    onEmojiChange: (emoji: string) => void;
  },
): void {
  const {
    dt,
    status,
    mode,
    worldSize,
    sGrid,
    playerPos,
    collisionGrid,
    alwaysShowAI,
    aiCharacterGroup,
    aiStaminaFill,
    aiStaminaGroup,
    playerLookAtTarget,
    playerSeesAiRef,
    onEmojiChange,
  } = params;

  const aiDx = ai.pos.current.x - ai.prevPos.current.x;
  const aiDz = ai.pos.current.z - ai.prevPos.current.z;
  const aiRawMoveSpeed = dt > 0 ? Math.sqrt(aiDx * aiDx + aiDz * aiDz) / dt : 0;
  ai.smoothedMoveSpeed.current = THREE.MathUtils.lerp(
    ai.smoothedMoveSpeed.current,
    aiRawMoveSpeed,
    dt * 10,
  );
  ai.prevPos.current.copy(ai.pos.current);

  let aiSurface = 0;
  const halfSize = Math.floor(worldSize / 2);
  const ix = worldToIndex(ai.pos.current.x, halfSize, worldSize);
  const iz = worldToIndex(ai.pos.current.z, halfSize, worldSize);
  if (sGrid[ix]?.[iz] !== undefined) {
    aiSurface = sGrid[ix][iz];
  }

  const isAIHider = mode === GameMode.HIDE_AND_SEEK && !isAISeeker;
  const isAIStandingStill =
    aiPhysicsOutput.isGrounded &&
    !aiPhysicsOutput.effectiveStunned &&
    !aiPhysicsOutput.isRolling &&
    !aiPhysicsOutput.isClimbing &&
    !aiPhysicsOutput.isLadderSliding &&
    !aiPhysicsOutput.isWallClimbing &&
    !aiPhysicsOutput.pMoving &&
    aiInput.moveDir.lengthSq() < 0.01 &&
    ai.smoothedMoveSpeed.current < 0.15;

  if (isAIHider && isAIStandingStill) {
    ai.stillTimer.current += dt;
  } else {
    ai.stillTimer.current = 0;
  }
  const isAIHiding = isAIHider && ai.stillTimer.current >= 2.0;

  // Update visualStateRef fields directly (zero object allocation per frame)
  const vs = ai.visualStateRef.current;
  vs.isCharging = aiPhysicsOutput.isCharging;
  vs.isRolling = aiPhysicsOutput.isRolling;
  vs.isGrounded = aiPhysicsOutput.isGrounded;
  vs.isRunning = aiPhysicsOutput.isRunning;
  vs.isStumbling = aiPhysicsOutput.isStumbling;
  vs.stunned = aiPhysicsOutput.effectiveStunned;
  vs.isMoving = aiPhysicsOutput.pMoving;
  vs.moveSpeed = ai.smoothedMoveSpeed.current;
  vs.landingFactor = aiPhysicsOutput.landingFactor;
  vs.currentSurface = aiSurface;
  vs.fallDistance = aiPhysicsOutput.fallDistance;
  vs.justLanded = aiPhysicsOutput.justLanded;
  vs.isHiding = isAIHiding;
  vs.isClimbing = aiPhysicsOutput.isClimbing;
  vs.isLadderSliding = aiPhysicsOutput.isLadderSliding;
  vs.isNearLadder = aiPhysicsOutput.isNearLadder;
  vs.isLadderHanging = aiPhysicsOutput.isLadderHanging;
  vs.isLadderMounting = aiPhysicsOutput.isLadderMounting;
  vs.ladderFaceAngle = aiPhysicsOutput.ladderFaceAngle;
  vs.isWallClimbing = aiPhysicsOutput.isWallClimbing;
  vs.wallClimbProgress = aiPhysicsOutput.wallClimbProgress;

  // Floating status emoji
  let nextEmoji = '🤖';
  if (ai.stunTimer.current > 0) {
    nextEmoji = '💫';
  } else if (ai.isExhausted.current || ai.stamina.current < 15.0) {
    nextEmoji = '😮‍💨';
  } else if (
    aiPhysicsOutput.isClimbing ||
    aiPhysicsOutput.isWallClimbing ||
    aiPhysicsOutput.isLadderSliding ||
    aiPhysicsOutput.isNearLadder ||
    aiPhysicsOutput.isLadderHanging ||
    aiPhysicsOutput.isLadderMounting
  ) {
    nextEmoji = '🧗';
  } else if (!ai.isGrounded.current && Math.abs(ai.vel.current.y) > 2.0) {
    nextEmoji = '🦘';
  } else if (mode === GameMode.HIDE_AND_SEEK) {
    if (isAISeeker) {
      if (aiHasVisualContact) nextEmoji = '🎯';
      else if (aiHasHeardNoise || ai.heardEmojiTimer.current > 0) nextEmoji = '👂';
      else if (ai.hasLastKnownPlayerPos.current) nextEmoji = '🔎';
      else nextEmoji = '🔍';
    } else {
      if (aiHasVisualContact) nextEmoji = '😱';
      else if (aiHasHeardNoise || ai.heardEmojiTimer.current > 0) nextEmoji = '👂';
      else if (isAIHiding) nextEmoji = '🤫';
      else if (isAIStandingStill) nextEmoji = '👀';
      else nextEmoji = '🏃';
    }
  } else if (mode === GameMode.FREE) {
    nextEmoji = aiInput.moveDir.lengthSq() > 0.01 ? '🚶' : '🤖';
  }

  if (ai.emojiRef.current !== nextEmoji) {
    ai.emojiRef.current = nextEmoji;
    onEmojiChange(nextEmoji);
  }

  // Gaze tracking & visibility
  const distBetween = ai.pos.current.distanceTo(playerPos);
  scratchEyeA.set(ai.pos.current.x, ai.pos.current.y + 1.4, ai.pos.current.z);
  scratchEyeB.set(playerPos.x, playerPos.y + 1.4, playerPos.z);
  scratchHead.set(playerPos.x, playerPos.y + 1.4, playerPos.z);
  scratchTorso.set(playerPos.x, playerPos.y + 0.7, playerPos.z);

  const aiSeesPlayer =
    distBetween < 40.0 &&
    (checkLineOfSight(scratchEyeA, scratchHead, collisionGrid) ||
      checkLineOfSight(scratchEyeA, scratchTorso, collisionGrid));

  const LOOK_AT_MAX_DISTANCE = 14.0;
  if (aiSeesPlayer && distBetween <= LOOK_AT_MAX_DISTANCE) {
    ai.lookAtTarget.current = playerPos;
    if (aiInput.moveDir.lengthSq() < 0.01 && aiCharacterGroup) {
      const dx = playerPos.x - ai.pos.current.x;
      const dz = playerPos.z - ai.pos.current.z;
      if (dx * dx + dz * dz > 0.01) {
        const targetAngle = Math.atan2(dx, dz);
        const diff = Math.atan2(
          Math.sin(targetAngle - aiCharacterGroup.rotation.y),
          Math.cos(targetAngle - aiCharacterGroup.rotation.y),
        );
        aiCharacterGroup.rotation.y += diff * dt * 6.0;
      }
    }
  } else {
    ai.lookAtTarget.current = null;
  }

  scratchHead.set(ai.pos.current.x, ai.pos.current.y + 1.4, ai.pos.current.z);
  scratchTorso.set(ai.pos.current.x, ai.pos.current.y + 0.7, ai.pos.current.z);
  scratchFeet.set(ai.pos.current.x, ai.pos.current.y + 0.1, ai.pos.current.z);

  const playerSeesAi =
    distBetween < 45.0 &&
    (checkLineOfSight(scratchEyeB, scratchHead, collisionGrid) ||
      checkLineOfSight(scratchEyeB, scratchTorso, collisionGrid) ||
      checkLineOfSight(scratchEyeB, scratchFeet, collisionGrid));

  playerSeesAiRef.current = playerSeesAi;

  if (aiCharacterGroup) {
    const isAiVisible =
      alwaysShowAI || status === GameStatus.ROUND_OVER || status === GameStatus.GAME_OVER
        ? true
        : playerSeesAi;
    aiCharacterGroup.visible = isAiVisible;
  }

  if (playerSeesAi && distBetween <= LOOK_AT_MAX_DISTANCE) {
    playerLookAtTarget.current = ai.pos.current;
  } else {
    playerLookAtTarget.current = null;
  }

  // Update AI Stamina Bar
  if (aiStaminaFill && aiStaminaGroup) {
    const s = Math.max(0, ai.stamina.current / 100);
    aiStaminaFill.style.width = `${s * 100}%`;

    if (aiPhysicsOutput.effectiveStunned) {
      aiStaminaFill.style.backgroundColor = '#9ca3af';
    } else {
      const hue = s * 120;
      aiStaminaFill.style.backgroundColor = `hsl(${hue}, 100%, 50%)`;
    }

    const isAiGroupVisible = aiCharacterGroup ? aiCharacterGroup.visible : false;
    aiStaminaGroup.style.display = isAiGroupVisible && s < 0.99 ? 'block' : 'none';
  }
}
