import React from 'react';
import { GameStatus, GameState, GameSettings } from '../../types';
import { MapSettingsPanel } from './MapSettingsPanel';

interface MainMenuProps {
    gameState: GameState;
    debugMode: boolean;
    setDebugMode: (val: boolean) => void;
    startGame: () => void;
    playAgain: () => void;
    nextRound: () => void;
    resetToMenu: () => void;
    updateSetting: (key: keyof GameSettings, value: any) => void;
    updateRatio: (key: keyof GameSettings['ratios'], value: number) => void;
    toggleLock: (key: string) => void;
    resetRatios: () => void;
    showWireframe?: boolean;
    setShowWireframe?: (val: boolean) => void;
    setIsEditing: (val: boolean) => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({
    gameState, debugMode, setDebugMode, startGame, playAgain, nextRound, resetToMenu,
    updateSetting, updateRatio, toggleLock, resetRatios, showWireframe, setShowWireframe, setIsEditing
}) => {
    if (gameState.status !== GameStatus.IDLE && gameState.status !== GameStatus.GAME_OVER && gameState.status !== GameStatus.ROUND_OVER) {
        return null;
    }

    return (
        <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center text-white z-50 p-6 text-center overflow-y-auto"
            onMouseEnter={() => setIsEditing(true)}
            onMouseLeave={() => setIsEditing(false)}
        >
            {gameState.status === GameStatus.IDLE && (
                <div className="max-w-xl w-full flex flex-col items-center">
                    <h2 className="pixel-font text-4xl mb-6 text-yellow-400 animate-pulse">PARKUBES</h2>

                    <div className="w-full flex justify-end mb-2">
                        <button
                            onClick={() => setDebugMode(!debugMode)}
                            className={`pixel-font text-[10px] px-2 py-1 border rounded transition-all
                        ${debugMode
                                    ? 'bg-green-900/60 border-green-500 text-green-400'
                                    : 'bg-gray-800/50 border-gray-600 text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            DEBUG
                        </button>
                    </div>

                    <MapSettingsPanel
                        settings={gameState.settings}
                        updateSetting={updateSetting}
                        updateRatio={updateRatio}
                        toggleLock={toggleLock}
                        resetRatios={resetRatios}
                        showWireframe={showWireframe}
                        setShowWireframe={setShowWireframe}
                    />

                    <button onClick={startGame} className="pixel-font bg-yellow-500 hover:bg-yellow-400 text-black px-10 py-5 transform hover:scale-105 transition-all shadow-xl shadow-yellow-500/20">
                        INICIAR PARTIDA
                    </button>
                </div>
            )}

            {gameState.status === GameStatus.ROUND_OVER && (
                <div className="flex flex-col items-center">
                    <h2 className="pixel-font text-3xl mb-4 text-white">FIM DA RODADA</h2>
                    <div className="flex flex-col gap-3">
                        <button onClick={nextRound} className="pixel-font bg-blue-500 hover:bg-blue-400 text-white px-10 py-5 transform hover:scale-105 transition-all">
                            PRÓXIMA RODADA
                        </button>
                        <button onClick={resetToMenu} className="pixel-font text-[10px] text-gray-500 hover:text-white transition-colors">
                            VOLTAR AO MENU
                        </button>
                    </div>
                </div>
            )}

            {gameState.status === GameStatus.GAME_OVER && (
                <div className="flex flex-col items-center">
                    <h2 className="pixel-font text-4xl mb-4 text-yellow-400">PARTIDA ENCERRADA</h2>
                    <div className="text-2xl mb-2 font-bold uppercase">
                        PARKOUR COMPLETADO
                    </div>
                    <p className="mb-8 text-gray-400 italic">Score Final: {gameState.match.scorePlayer}</p>
                    <div className="flex flex-col gap-3">
                        <button onClick={playAgain} className="pixel-font bg-yellow-500 hover:bg-yellow-400 text-black px-10 py-5">
                            JOGAR NOVAMENTE
                        </button>
                        <button onClick={resetToMenu} className="pixel-font text-[10px] text-gray-500 hover:text-white transition-colors">
                            VOLTAR AO MENU
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
