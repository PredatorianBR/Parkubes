import * as THREE from 'three';

export interface LadderState {
  isClimbing: boolean;
  isLadderSliding: boolean;
  isLadderHanging: boolean;
  isLadderMounting: boolean;
  ladderMountTimer: number;
  isWallClimbing: boolean;
  wallClimbProgress: number;
  wallClimbDir: THREE.Vector2;
}

export type Position = [number, number, number];

export enum GameStatus {
  IDLE = 'IDLE',
  PREP = 'PREP',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  ROUND_OVER = 'ROUND_OVER',
  GAME_OVER = 'GAME_OVER',
}

export enum GameMode {
  FREE = 'FREE',
  HIDE_AND_SEEK = 'HIDE_AND_SEEK',
}

export interface PhysicsState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  lastDir: THREE.Vector2; // X, Z
  stamina: number;
  isGrounded: boolean;
  isRolling: boolean;
  stumbleVel: THREE.Vector3;
  noiseLevel: number;
  didStepUp?: boolean;
  isClimbing?: boolean;
  ladderFaceAngle?: number;
  isLadderSliding?: boolean;
  isNearLadder?: boolean;
  isLadderHanging?: boolean;
  isLadderMounting?: boolean;
}

export interface GameSettings {
  worldSize: number;
  playerSpeed: number;
  staminaDuration: number;
  ratios: {
    farm: number;
    ruins: number;
    house: number;
    highrise: number;
    factory: number;
    foliage: number;
  };

  riverWidth: number;
  riverFlow: number;
  cameraZoom: number;
  cameraFollow: boolean;
}

export interface VoxelObject {
  id: string;
  position: Position;
  type:
    | 'box'
    | 'wheat'
    | 'fence'
    | 'chimney'
    | 'chimney-house'
    | 'ruin'
    | 'factory'
    | 'highrise'
    | 'roof-ac'
    | 'wall-ac'
    | 'industrial-ac'
    | 'residential-ac'
    | 'foliage';
  color: string;
  scale: [number, number, number];
  rotation?: number;

  // Style properties
  variant?: number; // 0-3 for facade variations

  // Connections for fences/pipes
  neighbors?: {
    n: boolean;
    s: boolean;
    e: boolean;
    w: boolean;
  };
  isPost?: boolean;

  shape?: {
    active: boolean; // Keep for consistency or just check if shape exists
    points: [number, number][]; // 2D contour vertices for THREE.Shape
    mask: boolean[][]; // 2D occupancy grid
  };
  chimney?: {
    position: Position;
    scale: Position;
    color: string;
  };
  // Integrated chimneys for houses (no smoke, transparent with house)
  attachedChimneys?: {
    pos: Position;
    scale: Position;
    color: string;
    smoke?: boolean; // Added support for smoke in attached chimneys
    rotation?: number;
  }[];
  // Integrated ACs
  acs?: {
    pos: Position;
    scale: Position;
    color: string;
    rotation: number;
    type: 'wall' | 'roof';
  }[];
  // Pre-calculated decorations to avoid overlap
  windows?: {
    pos: Position; // Local position relative to building center
    rot: [number, number, number];
  }[];
  doors?: {
    pos: Position;
    rot: [number, number, number];
    type?: 'standard' | 'industrial';
  }[];
  ladders?: {
    pos: Position;
    rot: [number, number, number];
    height: number; // Total height of the ladder in world units
  }[];
}

export interface MatchState {
  currentRound: number;
  maxRounds: number;
  scorePlayer: number;
  timer: number;
}

export interface GameState {
  status: GameStatus;
  mode: GameMode;
  match: MatchState;
  taunt: string;
  hint: string;
  settings: GameSettings;
  mapId: number; // Force map regeneration
  lastRoundResult?: string;
}

export interface VisualState {
  isRunning: boolean;
  isMoving: boolean;
  isGrounded: boolean;
  currentSurface: number;
  landingFactor: number;
  stunned: boolean;
  fallDistance: number;
  justLanded: boolean;
  isRolling: boolean;
  moveSpeed: number;
  isCharging?: boolean;
  isStumbling?: boolean;
  isHiding?: boolean;
  isClimbing?: boolean;
  isLadderSliding?: boolean;
  isNearLadder?: boolean;
  isLadderHanging?: boolean;
  isLadderMounting?: boolean;
  ladderFaceAngle?: number;
  isWallClimbing?: boolean;
  wallClimbProgress?: number;
}
