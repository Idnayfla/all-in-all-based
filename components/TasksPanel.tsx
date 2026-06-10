'use client';
import { useCallback, useEffect, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────
type Priority = 'urgent' | 'high' | 'normal' | 'low';
type Status = 'todo' | 'in_progress' | 'done' | 'cancelled';
type FilterTab = 'all' | 'today' | 'upcoming' | 'done';

interface Task {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  priority: Priority;
  status: Status;
  tags: string[];
  created_at: string;
  updated_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const PRIORITY_COLORS: Record<Priority, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  normal: 'var(--accent)',
  low: 'var(--text3)',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

function isOverdue(task: Task): boolean {
  if (!task.due_date || task.status === 'done' || task.status === 'cancelled') return false;
  return new Date(task.due_date) < new Date(new Date().setHours(0, 0, 0, 0));
}

function isDueToday(task: Task): boolean {
  if (!task.due_date || task.status === 'done' || task.status === 'cancelled') return false;
  const d = new Date(task.due_date);
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

function isUpcoming(task: Task): boolean {
  if (!task.due_date) return task.status !== 'done' && task.status !== 'cancelled';
  const d = new Date(task.due_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return d >= tomorrow && task.status !== 'done' && task.status !== 'cancelled';
}

function formatDue(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const diff = Math.round((d.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  if (diff < 7) return `In ${diff}d`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TasksPanel({ authToken }: { authToken?: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');

  // Add-task form state
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('normal');
  const [adding, setAdding] = useState(false);

  const headers = useCallback(
    () => ({
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    }),
    [authToken]
  );

  // ── Fetch tasks ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authToken) {
      setLoading(false);
      return;
    }
    fetch('/api/tasks', { headers: headers() })
      .then(r => r.json())
      .then((data: Task[]) => {
        if (Array.isArray(data)) setTasks(data);
      })
      .finally(() => setLoading(false));
  }, [authToken, headers]);

  // ── Add task ───────────────────────────────────────────────────────────────
  const addTask = async () => {
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    // Optimistic insert
    const tempId = `temp-${Date.now()}`;
    const optimistic: Task = {
      id: tempId,
      title,
      notes: null,
      due_date: newDue || null,
      priority: newPriority,
      status: 'todo',
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setTasks(prev => [optimistic, ...prev]);
    setNewTitle('');
    setNewDue('');
    setNewPriority('normal');

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ title, due_date: newDue || null, priority: newPriority }),
      });
      const created: Task = await res.json();
      setTasks(prev => prev.map(t => (t.id === tempId ? created : t)));
    } catch {
      setTasks(prev => prev.filter(t => t.id !== tempId));
    } finally {
      setAdding(false);
    }
  };

  // ── Toggle done ────────────────────────────────────────────────────────────
  const toggleDone = async (task: Task) => {
    const newStatus: Status = task.status === 'done' ? 'todo' : 'done';
    // Optimistic update
    setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, status: newStatus } : t)));
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ id: task.id, status: newStatus }),
      });
    } catch {
      // Revert on failure
      setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, status: task.status } : t)));
    }
  };

  // ── Delete task ────────────────────────────────────────────────────────────
  const deleteTask = async (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    try {
      await fetch(`/api/tasks?id=${id}`, { method: 'DELETE', headers: headers() });
    } catch {
      // Silent fail — task is already removed optimistically
    }
  };

  // ── Group tasks ────────────────────────────────────────────────────────────
  const overdue = tasks.filter(isOverdue);
  const dueToday = tasks.filter(isDueToday);
  const upcoming = tasks.filter(
    t => isUpcoming(t) || (!t.due_date && t.status !== 'done' && t.status !== 'cancelled')
  );
  const done = tasks.filter(t => t.status === 'done');

  // Remove duplicates in upcoming — tasks already in overdue/dueToday shouldn't show again
  const overdueIds = new Set(overdue.map(t => t.id));
  const todayIds = new Set(dueToday.map(t => t.id));
  const upcomingClean = upcoming.filter(t => !overdueIds.has(t.id) && !todayIds.has(t.id));

  const filterCounts: Record<FilterTab, number> = {
    all: tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length,
    today: dueToday.length + overdue.length,
    upcoming: upcomingClean.length,
    done: done.length,
  };

  const renderGroup = (label: string, items: Task[], labelColor?: string) => {
    if (items.length === 0) return null;
    return (
      <div className="tasks-group" key={label}>
        <div className="tasks-group-label" style={labelColor ? { color: labelColor } : undefined}>
          {label}
          <span className="tasks-group-count">{items.length}</span>
        </div>
        {items.map(task => (
          <div
            key={task.id}
            className={`tasks-row${task.status === 'done' ? ' tasks-row--done' : ''}`}
          >
            <button
              className={`tasks-checkbox${task.status === 'done' ? ' checked' : ''}`}
              onClick={() => toggleDone(task)}
              title={task.status === 'done' ? 'Mark incomplete' : 'Mark done'}
            >
              {task.status === 'done' ? '◈' : '◻'}
            </button>
            <span className="tasks-row-title">{task.title}</span>
            {task.due_date && (
              <span
                className="tasks-row-due"
                style={isOverdue(task) ? { color: '#ef4444' } : undefined}
              >
                {formatDue(task.due_date)}
              </span>
            )}
            <span
              className="tasks-priority-dot"
              style={{ background: PRIORITY_COLORS[task.priority] }}
              title={PRIORITY_LABELS[task.priority]}
            />
            <button
              className="tasks-row-del"
              onClick={() => deleteTask(task.id)}
              title="Delete task"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    );
  };

  const visibleOverdue = filter === 'all' || filter === 'today' ? overdue : [];
  const visibleToday = filter === 'all' || filter === 'today' ? dueToday : [];
  const visibleUpcoming =
    filter === 'all' || filter === 'upcoming' ? upcomingClean : filter === 'today' ? [] : [];
  const visibleDone = filter === 'done' ? done : [];

  const isEmpty =
    visibleOverdue.length === 0 &&
    visibleToday.length === 0 &&
    visibleUpcoming.length === 0 &&
    visibleDone.length === 0;

  return (
    <div className="tasks-root">
      {/* Add task row */}
      <div className="tasks-add-row">
        <input
          className="tasks-add-input"
          placeholder="Add a task…"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTask()}
          disabled={!authToken}
        />
        <input
          type="date"
          className="tasks-add-date"
          value={newDue}
          onChange={e => setNewDue(e.target.value)}
          disabled={!authToken}
        />
        <select
          className="tasks-add-priority"
          value={newPriority}
          onChange={e => setNewPriority(e.target.value as Priority)}
          disabled={!authToken}
        >
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <button
          className="tasks-add-btn"
          onClick={addTask}
          disabled={!newTitle.trim() || !authToken || adding}
        >
          + Add
        </button>
      </div>

      {/* Filter tabs */}
      <div className="tasks-filter-tabs">
        {(['all', 'today', 'upcoming', 'done'] as FilterTab[]).map(f => (
          <button
            key={f}
            className={`tasks-filter-tab${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'today' ? 'Today' : f === 'upcoming' ? 'Upcoming' : 'Done'}
            {filterCounts[f] > 0 && <span className="tasks-filter-count">{filterCounts[f]}</span>}
          </button>
        ))}
      </div>

      {/* Task list */}
      <div className="tasks-list">
        {loading && <div className="tasks-empty">Loading…</div>}
        {!loading && !authToken && (
          <div className="tasks-empty-state">
            <div className="tasks-empty-icon">◈</div>
            <div className="tasks-empty-title">Your Tasks</div>
            <div className="tasks-empty-sub">Sign in to track what you need to do</div>
          </div>
        )}
        {!loading && authToken && isEmpty && (
          <div className="tasks-empty-state">
            <div className="tasks-empty-icon">◉</div>
            <div className="tasks-empty-title">
              {filter === 'done' ? 'Nothing done yet' : 'All clear'}
            </div>
            <div className="tasks-empty-sub">
              {filter === 'done'
                ? 'Completed tasks will appear here'
                : 'Add a task above or ask Based to create one'}
            </div>
          </div>
        )}
        {!loading && authToken && (
          <>
            {renderGroup('Overdue', visibleOverdue, '#ef4444')}
            {renderGroup('Due Today', visibleToday, '#f97316')}
            {filter !== 'done' && renderGroup('Upcoming', visibleUpcoming)}
            {renderGroup('Done', visibleDone)}
          </>
        )}
      </div>
    </div>
  );
}
