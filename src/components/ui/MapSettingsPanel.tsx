import React from 'react';
import { GameSettings } from '../../types';
import { LockIcon } from './Icons';

interface MapSettingsPanelProps {
    settings: GameSettings;
    updateSetting: <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => void;
    updateRatio: (key: keyof GameSettings['ratios'], value: number) => void;
    toggleLock: (key: string) => void;
    resetRatios: () => void;
    showWireframe?: boolean;
    setShowWireframe?: (val: boolean) => void;
}

export const MapSettingsPanel: React.FC<MapSettingsPanelProps> = ({
    settings, updateSetting, updateRatio, toggleLock, resetRatios, showWireframe, setShowWireframe
}) => {
    const calculateEmptySpace = () => {
        const r = settings.ratios;
        const used = r.farm + r.ruins + r.house + r.highrise + r.factory;
        return Math.max(0, 100 - used);
    };

    const renderRatioSlider = (key: keyof GameSettings['ratios'], label: string, colorClass: string) => {
        const isLocked = settings.lockedRatios.includes(key);
        return (
            <div className="flex flex-col gap-1 mb-2">
                <div className="flex justify-between items-center">
                    <label className="pixel-font text-[10px] text-gray-400">{label}</label>
                    <div className="flex items-center gap-2">
                        <span className="pixel-font text-[10px] text-white w-6 text-right">{settings.ratios[key]}%</span>
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
                    value={settings.ratios[key]}
                    onChange={(e) => updateRatio(key, parseInt(e.target.value))}
                    className={`w-full ${colorClass} ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    disabled={isLocked}
                />
            </div>
        );
    };

    return (
        <div className="w-full bg-white/5 p-6 rounded-xl border border-white/10 mb-8 space-y-4 text-left max-h-[60vh] overflow-y-auto">
            <h3 className="pixel-font text-xs text-blue-300 border-b border-white/10 pb-2 mb-2">GERAL</h3>

            <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                    <label className="pixel-font text-[10px] text-gray-400 flex justify-between">
                        TAMANHO <span>{settings.worldSize}</span>
                    </label>
                    <input
                        type="range" min="20" max="80" step="10"
                        value={settings.worldSize}
                        onChange={(e) => updateSetting('worldSize', parseInt(e.target.value))}
                        className="w-full accent-yellow-400"
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <label className="pixel-font text-[10px] text-gray-400 flex justify-between">
                        LARG. RIO <span>{settings.riverWidth}</span>
                    </label>
                    <input
                        type="range" min="0" max="6" step="1"
                        value={settings.riverWidth}
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
                        ZOOM <span>{settings.cameraZoom}</span>
                    </label>
                    <input
                        type="range" min="10" max="100" step="5"
                        value={settings.cameraZoom}
                        onChange={(e) => updateSetting('cameraZoom', parseInt(e.target.value))}
                        className="w-full accent-purple-500"
                    />
                </div>
                <div className="flex flex-col gap-2 mt-2">
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="cameraFollowMenu"
                            checked={settings.cameraFollow}
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
    );
};
