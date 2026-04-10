
import { useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { GameStatus, GameMode, GameSettings, MatchState, AIMode } from '../types';
import { checkLineOfSight, SpatialHashGrid } from '../utils/physics';
import { computeAIPath } from '../utils/navigation';
import { updatePlayerPhysics } from '../utils/player';

// --- Interfaces ---

interface AIVisualState {
    isCharging: boolean;
    isRolling: boolean;
    isGrounded: boolean;
    isRunning: boolean;
    isMoving: boolean;
    moveSpeed: number;
    isStumbling: boolean;
    stunned: boolean;
    landingFactor: number;
    currentSurface: number;
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
    isHiding: boolean;
    isSearching: boolean;
    stamina: number;
    aiMode: AIMode;
}

interface MapData {
    objects: any[];
    collisionGrid: SpatialHashGrid;
    bGrid: number[][];
    wGrid: number[][];
    sGrid: number[][];
    tGrid: number[][];
    spawnPos: THREE.Vector3;
    ladderZones: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; faceAngle: number; railX: number; railZ: number }[];
    riverOrientation: number;
    riverFlow: number;
    worldSize: number;
}

interface UseAIControllerParams {
    playerPos: React.MutableRefObject<THREE.Vector3>;
    playerVel: React.MutableRefObject<THREE.Vector3>;
    keys: React.MutableRefObject<{ [key: string]: boolean | { x: number; y: number } | undefined }>;
    camera: THREE.Camera;
}

const DEFAULT_AI_VISUAL_STATE: AIVisualState = {
    isCharging: false,
    isRolling: false,
    isGrounded: true,
    isRunning: false,
    isMoving: false,
    moveSpeed: 0,
    isStumbling: false,
    stunned: false,
    landingFactor: 0,
    currentSurface: 0,
    fallDistance: 0,
    justLanded: false,
    isClimbing: false,
    isLadderSliding: false,
    isNearLadder: false,
    isLadderHanging: false,
    isLadderMounting: false,
    ladderFaceAngle: 0,
    isWallClimbing: false,
    wallClimbProgress: 0,
    isHiding: false,
    isSearching: false,
    stamina: 100,
    aiMode: AIMode.AGUARDANDO
};

export const useAIController = (params: UseAIControllerParams) => {
    const { playerPos, playerVel, keys, camera } = params;
    const SAFE_MARGIN = 2.0;

    // --- AI Physics Refs ---
    const aiPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiVel = useRef(new THREE.Vector3(0, 0, 0));
    const aiLastDir = useRef(new THREE.Vector2(0, 1));
    const isAIGrounded = useRef(false);
    const isAICharging = useRef(false);
    const isAIRolling = useRef(false);
    const aiStamina = useRef(100);
    const aiStunTimer = useRef(0);
    const aiJumpDelayTimer = useRef(0);
    const aiAirTimeHighPoint = useRef(0);
    const aiJumpPressedPrev = useRef(false);
    const aiRollTimer = useRef(0);
    const aiJumpBufferTimer = useRef(0);
    const aiStumbleTimer = useRef(0);
    const aiStumbleVelocity = useRef(new THREE.Vector3(0, 0, 0));
    const aiLandingAnimTimer = useRef(0);
    const aiLastFallDist = useRef(0);
    const lastKnownPlayerPos = useRef<THREE.Vector3 | null>(null);
    const lastKnownPlayerDir = useRef<THREE.Vector3 | null>(null);
    const aiLadderState = useRef({
        isClimbing: false,
        isLadderSliding: false,
        isLadderHanging: false,
        isLadderMounting: false,
        ladderMountTimer: 0,
        isWallClimbing: false,
        wallClimbProgress: 0,
        wallClimbDir: new THREE.Vector2(0, 0)
    });

    // --- AI Pathfinding Refs ---
    const aiPath = useRef<THREE.Vector3[]>([]);
    const lastPathPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const pathTimer = useRef(0);
    const aiIsHiding = useRef(false);
    const aiStuckTimer = useRef(0);

    // --- Search State ---
    const isAISearching = useRef(false);
    const aiSearchTarget = useRef<THREE.Vector3 | null>(null);
    const aiSearchTimer = useRef(0);
    const aiWasVisible = useRef(false);
    const aiSearchWaypoints = useRef<THREE.Vector3[]>([]);

    // --- Spawn ---
    const aiStartPos = useRef(new THREE.Vector3(0, 0, 0));

    // --- AI Visual Refs ---
    const aiGroup = useRef<THREE.Group>(null!);
    const prevAIPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiSmoothedMoveSpeed = useRef(0);
    const losLineRef = useRef<any>(null!);
    const lastKnownMarkerRef = useRef<THREE.Mesh>(null!);
    const pathLineRef = useRef<any>(null!);
    const aiNudgeTimer = useRef(0);
    const aiStaminaHysteresisActive = useRef(true);
    const aiStateLockTimer = useRef(0);

    // --- AI Visual State ---
    const [aiVisualState, setAiVisualState] = useState<AIVisualState>({ ...DEFAULT_AI_VISUAL_STATE });

    // --- Reusable vectors to avoid GC pressure ---
    const _v1 = useRef(new THREE.Vector3());
    const _v2 = useRef(new THREE.Vector3());
    const _v3 = useRef(new THREE.Vector3());
    const _v4 = useRef(new THREE.Vector3());
    const _v5 = useRef(new THREE.Vector3());
    const _v2d = useRef(new THREE.Vector2());

    // Pre-computed corner positions (memoized once)
    const _corners = useMemo(() => [
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
    ], []);

    // --- Reset AI (called during PREP) ---
    const resetAI = (spawnPos: THREE.Vector3) => {
        aiPos.current.copy(spawnPos);
        prevAIPos.current.copy(spawnPos);
        aiStartPos.current.copy(spawnPos);
        aiVel.current.set(0, 0, 0);
        isAIGrounded.current = true;
        aiAirTimeHighPoint.current = spawnPos.y;
        aiStamina.current = 100;
        aiStunTimer.current = 0;
        aiIsHiding.current = false;
        aiPath.current = [];
        aiStuckTimer.current = 0;
        isAISearching.current = true;
        aiSearchTarget.current = null;
        aiSearchTimer.current = 10.0; // Force immediate target pick
        lastKnownPlayerPos.current = null;
        lastKnownPlayerDir.current = null;
        aiStaminaHysteresisActive.current = true;
        aiStateLockTimer.current = 0;
    };

    // --- Fall Safety Respawn ---
    const checkFallSafety = () => {
        if (aiPos.current.y < -10) {
            aiPos.current.copy(aiStartPos.current);
            aiVel.current.set(0, 0, 0);
        }
    };

    // --- Main AI Update (called inside useFrame) ---
    const updateAI = (
        dt: number,
        aiCanMove: boolean,
        mapData: MapData,
        settings: GameSettings,
        match: MatchState,
        mode: GameMode,
        status: GameStatus,
        debugMode?: boolean,
        onRoundEnd?: (playerWon: boolean) => void
    ): { aiCatchTriggered: boolean } => {

        let aiCatchTriggered = false;

        if (mode !== GameMode.HIDE_AND_SEEK || status !== GameStatus.PLAYING) {
            return { aiCatchTriggered };
        }

        const aiInput: { moveDir: THREE.Vector3; jump: boolean; run: boolean; ladderUp?: boolean; ladderDown?: boolean } = {
            moveDir: new THREE.Vector3(), jump: false, run: true, ladderUp: false, ladderDown: false
        };

        // Artificial Steering Logic
        const isSeeker = match.playerRole === 'HIDER'; // Since player is Hider, AI is Seeker
        let currentMode = aiVisualState.aiMode;

        // VISION CHECK
        const aiEyePos = _v1.current.set(aiPos.current.x, aiPos.current.y + 3.5, aiPos.current.z);
        const playerVisualPos = _v2.current.set(playerPos.current.x, playerPos.current.y + 3.5, playerPos.current.z);
        const isVisible = checkLineOfSight(aiEyePos, playerVisualPos, mapData.collisionGrid);

        if (isVisible) {
            isAISearching.current = false;
            aiSearchTarget.current = null;

            if (!lastKnownPlayerPos.current) lastKnownPlayerPos.current = new THREE.Vector3();
            if (!lastKnownPlayerDir.current) lastKnownPlayerDir.current = new THREE.Vector3();
            lastKnownPlayerPos.current.copy(playerPos.current);
            if (playerVel.current.lengthSq() > 0.1) {
                lastKnownPlayerDir.current.copy(playerVel.current);
                lastKnownPlayerDir.current.y = 0;
                if (lastKnownPlayerDir.current.lengthSq() > 0) lastKnownPlayerDir.current.normalize();
            }
        }

        // --- DEBUG GRAPHICS UPDATE ---
        if (debugMode && losLineRef.current && lastKnownMarkerRef.current) {
            losLineRef.current.visible = true;
            const positions = new Float32Array([
                aiEyePos.x, aiEyePos.y, aiEyePos.z,
                playerVisualPos.x, playerVisualPos.y, playerVisualPos.z
            ]);
            losLineRef.current.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const mat = losLineRef.current.material as THREE.LineBasicMaterial;
            mat.color.set(isVisible ? 0x00ff00 : 0xff0000);

            if (lastKnownPlayerPos.current) {
                lastKnownMarkerRef.current.position.copy(lastKnownPlayerPos.current).add(new THREE.Vector3(0, 2, 0));
                lastKnownMarkerRef.current.visible = true;
            } else {
                lastKnownMarkerRef.current.visible = false;
            }
        } else if (losLineRef.current && lastKnownMarkerRef.current) {
            losLineRef.current.visible = false;
            lastKnownMarkerRef.current.visible = false;
        }

        // --- TIMERS ---
        pathTimer.current -= dt;
        if (aiNudgeTimer.current > 0) aiNudgeTimer.current -= dt;

        // --- AI PATHFINDING LOGIC ---
        let targetPos: THREE.Vector3 | null = null;
        let distToThreat = 0;

        const visibilityLost = aiWasVisible.current && !isVisible;
        const visibilityGained = !aiWasVisible.current && isVisible;

        if (isSeeker && visibilityLost) {
            pathTimer.current = 0;
            aiPath.current = [];
        }

        // Fugitive also reacts immediately when spotted
        if (!isSeeker && visibilityGained) {
            pathTimer.current = 0;
            aiPath.current = [];
        }

        if (isSeeker) {
            if (isVisible) {
                targetPos = playerPos.current;
                currentMode = AIMode.PERSEGUIÇÃO;
            } else if (isAISearching.current) {
                currentMode = AIMode.BUSCA;
                
                // --- IMPROVED SEARCH LOGIC ---
                // If we don't have waypoints, generate them in a pattern
                if (aiSearchWaypoints.current.length === 0) {
                    const anchor = lastKnownPlayerPos.current || aiPos.current;
                    const halfSize = Math.floor(settings.worldSize / 2);
                    
                    // Create 5 random points in a search radius
                    for (let i = 0; i < 5; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const radius = 5 + Math.random() * 15;
                        const target = new THREE.Vector3(
                            THREE.MathUtils.clamp(anchor.x + Math.sin(angle) * radius, -halfSize + SAFE_MARGIN, halfSize - SAFE_MARGIN),
                            0,
                            THREE.MathUtils.clamp(anchor.z + Math.cos(angle) * radius, -halfSize + SAFE_MARGIN, halfSize - SAFE_MARGIN)
                        );
                        aiSearchWaypoints.current.push(target);
                    }
                }
                
                // Pick the next waypoint
                if (aiSearchWaypoints.current.length > 0) {
                    targetPos = aiSearchWaypoints.current[0];
                    if (aiPos.current.distanceTo(targetPos) < 3.0) {
                        aiSearchWaypoints.current.shift();
                        aiPath.current = []; // Force re-path to new target
                    }
                } else {
                    // Waypoints exhausted, just wander
                    isAISearching.current = true;
                    aiSearchWaypoints.current = [];
                }
            } else {
                targetPos = lastKnownPlayerPos.current;
                currentMode = AIMode.BUSCA; // Simplified mode for "Going to last known position"
                
                if (targetPos) {
                    const distToLastSeen = aiPos.current.distanceTo(targetPos);
                    if (distToLastSeen < 3.0) {
                        isAISearching.current = true;
                        aiSearchTimer.current = 0;
                        aiPath.current = [];
                    }
                } else {
                    isAISearching.current = true;
                    aiSearchTimer.current = 10.0;
                }
            }
        } else {
            // FUGITIVE AI (Seeker is opponent) 
            // Use real-time position if visible, otherwise lastKnown
            const threatCenter = isVisible ? playerPos.current : (lastKnownPlayerPos.current || playerPos.current);
            const distToThreat = aiPos.current.distanceTo(threatCenter);
            const halfSize = Math.floor(settings.worldSize / 2);

            // Stamina Hysteresis Management
            if (aiStamina.current < 5) {
                aiStaminaHysteresisActive.current = false;
            } else if (aiStamina.current > 30) {
                aiStaminaHysteresisActive.current = true;
            }

            // State Lock Timer to prevent rapid oscillation
            if (aiStateLockTimer.current > 0) {
                aiStateLockTimer.current -= dt;
            }

            // --- STATE TRANSITION LOGIC ---
            const threatDistSq = aiPos.current.distanceToSquared(threatCenter);
            const isThreatClose = threatDistSq < 15 * 15;
            const canTransitionState = aiStateLockTimer.current <= 0;

            // Force RUN mode immediately if in game and fugitive
            if (match.phase === 'WAITING' && !isSeeker && currentMode === AIMode.AGUARDANDO) {
                currentMode = AIMode.RUN;
            }

            const shouldRun = isVisible || distToThreat < 18.0;

            // Modes: RUN if visible OR near threat, HIDE if far enough AND not seen
            if (shouldRun) {
                if (canTransitionState || currentMode === AIMode.RUN) {
                    currentMode = AIMode.RUN;
                    if (aiIsHiding.current) aiStateLockTimer.current = 0.8;
                    aiIsHiding.current = false;
                }
                
                // Fugitive AI Navigation Logic - Furthest Corner
                const cornerDist = halfSize - SAFE_MARGIN;
                const corners = _corners;
                corners[0].set(-cornerDist, 0, -cornerDist);
                corners[1].set(-cornerDist, 0, cornerDist);
                corners[2].set(cornerDist, 0, -cornerDist);
                corners[3].set(cornerDist, 0, cornerDist);
                
                // Sort corners by a combination of target distance from threat 
                // AND how far the direct path is from the threat
                corners.sort((a, b) => {
                    const distA = a.distanceTo(threatCenter);
                    const distB = b.distanceTo(threatCenter);
                    
                    // Simple distance-to-segment (aiPos -> corner) check for threat avoidance
                    const getPathClearance = (corner: THREE.Vector3) => {
                        const line = _v1.current.subVectors(corner, aiPos.current);
                        const lenSq = line.lengthSq();
                        if (lenSq === 0) return aiPos.current.distanceTo(threatCenter);
                        
                        const t = Math.max(0, Math.min(1, _v2.current.subVectors(threatCenter, aiPos.current).dot(line) / lenSq));
                        const projection = _v3.current.copy(aiPos.current).addScaledVector(line, t);
                        return threatCenter.distanceTo(projection);
                    };

                    const scoreA = distA + getPathClearance(a) * 2.0;
                    const scoreB = distB + getPathClearance(b) * 2.0;
                    return scoreB - scoreA;
                });
                
                // If the best corner is still somehow bad or we are close to it, try to maintain movement
                const distToPrimary = aiPos.current.distanceTo(corners[0]);
                if (distToPrimary < 5.0 && distToThreat < 20.0) {
                    targetPos = corners[1];
                } else {
                    targetPos = corners[0];
                }
                
                // Manage Run Input based on Hysteresis
                aiInput.run = aiStaminaHysteresisActive.current;
            } else {
                if (canTransitionState || currentMode === AIMode.HIDE) {
                    currentMode = AIMode.HIDE;
                    if (!aiIsHiding.current) aiStateLockTimer.current = 0.5;
                }
                
                // ALWAYS calculate target height even if state transition is locked
                // to ensure AI keeps moving to its intended destination
                
                // Seek cover from threatCenter (which is lastKnown now)
                const nearby = mapData.collisionGrid.query(aiPos.current.x, aiPos.current.z, 20.0);
                if (nearby.length > 0) {
                    const coverObj = nearby.find((b: any) => (b.maxY - b.minY) > 4.0);
                    if (coverObj) {
                        const coverCenter = _v1.current.set((coverObj.minX + coverObj.maxX) / 2, 0, (coverObj.minZ + coverObj.maxZ) / 2);
                        const dirFromThreat = _v2.current.subVectors(coverCenter, threatCenter).normalize();
                        const size = Math.max(coverObj.maxX - coverObj.minX, coverObj.maxZ - coverObj.minZ);
                        
                        const hideSpot = _v3.current.copy(coverCenter).addScaledVector(dirFromThreat, size / 2 + 2.0);
                        
                        // --- IMPROVED HIDING LOGIC: LOS CHECK ---
                        const hideSpotEye = _v4.current.set(hideSpot.x, aiPos.current.y + 1.5, hideSpot.z);
                        const threatEye = _v5.current.set(threatCenter.x, threatCenter.y + 1.5, threatCenter.z);
                        const isSafe = !checkLineOfSight(hideSpotEye, threatEye, mapData.collisionGrid);
                        
                        if (isSafe) {
                            targetPos = hideSpot;
                        } else {
                            // If not safe, look for another spot or move further away
                            targetPos = null;
                        }

                        if (targetPos && aiPos.current.distanceTo(targetPos) < 2.0) {
                            aiIsHiding.current = true;
                            aiInput.moveDir.set(0, 0, 0);
                            aiInput.run = false;
                            aiPath.current = [];
                        } else {
                            aiIsHiding.current = false;
                        }
                    }
                }

                if (!aiIsHiding.current && !targetPos) {
                    const cornerDist = halfSize - SAFE_MARGIN;
                    const corners = _corners;
                    corners[0].set(-cornerDist, 0, -cornerDist);
                    corners[1].set(-cornerDist, 0, cornerDist);
                    corners[2].set(cornerDist, 0, -cornerDist);
                    corners[3].set(cornerDist, 0, cornerDist);
                    // Se não houver cobertura, fuja para o canto mais distante do caçador
                    corners.sort((a, b) => b.distanceTo(threatCenter) - a.distanceTo(threatCenter));
                    targetPos = corners[0];
                }
            }
        }

        // --- PATHFINDING TRIGGER ---
        // Se temos um alvo mas não temos um caminho, ou o alvo mudou demais, recalcula.
        let needsNewPath = aiPath.current.length === 0 || pathTimer.current <= 0;

        // PATH INTERCEPTION CHECK: Se o buscador entrar no caminho planejado, recalcula IMEDIATAMENTE
        if (!isSeeker && aiPath.current.length > 0) {
            const INTERCEPTION_RADIUS = 5.0; // Desvio proativo
            const seekerPos = playerPos.current;
            
            // Verifica apenas os próximos waypoints para evitar oscilação excessiva
            const waypointsToCheck = Math.min(aiPath.current.length, 12);
            for (let i = 0; i < waypointsToCheck; i++) {
                if (aiPath.current[i].distanceTo(seekerPos) < INTERCEPTION_RADIUS) {
                    needsNewPath = true;
                    pathTimer.current = 0; // Força recálculo no próximo passo
                    break;
                }
            }
        }
        if (targetPos) {
            const distToLastPathTarget = lastPathPos.current.distanceTo(targetPos);
            // Reduzi a tolerância de mudança de alvo para 1.5 para IA ser mais responsiva
            needsNewPath = needsNewPath || distToLastPathTarget > 1.5;
        }

        if (needsNewPath && !aiIsHiding.current && targetPos) {
            const threat = isSeeker ? undefined : playerPos.current;
            const newPath = computeAIPath(aiPos.current, targetPos, {
                collisionGrid: mapData.collisionGrid,
                bGrid: mapData.bGrid,
                tGrid: mapData.tGrid,
                wGrid: mapData.wGrid,
                worldSize: settings.worldSize
            }, settings, threat);

            if (newPath.length > 0) {
                aiPath.current = newPath;
                lastPathPos.current.copy(targetPos);
                // Increase timer for smoother pathfinding: 0.5s for fugitive near threat, 1.5s otherwise
                pathTimer.current = (!isSeeker && distToThreat < 15.0) ? 0.5 : 1.5;
            }
        }

        if (aiPath.current.length > 0) {
            const nextWaypoint = _v1.current.copy(aiPath.current[0]);
            const toWaypoint = _v2.current.subVectors(nextWaypoint, aiPos.current);
            toWaypoint.y = 0;
            const distToWaypoint = toWaypoint.length();

            if (distToWaypoint < 1.0) {
                aiPath.current.shift();
                if (aiPath.current.length > 0) {
                    aiInput.moveDir.copy(aiPath.current[0]).sub(aiPos.current).setY(0).normalize();
                } else {
                    aiInput.moveDir.set(0, 0, 0);
                }
            } else {
                aiInput.moveDir.copy(toWaypoint).normalize();
            }

            if (debugMode && pathLineRef.current) {
                pathLineRef.current.visible = true;
                const points = [aiPos.current, ...aiPath.current];
                const pts = new Float32Array(points.length * 3);
                points.forEach((p, i) => {
                    pts[i * 3] = p.x;
                    pts[i * 3 + 1] = p.y + 0.1;
                    pts[i * 3 + 2] = p.z;
                });
                pathLineRef.current.geometry.setPositions(pts);
            } else if (pathLineRef.current) {
                pathLineRef.current.visible = false;
            }
        } else {
            if (aiNudgeTimer.current <= 0) {
                aiInput.moveDir.set(0, 0, 0);
                aiInput.run = false;
            }
            if (pathLineRef.current) pathLineRef.current.visible = false;
        }

        // Fase de ESPERA (WAITING):
        // Se a IA for a HIDER (Fugitiva), ela DEVE começar a fugir imediatamente enquanto o Caçador espera.
        if (match.phase === 'WAITING' && aiNudgeTimer.current <= 0 && aiPath.current.length === 0) {
            if (!isSeeker) {
                // Se a IA é fugitiva e está no WAITING, tenta um movimento linear para longe do jogador enquanto o A* calcula
                const playerDir = _v1.current.subVectors(playerPos.current, aiPos.current);
                playerDir.y = 0;
                if (playerDir.lengthSq() > 0.01) {
                    aiInput.moveDir.copy(playerDir).negate().normalize();
                    aiInput.run = true;
                }
            } else {
                // Se a IA é caçadora, ela espera imóvel
                aiInput.moveDir.set(0, 0, 0);
                aiInput.run = false;
                currentMode = AIMode.AGUARDANDO;
            }
        }

        const distToRealTarget = aiPos.current.distanceTo(playerPos.current);
        if (distToRealTarget < 1.5) {
            aiCatchTriggered = true;
        }

        // Lógica de cobertura oportunista: SÓ se aplica quando a ameaça está longe E a IA NÃO está visível.
        // Quando está sendo perseguida, a prioridade absoluta é fugir, não se esconder.
        const threatIsFar = !isSeeker && aiPos.current.distanceTo(playerPos.current) > 12.0;
        if (!isSeeker && match.phase === 'HUNTING' && aiInput.moveDir.lengthSq() > 0 && aiPath.current.length === 0 && threatIsFar && !isVisible) {
            const nearbyObjects = mapData.collisionGrid.query(aiPos.current.x, aiPos.current.z, 8.0);
            if (nearbyObjects.length > 0) {
                const cover = nearbyObjects.find((b: any) => b.maxY > Math.max(aiPos.current.y, 1.0) + 2.0 && b.minY <= aiPos.current.y + 0.5);
                if (cover) {
                    const coverCenter = _v1.current.set(
                        (cover.minX + cover.maxX) / 2,
                        0,
                        (cover.minZ + cover.maxZ) / 2
                    );
                    const dirCoverToPlayer = _v2.current.subVectors(playerPos.current, coverCenter).normalize();
                    const hideDist = Math.max((cover.maxX - cover.minX) / 2, (cover.maxZ - cover.minZ) / 2) + 1.0;
                    const hideSpot = _v3.current.copy(coverCenter).addScaledVector(dirCoverToPlayer, -hideDist);

                    hideSpot.y = aiPos.current.y;
                    const distToHide = hideSpot.distanceTo(aiPos.current);
                    if (distToHide > 1.0) {
                        aiInput.moveDir.copy(hideSpot).sub(aiPos.current).normalize();
                    } else {
                        aiInput.moveDir.set(0, 0, 0);
                    }
                }
            }
        }

        if (aiInput.moveDir.lengthSq() > 0) {
            const lookAheadDist = 1.5;
            const aiRadius = 0.6;
            const p = aiPos.current;
            const d = aiInput.moveDir;

            const checkX = p.x + d.x * lookAheadDist;
            const checkZ = p.z + d.z * lookAheadDist;

            const filterObstacles = (b: any) => {
                if (b.maxY <= p.y + 0.5 || b.minY >= p.y + 2.0) return false;
                const boxCenterX = (b.minX + b.maxX) / 2;
                const boxCenterZ = (b.minZ + b.maxZ) / 2;
                const toBox = _v4.current.set(boxCenterX - p.x, 0, boxCenterZ - p.z).normalize();
                if (toBox.dot(d) < 0.2) return false;
                return true;
            };

            const rawBoxes = mapData.collisionGrid.query(checkX, checkZ, aiRadius);
            const boxes = rawBoxes.filter(filterObstacles);

            if (boxes.length > 0) {
                const rightWhiskerDir = _v3.current.set(d.x + d.z, 0, d.z - d.x).normalize();
                const leftWhiskerDir = _v4.current.set(d.x - d.z, 0, d.z + d.x).normalize();

                const rightCheckX = p.x + rightWhiskerDir.x * lookAheadDist;
                const rightCheckZ = p.z + rightWhiskerDir.z * lookAheadDist;
                const rightBoxes = mapData.collisionGrid.query(rightCheckX, rightCheckZ, aiRadius).filter(filterObstacles);

                const leftCheckX = p.x + leftWhiskerDir.x * lookAheadDist;
                const leftCheckZ = p.z + leftWhiskerDir.z * lookAheadDist;
                const leftBoxes = mapData.collisionGrid.query(leftCheckX, leftCheckZ, aiRadius).filter(filterObstacles);

                if (rightBoxes.length < boxes.length && rightBoxes.length <= leftBoxes.length) {
                    aiInput.moveDir.add(rightWhiskerDir.multiplyScalar(2.0)).normalize();
                } else if (leftBoxes.length < boxes.length) {
                    aiInput.moveDir.add(leftWhiskerDir.multiplyScalar(2.0)).normalize();
                } else {
                    const hardRightDir = _v5.current.set(d.z, 0, -d.x);
                    aiInput.moveDir.add(hardRightDir.multiplyScalar(3.0)).normalize();
                }
            }
        }

        const aiVelocitySq = aiVel.current.x * aiVel.current.x + aiVel.current.z * aiVel.current.z;
        const halfSize = Math.floor(settings.worldSize / 2);
        const nearEdge = Math.abs(aiPos.current.x) >= halfSize - 4.0 || Math.abs(aiPos.current.z) >= halfSize - 4.0;
        
        // Stuck threshold dinâmico: reage muito mais rápido quando em perigo
        const isUnderPressure = !isSeeker && (isVisible || aiPos.current.distanceTo(playerPos.current) < 15.0);
        const stuckThreshold = isUnderPressure ? 0.4 : (nearEdge ? 0.8 : 1.2);

        if (aiInput.moveDir.lengthSq() > 0 && aiVelocitySq < 0.25) {
            aiStuckTimer.current += dt;
            if (aiStuckTimer.current > stuckThreshold) {
                if (nearEdge) {
                    aiInput.moveDir.set(-aiPos.current.x, 0, -aiPos.current.z).normalize();
                    aiInput.jump = true;
                    aiNudgeTimer.current = 0.6;
                } else {
                    // Nudge inteligente: foge PARA LONGE do buscador, não em direção aleatória
                    const escapeDir = _v1.current.subVectors(aiPos.current, playerPos.current);
                    escapeDir.y = 0;
                    if (escapeDir.lengthSq() > 0.01) {
                        escapeDir.normalize();
                        // Adiciona variação lateral (±45°) para não ficar em linha reta
                        const lateralAngle = (Math.random() - 0.5) * Math.PI * 0.5;
                        const cos = Math.cos(lateralAngle);
                        const sin = Math.sin(lateralAngle);
                        const rx = escapeDir.x * cos - escapeDir.z * sin;
                        const rz = escapeDir.x * sin + escapeDir.z * cos;
                        aiInput.moveDir.set(rx, 0, rz).normalize();
                    } else {
                        const angle = Math.random() * Math.PI * 2;
                        aiInput.moveDir.set(Math.cos(angle), 0, Math.sin(angle));
                    }
                    aiInput.jump = true;
                    aiNudgeTimer.current = 0.4;
                }
                aiStuckTimer.current = 0;
                aiPath.current = [];
            }
        } else {
            aiStuckTimer.current = 0;
        }
        // --- ANTI-PARALISIA: Forçar liberação de escada quando em modo de fuga ---
        // A IA fugitiva não deve ficar presa em escadas. Se estiver em estado de ladder
        // e precisar fugir, forçar a liberação do estado.
        const isOnLadder = aiLadderState.current.isClimbing || aiLadderState.current.isLadderSliding || 
                           aiLadderState.current.isLadderHanging || aiLadderState.current.isLadderMounting;
        if (!isSeeker && isOnLadder && (currentMode === AIMode.RUN || isVisible)) {
            // Forçar liberação da escada
            aiLadderState.current.isClimbing = false;
            aiLadderState.current.isLadderSliding = false;
            aiLadderState.current.isLadderHanging = false;
            aiLadderState.current.isLadderMounting = false;
            aiLadderState.current.ladderMountTimer = 0;
            // Saltar para longe da escada em direção oposta ao buscador
            aiInput.jump = true;
        }

        const aiPhysicsOutput = updatePlayerPhysics(
            dt, aiPos.current, aiVel.current, isAIGrounded, isAICharging, aiLandingAnimTimer, aiJumpDelayTimer,
            aiAirTimeHighPoint, aiStamina, aiStunTimer, aiStunTimer.current > 0, keys,
            aiLastDir, aiJumpPressedPrev, settings.playerSpeed * 0.95,
            mapData.collisionGrid, mapData.bGrid, mapData.wGrid, settings.worldSize, aiCanMove,
            aiRollTimer, aiJumpBufferTimer, isAIRolling, aiStumbleTimer, aiStumbleVelocity,
            camera, aiLastFallDist, mapData?.riverOrientation ?? -1, settings.riverFlow,
            mapData?.ladderZones ?? [],
            aiInput,
            aiLadderState
        );

        if (aiGroup.current) {
            aiGroup.current.position.copy(aiPos.current);

            // --- ANTI-PARALISIA PÓS-FÍSICA: Detecção de velocidade zero absoluta ---
            // Se a IA está tentando se mover mas está completamente parada (velocidade ~0),
            // e o buscador está perto, forçar salto de emergência para longe.
            const postPhysicsVelSq = aiVel.current.x * aiVel.current.x + aiVel.current.z * aiVel.current.z;
            const aiWantsToMove = aiInput.moveDir.lengthSq() > 0.01;
            const isParalyzed = aiWantsToMove && postPhysicsVelSq < 0.1 && isAIGrounded.current;
            
            if (!isSeeker && isParalyzed) {
                aiStuckTimer.current += dt;
                // Limiar ultra-agressivo: 0.3s de paralisia total = emergência
                if (aiStuckTimer.current > 0.3 && aiPos.current.distanceTo(playerPos.current) < 20.0) {
                    // Forçar liberação de QUALQUER estado que possa prender
                    aiLadderState.current.isClimbing = false;
                    aiLadderState.current.isLadderSliding = false;
                    aiLadderState.current.isLadderHanging = false;
                    aiLadderState.current.isLadderMounting = false;
                    aiLadderState.current.ladderMountTimer = 0;
                    
                    // Salto de emergência para longe do buscador
                    const emergencyDir = _v1.current.subVectors(aiPos.current, playerPos.current);
                    emergencyDir.y = 0;
                    if (emergencyDir.lengthSq() > 0.01) {
                        emergencyDir.normalize();
                        // Variação lateral para evitar loop
                        const lat = (Math.random() - 0.5) * Math.PI * 0.6;
                        const c = Math.cos(lat), s = Math.sin(lat);
                        aiVel.current.set(
                            (emergencyDir.x * c - emergencyDir.z * s) * 8.0,
                            12.0, // Salto vertical forte
                            (emergencyDir.x * s + emergencyDir.z * c) * 8.0
                        );
                    } else {
                        aiVel.current.set(0, 12.0, 0);
                    }
                    isAIGrounded.current = false;
                    aiStuckTimer.current = 0;
                    aiPath.current = [];
                    aiNudgeTimer.current = 0.5;
                }
            }

            const isAIOtherLadder = aiPhysicsOutput.isClimbing || aiPhysicsOutput.isLadderSliding || aiPhysicsOutput.isLadderHanging || aiPhysicsOutput.isLadderMounting;
            if (isAIOtherLadder) {
                const targetAngle = aiPhysicsOutput.ladderFaceAngle;
                let currentAngle = aiGroup.current.rotation.y;
                let diff = targetAngle - currentAngle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                aiGroup.current.rotation.y += diff * dt * 12;
            } else if (aiPhysicsOutput.pMoving && !aiPhysicsOutput.effectiveStunned) {
                const targetAngle = Math.atan2(aiPhysicsOutput.pDir.x, aiPhysicsOutput.pDir.z);
                let currentAngle = aiGroup.current.rotation.y;
                let diff = targetAngle - currentAngle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                aiGroup.current.rotation.y += diff * dt * 15;
            }
        }

        const aiDx = aiPos.current.x - prevAIPos.current.x;
        const aiDz = aiPos.current.z - prevAIPos.current.z;
        const aiRawMoveSpeed = dt > 0 ? Math.sqrt(aiDx * aiDx + aiDz * aiDz) / dt : 0;
        aiSmoothedMoveSpeed.current = THREE.MathUtils.lerp(aiSmoothedMoveSpeed.current, aiRawMoveSpeed, dt * 10);
        prevAIPos.current.copy(aiPos.current);

        if (aiStunTimer.current > 0) {
            currentMode = AIMode.ATORDUADO;
        }

        setAiVisualState({
            isCharging: aiPhysicsOutput.isCharging,
            isRolling: aiPhysicsOutput.isRolling,
            isGrounded: aiPhysicsOutput.isGrounded,
            isRunning: aiPhysicsOutput.isRunning,
            isMoving: aiPhysicsOutput.pMoving,
            moveSpeed: aiSmoothedMoveSpeed.current,
            isStumbling: aiPhysicsOutput.isStumbling,
            stunned: aiPhysicsOutput.effectiveStunned,
            landingFactor: aiPhysicsOutput.landingFactor,
            currentSurface: 0,
            fallDistance: aiPhysicsOutput.fallDistance,
            justLanded: aiPhysicsOutput.justLanded,
            isClimbing: aiPhysicsOutput.isClimbing,
            isLadderSliding: aiPhysicsOutput.isLadderSliding,
            isNearLadder: aiPhysicsOutput.isNearLadder,
            isLadderHanging: aiPhysicsOutput.isLadderHanging,
            isLadderMounting: aiPhysicsOutput.isLadderMounting,
            ladderFaceAngle: aiPhysicsOutput.ladderFaceAngle,
            isWallClimbing: aiLadderState.current.isWallClimbing,
            wallClimbProgress: aiLadderState.current.wallClimbProgress,
            isHiding: aiIsHiding.current,
            isSearching: isAISearching.current,
            stamina: aiStamina.current,
            aiMode: currentMode
        });

        aiWasVisible.current = isVisible;

        if (aiCatchTriggered && onRoundEnd) {
            onRoundEnd(match.playerRole === 'SEEKER');
        }

        return { aiCatchTriggered };
    };

    return {
        // Refs needed in JSX or parent logic
        aiPos,
        aiVel,
        aiGroup,
        aiPath,
        aiStunTimer,
        aiRollTimer,
        aiStamina,
        losLineRef,
        lastKnownMarkerRef,
        pathLineRef,
        // State
        aiVisualState,
        // Methods
        resetAI,
        updateAI,
        checkFallSafety
    };
};
