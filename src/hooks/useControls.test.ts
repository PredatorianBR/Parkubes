import { renderHook } from '@testing-library/react';
import { useControls } from './useControls';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('useControls hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with empty keys', () => {
    const { result } = renderHook(() => useControls());
    expect(result.current.current).toEqual({});
  });

  describe('Keyboard Events', () => {
    it('should set key to true on keydown', () => {
      const { result } = renderHook(() => useControls());

      const event = new KeyboardEvent('keydown', { key: 'W' });
      window.dispatchEvent(event);

      expect(result.current.current['w']).toBe(true);
    });

    it('should set key to false on keyup', () => {
      const { result } = renderHook(() => useControls());

      const downEvent = new KeyboardEvent('keydown', { key: 'W' });
      window.dispatchEvent(downEvent);
      expect(result.current.current['w']).toBe(true);

      const upEvent = new KeyboardEvent('keyup', { key: 'w' });
      window.dispatchEvent(upEvent);
      expect(result.current.current['w']).toBe(false);
    });
  });

  describe('Custom Virtual Events', () => {
    it('should handle game-control-down event', () => {
      const { result } = renderHook(() => useControls());

      const event = new CustomEvent('game-control-down', { detail: { key: 'Space' } });
      window.dispatchEvent(event);

      expect(result.current.current['space']).toBe(true);
    });

    it('should handle game-control-up event', () => {
      const { result } = renderHook(() => useControls());

      const downEvent = new CustomEvent('game-control-down', { detail: { key: 'Space' } });
      window.dispatchEvent(downEvent);
      expect(result.current.current['space']).toBe(true);

      const upEvent = new CustomEvent('game-control-up', { detail: { key: 'Space' } });
      window.dispatchEvent(upEvent);
      expect(result.current.current['space']).toBe(false);
    });

    it('should safely ignore custom events without key detail', () => {
      const { result } = renderHook(() => useControls());

      const event = new CustomEvent('game-control-down', { detail: {} });
      window.dispatchEvent(event);

      expect(result.current.current).toEqual({});
    });
  });

  describe('Analog Joystick Events', () => {
    it('should update analog values on game-joystick-move', () => {
      const { result } = renderHook(() => useControls());

      const event = new CustomEvent('game-joystick-move', { detail: { x: 0.5, y: -0.5 } });
      window.dispatchEvent(event);

      expect(result.current.current.analog).toEqual({ x: 0.5, y: -0.5 });
    });

    it('should reset analog values to 0 on game-joystick-end', () => {
      const { result } = renderHook(() => useControls());

      const moveEvent = new CustomEvent('game-joystick-move', { detail: { x: 0.5, y: -0.5 } });
      window.dispatchEvent(moveEvent);
      expect(result.current.current.analog).toEqual({ x: 0.5, y: -0.5 });

      const endEvent = new CustomEvent('game-joystick-end');
      window.dispatchEvent(endEvent);
      expect(result.current.current.analog).toEqual({ x: 0, y: 0 });
    });
  });

  describe('Cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => useControls());

      // Should have added 6 listeners
      expect(addEventListenerSpy).toHaveBeenCalledTimes(6);
      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('keyup', expect.any(Function));

      unmount();

      // Should have removed 6 listeners
      expect(removeEventListenerSpy).toHaveBeenCalledTimes(6);
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keyup', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('game-control-down', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('game-control-up', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('game-joystick-move', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('game-joystick-end', expect.any(Function));
    });
  });
});
