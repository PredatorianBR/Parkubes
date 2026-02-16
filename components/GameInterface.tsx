
import React from 'react';
import { GameStatus, GameState, GameSettings } from '../types';

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
    updateSetting: (key: keyof GameSettings, value: any) => void;
    updateRatio: (key: keyof GameSettings['ratios'], value: number) => void;
    toggleLock: (key: string) => void;
    resetRatios: () => void;
    showMission: boolean;
    setIsEditing: (val: boolean) => void;
}

const LockIcon = ({ locked }: { locked: boolean }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill={locked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {locked ? (
            <>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </>
        ) : (
            <>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
            </>
        )}
    </svg>
);

export const GameInterface: React.FC<GameInterfaceProps> = ({ 
    gameState, debugMode, setDebugMode, showGrid, setShowGrid, showCollision, setShowCollision, showWireframe, setShowWireframe, togglePause, startGame, playAgain, restartRound, nextRound, resetToMenu, updateSetting, updateRatio, toggleLock, resetRatios, showMission, setIsEditing
}) => {
    
    const renderRatioSlider = (key: keyof GameSettings['ratios'], label: string, colorClass: string) => {
        const isLocked = gameState.settings.lockedRatios.includes(key);
        return (
            <div className="flex flex-col gap-1 mb-2">
                <div className="flex justify-between items-center">
                    <label className="pixel-font text-[10px] text-gray-400">{label}</label>
                    <div className="flex items-center gap-2">
                         <span className="pixel-font text-[10px] text-white w-6 text-right">{gameState.settings.ratios[key]}%</span>
                         <button 
                            onClick={() => toggleLock(key)}
                            className={`p-1 rounded hover:bg-white/10 transition-colors ${isLocked ? 'text-yellow-400' : 'text-gray-600'}`}
                            title={isLocked ? "Destravar" : "Travar"}
                         >
                            <LockIcon locked={isLocked} />
                         </button>
                    </div>
                </div>
                <input 
                    type="range" min="0" max="100" step="1" 
                    value={gameState.settings.ratios[key]} 
                    onChange={(e) => updateRatio(key, parseInt(e.target.value))}
                    className={`w-full ${colorClass} ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    disabled={isLocked}
                />
            </div>
        );
    };

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

    const calculateEmptySpace = () => {
        const r = gameState.settings.ratios;
        const used = r.farm + r.ruins + r.house + r.highrise + r.factory;
        return Math.max(0, 100 - used);
    };

    // In-Game Floating Menu
    const renderInGameMenu = () => {
        if (gameState.status === GameStatus.IDLE || gameState.status === GameStatus.GAME_OVER || gameState.status === GameStatus.ROUND_OVER) return null;

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
                            SAIR
                        </button>
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
          {renderInGameMenu()}
    
          {debugMode && gameState.status === GameStatus.PLAYING && (
              <div className="absolute top-20 right-56 pointer-events-none">
                 <div className="bg-red-900/80 border border-red-500 text-red-100 text-[10px] pixel-font p-2 rounded animate-pulse">
                    INVINCIBLE
                 </div>
              </div>
          )}
    
          {/* HUD PRINCIPAL - REMOVED TIMER */}
          {(gameState.status === GameStatus.PLAYING || gameState.status === GameStatus.PREP) && (
            <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start pointer-events-none">
                <div className="bg-black/60 backdrop-blur-md p-3 rounded-lg border border-white/10 text-white min-w-[150px]">
                <div className="flex justify-between items-center mb-1">
                    <span className="pixel-font text-[10px] text-yellow-400">RODADA {gameState.match.currentRound}</span>
                    <span className="pixel-font text-[10px] text-blue-400">LIVRE</span>
                </div>
                <div className="text-xs font-bold tracking-widest">
                    SCORE: {gameState.match.scorePlayer}
                </div>
                </div>
            </div>
          )}
    
          {(gameState.status === GameStatus.IDLE || 
            gameState.status === GameStatus.GAME_OVER || 
            gameState.status === GameStatus.ROUND_OVER) && (
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

                  <div className="w-full bg-white/5 p-6 rounded-xl border border-white/10 mb-8 space-y-4 text-left max-h-[60vh] overflow-y-auto">
                    <h3 className="pixel-font text-xs text-blue-300 border-b border-white/10 pb-2 mb-2">GERAL</h3>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                            <label className="pixel-font text-[10px] text-gray-400 flex justify-between">
                                TAMANHO <span>{gameState.settings.worldSize}</span>
                            </label>
                            <input 
                                type="range" min="16" max="64" step="8" 
                                value={gameState.settings.worldSize} 
                                onChange={(e) => updateSetting('worldSize', parseInt(e.target.value))}
                                className="w-full accent-yellow-400"
                            />
                        </div>

                         <div className="flex flex-col gap-2">
                            <label className="pixel-font text-[10px] text-gray-400 flex justify-between">
                                LARG. RIO <span>{gameState.settings.riverWidth}</span>
                            </label>
                            <input 
                                type="range" min="0" max="6" step="1" 
                                value={gameState.settings.riverWidth} 
                                onChange={(e) => updateSetting('riverWidth', parseInt(e.target.value))}
                                className="w-full accent-blue-600"
                            />
                        </div>
                    </div>

                    <div className="flex justify-between items-end mt-4 mb-2 border-b border-white/10 pb-2">
                        <h3 className="pixel-font text-xs text-blue-300">TERRENO (Restante: {calculateEmptySpace()}%)</h3>
                        <button 
                            onClick={resetRatios}
                            className="pixel-font text-[8px] text-red-400 hover:text-red-300 border border-red-500/30 px-2 py-1 rounded bg-red-900/20"
                        >
                            RESETAR
                        </button>
                    </div>

                    <div className="bg-white/5 p-2 mb-2 rounded border border-white/5">
                        <label className="pixel-font text-[10px] text-gray-500 block">ESPAÇO VAZIO E OUTROS</label>
                        <div className="w-full bg-gray-800 h-2 rounded-full mt-1 overflow-hidden">
                            <div className="bg-gray-500 h-full transition-all duration-300" style={{ width: `${calculateEmptySpace()}%` }}></div>
                        </div>
                    </div>

                    {renderRatioSlider('farm', 'PLANTAÇÕES', 'accent-green-600')}
                    {renderRatioSlider('house', 'CASAS', 'accent-blue-400')}
                    {renderRatioSlider('highrise', 'PRÉDIOS', 'accent-purple-400')}
                    {renderRatioSlider('factory', 'FÁBRICAS', 'accent-slate-400')}
                    {renderRatioSlider('ruins', 'RUÍNAS', 'accent-gray-600')}

                    <h3 className="pixel-font text-xs text-blue-300 border-b border-white/10 pb-2 mb-2 mt-4">OPÇÕES</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                             <label className="pixel-font text-[10px] text-gray-400 flex justify-between">
                                ZOOM <span>{gameState.settings.cameraZoom}</span>
                            </label>
                            <input 
                                type="range" min="10" max="100" step="5" 
                                value={gameState.settings.cameraZoom} 
                                onChange={(e) => updateSetting('cameraZoom', parseInt(e.target.value))}
                                className="w-full accent-purple-500"
                            />
                        </div>
                        <div className="flex flex-col gap-2 mt-2">
                            <div className="flex items-center gap-2">
                                <input 
                                    type="checkbox"
                                    id="cameraFollowMenu"
                                    checked={gameState.settings.cameraFollow}
                                    onChange={(e) => updateSetting('cameraFollow', e.target.checked)}
                                    className="w-4 h-4 accent-purple-500"
                                />
                                 <label htmlFor="cameraFollowMenu" className="pixel-font text-[10px] text-gray-400">
                                    CÂMERA SEGUIR
                                </label>
                            </div>
                            {setShowWireframe && (
                                <div className="flex items-center gap-2">
                                    <input 
                                        type="checkbox"
                                        id="showWireframeMenu"
                                        checked={!!showWireframe}
                                        onChange={(e) => setShowWireframe(e.target.checked)}
                                        className="w-4 h-4 accent-cyan-500"
                                    />
                                    <label htmlFor="showWireframeMenu" className="pixel-font text-[10px] text-gray-400">
                                        WIREFRAME AO OCULTAR
                                    </label>
                                </div>
                             )}
                        </div>
                    </div>
                  </div>
    
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
          )}
    
          {/* MISSION OVERLAY */}
          {gameState.status === GameStatus.PREP && showMission && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-40 animate-out fade-out duration-1000 fill-mode-forwards" style={{ animationDelay: '2.5s' }}>
               <div className="mb-4 text-white pixel-font text-xl animate-pulse bg-black/40 px-4 py-1 rounded">MODO LIVRE</div>
               <div className={`
                  text-8xl pixel-font font-black tracking-tighter drop-shadow-[0_0_15px_rgba(0,0,0,0.8)] mb-8 transform scale-100 transition-transform text-blue-500
               `}>
                  CORRER!
               </div>
               <div className="text-white/90 font-mono text-sm bg-black/60 px-6 py-3 rounded backdrop-blur-md">
                  Explore o mapa sem limites de tempo.
               </div>
            </div>
          )}
    
          <div className="absolute bottom-4 left-4 text-[10px] text-white/30 pixel-font space-y-1 pointer-events-none">
            <div>WASD - MOVER | ESPAÇO - PULAR/ESCALAR</div>
            <div>SHIFT - CORRER</div>
          </div>
        </>
    );
};
