
import React, { useState, useEffect, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrthographicCamera, Stars, Sky, ContactShadows, OrbitControls } from '@react-three/drei';
import { VoxelSeek } from './components/VoxelSeek';
import { GameInterface } from './components/GameInterface';
import { OnScreenControls } from './components/OnScreenControls';
import { GameStatus, GameState, GameSettings } from './types';
import * as THREE from 'three';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>({
    status: GameStatus.IDLE,
    match: {
      currentRound: 1,
      maxRounds: 4,
      scorePlayer: 0,
      timer: 0 // Timer ignored
    },
    taunt: "Pratique seu parkour!",
    hint: "Use obstáculos para ganhar altura.",
    settings: {
      worldSize: 32,
      playerSpeed: 0.7,
      staminaDuration: 2.0,
      riverWidth: 3,
      cameraZoom: 30,
      cameraFollow: true, // DEFAULT TRUE
      lockedRatios: [],
      ratios: {
        farm: 20,
        house: 30,
        highrise: 20,
        factory: 15,
        ruins: 10
      }
    },
    mapId: 0
  });

  const [debugMode, setDebugMode] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [showCollision, setShowCollision] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false); // Novo estado
  const [showMission, setShowMission] = useState(false);
  const [isEditing, setIsEditing] = useState(false); 

  const startGame = () => {
    setGameState(prev => ({
      ...prev,
      status: GameStatus.PREP,
      match: { ...prev.match, currentRound: 1, scorePlayer: 0 }
    }));
  };

  const playAgain = () => {
    setGameState(prev => ({
      ...prev,
      status: GameStatus.PREP,
      match: { ...prev.match, currentRound: 1, scorePlayer: 0 },
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
    setGameState(prev => ({ ...prev, status: GameStatus.PREP }));
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

  const toggleLock = (key: string) => {
      setGameState(prev => {
          const isLocked = prev.settings.lockedRatios.includes(key);
          const newLocked = isLocked 
            ? prev.settings.lockedRatios.filter(k => k !== key)
            : [...prev.settings.lockedRatios, key];
          
          return {
              ...prev,
              settings: { ...prev.settings, lockedRatios: newLocked }
          };
      });
  };

  const resetRatios = () => {
      setGameState(prev => ({
          ...prev,
          settings: {
              ...prev.settings,
              lockedRatios: [],
              ratios: {
                farm: 20,
                house: 30,
                highrise: 20,
                factory: 15,
                ruins: 10
              }
          },
          mapId: prev.mapId + 1 // Always regen on reset
      }));
  };

  const updateRatio = (changedKey: keyof GameSettings['ratios'], rawNewValue: number) => {
      setGameState(prev => {
          const ratios = { ...prev.settings.ratios };
          let otherSum = 0;
          (Object.keys(ratios) as Array<keyof GameSettings['ratios']>).forEach(k => {
              if (k !== changedKey) {
                  // @ts-ignore
                  otherSum += ratios[k];
              }
          });
          const maxAvailable = 100 - otherSum;
          const newValue = Math.min(Math.max(0, rawNewValue), maxAvailable);
          ratios[changedKey] = newValue;
          return { 
              ...prev, 
              settings: { ...prev.settings, ratios },
              mapId: prev.mapId + 1 // Regen on ratio change
          };
      });
  }

  const nextRound = useCallback(() => {
    setGameState(prev => {
      const nextRound = prev.match.currentRound + 1;
      if (nextRound > prev.match.maxRounds) {
        return { ...prev, status: GameStatus.GAME_OVER };
      }
      return {
        ...prev, status: GameStatus.PREP,
        match: { ...prev.match, currentRound: nextRound }
      };
    });
  }, []);

  const handleRoundEnd = useCallback((playerWon: boolean) => {
    setGameState(prev => ({
      ...prev, status: GameStatus.ROUND_OVER,
      match: { ...prev.match, scorePlayer: prev.match.scorePlayer + 1 }
    }));
  }, []);

  const handlePrepComplete = useCallback(() => {
      setGameState(prev => ({ ...prev, status: GameStatus.PLAYING }));
  }, []);

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

  // Removed Timer Interval Logic

  const shadowSize = gameState.settings.worldSize * 1.5;

  const showVirtualControls = gameState.status === GameStatus.PLAYING || gameState.status === GameStatus.PREP;

  return (
    <div className="relative w-full h-screen bg-gray-950 select-none overflow-hidden">
      <Canvas shadows gl={{ antialias: true, shadowMapType: THREE.PCFSoftShadowMap }}>
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
            settings={gameState.settings} 
            timer={gameState.match.timer} 
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
        toggleLock={toggleLock}
        resetRatios={resetRatios}
        showMission={showMission}
        setIsEditing={setIsEditing}
      />

      <OnScreenControls visible={showVirtualControls} />
    </div>
  );
};

export default App;
