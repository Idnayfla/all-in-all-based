'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

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

  // Inline entity editing
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<EntityType>('project');
  const [editSummary, setEditSummary] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editContent, setEditContent] = useState<Record<string, string>>({});
  const [newFactKey, setNewFactKey] = useState('');
  const [newFactVal, setNewFactVal] = useState('');
  const [savingEntity, setSavingEntity] = useState(false);
  const editNameRef = useRef<HTMLInputElement>(null);

  // Quick-add task from entity card
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [addingTask, setAddingTask] = useState(false);

  const headers = useCallback(
    () => ({
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    }),
    [authToken]
  );

  // ── Escape key + body scroll lock when overlay is open ─────────────────────
  useEffect(() => {
    if (!expandedId) {
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpandedId(null);
        setEditingEntityId(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [expandedId]);

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
    const interval = setInterval(() => fetchEntities(search, typeFilter), 30_000);
    const onEntityUpdated = () => fetchEntities(search, typeFilter);
    window.addEventListener('based:entity-updated', onEntityUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener('based:entity-updated', onEntityUpdated);
    };
  }, [authToken, fetchEntities]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => fetchEntities(search, typeFilter), 300);
    return () => clearTimeout(t);
  }, [search, typeFilter, fetchEntities]);

  // ── Fetch tasks for fullscreen entity ─────────────────────────────────────
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

  // ── Add entity ─────────────────────────────────────────────────────────────
  const addEntity = async () => {
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      const res = await fetch('/api/entities', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name, type: newType, summary: newSummary.trim() || null }),
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

  // ── Entity inline edit ─────────────────────────────────────────────────────
  const startEntityEdit = (entity: Entity) => {
    setEditingEntityId(entity.id);
    setEditName(entity.name);
    setEditType(entity.type);
    setEditSummary(entity.summary ?? '');
    setEditNotes(entity.notes ?? '');
    setEditContent({ ...(entity.content ?? {}) });
    setNewFactKey('');
    setNewFactVal('');
    setExpandedId(entity.id);
    setTimeout(() => editNameRef.current?.focus(), 0);
  };

  const cancelEntityEdit = () => {
    setEditingEntityId(null);
    setNewFactKey('');
    setNewFactVal('');
  };

  const saveEntityEdit = async () => {
    const name = editName.trim();
    if (!name || !editingEntityId || savingEntity) return;
    setSavingEntity(true);
    const original = entities.find(e => e.id === editingEntityId);
    const updated: Entity = {
      ...original!,
      name,
      type: editType,
      summary: editSummary.trim() || null,
      notes: editNotes.trim() || null,
      content: editContent,
    };
    setEntities(prev => prev.map(e => (e.id === editingEntityId ? updated : e)));
    setEditingEntityId(null);
    try {
      const res = await fetch('/api/entities', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
          id: editingEntityId,
          name,
          type: editType,
          summary: editSummary.trim() || null,
          notes: editNotes.trim() || null,
          content: editContent,
        }),
      });
      const saved: Entity = await res.json();
      setEntities(prev => prev.map(e => (e.id === saved.id ? saved : e)));
    } catch {
      if (original) setEntities(prev => prev.map(e => (e.id === original.id ? original : e)));
    } finally {
      setSavingEntity(false);
    }
  };

  // ── Content fact CRUD ──────────────────────────────────────────────────────
  const addFact = () => {
    const key = newFactKey.trim().toLowerCase().replace(/\s+/g, '_');
    const val = newFactVal.trim();
    if (!key || !val) return;
    setEditContent(prev => ({ ...prev, [key]: val }));
    setNewFactKey('');
    setNewFactVal('');
  };

  const removeFact = (key: string) => {
    setEditContent(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const updateFact = (key: string, val: string) => {
    setEditContent(prev => ({ ...prev, [key]: val }));
  };

  // ── Delete entity ──────────────────────────────────────────────────────────
  const deleteEntity = async (id: string) => {
    setEntities(prev => prev.filter(e => e.id !== id));
    if (expandedId === id) setExpandedId(null);
    if (editingEntityId === id) setEditingEntityId(null);
    try {
      await fetch(`/api/entities?id=${id}`, { method: 'DELETE', headers: headers() });
    } catch {
      // Silent fail
    }
  };

  // ── Quick-add task linked to entity ───────────────────────────────────────
  const addEntityTask = async (entityId: string) => {
    const title = newTaskTitle.trim();
    if (!title || addingTask) return;
    setAddingTask(true);
    const tempTask: LinkedTask = {
      id: `temp-${Date.now()}`,
      title,
      status: 'todo',
      due_date: null,
      priority: 'normal',
    };
    setEntityTasks(prev => [...prev, tempTask]);
    setNewTaskTitle('');
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ title, entity_id: entityId, priority: 'normal' }),
      });
      const created: LinkedTask = await res.json();
      setEntityTasks(prev => prev.map(t => (t.id === tempTask.id ? created : t)));
    } catch {
      setEntityTasks(prev => prev.filter(t => t.id !== tempTask.id));
    } finally {
      setAddingTask(false);
    }
  };

  // ── Close fullscreen overlay ───────────────────────────────────────────────
  const closeFullscreen = () => {
    setExpandedId(null);
    setEditingEntityId(null);
  };

  // ── Group by type ──────────────────────────────────────────────────────────
  const grouped: Partial<Record<EntityType, Entity[]>> = {};
  for (const e of entities) {
    if (!grouped[e.type]) grouped[e.type] = [];
    grouped[e.type]!.push(e);
  }

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
                    const contentEntries = Object.entries(entity.content ?? {}).filter(
                      ([, v]) => v !== null && v !== undefined && String(v).trim() !== ''
                    );

                    return (
                      <div
                        key={entity.id}
                        className="entity-card"
                        onClick={() => setExpandedId(entity.id)}
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
                          <div className="entity-card-header-actions">
                            <button
                              className="entity-card-edit"
                              onClick={e => {
                                e.stopPropagation();
                                startEntityEdit(entity);
                              }}
                              title="Edit"
                            >
                              ✎
                            </button>
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
                        </div>

                        <div className="entity-card-name">{entity.name}</div>
                        {entity.summary && (
                          <div className="entity-card-summary">{entity.summary}</div>
                        )}
                        {contentEntries.length > 0 && (
                          <div className="entity-card-facts">
                            {contentEntries.slice(0, 3).map(([k, v]) => (
                              <div key={k} className="entity-fact-row">
                                <span className="entity-fact-key">{k}</span>
                                <span className="entity-fact-val">{String(v)}</span>
                              </div>
                            ))}
                            {contentEntries.length > 3 && (
                              <div className="entity-fact-more">
                                +{contentEntries.length - 3} more
                              </div>
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

      {/* ── Full-screen entity overlay ─────────────────────────────────────── */}
      {expandedId !== null &&
        (() => {
          const fe = entities.find(e => e.id === expandedId);
          if (!fe) return null;
          const isEditing = editingEntityId === expandedId;
          const contentEntries = Object.entries(fe.content ?? {}).filter(
            ([, v]) => v !== null && v !== undefined && String(v).trim() !== ''
          );

          return (
            <div className="entity-fullscreen-overlay" onClick={closeFullscreen}>
              <div className="entity-fullscreen-panel" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="entity-fullscreen-header">
                  <span
                    className="entity-card-type-chip entity-fullscreen-chip"
                    style={{ borderColor: TYPE_COLORS[fe.type], color: TYPE_COLORS[fe.type] }}
                  >
                    {TYPE_ICONS[fe.type]} {TYPE_LABELS[fe.type]}
                  </span>
                  <div className="entity-fullscreen-title">{fe.name}</div>
                  <div className="entity-fullscreen-header-actions">
                    {!isEditing && (
                      <button
                        className="entity-fullscreen-edit-btn"
                        onClick={() => startEntityEdit(fe)}
                      >
                        ✎ Edit
                      </button>
                    )}
                    <button
                      className="entity-fullscreen-del-btn"
                      onClick={() => deleteEntity(fe.id)}
                      title="Delete"
                    >
                      ✕
                    </button>
                    <button className="entity-fullscreen-close" onClick={closeFullscreen}>
                      ↓
                    </button>
                  </div>
                </div>

                {/* Body */}
                <div className="entity-fullscreen-body">
                  {isEditing ? (
                    /* Edit form */
                    <div className="entity-edit-form">
                      <input
                        ref={editNameRef}
                        className="entity-edit-name"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') cancelEntityEdit();
                        }}
                        placeholder="Entity name"
                      />
                      <div className="entity-edit-row2">
                        <select
                          className="entity-edit-type"
                          value={editType}
                          onChange={e => setEditType(e.target.value as EntityType)}
                        >
                          {ENTITY_TYPES.map(t => (
                            <option key={t} value={t}>
                              {TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        className="entity-edit-summary"
                        value={editSummary}
                        onChange={e => setEditSummary(e.target.value)}
                        placeholder="Summary (1-2 sentences)"
                        rows={2}
                      />
                      <textarea
                        className="entity-edit-notes"
                        value={editNotes}
                        onChange={e => setEditNotes(e.target.value)}
                        placeholder="Notes (optional)"
                        rows={2}
                      />
                      <div className="entity-edit-facts-section">
                        <div className="entity-edit-facts-label">Facts</div>
                        {Object.entries(editContent).map(([k, v]) => (
                          <div key={k} className="entity-edit-fact-row">
                            <span className="entity-edit-fact-key">{k}</span>
                            <input
                              className="entity-edit-fact-val"
                              value={v}
                              onChange={e => updateFact(k, e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Escape') cancelEntityEdit();
                              }}
                            />
                            <button
                              className="entity-edit-fact-del"
                              onClick={() => removeFact(k)}
                              title="Remove fact"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <div className="entity-edit-fact-add">
                          <input
                            className="entity-edit-fact-key-input"
                            placeholder="key"
                            value={newFactKey}
                            onChange={e => setNewFactKey(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addFact()}
                          />
                          <input
                            className="entity-edit-fact-val-input"
                            placeholder="value"
                            value={newFactVal}
                            onChange={e => setNewFactVal(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addFact()}
                          />
                          <button
                            className="entity-edit-fact-add-btn"
                            onClick={addFact}
                            disabled={!newFactKey.trim() || !newFactVal.trim()}
                            title="Add fact"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <div className="entity-edit-actions">
                        <button
                          className="entity-edit-save"
                          onClick={saveEntityEdit}
                          disabled={!editName.trim() || savingEntity}
                        >
                          ◈ Save
                        </button>
                        <button className="entity-edit-cancel" onClick={cancelEntityEdit}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <>
                      {fe.summary && <p className="entity-fullscreen-summary">{fe.summary}</p>}

                      {contentEntries.length > 0 && (
                        <div className="entity-fullscreen-section">
                          <div className="entity-fullscreen-section-label">Facts</div>
                          <div className="entity-fullscreen-facts-grid">
                            {contentEntries.map(([k, v]) => (
                              <div key={k} className="entity-fullscreen-fact-row">
                                <span className="entity-fullscreen-fact-key">{k}</span>
                                <span className="entity-fullscreen-fact-val">{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {fe.notes && (
                        <div className="entity-fullscreen-section">
                          <div className="entity-fullscreen-section-label">Notes</div>
                          <div className="entity-fullscreen-notes-text">{fe.notes}</div>
                        </div>
                      )}

                      {fe.last_mentioned_at && (
                        <div className="entity-fullscreen-meta">
                          Last mentioned{' '}
                          {new Date(fe.last_mentioned_at).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </div>
                      )}

                      <div className="entity-fullscreen-section">
                        <div className="entity-fullscreen-section-label">Tasks</div>
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
                              new Date(task.due_date) < new Date(new Date().setHours(0, 0, 0, 0));
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
                        <div className="entity-task-add">
                          <input
                            className="entity-task-add-input"
                            placeholder="Add linked task…"
                            value={newTaskTitle}
                            onChange={e => setNewTaskTitle(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') addEntityTask(fe.id);
                              if (e.key === 'Escape') setNewTaskTitle('');
                            }}
                          />
                          <button
                            className="entity-task-add-btn"
                            onClick={() => addEntityTask(fe.id)}
                            disabled={!newTaskTitle.trim() || addingTask}
                            title="Add task"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
