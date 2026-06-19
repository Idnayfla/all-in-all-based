'use client';
import type { GraphNode } from '@/app/api/graph/route';

const TYPE_ICONS: Record<string, string> = {
  project: '◈',
  person: '⊙',
  topic: '⬡',
  account: '◉',
  place: '◉',
  other: '·',
};

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: '#60a5fa',
  topic: '#4ade80',
  account: '#a78bfa',
  place: '#fb923c',
  other: 'rgba(237,232,208,0.5)',
};

interface Props {
  node: GraphNode | null;
  onClose: () => void;
  onOpen: (node: GraphNode) => void;
}

export default function GraphNodeCard({ node, onClose, onOpen }: Props) {
  if (!node) return null;

  const entityType = node.type === 'entity' ? node.entityType : null;
  const accentColor =
    node.type === 'project'
      ? '#c9a87c'
      : node.type === 'memory'
        ? '#5ef5c0'
        : (ENTITY_TYPE_COLORS[entityType ?? ''] ?? '#a78bfa');

  const icon =
    node.type === 'project'
      ? '◈'
      : node.type === 'memory'
        ? '◉'
        : (TYPE_ICONS[entityType ?? ''] ?? '·');

  const subtitle =
    node.type === 'project'
      ? `Updated ${new Date(node.updatedAt).toLocaleDateString()}`
      : node.type === 'memory'
        ? `${node.source} · ${new Date(node.sessionAt).toLocaleDateString()}`
        : (entityType ?? 'entity');

  const body = node.type !== 'memory' && node.summary ? node.summary : null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        width: 260,
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: '16px',
        zIndex: 10,
        boxShadow: 'var(--shadow-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0 }}>
          <span style={{ color: accentColor, fontSize: 18, flexShrink: 0 }}>{icon}</span>
          <span
            style={{
              color: 'var(--text)',
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {node.label}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text3)',
            fontSize: 18,
            padding: '0 4px',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      <div
        style={{
          fontSize: 10,
          color: 'var(--text3)',
          textTransform: 'uppercase',
          letterSpacing: '1.2px',
        }}
      >
        {subtitle}
      </div>

      {body && <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>{body}</div>}

      <button
        onClick={() => onOpen(node)}
        style={{
          marginTop: 4,
          padding: '7px 14px',
          background: 'linear-gradient(135deg, var(--accent) 0%, #d4b280 100%)',
          color: 'var(--bg)',
          border: 'none',
          borderRadius: 'var(--r-sm)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          letterSpacing: '0.5px',
        }}
      >
        {node.type === 'project' ? '◈ Open Project' : '◈ Ask Based'}
      </button>
    </div>
  );
}
