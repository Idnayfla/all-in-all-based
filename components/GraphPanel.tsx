'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import type { GraphData, GraphEdge, GraphNode } from '@/app/api/graph/route';
import GraphNodeCard from './GraphNodeCard';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph3D = dynamic<any>(() => import('react-force-graph-3d'), {
  ssr: false,
  loading: () => null,
});

// ── Node colours ───────────────────────────────────────────────────────────────

const NODE_COLOR: Record<string, string> = {
  project: '#c9a87c',
  memory: '#5ef5c0',
  entity_person: '#60a5fa',
  entity_topic: '#4ade80',
  entity_account: '#a78bfa',
  entity_place: '#fb923c',
  entity_other: '#8888aa',
};

function getNodeColor(node: GraphNode): string {
  if (node.type === 'project') return NODE_COLOR.project;
  if (node.type === 'memory') return NODE_COLOR.memory;
  return (
    NODE_COLOR[`entity_${(node as Extract<GraphNode, { type: 'entity' }>).entityType}`] ?? '#a78bfa'
  );
}

function getNodeRadius(node: GraphNode): number {
  if (node.type === 'project') return 7;
  if (node.type === 'entity') return 5;
  return 3;
}

// ── Link colours ───────────────────────────────────────────────────────────────

function getNodeIdStr(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'id' in val) return (val as { id: string }).id;
  return '';
}

function getLinkColor(link: GraphEdge): string {
  const src = getNodeIdStr(link.source);
  const tgt = getNodeIdStr(link.target);
  const alpha = Math.round(Math.max(0.18, link.similarity) * 200)
    .toString(16)
    .padStart(2, '0');
  if (src.startsWith('m:') && tgt.startsWith('m:')) return `#4ade80${alpha}`;
  if (
    (src.startsWith('p:') && tgt.startsWith('e:')) ||
    (src.startsWith('e:') && tgt.startsWith('p:'))
  )
    return `#a78bfa${alpha}`;
  return `#c9a87c${alpha}`;
}

function getLinkParticleColor(link: GraphEdge): string {
  const src = getNodeIdStr(link.source);
  const tgt = getNodeIdStr(link.target);
  if (src.startsWith('m:') && tgt.startsWith('m:')) return '#4ade80';
  if (
    (src.startsWith('p:') && tgt.startsWith('e:')) ||
    (src.startsWith('e:') && tgt.startsWith('p:'))
  )
    return '#a78bfa';
  return '#c9a87c';
}

// ── THREE.js node mesh ─────────────────────────────────────────────────────────

function buildNodeMesh(
  node: GraphNode,
  coreMats: Map<string, THREE.MeshLambertMaterial>
): THREE.Group {
  const group = new THREE.Group();
  const hex = getNodeColor(node);
  const r = getNodeRadius(node);
  const color = new THREE.Color(hex);

  // Glowing core sphere
  const coreMat = new THREE.MeshLambertMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.55,
  });
  coreMats.set(node.id, coreMat);
  group.add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 24), coreMat));

  // Outer wireframe aura
  group.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(r * 2.0, 7, 7),
      new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.1 })
    )
  );

  // White hot core for project nodes — makes them unmistakably central
  if (node.type === 'project') {
    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.38, 12, 12),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 })
      )
    );
  }

  return group;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  authToken: string;
  onOpenProject: (projectId: string) => void;
  onAskAbout: (label: string) => void;
}

export default function GraphPanel({ authToken, onOpenProject, onAskAbout }: Props) {
  const [data, setData] = useState<GraphData | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const dimsRef = useRef({ w: 800, h: 600 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const bloomAdded = useRef(false);
  const coreMats = useRef<Map<string, THREE.MeshLambertMaterial>>(new Map());

  const loadGraph = useCallback(
    (bust = false) => {
      setStatus('loading');
      fetch(`/api/graph${bust ? '?refresh=1' : ''}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then(r => r.json())
        .then((d: GraphData) => {
          setData(d);
          setStatus('idle');
        })
        .catch(() => setStatus('error'));
    },
    [authToken]
  );

  useEffect(() => {
    if (authToken) loadGraph();
  }, [authToken, loadGraph]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      const next = { w: rect.width, h: rect.height };
      dimsRef.current = next;
      setDims(next);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Dispose materials on unmount
  useEffect(
    () => () => {
      coreMats.current.forEach(m => m.dispose());
      coreMats.current.clear();
    },
    []
  );

  const nodeThreeObject = useCallback(
    (node: unknown) => buildNodeMesh(node as GraphNode, coreMats.current),
    []
  );

  // Direct material mutation — no React re-render on hover
  const handleNodeHover = useCallback((node: unknown, prevNode: unknown) => {
    const prev = prevNode as GraphNode | null;
    const curr = node as GraphNode | null;
    if (prev) {
      const m = coreMats.current.get(prev.id);
      if (m) m.emissiveIntensity = 0.55;
    }
    if (curr) {
      const m = coreMats.current.get(curr.id);
      if (m) m.emissiveIntensity = 1.8;
    }
    document.body.style.cursor = curr ? 'pointer' : '';
  }, []);

  // Add bloom + star field once after simulation first settles
  const handleEngineStop = useCallback(() => {
    if (!fgRef.current || bloomAdded.current) return;
    bloomAdded.current = true;

    // Star field — scattered points deep in the background
    try {
      const scene = fgRef.current.scene?.();
      if (scene) {
        const count = 1600;
        const spread = 700;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          positions[i * 3] = (Math.random() - 0.5) * spread;
          positions[i * 3 + 1] = (Math.random() - 0.5) * spread;
          positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        scene.add(
          new THREE.Points(
            geo,
            new THREE.PointsMaterial({
              color: '#ede8d0',
              size: 0.5,
              sizeAttenuation: true,
              transparent: true,
              opacity: 0.55,
            })
          )
        );
      }
    } catch {
      /* scene unavailable — no-op */
    }

    // Bloom
    try {
      const composer = fgRef.current.postProcessingComposer?.();
      if (!composer) return;
      const { w, h } = dimsRef.current;
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js')
        .then(({ UnrealBloomPass }) => {
          composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 1.6, 0.5, 0.04));
        })
        .catch(() => {});
    } catch {
      /* bloom unavailable — no-op */
    }
  }, []);

  const handleRefresh = () => {
    // Note: bloomAdded stays true — bloom + stars are added to the scene once and persist
    coreMats.current.forEach(m => m.dispose());
    coreMats.current.clear();
    loadGraph(true);
  };

  const graphData = {
    nodes: (data?.nodes ?? []).map(n => ({ ...n })),
    links: (data?.edges ?? []).map(e => ({ ...e })),
  };

  const showGraph = !!(data && data.nodes.length > 0);
  const isEmpty = !!(data && data.nodes.length === 0);

  const stats = data
    ? {
        projects: data.nodes.filter(n => n.type === 'project').length,
        entities: data.nodes.filter(n => n.type === 'entity').length,
        memories: data.nodes.filter(n => n.type === 'memory').length,
      }
    : null;

  const cacheAge = data?.cachedAt
    ? Math.round((Date.now() - new Date(data.cachedAt).getTime()) / 60000)
    : null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: 'var(--bg2)',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              color: 'var(--accent)',
              fontWeight: 700,
              letterSpacing: '1px',
              flexShrink: 0,
            }}
          >
            ◈ Graph
          </span>
          {stats && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[
                { count: stats.projects, color: '#c9a87c', label: 'projects' },
                { count: stats.entities, color: '#a78bfa', label: 'entities' },
                { count: stats.memories, color: '#5ef5c0', label: 'memories' },
              ]
                .filter(s => s.count > 0)
                .map(s => (
                  <span
                    key={s.label}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: s.color }}
                  >
                    {s.count} {s.label}
                  </span>
                ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {cacheAge !== null && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>
              {cacheAge}m ago
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={status === 'loading'}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              color: status === 'loading' ? 'var(--text3)' : 'var(--text2)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              padding: '4px 10px',
              cursor: status === 'loading' ? 'default' : 'pointer',
              letterSpacing: '0.5px',
            }}
          >
            {status === 'loading' ? '⊙ Loading…' : '⊙ Refresh'}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Loading */}
        {status === 'loading' && !data && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 14,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text3)',
              fontSize: 13,
            }}
          >
            <span
              style={{ fontSize: 32, color: 'var(--accent)', animation: 'spin 2s linear infinite' }}
            >
              ◈
            </span>
            Building your graph…
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 10,
              fontFamily: 'var(--font-mono)',
            }}
          >
            <div style={{ fontSize: 28, color: 'var(--danger)' }}>⊘</div>
            <div style={{ color: 'var(--text)', fontSize: 14 }}>Failed to load graph</div>
            <button
              onClick={handleRefresh}
              style={{
                marginTop: 6,
                padding: '7px 18px',
                background: 'var(--accent)',
                color: 'var(--bg)',
                border: 'none',
                borderRadius: 'var(--r-sm)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {isEmpty && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 10,
              fontFamily: 'var(--font-mono)',
              textAlign: 'center',
              padding: '0 48px',
            }}
          >
            <div style={{ fontSize: 32, color: 'var(--accent)' }}>◈</div>
            <div style={{ color: 'var(--text)', fontSize: 14 }}>No nodes yet</div>
            <div style={{ color: 'var(--text3)', fontSize: 12, lineHeight: 1.7 }}>
              Chat with Based to start building your knowledge graph
            </div>
          </div>
        )}

        {/* 3D Graph */}
        {showGraph && (
          <ForceGraph3D
            ref={fgRef}
            graphData={graphData}
            width={dims.w}
            height={dims.h}
            backgroundColor="#08070e"
            controlType="orbit"
            enableNodeDrag={false}
            nodeThreeObject={nodeThreeObject}
            nodeThreeObjectExtend={false}
            nodeLabel={(n: GraphNode) => n.label}
            linkColor={(l: GraphEdge) => getLinkColor(l)}
            linkWidth={(l: GraphEdge) => (l.similarity ?? 0.5) * 1.5}
            linkOpacity={0.6}
            linkCurvature={0.2}
            linkDirectionalParticles={2}
            linkDirectionalParticleWidth={(l: GraphEdge) => (l.similarity ?? 0.5) * 2.5}
            linkDirectionalParticleSpeed={(l: GraphEdge) => (l.similarity ?? 0.5) * 0.006}
            linkDirectionalParticleColor={(l: GraphEdge) => getLinkParticleColor(l)}
            onNodeClick={(node: GraphNode) => setSelectedNode(node)}
            onNodeHover={handleNodeHover}
            onEngineStop={handleEngineStop}
          />
        )}

        {/* Detail card */}
        {selectedNode && (
          <GraphNodeCard
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            onOpen={node => {
              setSelectedNode(null);
              if (node.type === 'project') {
                onOpenProject(node.id.replace('p:', ''));
              } else {
                onAskAbout(node.label);
              }
            }}
          />
        )}

        {/* Legend */}
        {showGraph && (
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: 16,
              background: 'rgba(8, 7, 14, 0.78)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text3)',
              pointerEvents: 'none',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
            }}
          >
            {[
              { color: '#c9a87c', label: 'Project' },
              { color: '#a78bfa', label: 'Entity' },
              { color: '#5ef5c0', label: 'Memory' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: item.color,
                    flexShrink: 0,
                    boxShadow: `0 0 8px ${item.color}99`,
                  }}
                />
                {item.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
