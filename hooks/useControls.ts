
import { useEffect, useRef } from 'react';

export const useControls = () => {
  const keys = useRef<{ [key: string]: boolean }>({});

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

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('game-control-down', virtualDown);
    window.addEventListener('game-control-up', virtualUp);

    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('game-control-down', virtualDown);
      window.removeEventListener('game-control-up', virtualUp);
    };
  }, []);

  return keys;
};
