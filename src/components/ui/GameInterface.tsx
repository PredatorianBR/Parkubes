import React from 'react';
import { GameStatus, GameState, GameSettings } from '../../types';
import { MainMenu } from './MainMenu';
import { InGameMenu } from './InGameMenu';
import { HUD } from './HUD';

interface GameInterfaceProps {
    gameState: GameState;
    debugMode: boolean;
    setDebugMode: (val: boolean) => void;
    showGrid?: boolean;
    setShowGrid?: (val: boolean) => void;
    showCollision?: boolean;
    setShowCollision?: (val: boolean) => void;
    showWireframe?: boolean;
    setShowWireframe?: (val: boolean) => void;
    togglePause: () => void;
    startGame: () => void;
    playAgain: () => void;
    restartRound: () => void;
    nextRound: () => void;
    resetToMenu: () => void;
    updateSetting: <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => void;
    updateRatio: (key: keyof GameSettings['ratios'], value: number) => void;
    toggleLock: (key: string) => void;
    resetRatios: () => void;
    showMission: boolean;
    setIsEditing: (val: boolean) => void;
}

export const GameInterface: React.FC<GameInterfaceProps> = ({
    gameState, debugMode, setDebugMode, showGrid, setShowGrid, showCollision, setShowCollision, showWireframe, setShowWireframe, togglePause, startGame, playAgain, restartRound, nextRound, resetToMenu, updateSetting, updateRatio, toggleLock, resetRatios, showMission, setIsEditing
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
                togglePause={togglePause}
                restartRound={restartRound}
                resetToMenu={resetToMenu}
                updateSetting={updateSetting}
                setIsEditing={setIsEditing}
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
                currentRound={gameState.match.currentRound}
                scorePlayer={gameState.match.scorePlayer}
                showMission={showMission}
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
                toggleLock={toggleLock}
                resetRatios={resetRatios}
                showWireframe={showWireframe}
                setShowWireframe={setShowWireframe}
                setIsEditing={setIsEditing}
            />
        </>
    );
};
