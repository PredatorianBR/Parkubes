import React from 'react';
import * as THREE from 'three';

export const RuinBlock: React.FC<{ position: THREE.Vector3; scale: [number, number, number]; color: string; showGrid?: boolean }> = ({ position, scale, color, showGrid }) => {
    const materialRef = React.useRef<THREE.MeshStandardMaterial>(null!);
    if (!materialRef.current) {
        materialRef.current = new THREE.MeshStandardMaterial({ color, transparent: false, opacity: 1.0 });
        materialRef.current.userData = { showGrid: { value: showGrid ? 1.0 : 0.0 } };
        materialRef.current.onBeforeCompile = (shader) => {
            shader.uniforms.showGrid = materialRef.current.userData.showGrid;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                '#include <common>\nvarying vec3 vWorldPos;'
            ).replace(
                '#include <worldpos_vertex>',
                '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                '#include <common>\nuniform float showGrid;\nvarying vec3 vWorldPos;'
            ).replace(
                '#include <fog_fragment>',
                `#include <fog_fragment>
                if (showGrid > 0.5) {
                    vec3 fractPos = fract(vWorldPos);
                    vec3 wNorm = abs(normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos))));
                    float lineThickness = 0.05;
                    float isXEdge = (step(fractPos.x, lineThickness) + step(1.0 - lineThickness, fractPos.x)) * step(wNorm.x, 0.5);
                    float isYEdge = (step(fractPos.y, lineThickness) + step(1.0 - lineThickness, fractPos.y)) * step(wNorm.y, 0.5);
                    float isZEdge = (step(fractPos.z, lineThickness) + step(1.0 - lineThickness, fractPos.z)) * step(wNorm.z, 0.5);
                    float grid = clamp(isXEdge + isYEdge + isZEdge, 0.0, 1.0);
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.0), grid * 0.8);
                }`
            );
        };
    } else {
        materialRef.current.color.set(new THREE.Color(color));
        materialRef.current.userData.showGrid.value = showGrid ? 1.0 : 0.0;
    }

    return (
        <group position={position}>
            <mesh castShadow receiveShadow material={materialRef.current}>
                <boxGeometry args={scale} />
            </mesh>
            {/* Small top blocks also need the shader if we want them to have grid, but keeping it simple for now */}
            <mesh position={[scale[0] * 0.25, scale[1] * 0.5, scale[2] * 0.25]} castShadow receiveShadow>
                <boxGeometry args={[scale[0] * 0.4, scale[1] * 0.4, scale[2] * 0.4]} />
                <meshStandardMaterial color={color} />
            </mesh>
            <mesh position={[-scale[0] * 0.2, scale[1] * 0.5, -scale[2] * 0.2]} castShadow receiveShadow>
                <boxGeometry args={[scale[0] * 0.3, scale[1] * 0.3, scale[2] * 0.3]} />
                <meshStandardMaterial color={color} />
            </mesh>
        </group>
    );
};
