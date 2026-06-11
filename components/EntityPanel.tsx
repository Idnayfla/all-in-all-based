'use client';
import { useCallback, useEffect, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────
type EntityType = 'project' | 'person' | 'topic' | 'account' | 'place' | 'other';
type TypeFilter = 'all' | EntityType;

interface LinkedTask {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  priority: string;
}

function formatTaskDue(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const diff = Math.round((d.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  if (diff < 7) return `In ${diff}d`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface Entity {
  id: string;
  name: string;
  type: EntityType;
  summary: string | null;
  content: Record<string, string>;
  notes: string | null;
  tags: string[];
  last_mentioned_at: string;
  created_at: string;
  updated_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const TYPE_ICONS: Record<EntityType, string> = {
  project: '⬡',
  person: '◉',
  topic: '◈',
  account: '⊙',
  place: '·',
  other: '—',
};

const TYPE_LABELS: Record<EntityType, string> = {
  project: 'Project',
  person: 'Person',
  topic: 'Topic',
  account: 'Account',
  place: 'Place',
  other: 'Other',
};

const TYPE_COLORS: Record<EntityType, string> = {
  project: '#c9a87c',
  person: '#60a5fa',
  topic: '#4ade80',
  account: '#a78bfa',
  place: '#fb923c',
  other: 'var(--text3)',
};

const ENTITY_TYPES: EntityType[] = ['project', 'person', 'topic', 'account', 'place', 'other'];

// ── Component ─────────────────────────────────────────────────────────────────
export default function EntityPanel({ authToken }: { authToken?: string }) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [entityTasks, setEntityTasks] = useState<LinkedTask[]>([]);
  const [entityTasksLoading, setEntityTasksLoading] = useState(false);

  // Add-entity form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<EntityType>('project');
  const [newSummary, setNewSummary] = useState('');
  const [adding, setAdding] = useState(false);

  const headers = useCallback(
    () => ({
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    }),
    [authToken]
  );

  // ── Fetch entities ─────────────────────────────────────────────────────────
  const fetchEntities = useCallback(
    (q?: string, t?: string) => {
      if (!authToken) return;
      const params = new URLSearchParams();
      if (q && q.trim()) params.set('search', q.trim());
      if (t && t !== 'all') params.set('type', t);
      fetch(`/api/entities?${params.toString()}`, { headers: headers() })
        .then(r => r.json())
        .then((data: Entity[]) => {
          if (Array.isArray(data)) setEntities(data);
        })
        .finally(() => setLoading(false));
    },
    [authToken, headers]
  );

  useEffect(() => {
    if (!authToken) {
      setLoading(false);
      return;
    }
    fetchEntities();
    // Poll every 30s so entity updates from Based's tool calls appear without a refresh
    const interval = setInterval(() => fetchEntities(search, typeFilter), 30_000);
    // Also re-fetch instantly when Based calls upsert_entity via tool
    const onEntityUpdated = () => fetchEntities(search, typeFilter);
    window.addEventListener('based:entity-updated', onEntityUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener('based:entity-updated', onEntityUpdated);
    };
  }, [authToken, fetchEntities]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => fetchEntities(search, typeFilter), 300);
    return () => clearTimeout(t);
  }, [search, typeFilter, fetchEntities]);

  // ── Add entity ─────────────────────────────────────────────────────────────
  const addEntity = async () => {
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      const res = await fetch('/api/entities', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          name,
          type: newType,
          summary: newSummary.trim() || null,
        }),
      });
      const created: Entity = await res.json();
      setEntities(prev => [created, ...prev]);
      setNewName('');
      setNewSummary('');
      setNewType('project');
      setShowAdd(false);
    } finally {
      setAdding(false);
    }
  };

  // ── Fetch tasks for expanded entity ───────────────────────────────────────
  useEffect(() => {
    if (!expandedId || !authToken) {
      setEntityTasks([]);
      return;
    }
    setEntityTasksLoading(true);
    fetch(`/api/tasks?entity_id=${expandedId}`, { headers: headers() })
      .then(r => r.json())
      .then((data: LinkedTask[]) => {
        if (Array.isArray(data)) setEntityTasks(data);
      })
      .finally(() => setEntityTasksLoading(false));
  }, [expandedId, authToken, headers]);

  // ── Delete entity ──────────────────────────────────────────────────────────
  const deleteEntity = async (id: string) => {
    setEntities(prev => prev.filter(e => e.id !== id));
    if (expandedId === id) setExpandedId(null);
    try {
      await fetch(`/api/entities?id=${id}`, { method: 'DELETE', headers: headers() });
    } catch {
      // Silent fail
    }
  };

  // ── Group by type ──────────────────────────────────────────────────────────
  const grouped: Partial<Record<EntityType, Entity[]>> = {};
  for (const e of entities) {
    if (!grouped[e.type]) grouped[e.type] = [];
    grouped[e.type]!.push(e);
  }

  // Order: project, person, account, topic, place, other
  const typeOrder: EntityType[] = ['project', 'person', 'account', 'topic', 'place', 'other'];

  const hasEntities = entities.length > 0;

  return (
    <div className="entity-root">
      {/* Search + filter bar */}
      <div className="entity-topbar">
        <input
          className="entity-search"
          placeholder="Search brain…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          disabled={!authToken}
        />
        <button
          className={`entity-add-toggle${showAdd ? ' active' : ''}`}
          onClick={() => setShowAdd(s => !s)}
          disabled={!authToken}
        >
          {showAdd ? '✕ Cancel' : '+ Add'}
        </button>
      </div>

      {/* Type filter chips */}
      <div className="entity-type-chips">
        {(['all', ...ENTITY_TYPES] as TypeFilter[]).map(t => (
          <button
            key={t}
            className={`entity-type-chip${typeFilter === t ? ' active' : ''}`}
            onClick={() => setTypeFilter(t)}
            style={
              typeFilter === t && t !== 'all'
                ? { borderColor: TYPE_COLORS[t as EntityType], color: TYPE_COLORS[t as EntityType] }
                : undefined
            }
          >
            {t === 'all' ? 'All' : TYPE_LABELS[t as EntityType]}
          </button>
        ))}
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="entity-add-form">
          <input
            className="entity-add-name"
            placeholder="Name (e.g. TikTok, Philosophy of Science)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addEntity()}
            autoFocus
          />
          <div className="entity-add-row2">
            <select
              className="entity-add-type"
              value={newType}
              onChange={e => setNewType(e.target.value as EntityType)}
            >
              {ENTITY_TYPES.map(t => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <input
              className="entity-add-summary"
              placeholder="Summary (optional)"
              value={newSummary}
              onChange={e => setNewSummary(e.target.value)}
            />
            <button
              className="entity-add-btn"
              onClick={addEntity}
              disabled={!newName.trim() || adding}
            >
              {adding ? '…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Entity grid */}
      <div className="entity-content">
        {loading && <div className="entity-empty">Loading…</div>}
        {!loading && !authToken && (
          <div className="entity-empty-state">
            <div className="entity-empty-icon">◉</div>
            <div className="entity-empty-title">Digital Brain</div>
            <div className="entity-empty-sub">Sign in — Based learns what matters to you</div>
          </div>
        )}
        {!loading && authToken && !hasEntities && (
          <div className="entity-empty-state">
            <div className="entity-empty-icon">⬡</div>
            <div className="entity-empty-title">Empty brain</div>
            <div className="entity-empty-sub">
              Based builds this automatically as you chat — or add entries manually above
            </div>
          </div>
        )}
        {!loading &&
          authToken &&
          hasEntities &&
          typeOrder
            .filter(t => grouped[t] && grouped[t]!.length > 0)
            .map(type => (
              <div key={type} className="entity-section">
                <div className="entity-section-label" style={{ color: TYPE_COLORS[type] }}>
                  {TYPE_ICONS[type]} {TYPE_LABELS[type]}s
                </div>
                <div className="entity-grid">
                  {grouped[type]!.map(entity => {
                    const isExpanded = expandedId === entity.id;
                    const contentEntries = Object.entries(entity.content ?? {}).filter(
                      ([, v]) => v !== null && v !== undefined && String(v).trim() !== ''
                    );
                    return (
                      <div
                        key={entity.id}
                        className={`entity-card${isExpanded ? ' expanded' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : entity.id)}
                      >
                        <div className="entity-card-header">
                          <span
                            className="entity-card-type-chip"
                            style={{
                              borderColor: TYPE_COLORS[entity.type],
                              color: TYPE_COLORS[entity.type],
                            }}
                          >
                            {TYPE_ICONS[entity.type]} {TYPE_LABELS[entity.type]}
                          </span>
                          <button
                            className="entity-card-del"
                            onClick={e => {
                              e.stopPropagation();
                              deleteEntity(entity.id);
                            }}
                            title="Delete"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="entity-card-name">{entity.name}</div>
                        {entity.summary && (
                          <div className="entity-card-summary">{entity.summary}</div>
                        )}
                        {contentEntries.length > 0 && (
                          <div className="entity-card-facts">
                            {contentEntries.slice(0, isExpanded ? 999 : 3).map(([k, v]) => (
                              <div key={k} className="entity-fact-row">
                                <span className="entity-fact-key">{k}</span>
                                <span className="entity-fact-val">{String(v)}</span>
                              </div>
                            ))}
                            {!isExpanded && contentEntries.length > 3 && (
                              <div className="entity-fact-more">
                                +{contentEntries.length - 3} more
                              </div>
                            )}
                          </div>
                        )}
                        {isExpanded && entity.notes && (
                          <div className="entity-card-notes">{entity.notes}</div>
                        )}
                        {isExpanded && entity.last_mentioned_at && (
                          <div className="entity-card-meta">
                            Last mentioned{' '}
                            {new Date(entity.last_mentioned_at).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </div>
                        )}
                        {isExpanded && (
                          <div className="entity-tasks-section">
                            <div className="entity-tasks-label">Tasks</div>
                            {entityTasksLoading ? (
                              <div className="entity-tasks-empty">Loading…</div>
                            ) : entityTasks.length === 0 ? (
                              <div className="entity-tasks-empty">No linked tasks</div>
                            ) : (
                              entityTasks.map(task => {
                                const isTaskDone =
                                  task.status === 'done' || task.status === 'cancelled';
                                const taskGlyph =
                                  task.status === 'done'
                                    ? '◈'
                                    : task.status === 'in_progress'
                                      ? '◉'
                                      : task.status === 'cancelled'
                                        ? '⊘'
                                        : '◻';
                                const taskOverdue =
                                  task.due_date &&
                                  !isTaskDone &&
                                  new Date(task.due_date) <
                                    new Date(new Date().setHours(0, 0, 0, 0));
                                return (
                                  <div key={task.id} className="entity-task-item">
                                    <span className="entity-task-status">{taskGlyph}</span>
                                    <span
                                      className={`entity-task-title${isTaskDone ? ' entity-task-title--done' : ''}`}
                                    >
                                      {task.title}
                                    </span>
                                    {task.due_date && (
                                      <span
                                        className={`entity-task-due${taskOverdue ? ' entity-task-due--overdue' : ''}`}
                                      >
                                        {formatTaskDue(task.due_date)}
                                      </span>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}
