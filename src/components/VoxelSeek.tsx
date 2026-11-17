import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  GameStatus,
  VoxelObject,
  GameSettings,
  GameMode,
  MatchState,
  LadderState,
  VisualState,
} from '../types';
import { Character } from './Character';
import { useControls } from '../hooks/useControls';
import { generateCityLevel, findSpawnPos } from '../utils/levelGen';
import { updatePlayerPhysics } from '../utils/player';
import {
  worldToIndex,
  SpatialHashGrid,
  CollisionBox,
  segmentIntersectsAABB3D,
  CLIMB_THRESHOLD,
} from '../utils/physics';
import { NavigationGraph, LadderZone } from '../utils/navigation';
import {
  AIContext,
  AIWaypoint,
  WhiskerHit,
  buildWaypointsFromNavPath,
  getRandomWaypoint,
  resetAIStateForRound,
  syncAIVisualsAndGaze,
  updateAIDecisionAndInput,
} from '../utils/aiController';
import { VoxelGround } from './environment/VoxelGround';
import { VoxelWater } from './environment/VoxelWater';
import { WheatField } from './environment/WheatField';
import { VoxelRuins, VoxelFences, VoxelFoliage } from './environment/VoxelInstancedProps';
import { Building } from './buildings/Building';
import { CollisionDebug, VisionPointsDebug, AIDebugVisualizer } from './debug/SceneDebuggers';
import { SoundDirectionIndicator } from './SoundDirectionIndicator';

interface GeneratedMapData {
  objects: VoxelObject[];
  collisionGrid: SpatialHashGrid;
  bGrid: number[][];
  wGrid: number[][];
  sGrid: number[][];
  tGrid: number[][];
  spawnPos: THREE.Vector3;
  ladderZones: LadderZone[];
  riverOrientation: number;
  riverFlow: number;
  worldSize: number;
}

declare global {
  interface Window {
    __PARKUBES_MAP_DATA?: GeneratedMapData;
    __PARKUBES_PLAYER_POS?: React.MutableRefObject<THREE.Vector3>;
    __PARKUBES_AI_POS?: React.MutableRefObject<THREE.Vector3>;
    __PARKUBES_AI_PATH?: React.MutableRefObject<AIWaypoint[]>;
    __PARKUBES_AI_PATH_INDEX?: React.MutableRefObject<number>;
    __PARKUBES_AI_LAST_KNOWN?: React.MutableRefObject<THREE.Vector3>;
    __PARKUBES_AI_HAS_LAST_KNOWN?: React.MutableRefObject<boolean>;
    __PARKUBES_AI_HIDING_SPOT?: React.MutableRefObject<THREE.Vector3>;
    __PARKUBES_NAV_GRAPH?: NavigationGraph;
  }
}

interface VoxelSeekProps {
  status: GameStatus;
  mode: GameMode;
  match: MatchState;
  settings: GameSettings;
  onRoundEnd: (playerWon: boolean) => void;
  onPrepComplete: () => void;
  debugMode?: boolean;
  godMode?: boolean;
  showGrid?: boolean;
  showCollision?: boolean;
  showWireframe?: boolean;
  showOcclusion?: boolean;
  showAIPath?: boolean;
  alwaysShowAI?: boolean;
  addDestinationMode?: boolean;
  isEditing?: boolean;
  mapId: number;
}

// Reusable scratch vectors for camera and occlusion ray checks
const IDLE_CAM_TARGET = new THREE.Vector3(0, 0, 0);
const IDLE_CAM_POS = new THREE.Vector3(100, 100, 100);
const scratchFollowTarget = new THREE.Vector3();
const scratchOccHead = new THREE.Vector3();
const scratchOccToPlayer = new THREE.Vector3();
const scratchOccPerp = new THREE.Vector3();
const scratchOccVelProj = new THREE.Vector3();
const scratchOccTargets = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
];
const dummyKeysRef = { current: {} };

const oppositeQuadrant = (q: number): 1 | 2 | 3 | 4 => {
  switch (q) {
    case 1:
      return 3;
    case 2:
      return 4;
    case 3:
      return 1;
    case 4:
      return 2;
    default:
      return 3;
  }
};

export const VoxelSeek: React.FC<VoxelSeekProps> = React.memo(
  (props) => {
    const {
      status,
      settings,
      onPrepComplete,
      debugMode,
      showGrid,
      showCollision,
      showWireframe,
      showOcclusion,
      showAIPath,
      alwaysShowAI = false,
      addDestinationMode = false,
      mapId,
    } = props;
    const { camera, controls } = useThree();
    const keys = useControls();

    const [aiEmoji, setAiEmoji] = useState('❓');
    const aiEmojiRef = useRef('❓');

    // Player Physics Refs
    const playerPos = useRef(new THREE.Vector3(0, 0, 0));
    const playerVel = useRef(new THREE.Vector3(0, 0, 0));
    const playerLastDir = useRef(new THREE.Vector2(0, 1));
    const isGrounded = useRef(false);
    const isCharging = useRef(false);
    const isRolling = useRef(false);
    const stamina = useRef(100);
    const stunTimer = useRef(0);
    const jumpDelayTimer = useRef(0);
    const airTimeHighPoint = useRef(0);
    const jumpPressedPrev = useRef(false);
    const rollTimer = useRef(0);
    const jumpBufferTimer = useRef(0);
    const stumbleTimer = useRef(0);
    const stumbleVelocity = useRef(new THREE.Vector3(0, 0, 0));
    const landingAnimTimer = useRef(0);
    const lastFallDist = useRef(0);
    const prevPlayerPos = useRef(new THREE.Vector3(0, 0, 0));
    const smoothedMoveSpeed = useRef(0);

    // AI Physics & Navigation Refs
    const aiPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiVel = useRef(new THREE.Vector3(0, 0, 0));
    const aiLastDir = useRef(new THREE.Vector2(0, 1));
    const aiIsGrounded = useRef(false);
    const aiIsCharging = useRef(false);
    const aiIsRolling = useRef(false);
    const aiStamina = useRef(100);
    const aiIsExhausted = useRef(false);
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
    const aiPrevPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiSmoothedMoveSpeed = useRef(0);
    const aiStuckTimer = useRef(0);
    const aiWaypointTimer = useRef(0);
    const aiLateralDetourDir = useRef(new THREE.Vector3(0, 0, 0));
    const aiLateralDetourTimer = useRef(0);
    const aiLongStuckTimer = useRef(0);
    const aiLongStuckPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiLastProgressPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiLastRouteSig = useRef<string>('');
    const aiRouteRepeatCount = useRef<number>(0);
    const aiAvoidNodeIds = useRef<Set<string>>(new Set());
    const aiSearchLookTimer = useRef(0);
    const aiWhiskerCenterHit = useRef<WhiskerHit | null>(null);
    const aiWhiskerLeftHit = useRef<WhiskerHit | null>(null);
    const aiWhiskerRightHit = useRef<WhiskerHit | null>(null);
    const aiWhiskerCenterDir = useRef(new THREE.Vector3(0, 0, 1));
    const aiWhiskerLeftDir = useRef(new THREE.Vector3(0, 0, 1));
    const aiWhiskerRightDir = useRef(new THREE.Vector3(0, 0, 1));
    const aiWhiskerCenterLen = useRef(2.5);
    const aiWhiskerSideLen = useRef(1.5);

    const aiLadderState = useRef<LadderState>({
      isClimbing: false,
      isLadderSliding: false,
      isLadderHanging: false,
      isLadderMounting: false,
      ladderMountTimer: 0,
      isWallClimbing: false,
      wallClimbProgress: 0,
      wallClimbDir: new THREE.Vector2(0, 0),
    });
    const aiLadderStuckTimer = useRef(0);
    const aiPrevLadderY = useRef(0);

    const aiCharacterGroup = useRef<THREE.Group>(null!);
    const aiStaminaGroup = useRef<HTMLDivElement>(null!);
    const aiStaminaFill = useRef<HTMLDivElement>(null!);

    const aiHidingSpot = useRef(new THREE.Vector3(0, 0, 0));
    const aiTargetPosRef = useRef(new THREE.Vector3(0, 0, 0));
    const aiLastKnownPlayerPos = useRef(new THREE.Vector3(0, 0, 0));
    const aiPlayerLastVel = useRef(new THREE.Vector3(0, 0, 0));
    const aiLastKnownPlayerDir = useRef(new THREE.Vector3(0, 0, 0));
    const aiHasLastKnownPlayerPos = useRef(false);
    const aiHeardEmojiTimer = useRef(0);
    const aiLocalSearchCount = useRef(0);
    const aiSearchedSpotIds = useRef<Set<string>>(new Set());
    const aiWanderTarget = useRef(new THREE.Vector3(0, 0, 0));
    const aiFleeTimer = useRef(0);
    const aiWanderTargetTimer = useRef(0);
    const aiVisitedQuadrants = useRef<Set<number>>(new Set());
    const aiSearchTimer = useRef(0);
    const aiWasPursuingPlayer = useRef(false);
    const playerLookAtTarget = useRef<THREE.Vector3 | null>(null);
    const aiLookAtTarget = useRef<THREE.Vector3 | null>(null);
    const aiNoiseLevelRef = useRef(0);
    const playerSeesAiRef = useRef(false);
    const playerStillTimer = useRef(0);
    const aiStillTimer = useRef(0);
    const isCustomDestination = useRef(false);

    const aiPath = useRef<AIWaypoint[]>([]);
    const aiPathIndex = useRef<number>(0);
    const aiPathRecalcTimer = useRef<number>(0);
    const aiLastPathTarget = useRef<THREE.Vector3>(new THREE.Vector3(Infinity, Infinity, Infinity));

    const aiVisualStateRef = useRef<Partial<VisualState>>({
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
      isHiding: false,
      isClimbing: false,
      isLadderSliding: false,
      isNearLadder: false,
      isLadderHanging: false,
      isLadderMounting: false,
      ladderFaceAngle: 0,
      isWallClimbing: false,
      wallClimbProgress: 0,
    });

    const aiContext = useMemo<AIContext>(
      () => ({
        pos: aiPos,
        vel: aiVel,
        lastDir: aiLastDir,
        isGrounded: aiIsGrounded,
        isCharging: aiIsCharging,
        isRolling: aiIsRolling,
        stamina: aiStamina,
        isExhausted: aiIsExhausted,
        stunTimer: aiStunTimer,
        jumpDelayTimer: aiJumpDelayTimer,
        airTimeHighPoint: aiAirTimeHighPoint,
        jumpPressedPrev: aiJumpPressedPrev,
        rollTimer: aiRollTimer,
        jumpBufferTimer: aiJumpBufferTimer,
        stumbleTimer: aiStumbleTimer,
        stumbleVelocity: aiStumbleVelocity,
        landingAnimTimer: aiLandingAnimTimer,
        lastFallDist: aiLastFallDist,
        prevPos: aiPrevPos,
        smoothedMoveSpeed: aiSmoothedMoveSpeed,
        ladderState: aiLadderState,
        noiseLevelRef: aiNoiseLevelRef,
        path: aiPath,
        pathIndex: aiPathIndex,
        pathRecalcTimer: aiPathRecalcTimer,
        lastPathTarget: aiLastPathTarget,
        hidingSpot: aiHidingSpot,
        targetPosRef: aiTargetPosRef,
        lastKnownPlayerPos: aiLastKnownPlayerPos,
        playerLastVel: aiPlayerLastVel,
        lastKnownPlayerDir: aiLastKnownPlayerDir,
        hasLastKnownPlayerPos: aiHasLastKnownPlayerPos,
        heardEmojiTimer: aiHeardEmojiTimer,
        localSearchCount: aiLocalSearchCount,
        searchedSpotIds: aiSearchedSpotIds,
        wanderTarget: aiWanderTarget,
        wanderTargetTimer: aiWanderTargetTimer,
        visitedQuadrants: aiVisitedQuadrants,
        searchTimer: aiSearchTimer,
        fleeTimer: aiFleeTimer,
        wasPursuingPlayer: aiWasPursuingPlayer,
        isCustomDestination,
        stillTimer: aiStillTimer,
        searchLookTimer: aiSearchLookTimer,
        stuckTimer: aiStuckTimer,
        waypointTimer: aiWaypointTimer,
        lateralDetourDir: aiLateralDetourDir,
        lateralDetourTimer: aiLateralDetourTimer,
        longStuckTimer: aiLongStuckTimer,
        longStuckPos: aiLongStuckPos,
        lastProgressPos: aiLastProgressPos,
        lastRouteSig: aiLastRouteSig,
        routeRepeatCount: aiRouteRepeatCount,
        avoidNodeIds: aiAvoidNodeIds,
        ladderStuckTimer: aiLadderStuckTimer,
        prevLadderY: aiPrevLadderY,
        whiskerCenterHit: aiWhiskerCenterHit,
        whiskerLeftHit: aiWhiskerLeftHit,
        whiskerRightHit: aiWhiskerRightHit,
        whiskerCenterDir: aiWhiskerCenterDir,
        whiskerLeftDir: aiWhiskerLeftDir,
        whiskerRightDir: aiWhiskerRightDir,
        whiskerCenterLen: aiWhiskerCenterLen,
        whiskerSideLen: aiWhiskerSideLen,
        visualStateRef: aiVisualStateRef,
        lookAtTarget: aiLookAtTarget,
        emojiRef: aiEmojiRef,
      }),
      [],
    );

    const occludedBuildingIdsRef = useRef<Set<string>>(new Set());
    const buildingsGroupRef = useRef<THREE.Group>(null);
    const characterGroup = useRef<THREE.Group>(null!);
    const staminaGroup = useRef<HTMLDivElement>(null!);
    const staminaFill = useRef<HTMLDivElement>(null!);

    const [mapData, setMapData] = useState<GeneratedMapData | null>(null);

    const visualStateRef = useRef<Partial<VisualState>>({
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
      isHiding: false,
      isClimbing: false,
      isLadderSliding: false,
      isNearLadder: false,
      isLadderHanging: false,
      isLadderMounting: false,
      ladderFaceAngle: 0,
      isWallClimbing: false,
      wallClimbProgress: 0,
    });

    // Initialization & Map Regeneration
    useEffect(() => {
      const timeout = setTimeout(() => {
        const spawn = new THREE.Vector2(0, 0);
        const data = generateCityLevel(spawn, settings, mapId);
        setMapData(data);

        window.__PARKUBES_MAP_DATA = data;
        window.__PARKUBES_PLAYER_POS = playerPos;
        window.__PARKUBES_AI_POS = aiPos;
        window.__PARKUBES_AI_PATH = aiPath;
        window.__PARKUBES_AI_PATH_INDEX = aiPathIndex;
        window.__PARKUBES_AI_LAST_KNOWN = aiLastKnownPlayerPos;
        window.__PARKUBES_AI_HAS_LAST_KNOWN = aiHasLastKnownPlayerPos;
        window.__PARKUBES_AI_HIDING_SPOT = aiHidingSpot;

        playerPos.current.copy(data.spawnPos);
        prevPlayerPos.current.copy(data.spawnPos);
        playerVel.current.set(0, 0, 0);
        isGrounded.current = true;
        airTimeHighPoint.current = data.spawnPos.y;
        stamina.current = 100;
        stunTimer.current = 0;
      }, 150);

      return () => clearTimeout(timeout);
    }, [settings, mapId]);

    const navGraph = useMemo(() => {
      if (!mapData) return null;
      const g = new NavigationGraph(mapData);
      window.__PARKUBES_NAV_GRAPH = g;
      return g;
    }, [mapData]);

    // Precompute exact building AABBs for fast zero-allocation occlusion checks
    const buildingOcclusionBoxes = useMemo(() => {
      if (!mapData) return [];
      const boxes: { id: string; box: CollisionBox }[] = [];
      for (const obj of mapData.objects) {
        if (
          obj.type === 'ruin' ||
          obj.type === 'fence' ||
          obj.type === 'wheat' ||
          obj.type === 'foliage'
        ) {
          continue;
        }
        const [w, h, d] = obj.scale;
        const [posX, posY, posZ] = obj.position;
        const botY = posY - h / 2;
        const topY = posY + h / 2 + 0.3;

        if (obj.shape?.active && obj.shape.mask) {
          const { mask } = obj.shape;
          const mWidth = mask.length;
          const mDepth = mask[0].length;
          const startX = posX - w / 2;
          const startZ = posZ - d / 2;

          for (let i = 0; i < mWidth; i++) {
            let j = 0;
            while (j < mDepth) {
              if (mask[i][j]) {
                let runLength = 1;
                while (j + runLength < mDepth && mask[i][j + runLength]) {
                  runLength++;
                }
                boxes.push({
                  id: obj.id,
                  box: {
                    minX: startX + i,
                    minY: botY,
                    minZ: startZ + j,
                    maxX: startX + i + 1,
                    maxY: topY,
                    maxZ: startZ + j + runLength,
                  },
                });
                j += runLength;
              } else {
                j++;
              }
            }
          }
        } else {
          boxes.push({
            id: obj.id,
            box: {
              minX: posX - w / 2,
              minY: botY,
              minZ: posZ - d / 2,
              maxX: posX + w / 2,
              maxY: topY,
              maxZ: posZ + d / 2,
            },
          });
        }
      }
      return boxes;
    }, [mapData]);

    const fitCameraToMap = React.useCallback(() => {
      if (!camera || !(camera instanceof THREE.OrthographicCamera)) return;
      const halfSize = settings.worldSize / 2;
      const maxH = 20;

      camera.position.set(100, 100, 100);
      camera.lookAt(0, 0, 0);
      if (controls) {
        const ctrl = controls as unknown as {
          target: THREE.Vector3;
          update: () => void;
          reset?: () => void;
        };
        if (ctrl.reset) ctrl.reset();
        if (ctrl.target) ctrl.target.set(0, 0, 0);
        if (ctrl.update) ctrl.update();
      }
      camera.updateMatrixWorld(true);

      const corners = [
        new THREE.Vector3(-halfSize, 0, -halfSize),
        new THREE.Vector3(halfSize, 0, -halfSize),
        new THREE.Vector3(-halfSize, 0, halfSize),
        new THREE.Vector3(halfSize, 0, halfSize),
        new THREE.Vector3(-halfSize, maxH, -halfSize),
        new THREE.Vector3(halfSize, maxH, -halfSize),
        new THREE.Vector3(-halfSize, maxH, halfSize),
        new THREE.Vector3(halfSize, maxH, halfSize),
      ];

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const viewMatrix = camera.matrixWorldInverse;

      corners.forEach((corner) => {
        const v = corner.clone().applyMatrix4(viewMatrix);
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      });

      const mapWidth3D = maxX - minX;
      const mapHeight3D = maxY - minY;
      const frustumWidth = camera.right - camera.left;
      const frustumHeight = camera.top - camera.bottom;

      if (frustumWidth > 0 && frustumHeight > 0 && mapWidth3D > 0 && mapHeight3D > 0) {
        const zoomX = frustumWidth / mapWidth3D;
        const zoomY = frustumHeight / mapHeight3D;
        camera.zoom = Math.min(zoomX, zoomY) * 0.9;
        camera.updateProjectionMatrix();
      }
    }, [camera, controls, settings.worldSize]);

    // Handle Match Start or Respawn (PREP status)
    useEffect(() => {
      if (status === GameStatus.PREP && mapData) {
        if (props.mode === GameMode.HIDE_AND_SEEK) {
          const pQuad = (Math.floor(Math.random() * 4) + 1) as 1 | 2 | 3 | 4;
          const aiQuad = oppositeQuadrant(pQuad);
          const worldSize = mapData.worldSize;
          const halfSize = Math.floor(worldSize / 2);

          const isWaterLogic = (lx: number, lz: number) => {
            const startX = worldToIndex(lx, halfSize, worldSize);
            const startZ = worldToIndex(lz, halfSize, worldSize);
            return mapData.wGrid[startX]?.[startZ] === 1;
          };

          const pSpawn = findSpawnPos(
            worldSize,
            halfSize,
            mapData.tGrid,
            mapData.collisionGrid,
            mapData.wGrid,
            isWaterLogic,
            pQuad,
          );
          const aiSpawn = findSpawnPos(
            worldSize,
            halfSize,
            mapData.tGrid,
            mapData.collisionGrid,
            mapData.wGrid,
            isWaterLogic,
            aiQuad,
          );

          playerPos.current.copy(pSpawn);
          prevPlayerPos.current.copy(pSpawn);
          playerVel.current.set(0, 0, 0);
          isGrounded.current = true;
          airTimeHighPoint.current = pSpawn.y;
          stamina.current = 100;
          stunTimer.current = 0;

          resetAIStateForRound(aiContext, aiSpawn, navGraph);
        } else {
          playerPos.current.copy(mapData.spawnPos);
          prevPlayerPos.current.copy(mapData.spawnPos);
          playerVel.current.set(0, 0, 0);
          isGrounded.current = true;
          airTimeHighPoint.current = mapData.spawnPos.y;
          stamina.current = 100;
          stunTimer.current = 0;

          if (navGraph) {
            const aiSpawn = getRandomWaypoint(mapData.spawnPos, navGraph, 15.0);
            if (aiSpawn.lengthSq() > 0.1) {
              resetAIStateForRound(aiContext, aiSpawn, navGraph);
            }
          }
        }

        fitCameraToMap();

        if (props.mode === GameMode.FREE) {
          onPrepComplete();
        }
      }
    }, [
      status,
      mapData,
      props.mode,
      props.match.currentRound,
      onPrepComplete,
      fitCameraToMap,
      navGraph,
      aiContext,
    ]);

    // Handle Camera Fitting on App Load (IDLE), Prep Phase & Window Resize
    useEffect(() => {
      if (mapData && !settings.cameraFollow && (status === GameStatus.IDLE || status === GameStatus.PREP)) {
        fitCameraToMap();
      }

      const handleResize = () => {
        if (!settings.cameraFollow && (status === GameStatus.IDLE || status === GameStatus.PREP)) {
          fitCameraToMap();
        }
      };

      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [fitCameraToMap, settings.cameraFollow, status, mapData]);

    // Listen to DevTools AI Waypath actions
    useEffect(() => {
      const handleClearPath = () => {
        if (navGraph && mapData) {
          const newRandomTarget = getRandomWaypoint(aiPos.current, navGraph, 10.0);
          if (newRandomTarget.lengthSq() > 0.1) {
            aiHidingSpot.current.copy(newRandomTarget);
            aiTargetPosRef.current.copy(newRandomTarget);
            const computedPath = navGraph.findPath(aiPos.current, newRandomTarget);
            if (computedPath && computedPath.length > 0) {
              const smoothed = navGraph.smoothPath(computedPath, mapData.collisionGrid);
              aiPath.current = buildWaypointsFromNavPath(smoothed, navGraph);
              aiPathIndex.current = 0;
              aiLastPathTarget.current.copy(newRandomTarget);
            } else {
              aiPath.current = [];
              aiPathIndex.current = 0;
              aiLastPathTarget.current.set(-9999, -9999, -9999);
            }
          }
        } else {
          aiPath.current = [];
          aiPathIndex.current = 0;
          aiLastPathTarget.current.set(-9999, -9999, -9999);
        }
        aiPathRecalcTimer.current = 0;
        aiWaypointTimer.current = 0;
        aiStuckTimer.current = 0;
      };

      const handleRemoveNextNode = () => {
        if (aiPath.current.length > 0) {
          if (aiPathIndex.current < aiPath.current.length - 1) {
            aiPathIndex.current++;
          } else {
            aiPath.current = [];
            aiPathIndex.current = 0;
          }
          aiWaypointTimer.current = 0;
          aiStuckTimer.current = 0;
        }
      };

      window.addEventListener('ai-clear-path', handleClearPath);
      window.addEventListener('ai-remove-next-node', handleRemoveNextNode);

      return () => {
        window.removeEventListener('ai-clear-path', handleClearPath);
        window.removeEventListener('ai-remove-next-node', handleRemoveNextNode);
      };
    }, [navGraph, mapData]);

    useFrame((_state, delta) => {
      if (!mapData) return;
      const dt = Math.min(delta, 0.1);
      const isPlayerSeeker =
        props.mode === GameMode.HIDE_AND_SEEK && props.match.currentRound % 2 === 0;
      const playerIsFrozen = status === GameStatus.PREP && isPlayerSeeker;
      const finalPlayerCanMove =
        (status === GameStatus.PLAYING || status === GameStatus.PREP) && !playerIsFrozen;

      const physicsOutput = updatePlayerPhysics(
        dt,
        playerPos.current,
        playerVel.current,
        isGrounded,
        isCharging,
        landingAnimTimer,
        jumpDelayTimer,
        airTimeHighPoint,
        stamina,
        stunTimer,
        stunTimer.current > 0,
        keys,
        playerLastDir,
        jumpPressedPrev,
        settings.playerSpeed,
        mapData.collisionGrid,
        mapData.bGrid,
        mapData.wGrid,
        settings.worldSize,
        finalPlayerCanMove,
        rollTimer,
        jumpBufferTimer,
        isRolling,
        stumbleTimer,
        stumbleVelocity,
        camera,
        lastFallDist,
        mapData.riverOrientation ?? -1,
        settings.riverFlow,
        mapData.ladderZones ?? [],
      );

      // Update Player Character Transform
      if (characterGroup.current) {
        characterGroup.current.position.copy(playerPos.current);

        const isOnLadder =
          physicsOutput.isClimbing ||
          physicsOutput.isLadderSliding ||
          physicsOutput.isLadderHanging ||
          physicsOutput.isLadderMounting;
        if (isOnLadder) {
          const targetAngle = physicsOutput.ladderFaceAngle;
          const currentAngle = characterGroup.current.rotation.y;
          const diff = Math.atan2(
            Math.sin(targetAngle - currentAngle),
            Math.cos(targetAngle - currentAngle),
          );
          characterGroup.current.rotation.y += diff * dt * 12;
        } else if (physicsOutput.pMoving && !physicsOutput.effectiveStunned) {
          const targetAngle = Math.atan2(physicsOutput.pDir.x, physicsOutput.pDir.z);
          const currentAngle = characterGroup.current.rotation.y;
          const diff = Math.atan2(
            Math.sin(targetAngle - currentAngle),
            Math.cos(targetAngle - currentAngle),
          );
          characterGroup.current.rotation.y += diff * dt * 15;
        }
      }

      // --- AI DECISION, PATHING & PHYSICS ---
      const decision = updateAIDecisionAndInput(aiContext, {
        dt,
        status,
        mode: props.mode,
        currentRound: props.match.currentRound,
        worldSize: settings.worldSize,
        addDestinationMode,
        playerPos: playerPos.current,
        playerVel: playerVel.current,
        playerNoiseLevel: physicsOutput.noiseLevel ?? 0,
        collisionGrid: mapData.collisionGrid,
        bGrid: mapData.bGrid,
        wGrid: mapData.wGrid,
        ladderZones: mapData.ladderZones ?? [],
        navGraph,
        onEmojiChange: setAiEmoji,
      });

      const aiPhysicsOutput = updatePlayerPhysics(
        dt,
        aiPos.current,
        aiVel.current,
        aiIsGrounded,
        aiIsCharging,
        aiLandingAnimTimer,
        aiJumpDelayTimer,
        aiAirTimeHighPoint,
        aiStamina,
        aiStunTimer,
        aiStunTimer.current > 0,
        dummyKeysRef,
        aiLastDir,
        aiJumpPressedPrev,
        settings.playerSpeed,
        mapData.collisionGrid,
        mapData.bGrid,
        mapData.wGrid,
        settings.worldSize,
        decision.aiCanMove,
        aiRollTimer,
        aiJumpBufferTimer,
        aiIsRolling,
        aiStumbleTimer,
        aiStumbleVelocity,
        camera,
        aiLastFallDist,
        mapData.riverOrientation ?? -1,
        settings.riverFlow,
        mapData.ladderZones ?? [],
        decision.aiInput,
        aiLadderState,
      );

      aiNoiseLevelRef.current = aiPhysicsOutput.noiseLevel ?? 0;

      if (aiCharacterGroup.current) {
        aiCharacterGroup.current.position.copy(aiPos.current);
        const isOnLadder =
          aiPhysicsOutput.isClimbing ||
          aiPhysicsOutput.isLadderSliding ||
          aiPhysicsOutput.isLadderHanging ||
          aiPhysicsOutput.isLadderMounting;
        if (isOnLadder) {
          const targetAngle = aiPhysicsOutput.ladderFaceAngle;
          const currentAngle = aiCharacterGroup.current.rotation.y;
          const diff = Math.atan2(
            Math.sin(targetAngle - currentAngle),
            Math.cos(targetAngle - currentAngle),
          );
          aiCharacterGroup.current.rotation.y += diff * dt * 12;
        } else if (
          (aiPhysicsOutput.pMoving || aiSearchLookTimer.current > 0) &&
          !aiPhysicsOutput.effectiveStunned
        ) {
          const targetAngle = Math.atan2(aiPhysicsOutput.pDir.x, aiPhysicsOutput.pDir.z);
          const currentAngle = aiCharacterGroup.current.rotation.y;
          const diff = Math.atan2(
            Math.sin(targetAngle - currentAngle),
            Math.cos(targetAngle - currentAngle),
          );
          aiCharacterGroup.current.rotation.y += diff * dt * 10;
        }
      }

      syncAIVisualsAndGaze(
        aiContext,
        aiPhysicsOutput,
        decision.aiInput,
        decision.aiHasVisualContact,
        decision.aiHasHeardNoise,
        decision.isAISeeker,
        {
          dt,
          status,
          mode: props.mode,
          worldSize: settings.worldSize,
          sGrid: mapData.sGrid,
          playerPos: playerPos.current,
          collisionGrid: mapData.collisionGrid,
          alwaysShowAI,
          aiCharacterGroup: aiCharacterGroup.current,
          aiStaminaFill: aiStaminaFill.current,
          aiStaminaGroup: aiStaminaGroup.current,
          playerLookAtTarget,
          playerSeesAiRef,
          onEmojiChange: setAiEmoji,
        },
      );

      // Catch Collision Check
      if (
        status === GameStatus.PLAYING &&
        props.mode === GameMode.HIDE_AND_SEEK &&
        !props.godMode &&
        !props.debugMode
      ) {
        const dist = playerPos.current.distanceTo(aiPos.current);
        if (dist < 1.8) {
          const isPlayerCatcher = props.match.currentRound % 2 === 0;
          props.onRoundEnd(isPlayerCatcher);
        }
      }

      // Update Player Stamina Bar
      if (staminaFill.current && staminaGroup.current) {
        const s = Math.max(0, stamina.current / 100);
        staminaFill.current.style.width = `${s * 100}%`;

        if (physicsOutput.effectiveStunned) {
          staminaFill.current.style.backgroundColor = '#9ca3af';
        } else {
          const hue = s * 120;
          staminaFill.current.style.backgroundColor = `hsl(${hue}, 100%, 50%)`;
        }

        staminaGroup.current.style.display = s < 0.99 ? 'block' : 'none';
      }

      // Determine Player Surface
      let currentSurface = 0;
      const halfSize = Math.floor(settings.worldSize / 2);
      const ix = worldToIndex(playerPos.current.x, halfSize, settings.worldSize);
      const iz = worldToIndex(playerPos.current.z, halfSize, settings.worldSize);
      if (mapData.sGrid[ix]?.[iz] !== undefined) {
        currentSurface = mapData.sGrid[ix][iz];
      }

      const dx = playerPos.current.x - prevPlayerPos.current.x;
      const dz = playerPos.current.z - prevPlayerPos.current.z;
      const rawMoveSpeed = dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
      smoothedMoveSpeed.current = THREE.MathUtils.lerp(
        smoothedMoveSpeed.current,
        rawMoveSpeed,
        dt * 10,
      );
      prevPlayerPos.current.copy(playerPos.current);

      const isPlayerHider =
        props.mode === GameMode.HIDE_AND_SEEK && props.match.currentRound % 2 !== 0;
      const isPlayerMoving = physicsOutput.pMoving || rawMoveSpeed > 0.15;
      const isPlayerStandingStill =
        !isPlayerMoving &&
        physicsOutput.isGrounded &&
        !physicsOutput.effectiveStunned &&
        !physicsOutput.isRolling &&
        !physicsOutput.isClimbing &&
        !physicsOutput.isLadderSliding &&
        !physicsOutput.isWallClimbing &&
        !physicsOutput.isCharging;

      if (isPlayerHider && isPlayerStandingStill) {
        playerStillTimer.current += dt;
      } else {
        playerStillTimer.current = 0;
      }
      const isHiding = isPlayerHider && playerStillTimer.current >= 2.0;

      // Sync Player Visual State in-place (zero allocation per frame)
      const vs = visualStateRef.current;
      vs.isCharging = physicsOutput.isCharging;
      vs.isRolling = physicsOutput.isRolling;
      vs.isGrounded = physicsOutput.isGrounded;
      vs.isRunning = physicsOutput.isRunning;
      vs.isStumbling = physicsOutput.isStumbling;
      vs.stunned = physicsOutput.effectiveStunned;
      vs.isMoving = physicsOutput.pMoving;
      vs.moveSpeed = smoothedMoveSpeed.current;
      vs.landingFactor = physicsOutput.landingFactor;
      vs.currentSurface = currentSurface;
      vs.fallDistance = physicsOutput.fallDistance;
      vs.justLanded = physicsOutput.justLanded;
      vs.isHiding = isHiding;
      vs.isClimbing = physicsOutput.isClimbing;
      vs.isLadderSliding = physicsOutput.isLadderSliding;
      vs.isNearLadder = physicsOutput.isNearLadder;
      vs.isLadderHanging = physicsOutput.isLadderHanging;
      vs.isLadderMounting = physicsOutput.isLadderMounting;
      vs.ladderFaceAngle = physicsOutput.ladderFaceAngle;
      vs.isWallClimbing = physicsOutput.isWallClimbing;
      vs.wallClimbProgress = physicsOutput.wallClimbProgress;

      // Camera Handling (zero allocation)
      if (status === GameStatus.IDLE) {
        camera.position.lerp(IDLE_CAM_POS, dt * 2);
        if (controls) {
          const ctrl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
          if (ctrl) {
            ctrl.target.lerp(IDLE_CAM_TARGET, dt * 5);
            ctrl.update();
          }
        }
      } else if (settings.cameraFollow) {
        const ctrl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
        if (ctrl) {
          scratchFollowTarget.copy(playerPos.current);
          ctrl.target.lerp(scratchFollowTarget, dt * 3.0);
          ctrl.update();
        }
      }

      // Fall safety
      if (finalPlayerCanMove && status === GameStatus.PLAYING && playerPos.current.y < -10) {
        playerPos.current.y = 100;
        playerVel.current.set(0, 0, 0);
      }

      // Fast Zero-Allocation Building Occlusion (AABB segment tests instead of recursive scene raycasting)
      const camPos = camera.position;
      scratchOccHead.copy(playerPos.current);
      scratchOccHead.y += 1.0;

      scratchOccToPlayer.subVectors(scratchOccHead, camPos);
      scratchOccToPlayer.y = 0;
      if (scratchOccToPlayer.lengthSq() > 1e-6) {
        scratchOccToPlayer.normalize();
      }
      scratchOccPerp.set(-scratchOccToPlayer.z, 0, scratchOccToPlayer.x);

      const sideBuffer = 0.6;
      scratchOccTargets[0].copy(scratchOccHead);
      scratchOccTargets[1].copy(scratchOccHead).addScaledVector(scratchOccPerp, sideBuffer);
      scratchOccTargets[2].copy(scratchOccHead).addScaledVector(scratchOccPerp, -sideBuffer);

      let targetCount = 3;
      if (playerVel.current.lengthSq() > 0.01) {
        scratchOccVelProj.copy(playerVel.current).multiplyScalar(0.3);
        if (scratchOccVelProj.lengthSq() > 3.24) {
          scratchOccVelProj.normalize().multiplyScalar(1.8);
        }
        scratchOccTargets[3].copy(scratchOccHead).add(scratchOccVelProj);
        targetCount = 4;
      }

      const occludedSet = occludedBuildingIdsRef.current;
      occludedSet.clear();
      for (let t = 0; t < targetCount; t++) {
        const tgt = scratchOccTargets[t];
        // Pull target slightly toward camera so player standing right against front wall doesn't falsely occlude
        const rx = camPos.x;
        const ry = camPos.y;
        const rz = camPos.z;
        const dxRay = tgt.x - rx;
        const dyRay = tgt.y - ry;
        const dzRay = tgt.z - rz;
        const rayLen = Math.hypot(dxRay, dyRay, dzRay);
        if (rayLen <= 0.25) continue;
        const scale = (rayLen - 0.2) / rayLen;
        const ex = rx + dxRay * scale;
        const ey = ry + dyRay * scale;
        const ez = rz + dzRay * scale;

        for (let b = 0; b < buildingOcclusionBoxes.length; b++) {
          const entry = buildingOcclusionBoxes[b];
          if (occludedSet.has(entry.id)) continue;
          if (segmentIntersectsAABB3D(rx, ry, rz, ex, ey, ez, entry.box, 0)) {
            occludedSet.add(entry.id);
          }
        }
      }
    });

    // Memoize Map Rendering
    const mapElements = useMemo(() => {
      if (!mapData) return null;

      const ruins = mapData.objects.filter((o) => o.type === 'ruin');
      const fences = mapData.objects.filter((o) => o.type === 'fence');
      const wheat = mapData.objects.filter((o) => o.type === 'wheat');
      const foliage = mapData.objects.filter((o) => o.type === 'foliage');
      const buildings = mapData.objects.filter(
        (o) =>
          o.type !== 'ruin' && o.type !== 'fence' && o.type !== 'wheat' && o.type !== 'foliage',
      );

      return (
        <>
          <VoxelGround
            size={mapData.worldSize}
            waterGrid={mapData.wGrid}
            sGrid={mapData.sGrid}
            debugMode={debugMode}
            showGrid={showGrid}
          />
          <VoxelWater
            size={mapData.worldSize}
            waterGrid={mapData.wGrid}
            riverOrientation={mapData.riverOrientation}
            riverFlow={settings.riverFlow}
          />
          <VoxelRuins ruins={ruins} showGrid={showGrid} />
          <VoxelFences fences={fences} />
          <VoxelFoliage objects={foliage} />
          <WheatField wheatObjects={wheat} playerPos={playerPos} />
          <group ref={buildingsGroupRef}>
            {buildings.map((obj) => (
              <Building
                key={obj.id}
                id={obj.id}
                occludedBuildingIdsRef={occludedBuildingIdsRef}
                position={obj.position}
                scale={obj.scale}
                color={obj.color}
                type={obj.type as 'box' | 'factory' | 'highrise'}
                chimney={obj.chimney}
                attachedChimneys={obj.attachedChimneys}
                acs={obj.acs}
                shape={obj.shape}
                windows={obj.windows}
                doors={obj.doors}
                ladders={obj.ladders}
                variant={obj.variant}
                showWireframe={showWireframe}
                showGrid={showGrid}
                status={status}
                debugMode={debugMode}
              />
            ))}
          </group>
        </>
      );
    }, [mapData, debugMode, showGrid, showWireframe, status, settings.riverFlow]);

    if (!mapData) return null;

    return (
      <group
        onPointerDown={(e) => {
          if (addDestinationMode && e.button === 0 && navGraph && e.point) {
            e.stopPropagation();
            const clickedPoint = e.point.clone();
            aiHidingSpot.current.copy(clickedPoint);
            aiTargetPosRef.current.copy(clickedPoint);
            isCustomDestination.current = true;

            if (
              Math.abs(aiPos.current.y - clickedPoint.y) <= CLIMB_THRESHOLD &&
              navGraph.isDirectWalkable(aiPos.current, clickedPoint, mapData.collisionGrid)
            ) {
              aiPath.current = [
                { id: 'direct_dest', x: clickedPoint.x, y: clickedPoint.y, z: clickedPoint.z, edgeType: 'walk' },
              ];
              aiPathIndex.current = 0;
              aiLastPathTarget.current.copy(clickedPoint);
            } else {
              const computedPath = navGraph.findPath(aiPos.current, clickedPoint);
              if (computedPath && computedPath.length > 0) {
                const smoothed = navGraph.smoothPath(computedPath, mapData.collisionGrid);
                const pathNodes: AIWaypoint[] = buildWaypointsFromNavPath(smoothed, navGraph);

                const lastNode = pathNodes[pathNodes.length - 1];
                if (
                  lastNode &&
                  Math.hypot(lastNode.x - clickedPoint.x, lastNode.z - clickedPoint.z) > 0.5 &&
                  navGraph.isDirectWalkable(lastNode, clickedPoint, mapData.collisionGrid)
                ) {
                  pathNodes.push({
                    id: 'clicked_target',
                    x: clickedPoint.x,
                    y: clickedPoint.y,
                    z: clickedPoint.z,
                    edgeType: 'walk',
                  });
                }

                aiPath.current = pathNodes;
                aiPathIndex.current = 0;
                aiLastPathTarget.current.copy(clickedPoint);
              } else {
                aiPath.current = [];
                aiPathIndex.current = 0;
                aiLastPathTarget.current.set(-9999, -9999, -9999);
              }
            }
            aiPathRecalcTimer.current = 0;
            aiWaypointTimer.current = 0;
            aiStuckTimer.current = 0;
          }
        }}
      >
        {mapElements}
        {mapData && (
          <>
            <CollisionDebug
              collisionGrid={mapData.collisionGrid}
              bGrid={mapData.bGrid}
              size={mapData.worldSize}
              visible={!!showCollision}
            />
            <VisionPointsDebug
              playerPos={playerPos}
              playerLastDir={playerLastDir}
              visible={!!showOcclusion}
            />
            <AIDebugVisualizer
              visible={!!showAIPath}
              aiPos={aiPos}
              aiPath={aiPath}
              aiPathIndex={aiPathIndex}
              aiTargetPos={aiTargetPosRef}
              aiLastKnownPlayerPos={aiLastKnownPlayerPos}
              aiLastKnownPlayerDir={aiLastKnownPlayerDir}
              aiHasLastKnownPlayerPos={aiHasLastKnownPlayerPos}
              aiWhiskerCenterHit={aiWhiskerCenterHit}
              aiWhiskerLeftHit={aiWhiskerLeftHit}
              aiWhiskerRightHit={aiWhiskerRightHit}
              aiWhiskerCenterDir={aiWhiskerCenterDir}
              aiWhiskerLeftDir={aiWhiskerLeftDir}
              aiWhiskerRightDir={aiWhiskerRightDir}
              aiWhiskerCenterLen={aiWhiskerCenterLen}
              aiWhiskerSideLen={aiWhiskerSideLen}
            />
          </>
        )}
        {status !== GameStatus.IDLE && (
          <Character
            groupRef={characterGroup}
            staminaFillRef={staminaFill}
            staminaGroupRef={staminaGroup}
            visualStateRef={visualStateRef}
            stunTimerRef={stunTimer}
            rollTimerRef={rollTimer}
            staminaRef={stamina}
            lookAtPosRef={playerLookAtTarget}
            color="#3b82f6"
            overlayContent={
              props.mode === GameMode.HIDE_AND_SEEK && status === GameStatus.PREP ? (
                <div className="bg-black/75 px-2 py-0.5 rounded text-white text-[10px] pixel-font border border-white/20 select-none uppercase tracking-wider">
                  {props.match.currentRound % 2 === 0 ? 'PEGADOR (VOCÊ)' : 'FUGITIVO (VOCÊ)'}
                </div>
              ) : null
            }
          />
        )}
        {status !== GameStatus.IDLE && (
          <SoundDirectionIndicator
            playerPos={playerPos}
            aiPos={aiPos}
            aiNoiseLevelRef={aiNoiseLevelRef}
            hasVisualContactRef={playerSeesAiRef}
          />
        )}
        {(props.mode === GameMode.HIDE_AND_SEEK ||
          addDestinationMode ||
          showAIPath ||
          isCustomDestination.current) &&
          status !== GameStatus.IDLE && (
            <Character
              groupRef={aiCharacterGroup}
              staminaFillRef={aiStaminaFill}
              staminaGroupRef={aiStaminaGroup}
              visualStateRef={aiVisualStateRef}
              stunTimerRef={aiStunTimer}
              rollTimerRef={aiRollTimer}
              staminaRef={aiStamina}
              lookAtPosRef={aiLookAtTarget}
              color="#ef4444"
              showXRay={alwaysShowAI}
              overlayContent={
                status === GameStatus.PREP ? (
                  <div className="bg-black/75 px-2 py-0.5 rounded text-white text-[10px] pixel-font border border-white/20 select-none uppercase tracking-wider">
                    {props.match.currentRound % 2 !== 0 ? 'PEGADOR (IA)' : 'FUGITIVO (IA)'}
                  </div>
                ) : status === GameStatus.PLAYING || props.mode === GameMode.FREE ? (
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className="text-2xl animate-bounce"
                      style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
                    >
                      {aiEmoji}
                    </div>
                  </div>
                ) : null
              }
            />
          )}
      </group>
    );
  },
  (prev, next) => {
    return (
      prev.status === next.status &&
      prev.mode === next.mode &&
      prev.match === next.match &&
      prev.settings === next.settings &&
      prev.mapId === next.mapId &&
      prev.godMode === next.godMode &&
      prev.debugMode === next.debugMode &&
      prev.showGrid === next.showGrid &&
      prev.showCollision === next.showCollision &&
      prev.showWireframe === next.showWireframe &&
      prev.showOcclusion === next.showOcclusion &&
      prev.showAIPath === next.showAIPath &&
      prev.alwaysShowAI === next.alwaysShowAI &&
      prev.addDestinationMode === next.addDestinationMode &&
      prev.isEditing === next.isEditing
    );
  },
);
