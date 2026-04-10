const fs = require('fs');

const file = './src/components/Character.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add visualStateRef to CharacterProps
content = content.replace(
    'overlayContent?: React.ReactNode;',
    'overlayContent?: React.ReactNode;\n    visualStateRef?: React.MutableRefObject<any>;'
);

// 2. Add visualStateRef to ParticleEffects props
content = content.replace(
    'moveSpeed: number;\n}> = ({ isRunning',
    'moveSpeed: number;\n    visualStateRef?: React.MutableRefObject<any>;\n}> = ({ isRunning'
);

content = content.replace(
    /({ isRunning, isMoving.*?)( visualStateRef)? }\) => {/,
    '$1, visualStateRef }) => {\n    const getVs = () => visualStateRef?.current || {};'
);

// We will inject the property overrides at the top of ParticleEffects useFrame
const particleVars = `
        const vs = visualStateRef?.current || {};
        const run = vs.isRunning ?? isRunning;
        const mov = vs.isMoving ?? isMoving;
        const grd = vs.isGrounded ?? isGrounded;
        const surf = vs.currentSurface ?? currentSurface;
        const landFac = vs.landingFactor ?? landingFactor;
        const stn = vs.stunned ?? stunned;
        const fallDist = vs.fallDistance ?? fallDistance;
        const jLanded = vs.justLanded ?? justLanded;
        const roll = vs.isRolling ?? isRolling;
        const mSpeed = vs.moveSpeed ?? moveSpeed;
`;

content = content.replace(
    'useFrame((state, delta) => {\n        if (!meshRef.current || !playerGroup.current) return;',
    'useFrame((state, delta) => {\n        if (!meshRef.current || !playerGroup.current) return;' + particleVars
);

// Replace usages in ParticleEffects
content = content.replace(/isRunning\b/g, 'run')
                 .replace(/isMoving\b/g, 'mov')
                 .replace(/isGrounded\b/g, 'grd')
                 .replace(/currentSurface\b/g, 'surf')
                 .replace(/ landingFactor/g, ' landFac')
                 .replace(/\bstunned\b/g, 'stn')
                 .replace(/fallDistance\b/g, 'fallDist')
                 .replace(/justLanded\b/g, 'jLanded')
                 .replace(/\bisRolling\b/g, 'roll')
                 .replace(/moveSpeed\b/g, 'mSpeed');

// Oh wait, doing global replace like that also replaces the arguments in the function definition!
// So let's re-read the original file and do it safer via string splits.
