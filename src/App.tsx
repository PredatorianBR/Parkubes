
import React, { useState, useEffect, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrthographicCamera, Stars, Sky, ContactShadows, OrbitControls } from '@react-three/drei';
import { VoxelSeek } from './components/VoxelSeek';
import { GameInterface } from './components/ui/GameInterface';
import { OnScreenControls } from './components/ui/OnScreenControls';
import { GameStatus, GameState, GameSettings, GameMode } from './types';
import * as THREE from 'three';
const getRandomSettings = () => {
  // Randomize Ratios (Sum to 100)
  const keys = ['farm', 'house', 'highrise', 'factory', 'ruins', 'foliage'] as const;
  let rawValues = keys.map(() => Math.random());
  const sum = rawValues.reduce((a, b) => a + b, 0);
  const normalized = rawValues.map(v => Math.round((v / sum) * 100));

  // Fix potential rounding issues to ensure sum is exactly 100
  let currentSum = normalized.reduce((a, b) => a + b, 0);
  if (currentSum !== 100) {
    normalized[0] += (100 - currentSum);
  }

  return {
    ratios: {
      farm: normalized[0],
      house: normalized[1],
      highrise: normalized[2],
      factory: normalized[3],
      ruins: normalized[4],
      foliage: Math.floor(Math.random() * 40) // Foliage is density 0-40% independently or part of it
    },
    riverWidth: Math.floor(Math.random() * 6), // 0 to 5
    riverFlow: Math.floor(Math.random() * 5) + 1 // 1 to 5
  };
};

const App: React.FC = () => {
  const initialRandom = getRandomSettings();
  const [gameState, setGameState] = useState<GameState>({
    status: GameStatus.IDLE,
    mode: GameMode.FREE,
    match: {
      currentRound: 1,
      maxRounds: 4,
      scorePlayer: 0,
      scoreAI: 0,
      playerRole: 'SEEKER',
      phase: 'WAITING',
      timer: 0 // Timer managed by VoxelSeek or app interval
    },
    taunt: "Pratique seu parkour!",
    hint: "Use obstáculos para ganhar altura.",
    settings: {
      worldSize: 50,
      playerSpeed: 0.85,
      staminaDuration: 2.0,
      cameraZoom: 15,
      cameraFollow: false,
      ratios: {
        farm: 0,
        house: 0,
        highrise: 0,
        factory: 0,
        ruins: 0,
        foliage: 0
      },
      riverWidth: 0,
      riverFlow: 3
    },
    mapId: 0
  });

  const [matchTimer, setMatchTimer] = useState(0);
  const [debugMode, setDebugMode] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showCollision, setShowCollision] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false); // Novo estado
  const [showMission, setShowMission] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const startGame = () => {
    setMatchTimer(3);
    setGameState(prev => ({
      ...prev,
      status: GameStatus.PREP,
      match: { 
        ...prev.match, 
        currentRound: 1, 
        scorePlayer: 0, 
        scoreAI: 0, 
        playerRole: 'SEEKER',
        phase: 'WAITING',
        timer: 3 // Keep for state consistency if needed, but matchTimer handles HUD
      }
    }));
  };

  const playAgain = () => {
    setMatchTimer(3);
    setGameState(prev => ({
      ...prev,
      status: GameStatus.PREP,
      match: { 
        ...prev.match, 
        currentRound: 1, 
        scorePlayer: 0, 
        scoreAI: 0, 
        playerRole: 'SEEKER',
        phase: 'WAITING',
        timer: 3
      },
      mapId: prev.mapId + 1
    }));
  };

  const togglePause = useCallback(() => {
    setGameState(prev => {
      if (prev.status === GameStatus.PLAYING || prev.status === GameStatus.PREP) return { ...prev, status: GameStatus.PAUSED };
      if (prev.status === GameStatus.PAUSED) return { ...prev, status: GameStatus.PLAYING };
      return prev;
    });
  }, []);

  const restartRound = () => {
    setMatchTimer(3);
    setGameState(prev => ({ 
      ...prev, 
      status: GameStatus.PREP,
      match: {
        ...prev.match,
        phase: 'WAITING',
        timer: 3
      }
    }));
  };

  const resetToMenu = () => {
    setGameState(prev => ({
      ...prev,
      status: GameStatus.IDLE
    }));
  };

  const updateSetting = (key: keyof GameSettings, value: any) => {
    setGameState(prev => {
      // Only regenerate map if structural settings change
      const shouldRegen = key === 'worldSize' || key === 'riverWidth';
      return {
        ...prev,
        settings: { ...prev.settings, [key]: value },
        mapId: shouldRegen ? prev.mapId + 1 : prev.mapId
      };
    });
  };

  const resetRatios = () => {
    setGameState(prev => {
      const newRandom = getRandomSettings();
      return {
        ...prev,
        settings: {
          ...prev.settings,
          ...newRandom
        },
        mapId: prev.mapId + 1
      };
    });
  };

  const updateRatio = (changedKey: keyof GameSettings['ratios'], newValue: number) => {
    setGameState(prev => {
      const ratios = { ...prev.settings.ratios, [changedKey]: newValue };
      return {
        ...prev,
        settings: { ...prev.settings, ratios },
        mapId: prev.mapId + 1
      };
    });
  };

  const nextRound = useCallback(() => {
    setGameState(prev => {
      const nextRound = prev.match.currentRound + 1;
      if (nextRound > prev.match.maxRounds) {
        return { ...prev, status: GameStatus.GAME_OVER };
      }
      setMatchTimer(3);
      return {
        ...prev, status: GameStatus.PREP,
        match: { 
          ...prev.match, 
          currentRound: nextRound,
          playerRole: nextRound % 2 === 0 ? 'HIDER' : 'SEEKER',
          phase: 'WAITING',
          timer: 3
        }
      };
    });
  }, []);

  const handleRoundEnd = useCallback((playerWon: boolean) => {
    setGameState(prev => {
      // Determine if it was Seeker winning (catching) or Hider surviving
      const newScorePlayer = playerWon ? prev.match.scorePlayer + 1 : prev.match.scorePlayer;
      const newScoreAI = !playerWon ? (prev.match.scoreAI ?? 0) + 1 : prev.match.scoreAI;
      
      const isGameOver = prev.match.currentRound >= prev.match.maxRounds;
      
      return {
        ...prev, 
        status: isGameOver ? GameStatus.GAME_OVER : GameStatus.ROUND_OVER,
        match: { 
          ...prev.match, 
          scorePlayer: newScorePlayer,
          scoreAI: newScoreAI
        }
      };
    });
  }, []);

  const handlePrepComplete = useCallback(() => {
    setGameState(prev => ({ ...prev, status: GameStatus.PLAYING }));
  }, []);

  useEffect(() => {
    if (debugMode) {
      setShowGrid(true);
    } else {
      setShowGrid(false);
      setShowCollision(false);
    }
  }, [debugMode]);

  useEffect(() => {
    if (gameState.status === GameStatus.PREP) {
      setShowMission(true);
      const timeout = setTimeout(() => { setShowMission(false); }, 3000);
      return () => clearTimeout(timeout);
    } else {
      setShowMission(false);
    }
  }, [gameState.status, gameState.match.currentRound]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') togglePause(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePause]);

  // Timer decrement: simple interval that only updates matchTimer
  useEffect(() => {
    if (gameState.mode !== GameMode.HIDE_AND_SEEK || gameState.status !== GameStatus.PLAYING) return;
    
    const interval = setInterval(() => {
      setMatchTimer(t => t - 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [gameState.status, gameState.mode]);

  // Phase & Round Transitions: observe matchTimer and act on 0
  useEffect(() => {
    if (gameState.mode !== GameMode.HIDE_AND_SEEK || gameState.status !== GameStatus.PLAYING) return;

    if (matchTimer <= 0) {
      setGameState(prev => {
        if (prev.status !== GameStatus.PLAYING) return prev;

        if (prev.match.phase === 'WAITING') {
          // Finish waiting -> Start hunting
          setMatchTimer(30);
          return {
            ...prev,
            match: {
              ...prev.match,
              phase: 'HUNTING',
              timer: 30
            }
          };
        } else if (prev.match.phase === 'HUNTING') {
          // Finish hunting (time is up) -> Round Over
          const playerIsHider = prev.match.playerRole === 'HIDER';
          const newScorePlayer = playerIsHider ? prev.match.scorePlayer + 1 : prev.match.scorePlayer;
          const newScoreAI = !playerIsHider ? (prev.match.scoreAI ?? 0) + 1 : prev.match.scoreAI;
          const isGameOver = prev.match.currentRound >= prev.match.maxRounds;
          
          return {
            ...prev,
            status: isGameOver ? GameStatus.GAME_OVER : GameStatus.ROUND_OVER,
            match: {
              ...prev.match,
              timer: 0,
              scorePlayer: newScorePlayer,
              scoreAI: newScoreAI
            }
          };
        }
        return prev;
      });
    }
  }, [matchTimer, gameState.mode, gameState.status]);

  const shadowSize = gameState.settings.worldSize * 1.5;

  const showVirtualControls = gameState.status === GameStatus.PLAYING || gameState.status === GameStatus.PREP;

  return (
    <div className="relative w-full h-screen bg-gray-950 select-none overflow-hidden">
      <Canvas shadows gl={{ antialias: true }} onCreated={({ gl }) => {
        const canvas = gl.domElement;
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          console.warn('WebGL context lost. Attempting recovery...');
        });
        canvas.addEventListener('webglcontextrestored', () => {
          console.log('WebGL context restored.');
        });
      }}>
        <OrthographicCamera
          makeDefault
          position={[100, 100, 100]}
          near={0.1}
          far={5000}
          zoom={gameState.settings.cameraZoom}
        />
        <Sky sunPosition={[100, 50, 100]} turbidity={0.01} rayleigh={0.1} />
        <Stars radius={150} depth={50} count={3000} factor={4} saturation={0} fade speed={1} />
        <ambientLight intensity={0.4} />
        <directionalLight castShadow position={[60, 120, 40]} intensity={2.0} shadow-mapSize={[2048, 2048]} shadow-camera-left={-shadowSize} shadow-camera-right={shadowSize} shadow-camera-top={shadowSize} shadow-camera-bottom={-shadowSize} shadow-camera-near={0.1} shadow-camera-far={500} shadow-bias={-0.0005} />
        <OrbitControls makeDefault enabled={true} />
        <VoxelSeek
          status={gameState.status}
          mode={gameState.mode}
          match={gameState.match}
          settings={gameState.settings}
          timer={gameState.match.phase === 'WAITING' ? matchTimer : 0}
          onRoundEnd={handleRoundEnd}
          onPrepComplete={handlePrepComplete}
          debugMode={debugMode}
          showGrid={showGrid}
          showCollision={showCollision}
          showWireframe={showWireframe}
          isEditing={isEditing}
          mapId={gameState.mapId}
        />
        <ContactShadows position={[0, -0.01, 0]} opacity={0.5} scale={150} blur={2.5} far={10} color="#000000" />
      </Canvas>

      <GameInterface
        gameState={gameState}
        matchTimer={matchTimer}
        debugMode={debugMode}
        setDebugMode={setDebugMode}
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        showCollision={showCollision}
        setShowCollision={setShowCollision}
        showWireframe={showWireframe}
        setShowWireframe={setShowWireframe}
        togglePause={togglePause}
        startGame={startGame}
        playAgain={playAgain}
        restartRound={restartRound}
        nextRound={nextRound}
        resetToMenu={resetToMenu}
        updateSetting={updateSetting}
        updateRatio={updateRatio}
        resetRatios={resetRatios}
        showMission={showMission}
        setIsEditing={setIsEditing}
        setGameMode={(mode) => setGameState(prev => ({ ...prev, mode }))}
      />

      <OnScreenControls visible={showVirtualControls} />
    </div>
  );
};

export default App;
