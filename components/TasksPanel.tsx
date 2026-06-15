'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────
type Priority = 'urgent' | 'high' | 'normal' | 'low';
type Status = 'todo' | 'in_progress' | 'done' | 'cancelled';
type FilterTab = 'all' | 'today' | 'upcoming' | 'done';

interface Task {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  due_time: string | null;
  duration_minutes: number | null;
  tz_offset: string | null;
  priority: Priority;
  status: Status;
  tags: string[];
  entity_id: string | null;
  google_event_id: string | null;
  created_at: string;
  updated_at: string;
}

interface EntityRef {
  id: string;
  name: string;
  type: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const PRIORITY_COLORS: Record<Priority, string> = {
  urgent: '#ef4444',
  high: '#f59e0b',
  normal: 'var(--accent)',
  low: 'var(--text3)',
};

const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
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

function formatDueCallout(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const diff = Math.round((d.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86400000);
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff === 2) return 'Due in 2 days';
  if (diff === 3) return 'Due in 3 days';
  if (diff < 0) return `Overdue by ${Math.abs(diff)}d`;
  return `Due ${new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

function toDateInputValue(dateStr: string | null): string {
  if (!dateStr) return '';
  return dateStr.slice(0, 10);
}

function getBrowserTzOffset(): string {
  const total = -new Date().getTimezoneOffset();
  const sign = total >= 0 ? '+' : '-';
  const abs = Math.abs(total);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

function computeEndTime(startTime: string, durationMinutes: number): string {
  const [sh, sm] = startTime.split(':').map(Number);
  const total = sh * 60 + sm + durationMinutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function computeDuration(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

function matchesSearch(task: Task, term: string): boolean {
  if (!term) return true;
  const t = term.toLowerCase();
  return (
    task.title.toLowerCase().includes(t) ||
    (task.notes?.toLowerCase().includes(t) ?? false) ||
    (task.tags?.some(tag => tag.toLowerCase().includes(t)) ?? false)
  );
}

function getNextTask(tasks: Task[]): Task | null {
  const active = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
  if (active.length === 0) return null;
  return active.slice().sort((a, b) => {
    if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
    if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
    const po = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (po !== 0) return po;
    if (a.due_date && b.due_date)
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  })[0];
}

function getRecommendations(tasks: Task[]): string[] {
  const active = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
  const overdueTasks = active.filter(isOverdue);
  const urgentTasks = active.filter(t => t.priority === 'urgent');
  const todayTasks = active.filter(isDueToday);
  const allDone = tasks.length > 0 && active.length === 0;

  if (allDone) return ['All caught up! ◈'];

  const recs: string[] = [];

  if (overdueTasks.length > 0) {
    recs.push(
      `You have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''} — tackle these first`
    );
  }

  if (urgentTasks.length > 0 && recs.length < 2) {
    recs.push(`Focus on "${urgentTasks[0].title}" — it's marked urgent`);
  }

  if (recs.length < 2 && todayTasks.length === 0 && overdueTasks.length === 0) {
    recs.push('Clear day ahead — good time to work on upcoming tasks');
  }

  return recs.slice(0, 2);
}

// ── Calendar event type ────────────────────────────────────────────────────────
interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  url: string;
  allDay: boolean;
}

function formatCalTime(dateStr: string, allDay: boolean): string {
  if (allDay)
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return new Date(dateStr).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function isCalToday(event: CalEvent): boolean {
  const d = new Date(event.start);
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

function isCalUpcoming(event: CalEvent): boolean {
  const start = new Date(event.start);
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return start >= tomorrow;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TasksPanel({ authToken }: { authToken?: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');

  // Entities for the entity-link selector
  const [entities, setEntities] = useState<EntityRef[]>([]);

  // Google Calendar state — feature flag is set via NEXT_PUBLIC_GOOGLE_CALENDAR_ENABLED
  const calFeatureEnabled = process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_ENABLED === 'true';
  const [calConnected, setCalConnected] = useState(false);
  const [calEmail, setCalEmail] = useState('');
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [calLoading, setCalLoading] = useState(false);

  // Add-task form state
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('normal');
  const [adding, setAdding] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editDueTime, setEditDueTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editPriority, setEditPriority] = useState<Priority>('normal');
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState('');
  const [editEntityId, setEditEntityId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editTitleRef = useRef<HTMLInputElement>(null);

  // Schedule-check state (conflict detection)
  const [schedChecking, setSchedChecking] = useState(false);
  const [schedConflict, setSchedConflict] = useState(false);
  const [schedSuggested, setSchedSuggested] = useState<string | null>(null);
  const schedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const headers = useCallback(
    () => ({
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    }),
    [authToken]
  );

  // ── Schedule check: debounce 600ms when date/time/end-time changes ──────────
  useEffect(() => {
    if (!calConnected || !editDue || !editDueTime || !editEndTime) {
      setSchedConflict(false);
      setSchedSuggested(null);
      return;
    }
    const duration = computeDuration(editDueTime, editEndTime);
    if (duration <= 0) {
      setSchedConflict(false);
      setSchedSuggested(null);
      return;
    }
    if (schedTimerRef.current) clearTimeout(schedTimerRef.current);
    schedTimerRef.current = setTimeout(async () => {
      setSchedChecking(true);
      try {
        const tz = getBrowserTzOffset();
        const params = new URLSearchParams({
          date: editDue,
          time: editDueTime,
          duration: String(duration),
          tz_offset: tz,
        });
        const res = await fetch(`/api/calendar/schedule?${params}`, { headers: headers() });
        const data = (await res.json()) as {
          conflict?: boolean;
          suggested?: string | null;
          connected?: boolean;
        };
        if (data.connected === false) return;
        setSchedConflict(data.conflict ?? false);
        setSchedSuggested(data.suggested ?? null);
      } catch {
        // silent — schedule check is best-effort
      } finally {
        setSchedChecking(false);
      }
    }, 600);
    return () => {
      if (schedTimerRef.current) clearTimeout(schedTimerRef.current);
    };
  }, [calConnected, editDue, editDueTime, editEndTime, editingId, headers]);

  // ── Fetch calendar data ────────────────────────────────────────────────────
  const fetchCalendar = useCallback(() => {
    if (!authToken) return;
    setCalLoading(true);
    fetch('/api/calendar/events', { headers: headers() })
      .then(r => r.json())
      .then(
        (data: {
          connected?: boolean;
          email?: string;
          events?: CalEvent[];
          eventsError?: string;
          _debug?: unknown;
        }) => {
          setCalConnected(data.connected ?? false);
          setCalEmail(data.email ?? '');
          setCalEvents(Array.isArray(data.events) ? data.events : []);
          if (data.eventsError) console.warn('[Calendar] listEvents error:', data.eventsError);
          if (data._debug) console.log('[Calendar] debug:', data._debug);
        }
      )
      .catch(err => console.error('[Calendar] fetchCalendar failed:', err))
      .finally(() => setCalLoading(false));
  }, [authToken, headers]);

  // On mount: check for ?calendar=connected redirect, fetch calendar
  useEffect(() => {
    if (!authToken || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const calParam = params.get('calendar');
    if (calParam) {
      history.replaceState({}, '', window.location.pathname);
    }
    fetchCalendar();
  }, [authToken, fetchCalendar]);

  const connectCalendar = async () => {
    if (!authToken) return;
    try {
      const res = await fetch('/api/calendar/auth', { headers: headers() });
      const data = (await res.json()) as { url?: string };
      if (data.url) window.location.href = data.url;
    } catch {}
  };

  const disconnectCalendar = async () => {
    if (!authToken) return;
    try {
      await fetch('/api/calendar/auth', { method: 'DELETE', headers: headers() });
      setCalConnected(false);
      setCalEmail('');
      setCalEvents([]);
    } catch {}
  };

  // ── Fetch tasks ────────────────────────────────────────────────────────────
  const fetchTasks = useCallback(() => {
    if (!authToken) return;
    fetch('/api/tasks', { headers: headers() })
      .then(r => r.json())
      .then((data: Task[]) => {
        if (Array.isArray(data)) setTasks(data);
      })
      .finally(() => setLoading(false));
  }, [authToken, headers]);

  useEffect(() => {
    if (!authToken) {
      setLoading(false);
      return;
    }
    fetchTasks();
    const interval = setInterval(fetchTasks, 30_000);
    const onTaskUpdated = () => fetchTasks();
    window.addEventListener('based:task-updated', onTaskUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener('based:task-updated', onTaskUpdated);
    };
  }, [authToken, fetchTasks]);

  // ── Fetch entities for selector ────────────────────────────────────────────
  useEffect(() => {
    if (!authToken) return;
    fetch('/api/entities', { headers: headers() })
      .then(r => r.json())
      .then((data: EntityRef[]) => {
        if (Array.isArray(data)) setEntities(data);
      });
  }, [authToken, headers]);

  // ── Add task ───────────────────────────────────────────────────────────────
  const addTask = async () => {
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    const tempId = `temp-${Date.now()}`;
    const optimistic: Task = {
      id: tempId,
      title,
      notes: null,
      due_date: newDue || null,
      due_time: null,
      duration_minutes: null,
      tz_offset: null,
      priority: newPriority,
      status: 'todo',
      tags: [],
      entity_id: null,
      google_event_id: null,
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

  // ── Cycle status: todo → in_progress → done → todo ────────────────────────
  // Cancelled tasks re-enter the cycle from todo.
  const cycleStatus = async (task: Task) => {
    const newStatus: Status =
      task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'todo';
    setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, status: newStatus } : t)));
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ id: task.id, status: newStatus }),
      });
    } catch {
      setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, status: task.status } : t)));
    }
  };

  // ── Cancel task ────────────────────────────────────────────────────────────
  const cancelTask = async (id: string) => {
    const original = tasks.find(t => t.id === id);
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, status: 'cancelled' } : t)));
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ id, status: 'cancelled' }),
      });
    } catch {
      if (original) setTasks(prev => prev.map(t => (t.id === id ? original : t)));
    }
  };

  // ── Inline edit helpers ────────────────────────────────────────────────────
  const startEdit = (task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditDue(toDateInputValue(task.due_date));
    setEditDueTime(task.due_time ?? '');
    setEditEndTime(
      task.due_time && task.duration_minutes
        ? computeEndTime(task.due_time, task.duration_minutes)
        : ''
    );
    setEditPriority(task.priority);
    setEditNotes(task.notes ?? '');
    setEditTags(task.tags ?? []);
    setEditTagInput('');
    setEditEntityId(task.entity_id ?? null);
    setSchedConflict(false);
    setSchedSuggested(null);
    setTimeout(() => editTitleRef.current?.focus(), 0);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTagInput('');
  };

  const addEditTag = () => {
    const tag = editTagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!tag || editTags.includes(tag)) {
      setEditTagInput('');
      return;
    }
    setEditTags(prev => [...prev, tag]);
    setEditTagInput('');
  };

  const removeEditTag = (tag: string) => setEditTags(prev => prev.filter(t => t !== tag));

  const saveEdit = async (overrideStartTime?: string, overrideEndTime?: string) => {
    const title = editTitle.trim();
    if (!title || !editingId || saving) return;
    setSaving(true);

    const dueTime = overrideStartTime ?? editDueTime;
    const endTime = overrideEndTime ?? editEndTime;
    const durationMinutes = dueTime && endTime ? computeDuration(dueTime, endTime) : null;
    const original = tasks.find(t => t.id === editingId);
    const tzOff = dueTime && durationMinutes ? getBrowserTzOffset() : null;
    const updated = {
      ...original!,
      title,
      due_date: editDue || null,
      due_time: dueTime || null,
      duration_minutes: durationMinutes,
      tz_offset: tzOff,
      priority: editPriority,
      notes: editNotes.trim() || null,
      tags: editTags,
      entity_id: editEntityId,
    };

    setTasks(prev => prev.map(t => (t.id === editingId ? updated : t)));
    setEditingId(null);
    setEditTagInput('');
    setSchedConflict(false);
    setSchedSuggested(null);

    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
          id: editingId,
          title,
          due_date: editDue || null,
          due_time: dueTime || null,
          duration_minutes: durationMinutes,
          tz_offset: tzOff,
          priority: editPriority,
          notes: editNotes.trim() || null,
          tags: editTags,
          entity_id: editEntityId,
        }),
      });
      const saved: Task = await res.json();
      setTasks(prev => prev.map(t => (t.id === saved.id ? saved : t)));
    } catch {
      if (original) setTasks(prev => prev.map(t => (t.id === original.id ? original : t)));
    } finally {
      setSaving(false);
    }
  };

  const acceptSuggestedSlot = () => {
    if (!schedSuggested || !editDue || !editDueTime || !editEndTime) return;
    const duration = computeDuration(editDueTime, editEndTime);
    const newStart = schedSuggested;
    const newEnd = computeEndTime(schedSuggested, duration);
    fetch('/api/scheduling/learn', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ original_time: editDueTime, accepted_time: newStart, date: editDue }),
    }).catch(() => {});
    saveEdit(newStart, newEnd);
  };

  // ── Delete task ────────────────────────────────────────────────────────────
  const deleteTask = async (id: string) => {
    if (editingId === id) setEditingId(null);
    setTasks(prev => prev.filter(t => t.id !== id));
    try {
      await fetch(`/api/tasks?id=${id}`, { method: 'DELETE', headers: headers() });
    } catch {
      // Silent fail
    }
  };

  // ── Entity lookup map ──────────────────────────────────────────────────────
  const entityMap = new Map(entities.map(e => [e.id, e]));

  // ── Group tasks ────────────────────────────────────────────────────────────
  const overdue = tasks.filter(isOverdue);
  const dueToday = tasks.filter(isDueToday);
  const upcoming = tasks.filter(
    t => isUpcoming(t) || (!t.due_date && t.status !== 'done' && t.status !== 'cancelled')
  );
  const done = tasks.filter(t => t.status === 'done');
  const cancelled = tasks.filter(t => t.status === 'cancelled');

  const overdueIds = new Set(overdue.map(t => t.id));
  const todayIds = new Set(dueToday.map(t => t.id));
  const upcomingClean = upcoming.filter(t => !overdueIds.has(t.id) && !todayIds.has(t.id));

  const filterCounts: Record<FilterTab, number> = {
    all: tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length,
    today: dueToday.length + overdue.length,
    upcoming: upcomingClean.length,
    done: done.length + cancelled.length,
  };

  // Checkbox glyph + CSS class for status
  const checkboxGlyph = (status: Status) => {
    if (status === 'done') return '◈';
    if (status === 'in_progress') return '◉';
    if (status === 'cancelled') return '⊘';
    return '◻';
  };
  const checkboxClass = (status: Status) => {
    if (status === 'done') return 'tasks-checkbox checked';
    if (status === 'in_progress') return 'tasks-checkbox in-progress';
    if (status === 'cancelled') return 'tasks-checkbox cancelled';
    return 'tasks-checkbox';
  };
  const checkboxTitle = (status: Status) => {
    if (status === 'done') return 'Mark incomplete';
    if (status === 'in_progress') return 'Mark done';
    if (status === 'cancelled') return 'Restore task';
    return 'Start task';
  };

  const renderGroup = (label: string, items: Task[], labelColor?: string) => {
    const filtered = search ? items.filter(t => matchesSearch(t, search)) : items;
    if (filtered.length === 0) return null;
    return (
      <div className="tasks-group" key={label}>
        <div className="tasks-group-label" style={labelColor ? { color: labelColor } : undefined}>
          {label}
          <span className="tasks-group-count">{filtered.length}</span>
        </div>
        {filtered.map(task => {
          const isEditing = editingId === task.id;
          const linkedEntity = task.entity_id ? entityMap.get(task.entity_id) : null;

          if (isEditing) {
            return (
              <div key={task.id} className="tasks-edit-form">
                <input
                  ref={editTitleRef}
                  className="tasks-edit-title"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  placeholder="Task title"
                />
                <div className="tasks-edit-row2">
                  <input
                    type="date"
                    className="tasks-edit-date"
                    value={editDue}
                    onChange={e => setEditDue(e.target.value)}
                  />
                  <select
                    className="tasks-edit-priority"
                    value={editPriority}
                    onChange={e => setEditPriority(e.target.value as Priority)}
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                {calConnected && editDue && (
                  <div className="tasks-edit-row2">
                    <input
                      type="time"
                      className="tasks-edit-time"
                      value={editDueTime}
                      onChange={e => setEditDueTime(e.target.value)}
                    />
                    <span className="tasks-time-sep">→</span>
                    <input
                      type="time"
                      className="tasks-edit-duration"
                      value={editEndTime}
                      onChange={e => setEditEndTime(e.target.value)}
                    />
                  </div>
                )}
                {calConnected && editDueTime && editEndTime && (
                  <div
                    className={`tasks-sched-notice${schedConflict ? ' tasks-sched-conflict' : ' tasks-sched-free'}`}
                  >
                    {schedChecking ? (
                      '⊙ Checking availability…'
                    ) : schedConflict ? (
                      schedSuggested ? (
                        <>
                          {`⊘ Conflict — next free: ${schedSuggested} – ${computeEndTime(schedSuggested, computeDuration(editDueTime, editEndTime))}`}
                          <button className="tasks-sched-use-slot" onClick={acceptSuggestedSlot}>
                            Use this slot
                          </button>
                        </>
                      ) : (
                        '⊘ Conflict — no free slot found'
                      )
                    ) : (
                      '◈ Time slot is free'
                    )}
                  </div>
                )}
                {entities.length > 0 && (
                  <select
                    className="tasks-edit-entity"
                    value={editEntityId ?? ''}
                    onChange={e => setEditEntityId(e.target.value || null)}
                  >
                    <option value="">— No entity —</option>
                    {entities.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                )}
                <textarea
                  className="tasks-edit-notes"
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  rows={2}
                />
                <div className="tasks-edit-tags-area">
                  {editTags.length > 0 && (
                    <div className="tasks-edit-tags-chips">
                      {editTags.map(tag => (
                        <span key={tag} className="tasks-edit-tag">
                          {tag}
                          <button
                            className="tasks-edit-tag-del"
                            onClick={() => removeEditTag(tag)}
                            title="Remove tag"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <input
                    className="tasks-edit-tag-input"
                    value={editTagInput}
                    onChange={e => setEditTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addEditTag();
                      }
                      if (e.key === 'Escape') cancelEdit();
                    }}
                    placeholder="Add tag, press Enter…"
                  />
                </div>
                <div className="tasks-edit-actions">
                  <button
                    className="tasks-edit-save"
                    onClick={() => saveEdit()}
                    disabled={!editTitle.trim() || saving}
                  >
                    ◈ Save
                  </button>
                  <button className="tasks-edit-cancel" onClick={cancelEdit}>
                    Cancel
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={task.id}
              className={`tasks-row${task.status === 'done' ? ' tasks-row--done' : ''}${task.status === 'cancelled' ? ' tasks-row--cancelled' : ''}${isOverdue(task) ? ' tasks-row--overdue' : ''}${task.status === 'in_progress' ? ' tasks-row--in-progress' : ''}`}
            >
              <button
                className={checkboxClass(task.status)}
                onClick={() => cycleStatus(task)}
                title={checkboxTitle(task.status)}
              >
                {checkboxGlyph(task.status)}
              </button>
              <div
                className="tasks-row-body"
                onClick={() =>
                  task.status !== 'done' && task.status !== 'cancelled' && startEdit(task)
                }
              >
                <span className="tasks-row-title">{task.title}</span>
                {task.notes && <span className="tasks-row-notes">{task.notes}</span>}
                {task.tags && task.tags.length > 0 && (
                  <div className="tasks-tags-row">
                    {task.tags.map(tag => (
                      <span key={tag} className="tasks-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {linkedEntity && (
                <span className="tasks-row-entity" title={linkedEntity.name}>
                  {linkedEntity.name}
                </span>
              )}
              {task.due_date && (
                <span
                  className="tasks-row-due"
                  style={isOverdue(task) ? { color: '#ef4444' } : undefined}
                >
                  {formatDue(task.due_date)}
                  {task.due_time && (
                    <span className="tasks-row-due-time">{task.due_time.slice(0, 5)}</span>
                  )}
                </span>
              )}
              {task.google_event_id && (
                <span className="tasks-row-cal-badge" title="Synced to Google Calendar">
                  ⬡
                </span>
              )}
              <span
                className="tasks-priority-dot"
                style={{ background: PRIORITY_COLORS[task.priority] }}
                title={PRIORITY_LABELS[task.priority]}
              />
              {task.status !== 'done' && task.status !== 'cancelled' && (
                <>
                  <button
                    className="tasks-row-edit"
                    onClick={() => startEdit(task)}
                    title="Edit task"
                  >
                    ✎
                  </button>
                  <button
                    className="tasks-row-cancel"
                    onClick={() => cancelTask(task.id)}
                    title="Cancel task"
                  >
                    ⊘
                  </button>
                </>
              )}
              <button
                className="tasks-row-del"
                onClick={() => deleteTask(task.id)}
                title="Delete task"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  const visibleOverdue = filter === 'all' || filter === 'today' ? overdue : [];
  const visibleToday = filter === 'all' || filter === 'today' ? dueToday : [];
  const visibleUpcoming = filter === 'all' || filter === 'upcoming' ? upcomingClean : [];
  const visibleDone = filter === 'done' ? done : [];
  const visibleCancelled = filter === 'done' ? cancelled : [];

  const isEmpty =
    visibleOverdue.length === 0 &&
    visibleToday.length === 0 &&
    visibleUpcoming.length === 0 &&
    visibleDone.length === 0 &&
    visibleCancelled.length === 0;

  // If searching and all filtered groups are empty, show empty state
  const isSearchEmpty =
    search !== '' &&
    [
      ...visibleOverdue,
      ...visibleToday,
      ...visibleUpcoming,
      ...visibleDone,
      ...visibleCancelled,
    ].filter(t => matchesSearch(t, search)).length === 0;

  const nextTask = !loading && authToken ? getNextTask(tasks) : null;
  const recommendations =
    !loading && authToken && tasks.length > 0 ? getRecommendations(tasks) : [];
  const showCallout = !loading && authToken;

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

      {/* Next Up callout */}
      {showCallout && (
        <div className="tasks-callout">
          {tasks.length === 0 ? (
            <div className="tasks-callout-empty">
              ◈ No tasks yet. Tell Based to add one — try: &ldquo;add a task: [your task]&rdquo;
            </div>
          ) : (
            <>
              {nextTask && (
                <div
                  className="tasks-nextup-card"
                  style={{ borderLeftColor: PRIORITY_COLORS[nextTask.priority] }}
                >
                  <div className="tasks-nextup-header">
                    <span className="tasks-nextup-label">
                      {nextTask.status === 'in_progress' ? 'In Progress' : 'Next Up'}
                    </span>
                    <span
                      className="tasks-nextup-badge"
                      style={{
                        color: PRIORITY_COLORS[nextTask.priority],
                        borderColor: PRIORITY_COLORS[nextTask.priority],
                      }}
                    >
                      {PRIORITY_LABELS[nextTask.priority]}
                    </span>
                  </div>
                  <div className="tasks-nextup-title">{nextTask.title}</div>
                  {nextTask.due_date && (
                    <div
                      className="tasks-nextup-due"
                      style={isOverdue(nextTask) ? { color: '#ef4444' } : undefined}
                    >
                      {formatDueCallout(nextTask.due_date)}
                    </div>
                  )}
                  {nextTask.notes && <div className="tasks-nextup-notes">{nextTask.notes}</div>}
                  {nextTask.tags && nextTask.tags.length > 0 && (
                    <div className="tasks-tags-row" style={{ marginTop: 6 }}>
                      {nextTask.tags.map(tag => (
                        <span key={tag} className="tasks-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <button className="tasks-nextup-done-btn" onClick={() => cycleStatus(nextTask)}>
                    {nextTask.status === 'in_progress' ? '◈ Done' : '◉ Start'}
                  </button>
                </div>
              )}
              {recommendations.length > 0 && (
                <div className="tasks-recs">
                  {recommendations.map((rec, i) => (
                    <div key={i} className="tasks-rec-item">
                      ◈ {rec}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Search */}
      {authToken && tasks.length > 0 && (
        <div className="tasks-search-wrap">
          <input
            className="tasks-search"
            placeholder="Search tasks…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      )}

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

      {/* Google Calendar status bar */}
      {authToken && calFeatureEnabled && (
        <div className="tasks-cal-bar">
          {calConnected ? (
            <>
              <span className="tasks-cal-bar-status">
                ⊙ {calEmail || 'Google Calendar'} connected
              </span>
              <button className="tasks-cal-bar-disconnect" onClick={disconnectCalendar}>
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="tasks-cal-bar-connect"
              onClick={connectCalendar}
              disabled={calLoading}
            >
              ⊙ Connect Google Calendar
            </button>
          )}
        </div>
      )}

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
        {!loading && authToken && (isEmpty || isSearchEmpty) && (
          <div className="tasks-empty-state">
            <div className="tasks-empty-icon">◉</div>
            <div className="tasks-empty-title">
              {search ? 'No matches' : filter === 'done' ? 'Nothing done yet' : 'All clear'}
            </div>
            <div className="tasks-empty-sub">
              {search
                ? `No tasks matching "${search}"`
                : filter === 'done'
                  ? 'Completed and cancelled tasks will appear here'
                  : 'Add a task above or ask Based to create one'}
            </div>
          </div>
        )}
        {!loading && authToken && !isSearchEmpty && (
          <>
            {renderGroup('Overdue', visibleOverdue, '#ef4444')}
            {renderGroup('Due Today', visibleToday, '#f97316')}
            {filter !== 'done' && renderGroup('Upcoming', visibleUpcoming)}
            {renderGroup('Done', visibleDone)}
            {renderGroup('Cancelled', visibleCancelled, 'var(--text3)')}
          </>
        )}

        {/* Calendar events section */}
        {!loading &&
          authToken &&
          calConnected &&
          filter !== 'done' &&
          (() => {
            const visible =
              filter === 'today'
                ? calEvents.filter(isCalToday)
                : filter === 'upcoming'
                  ? calEvents.filter(isCalUpcoming)
                  : calEvents; // 'all' — next 90d
            return (
              <div className="tasks-cal-section">
                <div className="tasks-cal-section-label">⊙ Calendar</div>
                {visible.length === 0 ? (
                  <div className="tasks-cal-empty">No calendar events in this range</div>
                ) : (
                  visible.map(ev => (
                    <a
                      key={ev.id}
                      href={ev.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tasks-cal-event"
                    >
                      <span className="tasks-cal-event-icon">⊙</span>
                      <span className="tasks-cal-event-title">{ev.title}</span>
                      <span className="tasks-cal-event-time">
                        {formatCalTime(ev.start, ev.allDay)}
                      </span>
                      <span className="tasks-cal-event-arrow">→</span>
                    </a>
                  ))
                )}
              </div>
            );
          })()}
      </div>
    </div>
  );
}
