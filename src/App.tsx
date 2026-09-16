import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera, Stars, Sky, ContactShadows, OrbitControls } from '@react-three/drei';
import { Perf } from 'r3f-perf';
import { Leva, useControls as useLevaControls, folder, button } from 'leva';
import { useGameStore } from './store/gameStore';
import { VoxelSeek } from './components/VoxelSeek';
import { GameInterface, GameInterfaceProps } from './components/ui/GameInterface';
import { OnScreenControls } from './components/ui/OnScreenControls';
import { GameStatus, GameState, GameSettings, GameMode } from './types';
import { MatchState } from './types';

import { MatchContext } from './MatchContext';
const getRandomSettings = () => {
  return {
    ratios: {
      farm: 0,
      house: 45,
      highrise: 0,
      factory: 0,
      ruins: 0,
      foliage: 0,
    },
    riverWidth: 0,
    riverFlow: 3,
  };
};

const GameLayout: React.FC<{
  status: GameStatus;
  mode: GameMode;
  match: MatchState;
  settings: GameSettings;
  isEditing: boolean;
  mapId: number;
  handleRoundEnd: (playerWon: boolean) => void;
  handlePrepComplete: () => void;
  restartRound: () => void;
  nextRound: () => void;
  gameInterfaceProps: Omit<GameInterfaceProps, 'matchTimer'>;
}> = React.memo(
  ({
    status,
    mode,
    match,
    settings,
    isEditing,
    mapId,
    handleRoundEnd,
    handlePrepComplete,
    restartRound,
    nextRound,
    gameInterfaceProps,
  }) => {
    const [matchTimer, setMatchTimer] = useState(0);
    const { devSettings } = useGameStore();

    const handleRoundEndRef = useRef(handleRoundEnd);
    handleRoundEndRef.current = handleRoundEnd;
    const restartRoundRef = useRef(restartRound);
    restartRoundRef.current = restartRound;
    const nextRoundRef = useRef(nextRound);
    nextRoundRef.current = nextRound;

    // Centralized DevTools controls via Leva
    const [
      {
        ambientIntensity,
        sunIntensity,
        sunAzimuth,
        sunElevation,
        showPerfMonitor,
        showGrid,
        showCollision,
        showOcclusion,
        showAIPath,
        alwaysShowAI,
        showWireframe,
        addDestinationMode,
        godMode,
        freezeTimer,
        cameraZoom,
        cameraFollow,
        devToolsWidth,
        devToolsOpacity,
      },
      setLeva,
    ] = useLevaControls(() => ({
      'Ambiente & Performance': folder(
        {
          ambientIntensity: {
            value: devSettings.ambientIntensity,
            min: 0,
            max: 2,
            step: 0.05,
            label: 'Luz Ambiente',
          },
          sunIntensity: {
            value: devSettings.sunIntensity,
            min: 0,
            max: 5,
            step: 0.1,
            label: 'Luz Solar',
          },
          sunAzimuth: {
            value: devSettings.sunAzimuth,
            min: 0,
            max: 360,
            step: 1,
            label: 'Direção do Sol (°)',
          },
          sunElevation: {
            value: devSettings.sunElevation,
            min: 5,
            max: 90,
            step: 1,
            label: 'Elevação do Sol (°)',
          },
          showPerfMonitor: {
            value: true,
            label: 'Monitor FPS/GPU',
          },
        },
        { collapsed: false },
      ),
      'Câmera': folder(
        {
          cameraZoom: {
            value: settings.cameraZoom,
            min: 10,
            max: 100,
            step: 5,
            label: 'Zoom da Câmera',
          },
          cameraFollow: {
            value: settings.cameraFollow,
            label: 'Seguir Jogador',
          },
        },
        { collapsed: false },
      ),
      'Depuração Visual': folder(
        {
          showGrid: {
            value: true,
            label: 'Grade do Mapa',
          },
          showCollision: {
            value: false,
            label: 'Caixas de Colisão',
          },
          showOcclusion: {
            value: false,
            label: 'Pontos de Visão (Rua)',
          },
          showAIPath: {
            value: true,
            label: 'Rota e Alvo da IA',
          },
          alwaysShowAI: {
            value: false,
            label: 'Visão Permanente da IA',
          },
          showWireframe: {
            value: true,
            label: 'Wireframe ao Ocultar',
          },
        },
        { collapsed: false },
      ),
      'Waypath da IA': folder(
        {
          addDestinationMode: {
            value: false,
            label: 'Adicionar Destino',
          },
          'Limpar Caminho': button(() => {
            window.dispatchEvent(new CustomEvent('ai-clear-path'));
          }),
          'Remover Próximo Nó': button(() => {
            window.dispatchEvent(new CustomEvent('ai-remove-next-node'));
          }),
        },
        { collapsed: false },
      ),
      'Legenda Navegação IA': folder(
        {
          _rota: { value: 'Ciano (🔵)', editable: false, label: 'Rota / Waypoints' },
          _alvo: { value: 'Magenta (🟣)', editable: false, label: 'Alvo Atual' },
          _pos: { value: 'Amarelo (🟡)', editable: false, label: 'Última Posição' },
          _vetor: { value: 'Laranja (🟠)', editable: false, label: 'Vetor Movimento' },
          _sensores: { value: 'Verde (🟢)', editable: false, label: 'Sensores Whiskers' },
        },
        { collapsed: true },
      ),
      'Jogabilidade & Trapaças': folder(
        {
          godMode: {
            value: true,
            label: 'Modo Deus (Invencível)',
          },
          freezeTimer: {
            value: true,
            label: 'Congelar Tempo',
          },
        },
        { collapsed: false },
      ),
      'Interface DevTools': folder(
        {
          devToolsWidth: {
            value: 380,
            min: 280,
            max: 600,
            step: 10,
            label: 'Largura Painel (px)',
          },
          devToolsOpacity: {
            value: 1.0,
            min: 0.15,
            max: 1.0,
            step: 0.05,
            label: 'Opacidade / Transp.',
          },
        },
        { collapsed: false },
      ),
      'Controles de Partida': folder(
        {
          'Forçar Vitória': button(() => handleRoundEndRef.current(true)),
          'Forçar Derrota': button(() => handleRoundEndRef.current(false)),
          'Reiniciar / Respawn': button(() => restartRoundRef.current()),
          'Próxima Rodada': button(() => nextRoundRef.current()),
        },
        { collapsed: false },
      ),
    }));

    useEffect(() => {
      if (status === GameStatus.PREP) {
        if (mode === GameMode.FREE) {
          handlePrepComplete();
        } else {
          setMatchTimer(3);
        }
      }
    }, [status, match.currentRound, mode, handlePrepComplete]);

    // Timer decrement: simple interval that only updates local matchTimer
    useEffect(() => {
      if (mode !== GameMode.HIDE_AND_SEEK) return;
      if (status !== GameStatus.PLAYING && status !== GameStatus.PREP) return;

      const interval = setInterval(() => {
        if (status === GameStatus.PREP) {
          setMatchTimer((t) => {
            if (t <= 1) {
              setTimeout(() => handlePrepComplete(), 0);
              return 30; // Start playing timer at 30
            }
            return t - 1;
          });
        } else {
          // PLAYING
          if (freezeTimer) return;
          setMatchTimer((t) => {
            if (t <= 1) {
              const isPlayerHider = match.currentRound % 2 !== 0;
              setTimeout(() => handleRoundEnd(isPlayerHider), 0);
              return 0;
            }
            return t - 1;
          });
        }
      }, 1000);

      return () => clearInterval(interval);
    }, [status, mode, match.currentRound, handleRoundEnd, handlePrepComplete, freezeTimer]);

    const shadowSize = settings.worldSize * 1.5;

    const effectiveSettings = useMemo(
      () => ({
        ...settings,
        cameraZoom,
        cameraFollow,
      }),
      [settings, cameraZoom, cameraFollow],
    );

    const sunPosition = useMemo<[number, number, number]>(() => {
      const radAzimuth = (sunAzimuth * Math.PI) / 180;
      const radElevation = (sunElevation * Math.PI) / 180;
      const sunDistance = 140;
      return [
        Math.cos(radAzimuth) * Math.cos(radElevation) * sunDistance,
        Math.sin(radElevation) * sunDistance,
        Math.sin(radAzimuth) * Math.cos(radElevation) * sunDistance,
      ];
    }, [sunAzimuth, sunElevation]);

    return (
      <>
        <Leva
          collapsed={true}
          titleBar={{ title: 'Parkubes DevTools', drag: true }}
          theme={{
            sizes: {
              rootWidth: `${devToolsWidth}px`,
              controlWidth: '110px',
              numberInputMinWidth: '40px',
              scrubberWidth: '12px',
              rowHeight: '26px',
            },
            space: {
              rowGap: '4px',
              colGap: '8px',
            },
            fontSizes: {
              root: '11px',
            },
            colors: {
              elevation1: `rgba(18, 18, 22, ${devToolsOpacity})`,
              elevation2: `rgba(30, 30, 36, ${devToolsOpacity})`,
              elevation3: `rgba(10, 10, 14, ${devToolsOpacity})`,
              toolTipBackground: `rgba(10, 10, 14, ${devToolsOpacity})`,
            },
          }}
        />
        <MatchContext.Provider value={{ timer: matchTimer }}>
          <Canvas
            shadows
            gl={{ antialias: true }}
            onContextMenu={(e) => e.preventDefault()}
            onCreated={({ gl }) => {
              const canvas = gl.domElement;
              canvas.addEventListener('webglcontextlost', (e) => {
                e.preventDefault();
                console.warn('WebGL context lost. Attempting recovery...');
              });
              canvas.addEventListener('webglcontextrestored', () => {
                console.log('WebGL context restored.');
              });
            }}
          >
            {showPerfMonitor && <Perf position="bottom-left" />}
            <OrthographicCamera makeDefault position={[100, 100, 100]} near={0.1} far={5000} />
            <Sky sunPosition={sunPosition} turbidity={0.01} rayleigh={0.1} />
            <Stars radius={150} depth={50} count={3000} factor={4} saturation={0} fade speed={1} />
            <ambientLight intensity={ambientIntensity} />
            <directionalLight
              castShadow
              position={sunPosition}
              intensity={sunIntensity}
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-shadowSize}
              shadow-camera-right={shadowSize}
              shadow-camera-top={shadowSize}
              shadow-camera-bottom={-shadowSize}
              shadow-camera-near={0.1}
              shadow-camera-far={500}
              shadow-bias={-0.0005}
            />
            <OrbitControls
              makeDefault
              enabled={true}
              mouseButtons={{
                LEFT: addDestinationMode ? undefined : THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.PAN,
                RIGHT: THREE.MOUSE.ROTATE,
              }}
            />
            <VoxelSeek
              status={status}
              mode={mode}
              match={match}
              settings={effectiveSettings}
              onRoundEnd={handleRoundEnd}
              onPrepComplete={handlePrepComplete}
              godMode={godMode}
              showGrid={showGrid}
              showCollision={showCollision}
              showWireframe={showWireframe}
              showOcclusion={showOcclusion}
              showAIPath={showAIPath}
              alwaysShowAI={alwaysShowAI}
              addDestinationMode={addDestinationMode}
              isEditing={isEditing}
              mapId={mapId}
            />
            <ContactShadows
              position={[0, -0.01, 0]}
              opacity={0.5}
              scale={150}
              blur={2.5}
              far={10}
              color="#000000"
            />
          </Canvas>
        </MatchContext.Provider>

        <GameInterface
          {...gameInterfaceProps}
          matchTimer={matchTimer}
          godMode={godMode}
          freezeTimer={freezeTimer}
          handleRoundEnd={handleRoundEnd}
        />
      </>
    );
  },
);

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>({
    status: GameStatus.IDLE,
    mode: GameMode.FREE,
    match: {
      currentRound: 1,
      maxRounds: 4,
      scorePlayer: 0,
      timer: 0,
    },
    taunt: 'Pratique seu parkour!',
    hint: 'Use obstáculos para ganhar altura.',
    settings: {
      worldSize: 50,
      playerSpeed: 0.85,
      staminaDuration: 2.0,
      cameraZoom: 15,
      cameraFollow: false,
      ratios: {
        farm: 0,
        house: 45,
        highrise: 0,
        factory: 0,
        ruins: 0,
        foliage: 0,
      },
      riverWidth: 0,
      riverFlow: 3,
    },
    mapId: 0,
    lastRoundResult: '',
  });

  const [showMission, setShowMission] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const startGame = useCallback(() => {
    setGameState((prev) => ({
      ...prev,
      status: GameStatus.PREP,
      lastRoundResult: '',
      match: {
        ...prev.match,
        currentRound: 1,
        scorePlayer: 0,
        timer: 3,
      },
    }));
  }, []);

  const playAgain = useCallback(() => {
    setGameState((prev) => ({
      ...prev,
      status: GameStatus.PREP,
      lastRoundResult: '',
      match: {
        ...prev.match,
        currentRound: 1,
        scorePlayer: 0,
        timer: 3,
      },
      mapId: prev.mapId + 1,
    }));
  }, []);

  const togglePause = useCallback(() => {
    setGameState((prev) => {
      if (prev.status === GameStatus.PLAYING || prev.status === GameStatus.PREP)
        return { ...prev, status: GameStatus.PAUSED };
      if (prev.status === GameStatus.PAUSED) return { ...prev, status: GameStatus.PLAYING };
      return prev;
    });
  }, []);

  const restartRound = useCallback(() => {
    setGameState((prev) => ({
      ...prev,
      status: GameStatus.PREP,
      lastRoundResult: '',
      match: {
        ...prev.match,
        timer: 3,
      },
    }));
  }, []);

  const resetToMenu = useCallback(() => {
    setGameState((prev) => ({
      ...prev,
      lastRoundResult: '',
      status: GameStatus.IDLE,
    }));
  }, []);

  const updateSetting = useCallback(
    <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
      setGameState((prev) => {
        const shouldRegen = key === 'worldSize' || key === 'riverWidth';
        return {
          ...prev,
          settings: { ...prev.settings, [key]: value },
          mapId: shouldRegen ? prev.mapId + 1 : prev.mapId,
        };
      });
    },
    [],
  );

  const resetRatios = useCallback(() => {
    setGameState((prev) => {
      const newRandom = getRandomSettings();
      return {
        ...prev,
        settings: { ...prev.settings, ...newRandom },
        mapId: prev.mapId + 1,
      };
    });
  }, []);

  const updateRatio = useCallback(
    (changedKey: keyof GameSettings['ratios'], newValue: number) => {
      setGameState((prev) => {
        const ratios = { ...prev.settings.ratios, [changedKey]: newValue };
        return {
          ...prev,
          settings: { ...prev.settings, ratios },
          mapId: prev.mapId + 1,
        };
      });
    },
    [],
  );

  const nextRound = useCallback(() => {
    setGameState((prev) => {
      const nextRound = prev.match.currentRound + 1;
      if (nextRound > prev.match.maxRounds) {
        return { ...prev, status: GameStatus.GAME_OVER };
      }
      return {
        ...prev,
        status: GameStatus.PREP,
        lastRoundResult: '',
        match: {
          ...prev.match,
          currentRound: nextRound,
          timer: 3,
        },
      };
    });
  }, []);

  const handleRoundEnd = useCallback((playerWon: boolean) => {
    setGameState((prev) => {
      const newScorePlayer = playerWon ? prev.match.scorePlayer + 1 : prev.match.scorePlayer;
      const isGameOver = prev.match.currentRound >= prev.match.maxRounds;

      let lastRoundResult = '';
      if (prev.mode === GameMode.HIDE_AND_SEEK) {
        const wasPlayerHider = prev.match.currentRound % 2 !== 0;
        if (wasPlayerHider) {
          lastRoundResult = playerWon ? 'Você escapou!' : 'Você foi pego';
        } else {
          lastRoundResult = playerWon ? 'Você pegou!' : 'A IA escapou!';
        }
      }

      return {
        ...prev,
        status: isGameOver ? GameStatus.GAME_OVER : GameStatus.ROUND_OVER,
        lastRoundResult,
        match: {
          ...prev.match,
          scorePlayer: newScorePlayer,
        },
      };
    });
  }, []);

  const handlePrepComplete = useCallback(() => {
    setGameState((prev) => ({ ...prev, status: GameStatus.PLAYING }));
  }, []);

  useEffect(() => {
    if (gameState.status === GameStatus.PREP) {
      setShowMission(true);
      const timeout = setTimeout(() => {
        setShowMission(false);
      }, 3000);
      return () => clearTimeout(timeout);
    } else {
      setShowMission(false);
    }
  }, [gameState.status, gameState.match.currentRound]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') togglePause();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePause]);

  const showVirtualControls =
    gameState.status === GameStatus.PLAYING || gameState.status === GameStatus.PREP;

  const setGameMode = useCallback((mode: GameMode) => {
    setGameState((prev) => ({ ...prev, mode }));
  }, []);

  const gameInterfaceProps = useMemo(
    () => ({
      gameState,
      togglePause,
      startGame,
      playAgain,
      restartRound,
      nextRound,
      resetToMenu,
      updateSetting,
      updateRatio,
      resetRatios,
      showMission,
      setIsEditing,
      setGameMode,
    }),
    [
      gameState,
      togglePause,
      startGame,
      playAgain,
      restartRound,
      nextRound,
      resetToMenu,
      updateSetting,
      updateRatio,
      resetRatios,
      showMission,
      setIsEditing,
      setGameMode,
    ],
  );

  return (
    <div className="relative w-full h-screen bg-gray-950 select-none overflow-hidden">
      <GameLayout
        status={gameState.status}
        mode={gameState.mode}
        match={gameState.match}
        settings={gameState.settings}
        isEditing={isEditing}
        mapId={gameState.mapId}
        handleRoundEnd={handleRoundEnd}
        handlePrepComplete={handlePrepComplete}
        restartRound={restartRound}
        nextRound={nextRound}
        gameInterfaceProps={gameInterfaceProps}
      />
      <OnScreenControls visible={showVirtualControls} />
    </div>
  );
};

export default App;
