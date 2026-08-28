import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { NavigationGraph, NavNode } from './navigation';
import { SpatialHashGrid } from './physics';

describe('NavigationGraph - Rooftop Jump Connections', () => {
  it('creates jump edges between adjacent rooftop nodes across gaps', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Add Building 1: 4x4, height 6.0 at x: [-8, -4], z: [-2, 2]
    collisionGrid.insert({
      minX: -8,
      maxX: -4,
      minY: 0,
      maxY: 6.0,
      minZ: -2,
      maxZ: 2,
    });

    // Add Building 2: 4x4, height 6.0 at x: [-1, 3], z: [-2, 2] (3.0 meter gap between x = -4 and x = -1)
    collisionGrid.insert({
      minX: -1,
      maxX: 3,
      minY: 0,
      maxY: 6.0,
      minZ: -2,
      maxZ: 2,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));
    const wGrid = bGrid;
    const sGrid = bGrid;
    const tGrid = bGrid;

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid,
      sGrid,
      tGrid,
      ladderZones: [],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    // Find rooftop nodes on Building 1 and Building 2
    let roof1Node: NavNode | undefined;
    let roof2Node: NavNode | undefined;

    graph.nodes.forEach((node) => {
      if (Math.abs(node.y - 6.0) < 0.1) {
        if (node.x >= -7.5 && node.x <= -4.5) {
          roof1Node = node;
        } else if (node.x >= -0.5 && node.x <= 2.5) {
          roof2Node = node;
        }
      }
    });

    expect(roof1Node).toBeDefined();
    expect(roof2Node).toBeDefined();

    if (roof1Node && roof2Node) {
      // Find edge between roof1Node and roof2Node
      const edges = graph.edges.get(roof1Node.id) || [];
      const jumpEdge = edges.find((e) => e.target.y >= 5.5 && Math.abs(e.target.x - roof2Node!.x) < 1.5);

      expect(jumpEdge).toBeDefined();
      expect(jumpEdge?.type).toBe('jump');
    }
  });

  it('finds path across building rooftops using jump edges', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Building 1
    collisionGrid.insert({
      minX: -8,
      maxX: -4,
      minY: 0,
      maxY: 6.0,
      minZ: -2,
      maxZ: 2,
    });

    // Building 2 across gap
    collisionGrid.insert({
      minX: -1,
      maxX: 3,
      minY: 0,
      maxY: 6.0,
      minZ: -2,
      maxZ: 2,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    const startPos = new THREE.Vector3(-6.0, 6.0, 0.0);
    const endPos = new THREE.Vector3(1.0, 6.0, 0.0);

    const path = graph.findPath(startPos, endPos);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);

    // Check if at least one segment uses a jump edge
    let hasJump = false;
    for (let i = 0; i < path!.length - 1; i++) {
      const type = graph.getEdgeType(path![i], path![i + 1]);
      if (type === 'jump') {
        hasJump = true;
        break;
      }
    }
    expect(hasJump).toBe(true);
  });

  it('navigates from ground by climbing a nearby building with a ladder and jumping to a ladderless building rooftop (>1 floor)', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    const roofHeight = 12.0; // Multi-story building (e.g. 2 floors / highrise)

    // Building A (Ladderless): x: [3, 7], z: [-2, 2]
    collisionGrid.insert({
      minX: 3,
      maxX: 7,
      minY: 0,
      maxY: roofHeight,
      minZ: -2,
      maxZ: 2,
    });

    // Building B (With Ladder): x: [-4, 0], z: [-2, 2] (3m gap between Building B x=0 and Building A x=3)
    collisionGrid.insert({
      minX: -4,
      maxX: 0,
      minY: 0,
      maxY: roofHeight,
      minZ: -2,
      maxZ: 2,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    // Ladder attached to Building B
    const ladderZone = {
      minX: -2.5,
      maxX: -1.5,
      minY: 0,
      maxY: roofHeight,
      minZ: -2.5,
      maxZ: -1.5,
      faceAngle: 0,
      railX: -2.0,
      railZ: -2.0,
    };

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [ladderZone],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    // AI is on the ground near Building B
    const aiGroundPos = new THREE.Vector3(-10.0, 0.0, 0.0);
    // Player's last known position is on top of Building A (ladderless)
    const playerRoofPos = new THREE.Vector3(5.0, roofHeight, 0.0);

    const path = graph.findPath(aiGroundPos, playerRoofPos);

    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(2);

    // Verify path contains both a ladder climb transition and a jump transition
    let hasLadder = false;
    let hasJump = false;

    for (let i = 0; i < path!.length - 1; i++) {
      const type = graph.getEdgeType(path![i], path![i + 1]);
      if (type === 'ladder') hasLadder = true;
      if (type === 'jump') hasJump = true;
    }

    expect(hasLadder).toBe(true);
    expect(hasJump).toBe(true);

    // Verify final node in path is on top of Building A
    const lastNode = path![path!.length - 1];
    expect(Math.abs(lastNode.y - roofHeight)).toBeLessThan(0.5);
    expect(lastNode.x).toBeGreaterThanOrEqual(2.5);
  });

  it('pathfinds descending a ladder from a roof down to the ground', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);
    const roofHeight = 10.0;

    // Building with a ladder
    collisionGrid.insert({
      minX: -4,
      maxX: 0,
      minY: 0,
      maxY: roofHeight,
      minZ: -4,
      maxZ: 0,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const ladderZone = {
      minX: -2.5,
      maxX: -1.5,
      minY: 0,
      maxY: roofHeight,
      minZ: -2.5,
      maxZ: -1.5,
      faceAngle: 0,
      railX: -2.0,
      railZ: -2.0,
    };

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [ladderZone],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    // AI is on the roof near ladder dismount
    const aiRoofPos = new THREE.Vector3(-2.0, roofHeight, -1.0);
    // Target is on the ground at the ladder base
    const groundTargetPos = new THREE.Vector3(-2.0, 0.0, -3.0);

    const path = graph.findPath(aiRoofPos, groundTargetPos);

    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(2);

    // Verify path contains a ladder descent transition
    let hasLadderDescent = false;
    for (let i = 0; i < path!.length - 1; i++) {
      const type = graph.getEdgeType(path![i], path![i + 1]);
      if (type === 'ladder' && path![i].y > path![i + 1].y) {
        hasLadderDescent = true;
      }
    }

    expect(hasLadderDescent).toBe(true);

    // Verify final node in path is near the ground target
    const lastNode = path![path!.length - 1];
    expect(lastNode.y).toBeLessThanOrEqual(0.5);
  });

  it('creates climb edges and pathfinds from ground to top of a low obstacle (height 2.5m)', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);
    const lowObstacleHeight = 2.5;

    // Low obstacle / crate (ladderless)
    collisionGrid.insert({
      minX: 2,
      maxX: 6,
      minY: 0,
      maxY: lowObstacleHeight,
      minZ: -2,
      maxZ: 2,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    const groundPos = new THREE.Vector3(0.0, 0.0, 0.0);
    const roofPos = new THREE.Vector3(4.0, lowObstacleHeight, 0.0);

    const path = graph.findPath(groundPos, roofPos);

    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);

    // Verify path contains a 'climb' edge from ground to low obstacle top
    let hasClimb = false;
    for (let i = 0; i < path!.length - 1; i++) {
      const type = graph.getEdgeType(path![i], path![i + 1]);
      if (type === 'climb') {
        hasClimb = true;
        break;
      }
    }
    expect(hasClimb).toBe(true);
  });

  it('prefers using ladder to reach high building roof over climbing wall', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);
    const buildingHeight = 6.0;

    // Building at x: [2, 8], z: [-3, 3]
    collisionGrid.insert({
      minX: 2,
      maxX: 8,
      minY: 0,
      maxY: buildingHeight,
      minZ: -3,
      maxZ: 3,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const ladderZone = {
      minX: 0.5,
      maxX: 2.5,
      minY: 0,
      maxY: buildingHeight,
      minZ: -1.5,
      maxZ: 0.5,
      faceAngle: 0,
      railX: 1.5,
      railZ: -0.5,
    };

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [ladderZone],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    const groundPos = new THREE.Vector3(-2.0, 0.0, 0.0);
    const roofPos = new THREE.Vector3(5.0, buildingHeight, 0.0);

    const path = graph.findPath(groundPos, roofPos);

    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(2);

    let hasLadder = false;
    for (let i = 0; i < path!.length - 1; i++) {
      const type = graph.getEdgeType(path![i], path![i + 1]);
      if (type === 'ladder') hasLadder = true;
    }
    expect(hasLadder).toBe(true);
  });
});

describe('NavigationGraph - Path Smoothing & Direct Walkability', () => {
  it('correctly determines direct walkability across open ground and blocked paths', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Obstacle block at x: [0, 4], z: [-2, 2], y: [0, 4]
    collisionGrid.insert({
      minX: 0,
      maxX: 4,
      minY: 0,
      maxY: 4.0,
      minZ: -2,
      maxZ: 2,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    // 1. Clear corridor parallel to obstacle (e.g. from x=-5, z=5 to x=5, z=5)
    const clear1 = { x: -5.0, y: 0.0, z: 5.0 };
    const clear2 = { x: 5.0, y: 0.0, z: 5.0 };
    expect(graph.isDirectWalkable(clear1, clear2, collisionGrid)).toBe(true);

    // 2. Blocked corridor crossing obstacle (from x=-5, z=0 to x=5, z=0)
    const blocked1 = { x: -5.0, y: 0.0, z: 0.0 };
    const blocked2 = { x: 5.0, y: 0.0, z: 0.0 };
    expect(graph.isDirectWalkable(blocked1, blocked2, collisionGrid)).toBe(false);

    // 3. Height difference too large
    const highPoint = { x: 5.0, y: 5.0, z: 5.0 };
    expect(graph.isDirectWalkable(clear1, highPoint, collisionGrid)).toBe(false);
  });

  it('smooths raw A* path by merging collinear nodes while preserving action nodes', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    const startPos = new THREE.Vector3(-10.0, 0.0, 0.0);
    const endPos = new THREE.Vector3(10.0, 0.0, 0.0);

    const rawPath = graph.findPath(startPos, endPos);
    expect(rawPath).not.toBeNull();
    expect(rawPath!.length).toBeGreaterThan(5); // raw path has many 1m grid steps

    const smoothedPath = graph.smoothPath(rawPath!, collisionGrid);
    expect(smoothedPath.length).toBeLessThan(rawPath!.length);
    expect(smoothedPath[0].id).toBe(rawPath![0].id);
    expect(smoothedPath[smoothedPath.length - 1].id).toBe(rawPath![rawPath!.length - 1].id);
  });
});

describe('NavigationGraph - Strategic Destination Selection', () => {
  it('evaluates safe hiding spots with cover and distance away from seeker', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Add large central building to block Line of Sight: x: [-4, 4], z: [-4, 4], height 6.0
    collisionGrid.insert({
      minX: -4,
      maxX: 4,
      minY: 0,
      maxY: 6.0,
      minZ: -4,
      maxZ: 4,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    const seekerPos = new THREE.Vector3(-12.0, 0.0, 0.0);
    const aiPos = new THREE.Vector3(0.0, 0.0, 0.0);

    const bestHiding = graph.evaluateHidingSpots(seekerPos, aiPos, collisionGrid);
    expect(bestHiding).not.toBeNull();
    // Best hiding spot should be behind the building (x > 0) or elevated on rooftop
    expect(bestHiding!.x).toBeGreaterThan(-6.0);
  });

  it('selects strategic elevated vantage points for seeker patrol', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Add elevated vantage building in quadrant 1 (x: [4, 8], z: [4, 8], height 8.0)
    collisionGrid.insert({
      minX: 4,
      maxX: 8,
      minY: 0,
      maxY: 8.0,
      minZ: 4,
      maxZ: 8,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    const currentPos = new THREE.Vector3(0.0, 0.0, 0.0);
    const visitedQuadrants = new Set<number>([2, 3, 4]); // Quadrant 1 unvisited

    const vantageNode = graph.findStrategicVantageTarget(currentPos, null, visitedQuadrants, collisionGrid);
    expect(vantageNode).not.toBeNull();
    expect(vantageNode!.y).toBeGreaterThanOrEqual(2.5); // Elevated
  });

  it('finds nearby search spots around last known player position', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Add building corner obstacle
    collisionGrid.insert({
      minX: 2,
      maxX: 6,
      minY: 0,
      maxY: 4.0,
      minZ: 2,
      maxZ: 6,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);
    const lastKnownPos = new THREE.Vector3(0.0, 0.0, 0.0);

    const spots = graph.findNearbySearchSpots(lastKnownPos, 3.0, 18.0);
    expect(spots).toBeDefined();
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.length).toBeLessThanOrEqual(4);

    // Verify distance constraints
    spots.forEach((spot) => {
      const dist = Math.hypot(spot.x - lastKnownPos.x, spot.z - lastKnownPos.z);
      expect(dist).toBeGreaterThanOrEqual(3.0);
      expect(dist).toBeLessThanOrEqual(18.0);
    });
  });

  it('finds reachable patrol target with precalculated smooth path', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);
    const currentPos = new THREE.Vector3(0.0, 0.0, 0.0);
    const visitedQuadrants = new Set<number>([2, 3, 4]);

    const result = graph.findReachablePatrolTarget(currentPos, visitedQuadrants, collisionGrid);
    expect(result).not.toBeNull();
    expect(result!.target).toBeDefined();
    expect(result!.path).toBeDefined();
    expect(result!.path.length).toBeGreaterThan(1);
  });

  it('correctly maps bidirectional ladder path with approach and dismount nodes', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);
    const roofHeight = 8.0;

    collisionGrid.insert({
      minX: -4,
      maxX: 0,
      minY: 0,
      maxY: roofHeight,
      minZ: -4,
      maxZ: 0,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const ladderZone = {
      minX: -2.5,
      maxX: -1.5,
      minY: 0,
      maxY: roofHeight,
      minZ: -2.5,
      maxZ: -1.5,
      faceAngle: 0,
      railX: -2.0,
      railZ: -2.0,
    };

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [ladderZone],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    // 1. Ground to Roof
    const groundStart = new THREE.Vector3(-2.0, 0.0, -3.0);
    const roofEnd = new THREE.Vector3(-2.0, roofHeight, -1.0);
    const upPath = graph.findPath(groundStart, roofEnd);
    expect(upPath).not.toBeNull();

    const upLadderEdge = upPath!.some((node, i) => {
      if (i >= upPath!.length - 1) return false;
      return graph.getEdgeType(node, upPath![i + 1]) === 'ladder';
    });
    expect(upLadderEdge).toBe(true);

    // 2. Roof to Ground
    const downPath = graph.findPath(roofEnd, groundStart);
    expect(downPath).not.toBeNull();

    const downLadderEdge = downPath!.some((node, i) => {
      if (i >= downPath!.length - 1) return false;
      return graph.getEdgeType(node, downPath![i + 1]) === 'ladder';
    });
    expect(downLadderEdge).toBe(true);
  });

  it('allows scaling 1-story buildings (height 6.0m) from ground, but discards routes to inaccessible multi-story buildings (>1 floor without ladder)', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Building 1: 1 floor (height 6.0m, no ladder)
    collisionGrid.insert({
      minX: -8,
      maxX: -4,
      minY: 0,
      maxY: 6.0,
      minZ: -2,
      maxZ: 2,
    });

    // Building 2: 2 floors (height 12.0m, no ladder)
    collisionGrid.insert({
      minX: 4,
      maxX: 8,
      minY: 0,
      maxY: 12.0,
      minZ: -2,
      maxZ: 2,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    const groundPos = new THREE.Vector3(0.0, 0.0, 0.0);

    // 1. Path to 1-story building (6.0m) -> Scalable! Path should be found
    const oneStoryRoof = new THREE.Vector3(-6.0, 6.0, 0.0);
    const pathToOneStory = graph.findPath(groundPos, oneStoryRoof);
    expect(pathToOneStory).not.toBeNull();
    expect(pathToOneStory!.length).toBeGreaterThan(1);

    // 2. Path to 2-story building (12.0m, no ladder) -> Inaccessible! Route must be discarded (null)
    const twoStoryRoof = new THREE.Vector3(6.0, 12.0, 0.0);
    const pathToTwoStory = graph.findPath(groundPos, twoStoryRoof);
    expect(pathToTwoStory).toBeNull();
  });

  it('generates a straight-line scaling path directly up the wall face instead of detouring to the corner', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // 1-story climbable building: x in [-4, 4], z in [5, 11], height 5.0m
    collisionGrid.insert({
      minX: -4,
      maxX: 4,
      minY: 0,
      maxY: 5.0,
      minZ: 5,
      maxZ: 11,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    // AI is at (0, 0, 0)
    const groundStart = new THREE.Vector3(0.0, 0.0, 0.0);
    // Destination is on the roof at (0, 5.0, 8.0)
    const roofTarget = new THREE.Vector3(0.0, 5.0, 8.0);

    const rawPath = graph.findPath(groundStart, roofTarget);
    expect(rawPath).not.toBeNull();

    // Check climb node: must scale directly at the flat wall face (x near 0), NOT at the corners (x >= 4.0 or x <= -4.0)
    let climbFromNode: NavNode | null = null;
    let climbToNode: NavNode | null = null;

    for (let i = 0; i < rawPath!.length - 1; i++) {
      const type = graph.getEdgeType(rawPath![i], rawPath![i + 1]);
      if (type === 'climb') {
        climbFromNode = rawPath![i];
        climbToNode = rawPath![i + 1];
        break;
      }
    }

    expect(climbFromNode).not.toBeNull();
    expect(climbToNode).not.toBeNull();

    // The climb must happen straight at x ~ 0 along the front face (z ~ 5.0), not corner (x = +/-4.5)
    expect(Math.abs(climbFromNode!.x)).toBeLessThanOrEqual(1.0);
    expect(Math.abs(climbToNode!.x)).toBeLessThanOrEqual(1.0);

    // After smoothing, the path should have minimal straight-line waypoints directly to the target
    const smoothedPath = graph.smoothPath(rawPath!, collisionGrid);
    expect(smoothedPath.length).toBeLessThanOrEqual(4);
  });

  it('drops off the side of the building closest to the target node instead of going to the opposite side', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // 1-story climbable building: x in [-4, 4], z in [-4, 4], height 5.0m
    collisionGrid.insert({
      minX: -4,
      maxX: 4,
      minY: 0,
      maxY: 5.0,
      minZ: -4,
      maxZ: 4,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    // Ladder attached to the South side (z = -4.0)
    const ladderZone = {
      minX: -0.5,
      maxX: 0.5,
      minY: 0,
      maxY: 5.0,
      minZ: -4.5,
      maxZ: -3.5,
      faceAngle: 0,
      railX: 0.0,
      railZ: -4.0,
    };

    const mapData = {
      objects: [],
      collisionGrid,
      bGrid,
      wGrid: bGrid,
      sGrid: bGrid,
      tGrid: bGrid,
      ladderZones: [ladderZone],
      worldSize,
    };

    const graph = new NavigationGraph(mapData);

    // AI is on the roof at (0, 5.0, 0)
    const roofStart = new THREE.Vector3(0.0, 5.0, 0.0);
    // Destination is on the ground to the North at (0, 0, 12.0)
    const groundNorthTarget = new THREE.Vector3(0.0, 0.0, 12.0);

    const rawPath = graph.findPath(roofStart, groundNorthTarget);
    expect(rawPath).not.toBeNull();

    // Verify the path uses a 'drop' transition on the North side (z >= 3.0), NOT descending the South ladder (z <= -3.0)
    let dropFromNode: NavNode | null = null;
    let dropToNode: NavNode | null = null;

    for (let i = 0; i < rawPath!.length - 1; i++) {
      const type = graph.getEdgeType(rawPath![i], rawPath![i + 1]);
      if (type === 'drop') {
        dropFromNode = rawPath![i];
        dropToNode = rawPath![i + 1];
        break;
      }
    }

    expect(dropFromNode).not.toBeNull();
    expect(dropToNode).not.toBeNull();

    // Drop must happen on the North edge (z > 2.0 towards destination z = 12.0), not South (z < 0)
    expect(dropFromNode!.z).toBeGreaterThan(2.0);
    expect(dropToNode!.z).toBeGreaterThan(3.5);
  });
});
