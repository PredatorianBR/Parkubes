import React from 'react';
import { GameStatus, GameMode, MatchState } from '../../types';

interface HUDProps {
    status: GameStatus;
    mode: GameMode;
    match: MatchState;
    timer: number;
    showMission: boolean;
}

export const HUD: React.FC<HUDProps> = ({ status, mode, match, timer, showMission }) => {
    return (
        <>
            {/* HUD PRINCIPAL */}
            {(status === GameStatus.PLAYING || status === GameStatus.PREP) && (
                <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start pointer-events-none">
                    <div className="bg-black/60 backdrop-blur-md p-3 rounded-lg border border-white/10 text-white min-w-[150px]">
                        <div className="flex justify-between items-center mb-1">
                            <span className="pixel-font text-[10px] text-yellow-400">RODADA {match.currentRound}</span>
                            <span className={`pixel-font text-[10px] ${mode === GameMode.HIDE_AND_SEEK ? 'text-orange-400' : 'text-blue-400'}`}>
                                {mode === GameMode.HIDE_AND_SEEK ? 'ESCONDE ESCONDE' : 'LIVRE'}
                            </span>
                        </div>
                        <div className="text-xs font-bold tracking-widest flex justify-between">
                            <span>JOGADOR: <span className="text-blue-400">{match.scorePlayer}</span></span>
                            {mode === GameMode.HIDE_AND_SEEK && (
                                <span>IA: <span className="text-red-400">{match.scoreAI}</span></span>
                            )}
                        </div>
                        
                        {mode === GameMode.HIDE_AND_SEEK && (
                            <div className="mt-2 border-t border-white/20 pt-2">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-[10px] font-bold">
                                        VOCÊ É:{' '}
                                        <span className="text-blue-400">
                                            {match.playerRole === 'SEEKER' ? 'CAÇADOR' : 'ESCONDIDO'}
                                        </span>
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold">
                                        {match.phase === 'WAITING' ? 'ESPERE:' : 'TEMPO:'}
                                    </span>
                                    <span className={`pixel-font text-lg ${match.phase === 'WAITING' ? 'text-yellow-400 animate-pulse' : 'text-white'}`}>
                                        {timer}s
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* MISSION OVERLAY */}
            {status === GameStatus.PREP && showMission && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-40 animate-out fade-out duration-1000 fill-mode-forwards" style={{ animationDelay: '2.5s' }}>
                    <div className="mb-4 text-white pixel-font text-xl animate-pulse bg-black/40 px-4 py-1 rounded">
                        {mode === GameMode.HIDE_AND_SEEK ? 'ESCONDE ESCONDE' : 'MODO LIVRE'}
                    </div>
                    
                    {mode === GameMode.HIDE_AND_SEEK ? (
                        <>
                            <div className="text-6xl pixel-font font-black tracking-tighter drop-shadow-[0_0_15px_rgba(0,0,0,0.8)] mb-8 transform scale-100 transition-transform text-blue-500">
                                {match.playerRole === 'SEEKER' ? 'CAÇE A IA!' : 'ESCONDA-SE!'}
                            </div>
                            <div className="text-white/90 font-mono text-sm bg-black/60 px-6 py-3 rounded backdrop-blur-md">
                                {match.playerRole === 'SEEKER' ? 'Você tem 30 segundos para pegar a IA.' : 'Você tem 30 segundos para fugir da IA.'}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="text-8xl pixel-font font-black tracking-tighter drop-shadow-[0_0_15px_rgba(0,0,0,0.8)] mb-8 transform scale-100 transition-transform text-blue-500">
                                CORRER!
                            </div>
                            <div className="text-white/90 font-mono text-sm bg-black/60 px-6 py-3 rounded backdrop-blur-md">
                                Explore o mapa sem limites de tempo.
                            </div>
                        </>
                    )}
                </div>
            )}

            <div className="absolute bottom-4 left-4 text-[10px] text-white/30 pixel-font space-y-1 pointer-events-none">
                <div>WASD - MOVER | ESPAÇO - PULAR/ESCALAR</div>
                <div>SHIFT - CORRER</div>
            </div>
        </>
    );
};
