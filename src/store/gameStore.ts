import { create } from 'zustand';

const DEV_SETTINGS_STORAGE_KEY = 'parkubes_devtools_settings';

export interface DevSettings {
  showPerf: boolean;
  perfPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  ambientIntensity: number;
  sunIntensity: number;
  sunAzimuth: number;
  sunElevation: number;
  shadowsEnabled: boolean;
  fogDensity: number;
  showPerfMonitor: boolean;
  cameraZoom: number;
  cameraFollow: boolean;
  showGrid: boolean;
  showCollision: boolean;
  showOcclusion: boolean;
  showAIPath: boolean;
  alwaysShowAI: boolean;
  showWireframe: boolean;
  addDestinationMode: boolean;
  godMode: boolean;
  freezeTimer: boolean;
  devToolsWidth: number;
  devToolsOpacity: number;
}

export const DEFAULT_DEV_SETTINGS: DevSettings = {
  showPerf: true,
  perfPosition: 'bottom-left',
  ambientIntensity: 0.4,
  sunIntensity: 2.0,
  sunAzimuth: 345,
  sunElevation: 55,
  shadowsEnabled: true,
  fogDensity: 0.005,
  showPerfMonitor: true,
  cameraZoom: 15,
  cameraFollow: false,
  showGrid: true,
  showCollision: false,
  showOcclusion: false,
  showAIPath: true,
  alwaysShowAI: false,
  showWireframe: true,
  addDestinationMode: false,
  godMode: true,
  freezeTimer: true,
  devToolsWidth: 380,
  devToolsOpacity: 1.0,
};

function loadDevSettings(): DevSettings {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_DEV_SETTINGS };
    }
    const raw = window.localStorage.getItem(DEV_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DEV_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_DEV_SETTINGS };
    }

    const record = parsed as Record<string, unknown>;
    const merged: DevSettings = { ...DEFAULT_DEV_SETTINGS };
    for (const key of Object.keys(DEFAULT_DEV_SETTINGS) as (keyof DevSettings)[]) {
      const value = record[key];
      const defaultValue = DEFAULT_DEV_SETTINGS[key];
      if (typeof value === typeof defaultValue && (typeof value !== 'number' || Number.isFinite(value))) {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return merged;
  } catch {
    return { ...DEFAULT_DEV_SETTINGS };
  }
}

function saveDevSettings(settings: DevSettings): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(DEV_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota or private-mode errors safely
  }
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
  devSettings: loadDevSettings(),
  setDevSettings: (newSettings) =>
    set((state) => {
      let hasChange = false;
      for (const key of Object.keys(newSettings) as (keyof DevSettings)[]) {
        if (newSettings[key] !== state.devSettings[key]) {
          hasChange = true;
          break;
        }
      }
      if (!hasChange) return state;

      const nextDevSettings = { ...state.devSettings, ...newSettings };
      saveDevSettings(nextDevSettings);
      return { devSettings: nextDevSettings };
    }),
  togglePerf: () =>
    set((state) => {
      const nextDevSettings = {
        ...state.devSettings,
        showPerf: !state.devSettings.showPerf,
      };
      saveDevSettings(nextDevSettings);
      return { devSettings: nextDevSettings };
    }),

  soundEnabled: true,
  musicVolume: 0.7,
  sfxVolume: 0.8,
  setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
  setVolume: (type, volume) =>
    set({ [type === 'music' ? 'musicVolume' : 'sfxVolume']: volume }),
}));
