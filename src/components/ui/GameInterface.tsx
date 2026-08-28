import React from 'react';
import { GameStatus, GameState, GameSettings, GameMode } from '../../types';
import { MainMenu } from './MainMenu';
import { HUD } from './HUD';

export interface GameInterfaceProps {
  gameState: GameState;
  matchTimer: number;
  godMode?: boolean;
  freezeTimer?: boolean;
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
  godMode,
  freezeTimer,
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
}) => {
  return (
    <>
      {godMode && gameState.status === GameStatus.PLAYING && (
        <div className="absolute top-20 right-56 pointer-events-none">
          <div className="bg-red-900/80 border border-red-500 text-red-100 text-[10px] pixel-font p-2 rounded animate-pulse shadow-lg">
            MODO DEUS (INVENCÍVEL)
          </div>
        </div>
      )}

      <HUD
        status={gameState.status}
        mode={gameState.mode}
        match={gameState.match}
        timer={matchTimer}
        showMission={showMission}
        freezeTimer={freezeTimer}
        togglePause={togglePause}
        restartRound={restartRound}
        resetToMenu={resetToMenu}
      />

      <MainMenu
        gameState={gameState}
        startGame={startGame}
        playAgain={playAgain}
        nextRound={nextRound}
        resetToMenu={resetToMenu}
        updateSetting={updateSetting}
        updateRatio={updateRatio}
        resetRatios={resetRatios}
        setIsEditing={setIsEditing}
        setGameMode={setGameMode}
      />
    </>
  );
};
