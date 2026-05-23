'use client';

import { useRef, useEffect, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Environment } from '@react-three/drei';
import * as THREE from 'three';

// Preload so there's no pop when the component mounts
useGLTF.preload('/models/abstract_geometric_sphere.glb');

const basedMat = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color('#7c6af7'),
  emissive: new THREE.Color('#2a1d9e'),
  emissiveIntensity: 0.4,
  metalness: 0.95,
  roughness: 0.05,
  reflectivity: 0.8,
  iridescence: 1.0,
  iridescenceIOR: 1.4,
});

function Sphere() {
  const { scene } = useGLTF('/models/abstract_geometric_sphere.glb');
  const group = useRef<THREE.Object3D>(null!);

  // Deep-clone so the cached scene is never mutated
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    cloned.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.material = basedMat;
    });
  }, [cloned]);

  useFrame(state => {
    const t = state.clock.getElapsedTime();
    group.current.rotation.y = t * 0.1;
    group.current.rotation.x = Math.sin(t * 0.22) * 0.07;
    const breathe = 1 + Math.sin(t * 0.85) * 0.016;
    group.current.scale.setScalar(breathe);
  });

  return <primitive ref={group} object={cloned} />;
}

function FallbackSphere() {
  const mesh = useRef<THREE.Mesh>(null!);

  useFrame(state => {
    const t = state.clock.getElapsedTime();
    mesh.current.rotation.y = t * 0.1;
    const breathe = 1 + Math.sin(t * 0.85) * 0.016;
    mesh.current.scale.setScalar(breathe);
  });

  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1.5, 6]} />
      <meshStandardMaterial {...basedMat} />
    </mesh>
  );
}

export default function BasedOrb() {
  return (
    <Canvas
      camera={{ position: [0, 0, 17], fov: 25 }}
      gl={{ alpha: true, antialias: true }}
      style={{ background: 'transparent' }}
    >
      {/* Gold key light — companion warmth */}
      <pointLight position={[4, 3, 3]} color="#c9a87c" intensity={4.5} />
      {/* Based violet fill */}
      <pointLight position={[-3, -2, 2]} color="#8b76ff" intensity={2.5} />
      {/* Cream rim — lifts from black bg */}
      <pointLight position={[0, 2, -5]} color="#f5f0e8" intensity={1} />
      <ambientLight intensity={0.08} />

      <Suspense fallback={<FallbackSphere />}>
        <Environment preset="city" background={false} />
        <Sphere />
      </Suspense>
    </Canvas>
  );
}
