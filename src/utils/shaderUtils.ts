import * as THREE from 'three';

export const OcclusionUniforms = {
    uPlayerPos: { value: new THREE.Vector3(0, 0, 0) },
    uCameraPos: { value: new THREE.Vector3(0, 0, 0) }
};

export const injectOcclusionShader = (shader: any) => {
    // No-op: occlusion is now handled via raycast opacity fade and character X-Ray silhouette.
};
