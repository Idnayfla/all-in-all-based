'use client';
import { useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';

// OrbitControls inline (no addons import needed — just the core behaviour)
function createOrbitControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLCanvasElement
): { dispose: () => void; update: () => void } {
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  const spherical = { theta: Math.PI / 4, phi: Math.PI / 3, radius: 8 };

  function applySpherical() {
    const { theta, phi, radius } = spherical;
    camera.position.set(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
    camera.lookAt(0, 0, 0);
  }

  applySpherical();

  function onMouseDown(e: MouseEvent) {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    spherical.theta -= dx * 0.01;
    spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi + dy * 0.01));
    applySpherical();
  }

  function onMouseUp() {
    isDragging = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    spherical.radius = Math.max(1, Math.min(50, spherical.radius + e.deltaY * 0.01));
    applySpherical();
  }

  // Touch support
  let lastTouchDist = 0;

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 1) {
      isDragging = true;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }

  function onTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging) {
      const dx = e.touches[0].clientX - lastX;
      const dy = e.touches[0].clientY - lastY;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
      spherical.theta -= dx * 0.01;
      spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi + dy * 0.01));
      applySpherical();
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      spherical.radius = Math.max(
        1,
        Math.min(50, spherical.radius - (dist - lastTouchDist) * 0.05)
      );
      lastTouchDist = dist;
      applySpherical();
    }
  }

  function onTouchEnd() {
    isDragging = false;
  }

  domElement.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.addEventListener('touchstart', onTouchStart, { passive: true });
  domElement.addEventListener('touchmove', onTouchMove, { passive: false });
  domElement.addEventListener('touchend', onTouchEnd);

  return {
    update: applySpherical,
    dispose() {
      domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      domElement.removeEventListener('wheel', onWheel);
      domElement.removeEventListener('touchstart', onTouchStart);
      domElement.removeEventListener('touchmove', onTouchMove);
      domElement.removeEventListener('touchend', onTouchEnd);
    },
  };
}

// ── Default scene setup ───────────────────────────────────────────────────────
function buildDefaultScene(scene: THREE.Scene) {
  // Grid
  const grid = new THREE.GridHelper(20, 20, 0x333344, 0x222233);
  scene.add(grid);

  // Ambient light
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  // Directional light
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  // Floor plane
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.9, metalness: 0.1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function ThreeDStudio({ authToken }: { authToken?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<{ dispose: () => void; update: () => void } | null>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  // User-supplied animation callback from generated scene code
  const animateFnRef = useRef<((elapsed: number) => void) | null>(null);

  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  // ── Init Three.js ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x0a0a10, 1);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a10);
    scene.fog = new THREE.Fog(0x0a0a10, 20, 60);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    cameraRef.current = camera;

    buildDefaultScene(scene);

    const orbit = createOrbitControls(camera, canvas);
    orbitRef.current = orbit;

    startTimeRef.current = performance.now();

    // Size
    function resize() {
      const w = wrap!.clientWidth;
      const h = wrap!.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Render loop
    function animate() {
      rafRef.current = requestAnimationFrame(animate);
      const elapsed = performance.now() - startTimeRef.current;
      // Run user animation callback if present
      if (animateFnRef.current) {
        try {
          animateFnRef.current(elapsed);
        } catch {}
      }
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      orbit.dispose();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset to default scene ───────────────────────────────────────────────
  const resetScene = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    while (scene.children.length > 0) scene.remove(scene.children[0]);
    animateFnRef.current = null;
    buildDefaultScene(scene);
    setError('');
    setStatus('');
    setPrompt('');
  }, []);

  // ── Generate scene via AI ─────────────────────────────────────────────────
  const generateScene = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError('');
    setStatus('◈ Generating scene...');
    try {
      const res = await fetch('/api/generate-3d', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Generation failed');
        setStatus('');
        return;
      }
      if (!data.code) {
        setError('No scene code returned');
        setStatus('');
        return;
      }

      // Execute the returned code in a sandboxed function.
      // We expose a renderer proxy so generated code can set
      // renderer.userData.animateFn without TypeScript complaints.
      const scene = sceneRef.current!;
      const camera = cameraRef.current!;
      const rendererProxy = {
        userData: {
          get animateFn() {
            return animateFnRef.current;
          },
          set animateFn(fn: ((elapsed: number) => void) | null) {
            animateFnRef.current = fn;
          },
        },
      };

      // Strip markdown code fences and leading/trailing non-JS prose
      let cleanCode = data.code
        .replace(/^```(?:javascript|js)?\n?/m, '') // strip opening fence
        .replace(/\n?```\s*$/m, '') // strip closing fence
        .trim();

      // If the code appears to start with natural language (no JS keywords/symbols),
      // try to extract from first line that looks like JS
      const jsStartMatch = cleanCode.match(
        /^([\s\S]*?)((?:const|let|var|scene\.|while|\/\/|new |renderer\.|camera\.))/m
      );
      if (jsStartMatch && jsStartMatch[1].length > 0 && jsStartMatch[1].length < 200) {
        cleanCode = cleanCode.slice(jsStartMatch[1].length);
      }

      // eslint-disable-next-line no-new-func
      const fn = new Function('THREE', 'scene', 'camera', 'renderer', cleanCode);
      try {
        fn(THREE, scene, camera, rendererProxy);
        startTimeRef.current = performance.now();
        setStatus('');
      } catch (execErr: unknown) {
        setError(`Scene error: ${execErr instanceof Error ? execErr.message : String(execErr)}`);
        setStatus('');
        // Roll back to default scene on execution error
        while (scene.children.length > 0) scene.remove(scene.children[0]);
        animateFnRef.current = null;
        buildDefaultScene(scene);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
      setStatus('');
    } finally {
      setGenerating(false);
    }
  }, [prompt, generating, authToken]);

  return (
    <div className="threed-studio">
      {/* Toolbar */}
      <div className="threed-toolbar">
        <span className="threed-logo">◈ 3D Studio</span>

        <div className="threed-prompt-row">
          <input
            className="threed-prompt-input"
            placeholder="Describe a scene — a glowing solar system, a neon city, a spinning cube..."
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !generating) generateScene();
            }}
            disabled={generating}
          />
          <button
            className="threed-btn threed-btn-primary"
            onClick={generateScene}
            disabled={generating || !prompt.trim()}
          >
            {generating ? '◈ Generating...' : '◈ Generate'}
          </button>
          <button
            className="threed-btn"
            onClick={resetScene}
            disabled={generating}
            title="Clear scene"
          >
            ↺ Clear
          </button>
        </div>

        {(status || error) && (
          <div className={`threed-status${error ? ' threed-status--error' : ''}`}>
            {error || status}
          </div>
        )}
      </div>

      {/* Canvas area */}
      <div ref={wrapRef} className="threed-canvas-wrap">
        <canvas ref={canvasRef} className="threed-canvas" />
        {generating && (
          <div className="threed-loading-overlay">
            <div className="threed-loading-spinner">◈</div>
            <div className="threed-loading-text">Building your scene...</div>
          </div>
        )}
        <div className="threed-controls-hint">Drag to orbit · Scroll to zoom</div>
      </div>
    </div>
  );
}
