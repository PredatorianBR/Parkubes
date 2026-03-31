import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { updatePlayerPhysics } from './player';
import * as physics from './physics';

// Mock the physics engine to isolate player input logic
vi.mock('./physics', () => ({
  updateEntityPhysics: vi.fn()
}));

// Helper to create mutable refs easily for testing
const createRef = <T>(initialValue: T) => ({ current: initialValue });

describe('updatePlayerPhysics', () => {
  let defaultCamera: THREE.Camera;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup a default camera pointing forward (along -Z)
    defaultCamera = new THREE.Camera();
    defaultCamera.position.set(0, 0, 0);
    defaultCamera.lookAt(0, 0, -1);
    defaultCamera.updateMatrixWorld();

    // Default physics mock return value
    (physics.updateEntityPhysics as any).mockReturnValue({
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(0, 0, 0),
      isGrounded: true,
      isClimbing: false,
      isCharging: false,
      isRolling: false,
      didStepUp: false,
      stamina: 100,
      stunned: false,
      stumbleTimer: 0,
      stumbleVel: new THREE.Vector3(0, 0, 0),
      airTimeHigh: 0,
      lastDir: new THREE.Vector2(0, 1),
      noiseLevel: 0
    });
  });

  const createMockParams = () => ({
    dt: 1 / 60,
    pos: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    isGrounded: createRef(true),
    isChargingRef: createRef(false),
    landingAnimTimer: createRef(0),
    jumpDelayTimer: createRef(0),
    airTimeHighPoint: createRef(0),
    stamina: createRef(100),
    stunTimer: createRef(0),
    stunned: false,
    keys: createRef<Record<string, any>>({}),
    playerLastDir: createRef(new THREE.Vector2(0, 1)),
    jumpPressedPrev: createRef(false),
    speedSettings: 5,
    occupancyGrid: [],
    bridgeGrid: [],
    waterGrid: [],
    worldSize: 100,
    canMove: true,
    rollTimer: createRef(0),
    jumpBufferTimer: createRef(0),
    isRollingRef: createRef(false),
    stepUpTimer: createRef(0),
    stumbleTimer: createRef(0),
    stumbleVelocityRef: createRef(new THREE.Vector3(0, 0, 0)),
    camera: defaultCamera,
    lastFallDistRef: createRef(0)
  });

  it('initializes and calculates basic input direction with keyboard (forward)', () => {
    const params = createMockParams();
    params.keys.current['w'] = true; // Press 'W' to move forward

    updatePlayerPhysics(
      params.dt, params.pos, params.velocity, params.isGrounded, params.isChargingRef,
      params.landingAnimTimer, params.jumpDelayTimer, params.airTimeHighPoint, params.stamina,
      params.stunTimer, params.stunned, params.keys, params.playerLastDir, params.jumpPressedPrev,
      params.speedSettings, params.occupancyGrid, params.bridgeGrid, params.waterGrid,
      params.worldSize, params.canMove, params.rollTimer, params.jumpBufferTimer,
      params.isRollingRef, params.stepUpTimer, params.stumbleTimer, params.stumbleVelocityRef,
      params.camera, params.lastFallDistRef
    );

    // Camera looks at -Z, so forward ('w') means moving along -Z.
    // However, the exact value depends on cross products and normalizations inside.
    // The main point is that updateEntityPhysics receives the correctly mapped moveDir.
    expect(physics.updateEntityPhysics).toHaveBeenCalledTimes(1);

    // Check the inputs object passed to physics
    const callArgs = (physics.updateEntityPhysics as any).mock.calls[0][1];

    // Camera forward should be [0, 0, -1]
    expect(callArgs.moveDir.x).toBeCloseTo(0);
    expect(callArgs.moveDir.y).toBeCloseTo(0);
    expect(callArgs.moveDir.z).toBeCloseTo(-1);
  });

  it('prioritizes analog input over keyboard and correctly scales movement', () => {
    const params = createMockParams();
    // Setting both to simulate conflicting inputs
    params.keys.current['w'] = true;
    params.keys.current.analog = { x: 0.5, y: -0.5 }; // Analog pushing up and right

    updatePlayerPhysics(
      params.dt, params.pos, params.velocity, params.isGrounded, params.isChargingRef,
      params.landingAnimTimer, params.jumpDelayTimer, params.airTimeHighPoint, params.stamina,
      params.stunTimer, params.stunned, params.keys, params.playerLastDir, params.jumpPressedPrev,
      params.speedSettings, params.occupancyGrid, params.bridgeGrid, params.waterGrid,
      params.worldSize, params.canMove, params.rollTimer, params.jumpBufferTimer,
      params.isRollingRef, params.stepUpTimer, params.stumbleTimer, params.stumbleVelocityRef,
      params.camera, params.lastFallDistRef
    );

    const callArgs = (physics.updateEntityPhysics as any).mock.calls[0][1];

    // Y mapped to forward (z), X mapped to right (x)
    // -0.5 y -> inverted to 0.5 * forward (-Z) -> -0.5 Z
    // 0.5 x -> 0.5 * right (+X) -> 0.5 X
    expect(callArgs.moveDir.x).toBeCloseTo(0.5);
    expect(callArgs.moveDir.z).toBeCloseTo(-0.5);

    // W key should be ignored
  });

  it('handles stun timer and prevents movement', () => {
    const params = createMockParams();
    params.stunTimer.current = 1.0;
    params.stunned = true; // The game loop sets this based on state
    params.keys.current['w'] = true;

    updatePlayerPhysics(
      params.dt, params.pos, params.velocity, params.isGrounded, params.isChargingRef,
      params.landingAnimTimer, params.jumpDelayTimer, params.airTimeHighPoint, params.stamina,
      params.stunTimer, params.stunned, params.keys, params.playerLastDir, params.jumpPressedPrev,
      params.speedSettings, params.occupancyGrid, params.bridgeGrid, params.waterGrid,
      params.worldSize, params.canMove, params.rollTimer, params.jumpBufferTimer,
      params.isRollingRef, params.stepUpTimer, params.stumbleTimer, params.stumbleVelocityRef,
      params.camera, params.lastFallDistRef
    );

    // Stun timer should decrease
    expect(params.stunTimer.current).toBeCloseTo(1.0 - params.dt);

    // movement should be prevented (0, 0, 0 vector)
    const callArgs = (physics.updateEntityPhysics as any).mock.calls[0][1];
    expect(callArgs.moveDir.x).toBeCloseTo(0);
    expect(callArgs.moveDir.y).toBeCloseTo(0);
    expect(callArgs.moveDir.z).toBeCloseTo(0);
  });

  it('sets up jump buffer when jump is just pressed', () => {
    const params = createMockParams();
    params.keys.current[' '] = true; // jump pressed
    params.jumpPressedPrev.current = false; // not pressed previously

    updatePlayerPhysics(
      params.dt, params.pos, params.velocity, params.isGrounded, params.isChargingRef,
      params.landingAnimTimer, params.jumpDelayTimer, params.airTimeHighPoint, params.stamina,
      params.stunTimer, params.stunned, params.keys, params.playerLastDir, params.jumpPressedPrev,
      params.speedSettings, params.occupancyGrid, params.bridgeGrid, params.waterGrid,
      params.worldSize, params.canMove, params.rollTimer, params.jumpBufferTimer,
      params.isRollingRef, params.stepUpTimer, params.stumbleTimer, params.stumbleVelocityRef,
      params.camera, params.lastFallDistRef
    );

    // 0.2 buffer time minus current dt
    expect(params.jumpBufferTimer.current).toBeCloseTo(0.2 - params.dt);

    // The previous jump state should be updated for next frame
    expect(params.jumpPressedPrev.current).toBe(true);
  });

  it('triggers jump after delay timer finishes', () => {
    const params = createMockParams();
    params.jumpDelayTimer.current = params.dt; // Exactly 1 frame left

    updatePlayerPhysics(
      params.dt, params.pos, params.velocity, params.isGrounded, params.isChargingRef,
      params.landingAnimTimer, params.jumpDelayTimer, params.airTimeHighPoint, params.stamina,
      params.stunTimer, params.stunned, params.keys, params.playerLastDir, params.jumpPressedPrev,
      params.speedSettings, params.occupancyGrid, params.bridgeGrid, params.waterGrid,
      params.worldSize, params.canMove, params.rollTimer, params.jumpBufferTimer,
      params.isRollingRef, params.stepUpTimer, params.stumbleTimer, params.stumbleVelocityRef,
      params.camera, params.lastFallDistRef
    );

    expect(params.jumpDelayTimer.current).toBe(0); // Timer finished

    // Physics engine should receive a jump action
    const callArgs = (physics.updateEntityPhysics as any).mock.calls[0][1];
    expect(callArgs.actions.jump).toBe(true);
  });

  it('handles fall damage severity and triggers stun', () => {
    const params = createMockParams();

    // Simulate physics engine returning a stunned state due to fall
    (physics.updateEntityPhysics as any).mockReturnValue({
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(0, 0, 0),
      isGrounded: true,
      stunned: true, // Entity got stunned this frame
      airTimeHigh: 10, // Fell from y=10 to y=0
      lastDir: new THREE.Vector2(0, 1),
      stumbleTimer: 0,
      stumbleVel: new THREE.Vector3(0, 0, 0),
    });

    const result = updatePlayerPhysics(
      params.dt, params.pos, params.velocity, params.isGrounded, params.isChargingRef,
      params.landingAnimTimer, params.jumpDelayTimer, params.airTimeHighPoint, params.stamina,
      params.stunTimer, params.stunned, params.keys, params.playerLastDir, params.jumpPressedPrev,
      params.speedSettings, params.occupancyGrid, params.bridgeGrid, params.waterGrid,
      params.worldSize, params.canMove, params.rollTimer, params.jumpBufferTimer,
      params.isRollingRef, params.stepUpTimer, params.stumbleTimer, params.stumbleVelocityRef,
      params.camera, params.lastFallDistRef
    );

    // Fall severity = (airTimeHigh - pos.y) - 2.5 = (10 - 0) - 2.5 = 7.5
    // stunTimer = max(2.0, 7.5 * 0.8) = 6.0
    expect(params.stunTimer.current).toBe(6.0);
    expect(params.stumbleTimer.current).toBe(0.15);

    // Return value should indicate stun
    expect(result.effectiveStunned).toBe(true);
  });
});