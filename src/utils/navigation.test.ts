import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { NavigationGraph, NavNode, MinBinaryHeap } from './navigation';
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

  it('prefers ground nodes over elevated rooftop nodes when querying a ground position', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Add a building at x: [-4, 4], z: [-4, 4], height 8.0
    collisionGrid.insert({
      minX: -4,
      maxX: 4,
      minY: 0,
      maxY: 8.0,
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

    // Query position on ground near building base (x: 4.5, y: 0.0, z: 0.0)
    const groundQueryPos = new THREE.Vector3(4.5, 0.0, 0.0);
    const closest = graph.findClosestNode(groundQueryPos);

    expect(closest).not.toBeNull();
    // Closest node must be a ground-level node (y < 2.0), not the 8.0m high rooftop node
    expect(closest!.y).toBeLessThan(2.0);
  });

  it('accurately calculates path cost for route comparison', () => {
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
    const startPos = { x: 0, y: 0, z: 0 };
    const directPath = [
      { x: 0, y: 0, z: 5, edgeType: 'walk' as const },
      { x: 0, y: 0, z: 10, edgeType: 'walk' as const },
    ];
    const detourPath = [
      { x: 10, y: 0, z: 0, edgeType: 'walk' as const },
      { x: 10, y: 0, z: 10, edgeType: 'walk' as const },
      { x: 0, y: 0, z: 10, edgeType: 'walk' as const },
    ];

    const directCost = graph.calculatePathCost(startPos, directPath, 0);
    const detourCost = graph.calculatePathCost(startPos, detourPath, 0);

    expect(directCost).toBe(10);
    expect(detourCost).toBe(30);
    expect(directCost).toBeLessThan(detourCost);
  });

  it('strictly routes via ladder when destination is on a building with a ladder even if target is on the far edge', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);
    const buildingHeight = 5.0;

    // Building: 8x8 building at x: [-4, 4], z: [-4, 4], height 5.0m
    collisionGrid.insert({
      minX: -4,
      maxX: 4,
      minY: 0,
      maxY: buildingHeight,
      minZ: -4,
      maxZ: 4,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    // Ladder placed on South face at z = -4.0, railX = 0, railZ = -4.0
    const ladderZone = {
      minX: -0.5,
      maxX: 0.5,
      minY: 0,
      maxY: buildingHeight,
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

    // AI is on the ground at North side (x: 0, z: 8.0, y: 0.0), far from South ladder
    const aiGroundNorth = new THREE.Vector3(0.0, 0.0, 8.0);
    // Destination is on the roof at North edge (x: 0, z: 3.5, y: 5.0)
    const roofTargetNorth = new THREE.Vector3(0.0, buildingHeight, 3.5);

    const path = graph.findPath(aiGroundNorth, roofTargetNorth);

    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(2);

    // Must use the ladder to access the roof
    let hasLadder = false;
    let hasClimb = false;
    for (let i = 0; i < path!.length - 1; i++) {
      const type = graph.getEdgeType(path![i], path![i + 1]);
      if (type === 'ladder') hasLadder = true;
      if (type === 'climb') hasClimb = true;
    }

    expect(hasLadder).toBe(true);
    expect(hasClimb).toBe(false);
  });

  it('correctly finds the ladder for a given building rooftop node with findLadderForBuilding', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);
    const buildingHeight = 8.0;

    collisionGrid.insert({
      minX: 10,
      maxX: 16,
      minY: 0,
      maxY: buildingHeight,
      minZ: 10,
      maxZ: 16,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    const ladderZone = {
      minX: 9.5,
      maxX: 10.5,
      minY: 0,
      maxY: buildingHeight,
      minZ: 12.5,
      maxZ: 13.5,
      faceAngle: 0,
      railX: 10.0,
      railZ: 13.0,
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

    const roofNodePos = { x: 14.0, y: buildingHeight, z: 14.0 };
    const ladderInfo = graph.findLadderForBuilding(roofNodePos);

    expect(ladderInfo).not.toBeNull();
    expect(ladderInfo?.zone.railX).toBe(10.0);
    expect(ladderInfo?.zone.railZ).toBe(13.0);
    expect(ladderInfo?.groundNode).not.toBeNull();
    expect(ladderInfo?.footNode).not.toBeNull();
    expect(ladderInfo?.topNode).not.toBeNull();
    expect(ladderInfo?.roofNode).not.toBeNull();
  });

  it('scales low obstacles (< 1 floor height: 1.2m fences, 2.0m ruins, 3.5m containers, 5.0m rooftops) and navigates over them', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // 1. Fence / low wall: height 1.2m
    collisionGrid.insert({
      minX: -10,
      maxX: -8,
      minY: 0,
      maxY: 1.2,
      minZ: -2,
      maxZ: 2,
    });

    // 2. Ruin block: height 2.0m
    collisionGrid.insert({
      minX: -4,
      maxX: -2,
      minY: 0,
      maxY: 2.0,
      minZ: -2,
      maxZ: 2,
    });

    // 3. Low rooftop / container: height 4.5m (< 1 floor)
    collisionGrid.insert({
      minX: 2,
      maxX: 6,
      minY: 0,
      maxY: 4.5,
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

    // 1. Ground to fence (1.2m)
    const pFence = graph.findPath(new THREE.Vector3(-12.0, 0, 0), new THREE.Vector3(-9.0, 1.2, 0));
    expect(pFence).not.toBeNull();
    expect(pFence!.length).toBeGreaterThan(1);

    // 2. Ground to ruin (2.0m)
    const pRuin = graph.findPath(new THREE.Vector3(-6.0, 0, 0), new THREE.Vector3(-3.0, 2.0, 0));
    expect(pRuin).not.toBeNull();
    expect(pRuin!.length).toBeGreaterThan(1);

    // 3. Ground to low rooftop (4.5m)
    const pRoof = graph.findPath(new THREE.Vector3(0.0, 0, 0), new THREE.Vector3(4.0, 4.5, 0));
    expect(pRoof).not.toBeNull();
    expect(pRoof!.length).toBeGreaterThan(1);

    // Check climb edge on roof path
    let hasClimbEdge = false;
    for (let i = 0; i < pRoof!.length - 1; i++) {
      if (graph.getEdgeType(pRoof![i], pRoof![i + 1]) === 'climb') {
        hasClimbEdge = true;
        break;
      }
    }
    expect(hasClimbEdge).toBe(true);
  });

  it('generates rooftop jump edges between multi-story buildings across gaps and preserves them during path smoothing', () => {
    const worldSize = 50;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Building 1 (Height 8.0m): x [-10, -4], z [-3, 3]
    collisionGrid.insert({
      minX: -10,
      maxX: -4,
      minY: 0,
      maxY: 8.0,
      minZ: -3,
      maxZ: 3,
    });

    // Building 2 (Height 7.0m): x [-1, 5], z [-3, 3] (Gap of 3.0m between x=-4 and x=-1)
    collisionGrid.insert({
      minX: -1,
      maxX: 5,
      minY: 0,
      maxY: 7.0,
      minZ: -3,
      maxZ: 3,
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

    const startPos = new THREE.Vector3(-8.0, 8.0, 0.0);
    const targetPos = new THREE.Vector3(3.0, 7.0, 0.0);

    const rawPath = graph.findPath(startPos, targetPos);
    expect(rawPath).not.toBeNull();
    expect(rawPath!.length).toBeGreaterThan(1);

    // Verify path has jump edge
    let hasJump = false;
    for (let i = 0; i < rawPath!.length - 1; i++) {
      if (graph.getEdgeType(rawPath![i], rawPath![i + 1]) === 'jump') {
        hasJump = true;
        break;
      }
    }
    expect(hasJump).toBe(true);

    // Verify smoothPath preserves the jump transition
    const smoothed = graph.smoothPath(rawPath!, collisionGrid);
    expect(smoothed.length).toBeGreaterThan(1);

    let smoothedHasJump = false;
    for (let i = 0; i < smoothed.length - 1; i++) {
      if (graph.getEdgeType(smoothed[i], smoothed[i + 1]) === 'jump') {
        smoothedHasJump = true;
        break;
      }
    }
    expect(smoothedHasJump).toBe(true);

    // Test incoming edgeType mapping
    const aiPathNodes = smoothed.map((n, idx) => {
      const prevNode = idx > 0 ? smoothed[idx - 1] : null;
      const edgeType = prevNode ? (graph.getEdgeType(prevNode, n) ?? 'walk') : 'walk';
      return { id: n.id, x: n.x, y: n.y, z: n.z, edgeType };
    });

    // Landing node on Building 2 must have edgeType === 'jump'
    const jumpNode = aiPathNodes.find((n) => n.edgeType === 'jump');
    expect(jumpNode).toBeDefined();
    expect(jumpNode!.x).toBeGreaterThanOrEqual(-1.5);
  });
});

describe('NavigationGraph - Corner and Wall Clearance', () => {
  it('nudges nodes adjacent to wall faces away from obstacles to maintain character clearance', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Add a building from x: [0, 4], z: [-4, 4], y: [0, 6]
    collisionGrid.insert({
      minX: 0,
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

    // Ground nodes adjacent to wall x = 0 (original grid center x = -0.5)
    // should be pushed outward away from x = 0 to avoid wall clipping
    const adjacentNodes = Array.from(graph.nodes.values()).filter(
      (n) => n.y === 0 && n.x < 0 && n.x > -2.0 && n.z >= -3.0 && n.z <= 3.0,
    );

    expect(adjacentNodes.length).toBeGreaterThan(0);
    adjacentNodes.forEach((node) => {
      // Distance to wall face x = 0
      const distToWall = Math.abs(node.x - 0);
      // Nudged node should be at least 0.85m away from the wall face
      expect(distToWall).toBeGreaterThanOrEqual(0.85);
    });
  });

  it('prevents direct walkability through tight corners (quinas)', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Building with corner at (0, 0) in quadrant x: [0, 4], z: [0, 4]
    collisionGrid.insert({
      minX: 0,
      maxX: 4,
      minY: 0,
      maxY: 4.0,
      minZ: 0,
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

    // Path cutting tightly around the corner (0, 0): from (-0.5, 0, 2) to (2, 0, -0.5)
    // The midpoint of this line is (0.75, 0.75) or passes right next to (0, 0)
    const tightFrom = { x: -0.5, y: 0, z: 2.0 };
    const tightTo = { x: 2.0, y: 0, z: -0.5 };
    expect(graph.isDirectWalkable(tightFrom, tightTo, collisionGrid)).toBe(false);

    // Path with wide clearance around the corner (0, 0): from (-2, 0, 4) to (-2, 0, -2)
    const wideFrom = { x: -2.0, y: 0, z: 4.0 };
    const wideTo = { x: -2.0, y: 0, z: -2.0 };
    expect(graph.isDirectWalkable(wideFrom, wideTo, collisionGrid)).toBe(true);
  });

  it('smoothPath avoids cutting sharp quinas and navigates safely around buildings', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Building at x: [0, 6], z: [0, 6], y: [0, 4]
    collisionGrid.insert({
      minX: 0,
      maxX: 6,
      minY: 0,
      maxY: 4.0,
      minZ: 0,
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

    // Route around building: from (-2, 0, 3) to (3, 0, -2)
    const start = new THREE.Vector3(-2.0, 0.0, 3.0);
    const end = new THREE.Vector3(3.0, 0.0, -2.0);

    const rawPath = graph.findPath(start, end);
    expect(rawPath).not.toBeNull();

    const smoothed = graph.smoothPath(rawPath!, collisionGrid);
    expect(smoothed.length).toBeGreaterThan(1);

    // Verify smoothed path nodes maintain safe clearance from building bounding box
    smoothed.forEach((node) => {
      if (node.y === 0) {
        const closeX = Math.max(0, Math.min(node.x, 6));
        const closeZ = Math.max(0, Math.min(node.z, 6));
        const distToBuilding = Math.hypot(node.x - closeX, node.z - closeZ);
        expect(distToBuilding).toBeGreaterThanOrEqual(0.8);
      }
    });
  });

  it('strictly prohibits any ground nodes or path routes inside building footprints', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Large solid building from x: [-6, 6], z: [-6, 6], y: [0, 8]
    collisionGrid.insert({
      minX: -6,
      maxX: 6,
      minY: 0,
      maxY: 8.0,
      minZ: -6,
      maxZ: 6,
    });

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));

    // Fill bGrid for the building
    const halfSize = worldSize / 2;
    for (let gx = 14; gx <= 26; gx++) {
      for (let gz = 14; gz <= 26; gz++) {
        bGrid[gx][gz] = 8.0;
      }
    }

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

    // 1. Verify NO node exists inside the building interior volume (y < 8.0 and within [-5.9, 5.9] x [-5.9, 5.9])
    graph.nodes.forEach((node) => {
      if (node.y < 7.9) {
        const isInsideX = node.x > -5.9 && node.x < 5.9;
        const isInsideZ = node.z > -5.9 && node.z < 5.9;
        expect(isInsideX && isInsideZ).toBe(false);
      }
    });

    // 2. Route from one side of building to the opposite side at ground level
    const start = new THREE.Vector3(-10.0, 0.0, 0.0);
    const end = new THREE.Vector3(10.0, 0.0, 0.0);

    const path = graph.findPath(start, end);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);

    // Verify none of the path nodes go through the building interior
    path!.forEach((node) => {
      if (node.y < 7.9) {
        const isInsideX = node.x > -5.9 && node.x < 5.9;
        const isInsideZ = node.z > -5.9 && node.z < 5.9;
        expect(isInsideX && isInsideZ).toBe(false);
      }
    });
  });

  it('calculates rooftop jump edges between high platforms with proper edge types', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Roof A at x: [-8, -4], z: [-2, 2], y: 6.0
    collisionGrid.insert({
      minX: -8,
      maxX: -4,
      minY: 0,
      maxY: 6.0,
      minZ: -2,
      maxZ: 2,
    });

    // Roof B at x: [-1, 3], z: [-2, 2], y: 6.0
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
    const start = new THREE.Vector3(-6.0, 6.0, 0.0);
    const end = new THREE.Vector3(1.0, 6.0, 0.0);

    const path = graph.findPath(start, end);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);

    // Check if jump edge connects the two buildings
    const hasJump = path!.some((node, idx) => {
      if (idx === 0) return false;
      const prev = path![idx - 1];
      const edgeType = graph.getEdgeType(prev, node);
      return edgeType === 'jump';
    });
    expect(hasJump).toBe(true);
  });

  it('rejects jump edges when distance between buildings exceeds max achievable jump distance', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Roof A at x: [-12, -8], z: [-2, 2], y: 6.0
    collisionGrid.insert({
      minX: -12,
      maxX: -8,
      minY: 0,
      maxY: 6.0,
      minZ: -2,
      maxZ: 2,
    });

    // Roof B at x: [0, 4], z: [-2, 2], y: 6.0 (8.0 meter gap between x = -8 and x = 0)
    collisionGrid.insert({
      minX: 0,
      maxX: 4,
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

    // Verify NO jump edge exists across the 8.0m gap between Roof A and Roof B
    graph.nodes.forEach((nodeA) => {
      if (nodeA.x <= -8.0 && Math.abs(nodeA.y - 6.0) < 0.1) {
        const edges = graph.edges.get(nodeA.id) || [];
        const jumpEdgeToB = edges.find((e) => e.type === 'jump' && e.target.x >= 0.0);
        expect(jumpEdgeToB).toBeUndefined();
      }
    });
  });

  it('calculates detour nodes around a building when destination is on the exact opposite side in a straight line', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Solid Building in the center: [-4, 4] x [-4, 4], height 6.0
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

    // Fill bGrid around building center
    const half = Math.floor(worldSize / 2);
    for (let x = -4; x < 4; x++) {
      for (let z = -4; z < 4; z++) {
        bGrid[x + half][z + half] = 6.0;
      }
    }

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

    // Start is at West (x = -8, z = 0), Destination is at East (x = +8, z = 0)
    // Straight line goes right through the building [-4, 4]!
    const start = new THREE.Vector3(-8.0, 0.0, 0.0);
    const end = new THREE.Vector3(8.0, 0.0, 0.0);

    const path = graph.findPath(start, end);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(2);

    // Verify all nodes in the path route AROUND the building (outside [-3.8, 3.8] x [-3.8, 3.8])
    path!.forEach((node) => {
      const isInsideBuildingFootprint = Math.abs(node.x) < 3.8 && Math.abs(node.z) < 3.8 && node.y < 5.5;
      expect(isInsideBuildingFootprint).toBe(false);
    });

    // Verify smoothed path also does not cross through the building
    const smoothed = graph.smoothPath(path!, collisionGrid);
    expect(smoothed).not.toBeNull();
    smoothed.forEach((node) => {
      const isInside = Math.abs(node.x) < 3.8 && Math.abs(node.z) < 3.8 && node.y < 5.5;
      expect(isInside).toBe(false);
    });
  });

  it('prefers walking around a climbable low obstacle over climbing on top of it', () => {
    const worldSize = 40;
    const collisionGrid = new SpatialHashGrid(worldSize);

    // Low climbable obstacle: 2x2, height 2.0 at x: [-1, 1], z: [-1, 1]
    collisionGrid.insert({
      minX: -1,
      maxX: 1,
      minY: 0,
      maxY: 2.0,
      minZ: -1,
      maxZ: 1,
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

    // Start at x = -4, z = 0; End at x = 4, z = 0
    // Walking around takes ~8.5m on flat ground (y = 0).
    // Climbing over would climb to y = 2.0 then drop to y = 0.
    const start = new THREE.Vector3(-4.0, 0.0, 0.0);
    const end = new THREE.Vector3(4.0, 0.0, 0.0);

    const path = graph.findPath(start, end);
    expect(path).not.toBeNull();

    // Verify path stays at ground level (y < 1.0) and avoids climbing on top of the obstacle
    path!.forEach((node) => {
      expect(node.y).toBeLessThan(1.0);
    });
  });
});

describe('MinBinaryHeap Priority Queue', () => {
  it('correctly inserts and extracts elements in ascending priority order', () => {
    const heap = new MinBinaryHeap<string>();
    expect(heap.isEmpty()).toBe(true);
    expect(heap.size).toBe(0);

    heap.push('mid', 15);
    heap.push('low', 5);
    heap.push('high', 50);
    heap.push('lowest', 1);
    heap.push('mid2', 20);

    expect(heap.isEmpty()).toBe(false);
    expect(heap.size).toBe(5);
    expect(heap.peek()).toBe('lowest');

    expect(heap.pop()).toBe('lowest');
    expect(heap.pop()).toBe('low');
    expect(heap.pop()).toBe('mid');
    expect(heap.pop()).toBe('mid2');
    expect(heap.pop()).toBe('high');
    expect(heap.pop()).toBeUndefined();
    expect(heap.isEmpty()).toBe(true);
  });

  it('handles large volumes of pseudo-random priorities with sorted extraction', () => {
    const heap = new MinBinaryHeap<number>();
    const count = 200;
    const values: number[] = [];

    for (let i = 0; i < count; i++) {
      const priority = Math.random() * 1000;
      values.push(priority);
      heap.push(i, priority);
    }

    values.sort((a, b) => a - b);

    let prevPriority = -Infinity;
    for (let i = 0; i < count; i++) {
      const expectedPriority = values[i];
      const popped = heap.pop();
      expect(popped).toBeDefined();
      expect(expectedPriority).toBeGreaterThanOrEqual(prevPriority);
      prevPriority = expectedPriority;
    }

    expect(heap.isEmpty()).toBe(true);
  });

  it('clears heap correctly', () => {
    const heap = new MinBinaryHeap<number>();
    heap.push(1, 10);
    heap.push(2, 5);
    heap.clear();
    expect(heap.isEmpty()).toBe(true);
    expect(heap.size).toBe(0);
    expect(heap.pop()).toBeUndefined();
  });
});

describe('NavigationGraph - River Jumping & Water Avoidance', () => {
  it('creates jump edges across a river and chooses jump over swimming', () => {
    const worldSize = 40;
    const halfSize = 20;
    const collisionGrid = new SpatialHashGrid(worldSize);

    const bGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));
    const wGrid: number[][] = Array(worldSize)
      .fill(0)
      .map(() => Array(worldSize).fill(0));
    const sGrid = bGrid;
    const tGrid = bGrid;

    // Create a 2-meter wide river running along Z axis at x = [-1, 0] (gx = 19, 20)
    for (let gz = 0; gz < worldSize; gz++) {
      wGrid[19][gz] = 1;
      wGrid[20][gz] = 1;
    }

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

    // AI is at the left bank of the river (x = -3.5, z = 0.5)
    // Destination is at the right bank (x = 3.5, z = 0.5)
    const leftBankPos = new THREE.Vector3(-3.5, 0.0, 0.5);
    const rightBankPos = new THREE.Vector3(3.5, 0.0, 0.5);

    const path = graph.findPath(leftBankPos, rightBankPos);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);

    // Ensure that jump edge is used to cross the river without touching water
    let hasJump = false;
    let touchedWater = false;

    for (let i = 0; i < path!.length; i++) {
      if (path![i].isWater) {
        touchedWater = true;
      }
      if (i < path!.length - 1) {
        const type = graph.getEdgeType(path![i], path![i + 1]);
        if (type === 'jump') {
          hasJump = true;
        }
      }
    }

    expect(hasJump).toBe(true);
    expect(touchedWater).toBe(false);
  });
});










