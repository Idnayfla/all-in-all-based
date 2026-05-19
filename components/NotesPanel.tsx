'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontFamily } from '@tiptap/extension-font-family';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Extension } from '@tiptap/core';

// ── Custom FontSize extension ─────────────────────────────────────────────────
const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() { return { types: ['textStyle'] }; },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: el => el.style.fontSize || null,
          renderHTML: attrs => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (size: string) => ({ chain }: any) =>
        chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }: any) =>
        chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    } as any;
  },
});

// ── Types ──────────────────────────────────────────────────────────────────────
interface Note {
  id: string;
  title: string;
  content: string;
  drawing_data: string | null;
  created_at: string;
  updated_at: string;
}

interface DrawStroke {
  color: string;
  width: number;
  eraser: boolean;
  points: { x: number; y: number }[];
}

const FONTS = [
  { label: 'Sans-serif', value: 'Inter, sans-serif' },
  { label: 'Serif',      value: 'Georgia, serif' },
  { label: 'Mono',       value: 'JetBrains Mono, monospace' },
  { label: 'Cursive',    value: 'cursive' },
];
const FONT_SIZES = ['10px','12px','14px','16px','18px','20px','24px','28px','32px','40px','48px','64px'];
const COLORS = ['#ffffff','#f87171','#fb923c','#facc15','#4ade80','#60a5fa','#a78bfa','#f472b6','#000000'];
const HIGHLIGHT_COLORS = ['#fef08a','#bbf7d0','#bfdbfe','#fde8d8','#f5d0fe'];
const PEN_SIZES = [2, 4, 8, 16];

// ── Component ─────────────────────────────────────────────────────────────────
export default function NotesPanel({ authToken }: { authToken?: string }) {
  const [notes, setNotes]             = useState<Note[]>([]);
  const [selId, setSelId]             = useState<string | null>(null);
  const [title, setTitle]             = useState('');
  const [drawMode, setDrawMode]       = useState(false);
  const [strokes, setStrokes]         = useState<DrawStroke[]>([]);
  const [penColor, setPenColor]       = useState('#60a5fa');
  const [penSize, setPenSize]         = useState(4);
  const [eraser, setEraser]           = useState(false);
  const [search, setSearch]           = useState('');
  const [saving, setSaving]           = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading]         = useState(true);
  const [showExport, setShowExport]   = useState(false);

  const saveTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const isDrawing   = useRef(false);
  const currentStroke = useRef<DrawStroke | null>(null);
  const titleTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Tiptap editor ──────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { HTMLAttributes: { class: 'notes-code-block' } } }),
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: '',
    editorProps: {
      attributes: { class: 'notes-editor-inner', spellCheck: 'true' },
    },
    onUpdate: ({ editor }) => {
      scheduleNoteSave(editor.getHTML());
    },
    immediatelyRender: false,
  });

  // ── Auth headers ───────────────────────────────────────────────────────────
  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  }), [authToken]);

  // ── Load notes ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authToken) { setLoading(false); return; }
    fetch('/api/notes', { headers: headers() })
      .then(r => r.json())
      .then((data: Note[]) => {
        if (Array.isArray(data)) setNotes(data);
      })
      .finally(() => setLoading(false));
  }, [authToken]);

  // ── Select note ────────────────────────────────────────────────────────────
  const selectNote = useCallback((note: Note) => {
    setSelId(note.id);
    setTitle(note.title);
    editor?.commands.setContent(note.content || '<p></p>');
    let strk: DrawStroke[] = [];
    try { strk = note.drawing_data ? JSON.parse(note.drawing_data) : []; } catch {}
    setStrokes(strk);
    setDrawMode(false);
    // Force canvas clear so stale strokes don't persist between notes
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, [editor]);

  // ── Draw strokes onto canvas ───────────────────────────────────────────────
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(stroke => {
      if (stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.eraser ? 'rgba(0,0,0,1)' : stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (stroke.eraser) ctx.globalCompositeOperation = 'destination-out';
      else ctx.globalCompositeOperation = 'source-over';
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
  }, [strokes]);

  useEffect(() => { redrawCanvas(); }, [redrawCanvas]);

  // Resize canvas to match container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      canvas.width  = rect.width;
      canvas.height = rect.height;
      redrawCanvas();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [redrawCanvas]);

  // ── Pointer events for drawing ─────────────────────────────────────────────
  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawMode) return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    isDrawing.current = true;
    const pt = getPoint(e);
    currentStroke.current = { color: penColor, width: penSize, eraser, points: [pt, pt] };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || !currentStroke.current) return;
    e.preventDefault();
    const pt = getPoint(e);
    currentStroke.current.points.push(pt);

    // Live draw current stroke
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pts = currentStroke.current.points;
    ctx.beginPath();
    ctx.strokeStyle = eraser ? 'rgba(0,0,0,1)' : penColor;
    ctx.lineWidth = penSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  };

  const onPointerUp = () => {
    if (!isDrawing.current || !currentStroke.current) return;
    isDrawing.current = false;
    const newStrokes = [...strokes, currentStroke.current];
    currentStroke.current = null;
    setStrokes(newStrokes);
    scheduleNoteSave(editor?.getHTML() ?? '', newStrokes);
  };

  // ── Save logic ─────────────────────────────────────────────────────────────
  const scheduleNoteSave = useCallback((html: string, overrideStrokes?: DrawStroke[]) => {
    if (!selId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      const strokesData = overrideStrokes ?? strokes;
      await fetch(`/api/notes/${selId}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({
          content: html,
          drawing_data: strokesData.length > 0 ? JSON.stringify(strokesData) : null,
        }),
      });
      setSaving(false);
      setNotes(prev => prev.map(n => n.id === selId
        ? { ...n, content: html, drawing_data: strokesData.length > 0 ? JSON.stringify(strokesData) : null, updated_at: new Date().toISOString() }
        : n
      ));
    }, 800);
  }, [selId, strokes, headers]);

  const saveTitleNow = useCallback(async (newTitle: string) => {
    if (!selId) return;
    await fetch(`/api/notes/${selId}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ title: newTitle }),
    });
    setNotes(prev => prev.map(n => n.id === selId ? { ...n, title: newTitle } : n));
  }, [selId, headers]);

  // ── New note ───────────────────────────────────────────────────────────────
  const createNote = async () => {
    const res  = await fetch('/api/notes', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ title: 'Untitled', content: '<p></p>' }),
    });
    const note: Note = await res.json();
    setNotes(prev => [note, ...prev]);
    selectNote(note);
  };

  // ── Delete note ────────────────────────────────────────────────────────────
  const deleteNote = async (id: string) => {
    await fetch(`/api/notes/${id}`, { method: 'DELETE', headers: headers() });
    setNotes(prev => prev.filter(n => n.id !== id));
    if (selId === id) {
      setSelId(null);
      setTitle('');
      editor?.commands.setContent('<p></p>');
      setStrokes([]);
    }
  };

  // ── Export ─────────────────────────────────────────────────────────────────
  const htmlToMarkdown = (html: string): string => {
    return html
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
      .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
      .replace(/<u[^>]*>(.*?)<\/u>/gi, '__$1__')
      .replace(/<s[^>]*>(.*?)<\/s>/gi, '~~$1~~')
      .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
      .replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, (m) => '```\n' + m.replace(/<[^>]+>/g, '') + '\n```\n')
      .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => '> ' + c.replace(/<[^>]+>/g, '') + '\n')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const exportNote = (format: 'html' | 'txt' | 'md') => {
    const html = editor?.getHTML() ?? '';
    let blob: Blob;
    let name: string;
    const base = title || 'note';
    if (format === 'html') {
      blob = new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.7}pre{background:#111;padding:16px;border-radius:6px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}</style></head><body>${html}</body></html>`], { type: 'text/html' });
      name = `${base}.html`;
    } else if (format === 'md') {
      blob = new Blob([htmlToMarkdown(html)], { type: 'text/markdown' });
      name = `${base}.md`;
    } else {
      blob = new Blob([editor?.getText() ?? ''], { type: 'text/plain' });
      name = `${base}.txt`;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setShowExport(false);
  };

  // ── Filtered notes ─────────────────────────────────────────────────────────
  const filtered = notes.filter(n =>
    n.title.toLowerCase().includes(search.toLowerCase())
  );

  const sel = notes.find(n => n.id === selId) ?? null;

  // ── Toolbar helpers ────────────────────────────────────────────────────────
  const isActive = (name: string, attrs?: Record<string, any>) =>
    editor?.isActive(name, attrs) ?? false;
  const cmd = (fn: () => void) => { fn(); editor?.view.focus(); };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="notes-root">
      {/* Sidebar */}
      <div className={`notes-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="notes-sidebar-top">
          <button className="notes-new-btn" onClick={createNote}>+ New Note</button>
          <input
            className="notes-search"
            placeholder="Search notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="notes-list">
          {loading && <div className="notes-empty">Loading…</div>}
          {!loading && !authToken && <div className="notes-empty">Sign in to use Notes</div>}
          {!loading && authToken && filtered.length === 0 && (
            <div className="notes-empty">No notes yet</div>
          )}
          {filtered.map(note => (
            <div
              key={note.id}
              className={`notes-list-item${note.id === selId ? ' active' : ''}`}
              onClick={() => selectNote(note)}
            >
              <div className="notes-list-title">{note.title || 'Untitled'}</div>
              <div className="notes-list-date">{new Date(note.updated_at).toLocaleDateString()}</div>
              <button
                className="notes-list-del"
                onClick={e => { e.stopPropagation(); deleteNote(note.id); }}
                title="Delete"
              >✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* Editor area */}
      <div className="notes-main">
        {/* Top bar */}
        <div className="notes-topbar">
          <button
            className="notes-sidebar-toggle"
            onClick={() => setSidebarOpen(s => !s)}
            title="Toggle sidebar"
          >☰</button>

          {sel ? (
            <>
              <input
                className="notes-title-input"
                value={title}
                placeholder="Untitled"
                onChange={e => {
                  setTitle(e.target.value);
                  if (titleTimer.current) clearTimeout(titleTimer.current);
                  titleTimer.current = setTimeout(() => saveTitleNow(e.target.value), 800);
                }}
              />
              <span className="notes-save-status">{saving ? '· saving…' : '· saved'}</span>

              {/* Draw toggle */}
              <button
                className={`notes-mode-btn${drawMode ? ' active' : ''}`}
                onClick={() => setDrawMode(d => !d)}
                title="Toggle drawing layer"
              >✏ Draw</button>

              {/* Export */}
              <div className="notes-export-wrap" style={{ position: 'relative' }}>
                <button className="notes-export-btn" onClick={() => setShowExport(s => !s)}>↓ Export</button>
                {showExport && (
                  <div className="notes-export-menu" style={{ display: 'flex' }}>
                    <button onClick={() => exportNote('md')}>Markdown</button>
                    <button onClick={() => exportNote('html')}>HTML</button>
                    <button onClick={() => exportNote('txt')}>Plain text</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <span className="notes-pick-hint">← Select or create a note</span>
          )}
        </div>

        {sel ? (
          <>
            {/* Formatting toolbar */}
            {!drawMode && (
              <div className="notes-toolbar">
                {/* Font family */}
                <select
                  className="notes-select"
                  title="Font family"
                  onChange={e => cmd(() => editor?.chain().focus().setFontFamily(e.target.value).run())}
                >
                  {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>

                {/* Font size */}
                <select
                  className="notes-select notes-select-sm"
                  title="Font size"
                  defaultValue="16px"
                  onChange={e => cmd(() => (editor?.chain().focus() as any).setFontSize(e.target.value).run())}
                >
                  {FONT_SIZES.map(s => <option key={s} value={s}>{s.replace('px','')}</option>)}
                </select>

                <div className="notes-toolbar-sep" />

                {/* Text formatting */}
                <button className={`notes-tool-btn${isActive('bold') ? ' on' : ''}`} title="Bold" onClick={() => cmd(() => editor?.chain().focus().toggleBold().run())}><b>B</b></button>
                <button className={`notes-tool-btn${isActive('italic') ? ' on' : ''}`} title="Italic" onClick={() => cmd(() => editor?.chain().focus().toggleItalic().run())}><i>I</i></button>
                <button className={`notes-tool-btn${isActive('underline') ? ' on' : ''}`} title="Underline" onClick={() => cmd(() => editor?.chain().focus().toggleUnderline().run())}><u>U</u></button>
                <button className={`notes-tool-btn${isActive('strike') ? ' on' : ''}`} title="Strikethrough" onClick={() => cmd(() => editor?.chain().focus().toggleStrike().run())}><s>S</s></button>

                <div className="notes-toolbar-sep" />

                {/* Headings */}
                {([1,2,3] as const).map(l => (
                  <button key={l} className={`notes-tool-btn${isActive('heading', { level: l }) ? ' on' : ''}`} title={`Heading ${l}`} onClick={() => cmd(() => editor?.chain().focus().toggleHeading({ level: l }).run())}>H{l}</button>
                ))}

                <div className="notes-toolbar-sep" />

                {/* Lists */}
                <button className={`notes-tool-btn${isActive('bulletList') ? ' on' : ''}`} title="Bullet list" onClick={() => cmd(() => editor?.chain().focus().toggleBulletList().run())}>• –</button>
                <button className={`notes-tool-btn${isActive('orderedList') ? ' on' : ''}`} title="Ordered list" onClick={() => cmd(() => editor?.chain().focus().toggleOrderedList().run())}>1.</button>
                <button className={`notes-tool-btn${isActive('blockquote') ? ' on' : ''}`} title="Blockquote" onClick={() => cmd(() => editor?.chain().focus().toggleBlockquote().run())}>"</button>
                <button className={`notes-tool-btn${isActive('codeBlock') ? ' on' : ''}`} title="Code block" onClick={() => cmd(() => editor?.chain().focus().toggleCodeBlock().run())}>&lt;/&gt;</button>

                <div className="notes-toolbar-sep" />

                {/* Table */}
                <button className="notes-tool-btn" title="Insert table" onClick={() => cmd(() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>⊞ Table</button>
                {isActive('table') && (
                  <>
                    <button className="notes-tool-btn" title="Add row" onClick={() => cmd(() => editor?.chain().focus().addRowAfter().run())}>+Row</button>
                    <button className="notes-tool-btn" title="Add column" onClick={() => cmd(() => editor?.chain().focus().addColumnAfter().run())}>+Col</button>
                    <button className="notes-tool-btn" title="Delete table" onClick={() => cmd(() => editor?.chain().focus().deleteTable().run())}>✕Table</button>
                  </>
                )}

                <div className="notes-toolbar-sep" />

                {/* Text color */}
                <div className="notes-color-wrap" title="Text color">
                  <span className="notes-color-label">A</span>
                  <div className="notes-color-row">
                    {COLORS.map(c => (
                      <button
                        key={c}
                        className="notes-color-dot"
                        style={{ background: c, border: c === '#ffffff' ? '1px solid #555' : 'none' }}
                        onClick={() => cmd(() => editor?.chain().focus().setColor(c).run())}
                      />
                    ))}
                  </div>
                </div>

                {/* Highlight */}
                <div className="notes-color-wrap" title="Highlight">
                  <span className="notes-color-label">H</span>
                  <div className="notes-color-row">
                    {HIGHLIGHT_COLORS.map(c => (
                      <button
                        key={c}
                        className="notes-color-dot"
                        style={{ background: c }}
                        onClick={() => cmd(() => editor?.chain().focus().toggleHighlight({ color: c }).run())}
                      />
                    ))}
                  </div>
                </div>

                <div className="notes-toolbar-sep" />
                <button className="notes-tool-btn" title="Clear formatting" onClick={() => cmd(() => editor?.chain().focus().unsetAllMarks().clearNodes().run())}>✕ fmt</button>
              </div>
            )}

            {/* Draw toolbar */}
            {drawMode && (
              <div className="notes-toolbar notes-draw-toolbar">
                <span className="notes-draw-label">Pen color:</span>
                {COLORS.filter(c => c !== '#ffffff').map(c => (
                  <button
                    key={c}
                    className={`notes-color-dot${penColor === c && !eraser ? ' selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => { setPenColor(c); setEraser(false); }}
                  />
                ))}
                <div className="notes-toolbar-sep" />
                <span className="notes-draw-label">Size:</span>
                {PEN_SIZES.map(s => (
                  <button
                    key={s}
                    className={`notes-tool-btn${penSize === s && !eraser ? ' on' : ''}`}
                    onClick={() => { setPenSize(s); setEraser(false); }}
                  >{s}</button>
                ))}
                <div className="notes-toolbar-sep" />
                <button className={`notes-tool-btn${eraser ? ' on' : ''}`} onClick={() => setEraser(e => !e)}>◻ Eraser</button>
                <button className="notes-tool-btn" onClick={() => {
                  setStrokes([]);
                  const canvas = canvasRef.current;
                  if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
                  scheduleNoteSave(editor?.getHTML() ?? '', []);
                }}>✕ Clear</button>
                <div className="notes-toolbar-sep" />
                <span className="notes-draw-hint">Draw on top of your text</span>
              </div>
            )}

            {/* Editor + Canvas */}
            <div className="notes-editor-wrap">
              <EditorContent editor={editor} className="notes-editor-scroll" />
              {/* Drawing canvas overlays the editor when in draw mode */}
              <canvas
                ref={canvasRef}
                className={`notes-canvas${drawMode ? ' active' : ''}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              />
            </div>
          </>
        ) : (
          <div className="notes-empty-state">
            <div className="notes-empty-icon">◈</div>
            <div className="notes-empty-title">Personal Notes</div>
            <div className="notes-empty-sub">Write, draw, code — syncs across all your devices</div>
            {authToken && (
              <button className="notes-empty-btn" onClick={createNote}>+ Create your first note</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
