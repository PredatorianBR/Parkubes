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
                <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start pointer-events-none z-20">
                    <div className="bg-black/70 backdrop-blur-md p-3 rounded-lg border border-white/10 text-white min-w-[180px] shadow-2xl">
                        <div className="flex justify-between items-center mb-1">
                            <span className="pixel-font text-[10px] text-yellow-400">
                                {mode === GameMode.HIDE_AND_SEEK ? `RODADA ${match.currentRound}/${match.maxRounds}` : 'TREINO'}
                            </span>
                            <span className="pixel-font text-[10px] text-blue-400">
                                {mode === GameMode.HIDE_AND_SEEK ? 'ESCONDE-ESCONDE' : 'MODO LIVRE'}
                            </span>
                        </div>
                        
                        {mode === GameMode.HIDE_AND_SEEK && (
                            <div className="flex justify-between items-center mt-1 border-t border-white/5 pt-1 mb-2">
                                <span className="pixel-font text-[10px] text-gray-400">SEU PAPEL:</span>
                                <span className={`pixel-font text-[10px] font-bold ${match.currentRound % 2 === 0 ? 'text-red-400' : 'text-blue-400'}`}>
                                    {match.currentRound % 2 === 0 ? 'PEGADOR' : 'FUGITIVO'}
                                </span>
                            </div>
                        )}

                        <div className="text-xs font-mono flex justify-between items-center mb-1">
                            <span>PONTOS:</span>
                            <span className="text-yellow-400 font-bold">{match.scorePlayer}</span>
                        </div>

                        {mode === GameMode.HIDE_AND_SEEK && (
                            <div className="text-xs font-mono flex justify-between items-center border-t border-white/5 pt-1">
                                <span>{status === GameStatus.PREP ? 'CONTAGEM:' : 'TEMPO:'}</span>
                                <span className={`font-bold ${timer <= 5 && status === GameStatus.PLAYING ? 'text-red-500 animate-pulse text-sm' : 'text-green-400'}`}>
                                    {timer}s
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* HIDE & SEEK COUNTDOWN OVERLAY (UNIFIED) */}
            {status === GameStatus.PREP && mode === GameMode.HIDE_AND_SEEK && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-30 bg-black/45 backdrop-blur-[2px]">
                    <div className="mb-3 text-white pixel-font text-xs bg-black/65 px-4 py-1.5 rounded-full border border-white/10 shadow-lg tracking-wider">
                        RODADA {match.currentRound} DE {match.maxRounds}
                    </div>

                    <div className={`text-6xl md:text-7xl pixel-font font-black tracking-tighter drop-shadow-[0_0_15px_rgba(0,0,0,0.9)] mb-1 uppercase ${
                        match.currentRound % 2 === 0 ? 'text-red-500' : 'text-cyan-400'
                    }`}>
                        {match.currentRound % 2 === 0 ? 'PEGAR!' : 'ESCONDA-SE!'}
                    </div>

                    <div className="text-white pixel-font text-8xl font-black drop-shadow-[0_0_20px_rgba(0,0,0,0.9)] my-4 animate-pulse">
                        {timer > 0 ? timer : "VAI!"}
                    </div>

                    <div className="text-white/95 text-xs pixel-font bg-black/90 px-6 py-4 rounded-xl border border-white/10 shadow-2xl backdrop-blur-md max-w-sm text-center leading-relaxed space-y-2">
                        <div className="font-bold text-yellow-400 uppercase tracking-wider text-[11px]">
                            {match.currentRound % 2 === 0 ? "VOCÊ ESTÁ CONGELADO!" : "PREPARE-SE PARA FUGIR!"}
                        </div>
                        <div className="text-[11px] text-gray-300 font-mono">
                            {match.currentRound % 2 === 0 
                                ? "A IA tem 3 segundos de vantagem para se esconder!" 
                                : "Você tem 3 segundos de vantagem para correr!"}
                        </div>
                        <div className="text-[10px] text-gray-400 font-mono border-t border-white/10 pt-2 mt-1">
                            {match.currentRound % 2 === 0 
                                ? "Encontre e encoste na IA antes que o tempo acabe." 
                                : "Sobreviva por 30 segundos sem ser pego pela IA."}
                        </div>
                    </div>
                </div>
            )}

            {/* MISSION OVERLAY (FREE MODE ONLY) */}
            {status === GameStatus.PREP && showMission && mode !== GameMode.HIDE_AND_SEEK && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-45 animate-out fade-out duration-1000 fill-mode-forwards" style={{ animationDelay: '2.5s' }}>
                    <div className="mb-4 text-white pixel-font text-lg bg-black/60 px-4 py-1.5 rounded-full border border-white/10 backdrop-blur-md">
                        MODO LIVRE
                    </div>
                    
                    <div className="text-8xl pixel-font font-black tracking-tighter drop-shadow-[0_0_15px_rgba(0,0,0,0.8)] mb-8 transform scale-100 text-blue-500 uppercase">
                        CORRER!
                    </div>
                    <div className="text-white/90 font-mono text-sm bg-black/75 px-6 py-3 rounded border border-white/5 shadow-2xl backdrop-blur-md">
                        Explore o mapa sem limites de tempo.
                    </div>
                </div>
            )}

            <div className="absolute bottom-4 left-4 text-[10px] text-white/30 pixel-font space-y-1 pointer-events-none z-20">
                <div>WASD - MOVER | ESPAÇO - PULAR/ESCALAR</div>
                <div>SHIFT - CORRER</div>
            </div>
        </>
    );
};
