
import { useEffect, useRef } from 'react';

export const useControls = () => {
  const keys = useRef<{ [key: string]: boolean | { x: number; y: number } | undefined; analog?: { x: number; y: number } }>({});

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = true;
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = false;
    };

    // Custom events for touch/click controls
    const virtualDown = (e: any) => {
      if (e.detail?.key) keys.current[e.detail.key.toLowerCase()] = true;
    };
    const virtualUp = (e: any) => {
      if (e.detail?.key) keys.current[e.detail.key.toLowerCase()] = false;
    };

    // Analog Joystick Events
    const joystickMove = (e: any) => {
      if (e.detail) keys.current.analog = { x: e.detail.x, y: e.detail.y };
    };
    const joystickEnd = () => {
      keys.current.analog = { x: 0, y: 0 };
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('game-control-down', virtualDown);
    window.addEventListener('game-control-up', virtualUp);
    window.addEventListener('game-joystick-move', joystickMove);
    window.addEventListener('game-joystick-end', joystickEnd);

    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('game-control-down', virtualDown);
      window.removeEventListener('game-control-up', virtualUp);
      window.removeEventListener('game-joystick-move', joystickMove);
      window.removeEventListener('game-joystick-end', joystickEnd);
    };
  }, []);

  return keys;
};
