import { create } from 'zustand';

export interface DevSettings {
  showPerf: boolean;
  perfPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  ambientIntensity: number;
  sunIntensity: number;
  shadowsEnabled: boolean;
  fogDensity: number;
}

interface GameStoreState {
  // Dev & Perf settings
  devSettings: DevSettings;
  setDevSettings: (settings: Partial<DevSettings>) => void;
  togglePerf: () => void;

  // Sound / Audio settings
  soundEnabled: boolean;
  musicVolume: number;
  sfxVolume: number;
  setSoundEnabled: (enabled: boolean) => void;
  setVolume: (type: 'music' | 'sfx', volume: number) => void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  devSettings: {
    showPerf: true,
    perfPosition: 'bottom-left',
    ambientIntensity: 0.4,
    sunIntensity: 2.0,
    shadowsEnabled: true,
    fogDensity: 0.005,
  },
  setDevSettings: (newSettings) =>
    set((state) => ({
      devSettings: { ...state.devSettings, ...newSettings },
    })),
  togglePerf: () =>
    set((state) => ({
      devSettings: {
        ...state.devSettings,
        showPerf: !state.devSettings.showPerf,
      },
    })),

  soundEnabled: true,
  musicVolume: 0.7,
  sfxVolume: 0.8,
  setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
  setVolume: (type, volume) =>
    set({ [type === 'music' ? 'musicVolume' : 'sfxVolume']: volume }),
}));
