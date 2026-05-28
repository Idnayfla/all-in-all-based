'use client';

import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface GlyphDef {
  path: string;
  width: number;
}

interface FontMetrics {
  unitsPerEm: number;
  ascent: number;
  descent: number;
}

interface FontDef {
  name: string;
  description: string;
  metrics: FontMetrics;
  glyphs: Record<string, GlyphDef>;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const GLYPH_ROWS = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789.,!?:;-_()\'"',
];

function parseFontDef(text: string): FontDef | null {
  const match = text.match(/<<<FONT_DEF>>>([\s\S]*?)<<<END_FONT_DEF>>>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim()) as FontDef;
  } catch {
    return null;
  }
}

function GlyphSvg({
  glyph,
  size,
  color = 'currentColor',
}: {
  glyph: GlyphDef;
  size: number;
  color?: string;
}) {
  const w = (glyph.width / 100) * size;
  return (
    <svg
      width={w}
      height={size}
      viewBox={`0 0 ${glyph.width} 100`}
      style={{ display: 'inline-block', verticalAlign: 'top', flexShrink: 0 }}
    >
      <path d={glyph.path} fill={color} />
    </svg>
  );
}

function FontRender({ font, text, size }: { font: FontDef; text: string; size: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        lineHeight: 1,
        gap: `${size * 0.04}px 0`,
      }}
    >
      {text.split('').map((char, i) => {
        if (char === '\n') return <div key={i} style={{ width: '100%', height: size * 0.2 }} />;
        if (char === ' ') {
          const spGlyph = font.glyphs[' '];
          const spW = spGlyph ? (spGlyph.width / 100) * size : size * 0.35;
          return <span key={i} style={{ display: 'inline-block', width: spW }} />;
        }
        const glyph = font.glyphs[char];
        if (!glyph)
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                width: size * 0.45,
                height: size,
                opacity: 0.15,
                border: '1px dashed currentColor',
              }}
            />
          );
        return <GlyphSvg key={i} glyph={glyph} size={size} />;
      })}
    </div>
  );
}

export default function FontStudio() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [font, setFont] = useState<FontDef | null>(null);
  const [previewText, setPreviewText] = useState('The quick brown fox\njumps over the lazy dog');
  const [previewSize, setPreviewSize] = useState(52);
  const [tab, setTab] = useState<'preview' | 'glyphs'>('preview');
  const abortRef = useRef<AbortController | null>(null);

  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return {
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      'Content-Type': 'application/json',
    };
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput('');

    const outgoing: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(outgoing);
    setIsGenerating(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let accumulated = '';

    try {
      const headers = await getHeaders();
      const res = await fetch('/api/font-ai', {
        method: 'POST',
        headers,
        signal: ctrl.signal,
        body: JSON.stringify({ messages: outgoing }),
      });

      if (!res.ok || !res.body) throw new Error('Request failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          try {
            const { text: chunk, error } = JSON.parse(payload) as {
              text?: string;
              error?: string;
            };
            if (error) throw new Error(error);
            if (chunk) {
              accumulated += chunk;
              const parsed = parseFontDef(accumulated);
              if (parsed) setFont(parsed);
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: accumulated };
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : 'Generation failed';
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: `Error: ${msg}` };
        return updated;
      });
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [input, messages, isGenerating, getHeaders]);

  const downloadSvg = useCallback(() => {
    if (!font) return;
    const { name, metrics, glyphs } = font;
    const glyphLines = Object.entries(glyphs)
      .map(([char, g]) => {
        const esc =
          char === '"'
            ? '&quot;'
            : char === '&'
              ? '&amp;'
              : char === '<'
                ? '&lt;'
                : char === '>'
                  ? '&gt;'
                  : char;
        return `    <glyph unicode="${esc}" horiz-adv-x="${g.width}" d="${g.path}" />`;
      })
      .join('\n');
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg">
  <defs>
    <font id="${name.replace(/\s+/g, '-')}" horiz-adv-x="${metrics.unitsPerEm}">
      <font-face font-family="${name}" units-per-em="${metrics.unitsPerEm}" ascent="${metrics.ascent}" descent="${metrics.descent}" />
      <missing-glyph horiz-adv-x="${metrics.unitsPerEm}" />
${glyphLines}
    </font>
  </defs>
</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/\s+/g, '-')}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [font]);

  return (
    <div className="fs-root">
      {/* Sidebar: chat */}
      <aside className="fs-chat">
        <div className="fs-chat-header">
          <span className="fs-logo">B&gt;</span>
          <div>
            <div className="fs-chat-title">Font Studio</div>
            <div className="fs-chat-sub">AI typeface designer</div>
          </div>
        </div>

        <div className="fs-messages">
          {messages.length === 0 && (
            <div className="fs-empty">
              <p>Describe a font style to generate.</p>
              <div className="fs-suggestions">
                {[
                  'bold futuristic monospace',
                  'elegant thin serif',
                  'rounded playful sans',
                  'brutalist compressed display',
                ].map(s => (
                  <button
                    key={s}
                    className="fs-suggestion"
                    onClick={() => {
                      setInput(s);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => {
            const display = msg.content.replace(
              /<<<FONT_DEF>>>[\s\S]*?<<<END_FONT_DEF>>>/g,
              '◈ font generated'
            );
            return (
              <div key={i} className={`fs-msg fs-msg--${msg.role}`}>
                {display || (isGenerating && msg.role === 'assistant' ? '···' : '')}
              </div>
            );
          })}
        </div>

        <div className="fs-input-row">
          <textarea
            className="fs-textarea"
            value={input}
            placeholder="Describe your font…"
            rows={2}
            disabled={isGenerating}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            className="fs-send"
            disabled={!isGenerating && !input.trim()}
            onClick={isGenerating ? () => abortRef.current?.abort() : () => void send()}
          >
            {isGenerating ? '◉' : '→'}
          </button>
        </div>
      </aside>

      {/* Main: preview */}
      <main className="fs-main">
        {font ? (
          <>
            <div className="fs-toolbar">
              <div className="fs-font-name">{font.name}</div>
              <div className="fs-font-desc">{font.description}</div>
              <div className="fs-toolbar-right">
                <button
                  className={`fs-tab${tab === 'preview' ? ' fs-tab--active' : ''}`}
                  onClick={() => setTab('preview')}
                >
                  preview
                </button>
                <button
                  className={`fs-tab${tab === 'glyphs' ? ' fs-tab--active' : ''}`}
                  onClick={() => setTab('glyphs')}
                >
                  glyphs
                </button>
                <input
                  type="range"
                  min={18}
                  max={120}
                  value={previewSize}
                  onChange={e => setPreviewSize(Number(e.target.value))}
                  className="fs-slider"
                  title={`${previewSize}px`}
                />
                <button className="fs-download" onClick={downloadSvg}>
                  ↓ SVG
                </button>
              </div>
            </div>

            {tab === 'preview' && (
              <div className="fs-preview-area">
                <textarea
                  className="fs-preview-input"
                  value={previewText}
                  onChange={e => setPreviewText(e.target.value)}
                  rows={2}
                  placeholder="Type to preview…"
                />
                <div className="fs-render">
                  <FontRender font={font} text={previewText} size={previewSize} />
                </div>
              </div>
            )}

            {tab === 'glyphs' && (
              <div className="fs-glyphs">
                {GLYPH_ROWS.map((row, ri) => (
                  <div key={ri} className="fs-glyph-row">
                    {row.split('').map((char, ci) => {
                      const g = font.glyphs[char];
                      return (
                        <div key={ci} className="fs-glyph-cell" title={char}>
                          {g ? (
                            <svg
                              width={36}
                              height={36}
                              viewBox={`0 0 ${g.width} 100`}
                              className="fs-glyph-svg"
                            >
                              <path d={g.path} fill="currentColor" />
                            </svg>
                          ) : (
                            <span className="fs-glyph-missing">?</span>
                          )}
                          <span className="fs-glyph-label">{char === ' ' ? 'sp' : char}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="fs-placeholder">
            <svg width={100} height={100} viewBox="0 0 100 100" opacity={0.18}>
              <path
                d="M15,80 L50,8 L85,80 M25,58 L75,58"
                stroke="#c9a87c"
                strokeWidth={6}
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            <p className="fs-placeholder-text">Your font will render here</p>
            <p className="fs-placeholder-sub">Describe a style in the chat →</p>
          </div>
        )}
      </main>
    </div>
  );
}
