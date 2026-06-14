import React from 'react';
import { GameStatus, GameState, GameSettings, GameMode } from '../../types';
import { MainMenu } from './MainMenu';
import { InGameMenu } from './InGameMenu';
import { HUD } from './HUD';

export interface GameInterfaceProps {
  gameState: GameState;
  matchTimer: number;
  debugMode: boolean;
  setDebugMode: (val: boolean) => void;
  showGrid?: boolean;
  setShowGrid?: (val: boolean) => void;
  showCollision?: boolean;
  setShowCollision?: (val: boolean) => void;
  showWireframe?: boolean;
  setShowWireframe?: (val: boolean) => void;
  showOcclusion?: boolean;
  setShowOcclusion?: (val: boolean) => void;
  showAIPath?: boolean;
  setShowAIPath?: (val: boolean) => void;
  togglePause: () => void;
  startGame: () => void;
  playAgain: () => void;
  restartRound: () => void;
  nextRound: () => void;
  resetToMenu: () => void;
  updateSetting: <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => void;
  updateRatio: (key: keyof GameSettings['ratios'], value: number) => void;

  resetRatios: () => void;
  showMission: boolean;
  setIsEditing: (val: boolean) => void;
  setGameMode: (mode: GameMode) => void;
  handleRoundEnd?: (playerWon: boolean) => void;
}

export const GameInterface: React.FC<GameInterfaceProps> = ({
  gameState,
  matchTimer,
  debugMode,
  setDebugMode,
  showGrid,
  setShowGrid,
  showCollision,
  setShowCollision,
  showWireframe,
  setShowWireframe,
  showOcclusion,
  setShowOcclusion,
  showAIPath,
  setShowAIPath,
  togglePause,
  startGame,
  playAgain,
  restartRound,
  nextRound,
  resetToMenu,
  updateSetting,
  updateRatio,
  resetRatios,
  showMission,
  setIsEditing,
  setGameMode,
  handleRoundEnd,
}) => {
  return (
    <>
      <InGameMenu
        gameState={gameState}
        debugMode={debugMode}
        setDebugMode={setDebugMode}
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        showCollision={showCollision}
        setShowCollision={setShowCollision}
        showWireframe={showWireframe}
        setShowWireframe={setShowWireframe}
        showOcclusion={showOcclusion}
        setShowOcclusion={setShowOcclusion}
        showAIPath={showAIPath}
        setShowAIPath={setShowAIPath}
        togglePause={togglePause}
        restartRound={restartRound}
        resetToMenu={resetToMenu}
        updateSetting={updateSetting}
        setIsEditing={setIsEditing}
        handleRoundEnd={handleRoundEnd}
      />

      {debugMode && gameState.status === GameStatus.PLAYING && (
        <div className="absolute top-20 right-56 pointer-events-none">
          <div className="bg-red-900/80 border border-red-500 text-red-100 text-[10px] pixel-font p-2 rounded animate-pulse">
            INVINCIBLE
          </div>
        </div>
      )}

      <HUD
        status={gameState.status}
        mode={gameState.mode}
        match={gameState.match}
        timer={matchTimer}
        showMission={showMission}
        debugMode={debugMode}
      />

      <MainMenu
        gameState={gameState}
        debugMode={debugMode}
        setDebugMode={setDebugMode}
        startGame={startGame}
        playAgain={playAgain}
        nextRound={nextRound}
        resetToMenu={resetToMenu}
        updateSetting={updateSetting}
        updateRatio={updateRatio}
        resetRatios={resetRatios}
        showWireframe={showWireframe}
        setShowWireframe={setShowWireframe}
        setIsEditing={setIsEditing}
        setGameMode={setGameMode}
      />
    </>
  );
};
