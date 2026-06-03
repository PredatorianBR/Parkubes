import React from 'react';
import { GameSettings } from '../../types';

interface MapSettingsPanelProps {
    settings: GameSettings;
    updateSetting: <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => void;
    updateRatio: (key: keyof GameSettings['ratios'], value: number) => void;
    resetRatios: () => void;
    showWireframe?: boolean;
    setShowWireframe?: (val: boolean) => void;
}

export const MapSettingsPanel: React.FC<MapSettingsPanelProps> = ({
    settings, updateSetting, updateRatio, resetRatios, showWireframe, setShowWireframe
}) => {

    const renderRatioSlider = (key: keyof GameSettings['ratios'], label: string, colorClass: string) => {
        return (
            <div className="flex flex-col gap-1 mb-2">
                <div className="flex justify-between items-center">
                    <label className="pixel-font text-[10px] text-gray-400">{label}</label>
                    <div className="flex items-center gap-2">
                        <span className="pixel-font text-[10px] text-white w-6 text-right">{settings.ratios[key]}%</span>
                    </div>
                </div>
                <input
                    type="range" min="0" max="100" step="1"
                    value={settings.ratios[key]}
                    onChange={(e) => updateRatio(key, parseInt(e.target.value))}
                    className={`w-full ${colorClass}`}
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
                        LARG. RIO <span>{settings.riverWidth === 0 ? 'DESLIGADO' : settings.riverWidth}</span>
                    </label>
                    <input
                        type="range" min="0" max="5" step="1"
                        value={settings.riverWidth}
                        onChange={(e) => updateSetting('riverWidth', parseInt(e.target.value))}
                        className="w-full accent-blue-600"
                    />
                </div>

                <div className={`flex flex-col gap-2 ${settings.riverWidth === 0 ? 'opacity-40' : ''}`}>
                    <label className="pixel-font text-[10px] text-gray-400 flex justify-between">
                        FORÇA CORRENTEZA <span>{settings.riverWidth === 0 ? '-' : Math.floor(settings.riverFlow)}</span>
                    </label>
                    <input
                        type="range" min="1" max="5" step="1"
                        value={Math.floor(settings.riverFlow)}
                        onChange={(e) => updateSetting('riverFlow', parseInt(e.target.value))}
                        className={`w-full accent-cyan-400 ${settings.riverWidth === 0 ? 'cursor-not-allowed' : ''}`}
                        disabled={settings.riverWidth === 0}
                    />
                </div>
            </div>

            <div className="flex justify-between items-end mt-4 mb-2 border-b border-white/10 pb-2">
                <h3 className="pixel-font text-xs text-blue-300">BIOMAS (COBERTURA %)</h3>
                <button
                    onClick={resetRatios}
                    className="pixel-font text-[8px] text-red-400 hover:text-red-300 border border-red-500/30 px-2 py-1 rounded bg-red-900/20"
                >
                    RESETAR / ALEATORIZAR
                </button>
            </div>

            {renderRatioSlider('farm', 'PLANTAÇÕES', 'accent-green-600')}
            {renderRatioSlider('house', 'CASAS', 'accent-blue-400')}
            {renderRatioSlider('highrise', 'PRÉDIOS', 'accent-purple-400')}
            {renderRatioSlider('factory', 'FÁBRICAS', 'accent-slate-400')}
            {renderRatioSlider('ruins', 'RUÍNAS', 'accent-gray-600')}
            {renderRatioSlider('foliage', 'TOUCEIRAS (FLORES)', 'accent-pink-600')}

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

