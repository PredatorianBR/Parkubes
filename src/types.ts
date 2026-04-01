
import React from 'react';

export type Position = [number, number, number];

export enum GameStatus {
  IDLE = 'IDLE',
  PREP = 'PREP',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  ROUND_OVER = 'ROUND_OVER',
  GAME_OVER = 'GAME_OVER'
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
  };
  lockedRatios: string[];
  riverWidth: number;
  cameraZoom: number;
  cameraFollow: boolean;
}

export type BuildingType = 'box' | 'factory' | 'highrise';

export interface VoxelObject {
  id: string;
  position: Position;
  type: BuildingType | 'wheat' | 'fence' | 'chimney' | 'chimney-house' | 'ruin' | 'roof-ac' | 'wall-ac' | 'industrial-ac' | 'residential-ac';
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

  // Shape Logic
  lShape?: {
    active: boolean;
    cutCorner: 0 | 1 | 2 | 3; // 0=NE, 1=SE, 2=SW, 3=NW
    cutSize: [number, number]; // Width and Depth to remove
    secondCut?: { // Support for U-Shape or T-Shape variations
      corner: 0 | 1 | 2 | 3;
      size: [number, number];
    };
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
}

export interface MatchState {
  currentRound: number;
  maxRounds: number;
  scorePlayer: number;
  timer: number;
}

export interface GameState {
  status: GameStatus;
  match: MatchState;
  taunt: string;
  hint: string;
  settings: GameSettings;
  mapId: number; // Force map regeneration
}
