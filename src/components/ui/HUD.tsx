import React from 'react';
import { GameStatus, GameMode, MatchState } from '../../types';

interface HUDProps {
    status: GameStatus;
    mode: GameMode;
    match: MatchState;
    timer: number;
    showMission: boolean;
}

export const HUD: React.FC<HUDProps> = ({ status, match, showMission }) => {
    return (
        <>
            {/* HUD PRINCIPAL */}
            {(status === GameStatus.PLAYING || status === GameStatus.PREP) && (
                <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start pointer-events-none">
                    <div className="bg-black/60 backdrop-blur-md p-3 rounded-lg border border-white/10 text-white min-w-[150px]">
                        <div className="flex justify-between items-center mb-1">
                            <span className="pixel-font text-[10px] text-yellow-400">RODADA {match.currentRound}</span>
                            <span className="pixel-font text-[10px] text-blue-400">MODO LIVRE</span>
                        </div>
                        <div className="text-xs font-bold tracking-widest flex justify-between">
                            <span>JOGADOR: <span className="text-blue-400">{match.scorePlayer}</span></span>
                        </div>
                    </div>
                </div>
            )}

            {/* MISSION OVERLAY */}
            {status === GameStatus.PREP && showMission && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-40 animate-out fade-out duration-1000 fill-mode-forwards" style={{ animationDelay: '2.5s' }}>
                    <div className="mb-4 text-white pixel-font text-xl animate-pulse bg-black/40 px-4 py-1 rounded">
                        MODO LIVRE
                    </div>
                    
                    <div className="text-8xl pixel-font font-black tracking-tighter drop-shadow-[0_0_15px_rgba(0,0,0,0.8)] mb-8 transform scale-100 transition-transform text-blue-500">
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
