import React from 'react';
import { GameStatus, GameState, GameSettings } from '../../types';

interface InGameMenuProps {
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
    restartRound: () => void;
    resetToMenu: () => void;
    updateSetting: (key: keyof GameSettings, value: any) => void;
    setIsEditing: (val: boolean) => void;
}

export const InGameMenu: React.FC<InGameMenuProps> = ({
    gameState, debugMode, setDebugMode, showGrid, setShowGrid, showCollision, setShowCollision, showWireframe, setShowWireframe,
    togglePause, restartRound, resetToMenu, updateSetting, setIsEditing
}) => {
    if (gameState.status === GameStatus.IDLE || gameState.status === GameStatus.GAME_OVER || gameState.status === GameStatus.ROUND_OVER) return null;

    const renderCameraSettings = () => (
        <div className="grid grid-cols-1 gap-2">
            <div className="flex flex-col gap-1">
                <label className="pixel-font text-[8px] text-gray-400 flex justify-between">
                    ZOOM <span>{gameState.settings.cameraZoom}</span>
                </label>
                <input
                    type="range" min="10" max="100" step="5"
                    value={gameState.settings.cameraZoom}
                    onChange={(e) => updateSetting('cameraZoom', parseInt(e.target.value))}
                    className="w-full accent-purple-500 h-1"
                />
            </div>
            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    id="cameraFollow"
                    checked={gameState.settings.cameraFollow}
                    onChange={(e) => updateSetting('cameraFollow', e.target.checked)}
                    className="w-3 h-3 accent-purple-500"
                />
                <label htmlFor="cameraFollow" className="pixel-font text-[8px] text-gray-400 cursor-pointer">
                    CÂMERA SEGUIR
                </label>
            </div>
        </div>
    );

    return (
        <div
            className="absolute top-4 right-4 z-[60] bg-black/60 backdrop-blur-md p-4 rounded-xl border border-white/10 text-white w-48 transition-all pointer-events-auto"
            onMouseEnter={() => setIsEditing(true)}
            onMouseLeave={() => setIsEditing(false)}
        >
            <div className="flex justify-between items-center mb-3 border-b border-white/10 pb-2">
                <span className="pixel-font text-[10px] text-yellow-400">MENU</span>
                <button
                    onClick={togglePause}
                    className="bg-blue-600/50 hover:bg-blue-500 p-1 rounded text-[8px] px-2 transition-colors"
                >
                    {gameState.status === GameStatus.PAUSED ? 'PLAY' : 'PAUSE'}
                </button>
            </div>

            {/* Camera Options */}
            <div className="mb-3">
                <h4 className="pixel-font text-[8px] text-gray-500 mb-1">CÂMERA</h4>
                {renderCameraSettings()}
            </div>

            {/* Visual Options */}
            <div className="mb-3 border-t border-white/10 pt-2">
                <h4 className="pixel-font text-[8px] text-gray-500 mb-1">VISUAL</h4>
                {setShowWireframe && (
                    <div className="flex items-center gap-2 mb-2">
                        <input
                            type="checkbox"
                            id="showWireframe"
                            checked={!!showWireframe}
                            onChange={(e) => setShowWireframe(e.target.checked)}
                            className="w-3 h-3 accent-cyan-500"
                        />
                        <label htmlFor="showWireframe" className="pixel-font text-[8px] text-gray-400 cursor-pointer">
                            WIREFRAME AO OCULTAR
                        </label>
                    </div>
                )}
            </div>

            {/* Debug Options */}
            <div className="border-t border-white/10 pt-2">
                <div className="flex items-center gap-2 mb-2">
                    <input
                        type="checkbox"
                        id="debugMode"
                        checked={debugMode}
                        onChange={(e) => setDebugMode(e.target.checked)}
                        className="w-3 h-3 accent-red-500"
                    />
                    <label htmlFor="debugMode" className={`pixel-font text-[8px] cursor-pointer ${debugMode ? 'text-red-400' : 'text-gray-500'}`}>
                        MODO DEBUG
                    </label>
                </div>

                {debugMode && setShowGrid && setShowCollision && (
                    <div className="pl-4 flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="showGrid"
                                checked={!!showGrid}
                                onChange={(e) => setShowGrid(e.target.checked)}
                                className="w-3 h-3 accent-blue-500"
                            />
                            <label htmlFor="showGrid" className="pixel-font text-[8px] text-gray-400 cursor-pointer">
                                GRADE
                            </label>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="showCol"
                                checked={!!showCollision}
                                onChange={(e) => setShowCollision(e.target.checked)}
                                className="w-3 h-3 accent-blue-500"
                            />
                            <label htmlFor="showCol" className="pixel-font text-[8px] text-gray-400 cursor-pointer">
                                COLISÃO
                            </label>
                        </div>
                    </div>
                )}
            </div>

            {gameState.status === GameStatus.PAUSED && (
                <div className="mt-4 flex flex-col gap-2">
                    <button onClick={restartRound} className="pixel-font bg-gray-700/50 hover:bg-gray-600 text-white text-[8px] py-2 rounded transition-colors">
                        RESPAWN
                    </button>
                    <button onClick={resetToMenu} className="pixel-font bg-red-900/40 hover:bg-red-800 text-white text-[8px] py-2 rounded transition-colors border border-red-500/30">
                        Sair para o menu principal
                    </button>
                </div>
            )}
        </div>
    );
};
