import React from 'react';
import * as THREE from 'three';

export const GridMaterial: React.FC<{
  color: string;
  showGrid?: boolean;
  floorHeight?: number;
  transparent?: boolean;
  opacity?: number;
  roughness?: number;
  metalness?: number;
}> = ({
  color,
  showGrid = false,
  floorHeight = 6.0,
  transparent,
  opacity,
  roughness = 1.0,
  metalness = 0.0,
}) => {
  const materialRef = React.useRef<THREE.MeshStandardMaterial>(null!);

  if (!materialRef.current) {
    materialRef.current = new THREE.MeshStandardMaterial({
      color,
      transparent: transparent ?? false,
      opacity: opacity ?? 1.0,
      roughness,
      metalness,
    });
    materialRef.current.userData = {
      showGrid: { value: showGrid ? 1.0 : 0.0 },
      floorHeight: { value: floorHeight },
    };
    materialRef.current.onBeforeCompile = (shader) => {
      shader.uniforms.showGrid = materialRef.current.userData.showGrid;
      shader.uniforms.floorHeight = materialRef.current.userData.floorHeight;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
                varying vec3 vWorldPos;`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
                vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
                uniform float showGrid;
                uniform float floorHeight;
                varying vec3 vWorldPos;`,
        )
        .replace(
          '#include <fog_fragment>',
          `#include <fog_fragment>
                if (showGrid > 0.5) {
                    vec3 fractPos = fract(vWorldPos);
                    vec3 wNorm = abs(normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos))));
                    float lineThickness = 0.05;
                    float isXEdge = (step(fractPos.x, lineThickness) + step(1.0 - lineThickness, fractPos.x)) * step(wNorm.x, 0.5);
                    float isYEdge = (step(fractPos.y, lineThickness) + step(1.0 - lineThickness, fractPos.y)) * step(wNorm.y, 0.5);
                    float isZEdge = (step(fractPos.z, lineThickness) + step(1.0 - lineThickness, fractPos.z)) * step(wNorm.z, 0.5);
                    
                    // Floor division logic
                    float floorMod = mod(vWorldPos.y + 0.01, floorHeight);
                    float isFloor = (step(floorMod, 0.15) + step(floorHeight - 0.15, floorMod)) * step(wNorm.y, 0.5);
                    
                    float grid = clamp(isXEdge + isYEdge + isZEdge, 0.0, 1.0);
                    
                    // Background grid is dark
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.0), grid * 0.8);
                    
                    // Floor lines are distinct (e.g., slightly blue or just brighter)
                    if (isFloor > 0.5) {
                        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.2, 0.5, 1.0), 0.6);
                    }
                }`,
        );
    };
  } else {
    materialRef.current.color.set(new THREE.Color(color));
    if (transparent !== undefined) materialRef.current.transparent = transparent;
    if (opacity !== undefined) materialRef.current.opacity = opacity;
    materialRef.current.roughness = roughness;
    materialRef.current.metalness = metalness;
    materialRef.current.userData.showGrid.value = showGrid ? 1.0 : 0.0;
    materialRef.current.userData.floorHeight.value = floorHeight;
  }

  React.useEffect(() => {
    return () => {
      if (materialRef.current) {
        materialRef.current.dispose();
      }
    };
  }, []);

  // Attach material to parent mesh
  return <primitive object={materialRef.current} attach="material" />;
};
