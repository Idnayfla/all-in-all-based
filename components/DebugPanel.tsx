'use client';
import { useState, useEffect, useRef } from 'react';

interface DebugEvent {
  time: string;
  type: 'chunk' | 'done' | 'error' | 'info';
  data: string;
}

export default function DebugPanel({ enabled }: { enabled: boolean }) {
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [visible, setVisible] = useState(false);
  const [rawStream, setRawStream] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;

    const handleDebug = (e: CustomEvent) => {
      const { type, data } = e.detail;
      const time = new Date().toISOString().split('T')[1].slice(0, 12);
      setEvents(prev => [...prev.slice(-200), { time, type, data }]);
      if (type === 'chunk') setRawStream(prev => prev + data);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    window.addEventListener('debug-event', handleDebug as EventListener);
    return () => window.removeEventListener('debug-event', handleDebug as EventListener);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <button
        onClick={() => setVisible(v => !v)}
        style={{
          position: 'fixed', bottom: 60, right: 16, zIndex: 9999,
          background: '#1a1a2e', border: '1px solid #ff6b6b',
          color: '#ff6b6b', padding: '6px 12px', borderRadius: 6,
          fontSize: 11, cursor: 'pointer', fontFamily: 'monospace'
        }}
      >
        {visible ? '✕ Debug' : '⚡ Debug'}
      </button>

      {visible && (
        <div style={{
          position: 'fixed', bottom: 100, right: 16, width: 480, height: 400,
          background: '#0d0d1a', border: '1px solid #333', borderRadius: 8,
          zIndex: 9998, display: 'flex', flexDirection: 'column',
          fontFamily: 'monospace', fontSize: 11
        }}>
          <div style={{
            padding: '8px 12px', borderBottom: '1px solid #333',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: '#111'
          }}>
            <span style={{ color: '#888' }}>Stream Debug</span>
            <button
              onClick={() => { setEvents([]); setRawStream(''); }}
              style={{ background: 'none', border: '1px solid #444', color: '#888', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}
            >
              Clear
            </button>
          </div>

          <div style={{ display: 'flex', borderBottom: '1px solid #222', fontSize: 10 }}>
            {['Events', 'Raw Stream'].map((tab, i) => (
              <button key={tab} style={{
                flex: 1, padding: '4px', background: 'none',
                border: 'none', color: '#666', cursor: 'pointer'
              }}
                onClick={e => {
                  const parent = (e.target as HTMLElement).closest('div')!.nextSibling as HTMLElement;
                  const panels = parent.querySelectorAll('[data-panel]');
                  panels.forEach((p, pi) => (p as HTMLElement).style.display = pi === i ? 'block' : 'none');
                }}
              >{tab}</button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <div data-panel="0" style={{ height: '100%', overflowY: 'auto', padding: 8 }}>
              {events.length === 0 && (
                <div style={{ color: '#444', textAlign: 'center', marginTop: 20 }}>No events yet. Send a message.</div>
              )}
              {events.map((ev, i) => (
                <div key={i} style={{ marginBottom: 4, borderLeft: `2px solid ${ev.type === 'done' ? '#00ff88' : ev.type === 'error' ? '#ff4444' : ev.type === 'info' ? '#4488ff' : '#444'}`, paddingLeft: 8 }}>
                  <span style={{ color: '#555' }}>{ev.time} </span>
                  <span style={{ color: ev.type === 'done' ? '#00ff88' : ev.type === 'error' ? '#ff4444' : ev.type === 'info' ? '#4488ff' : '#888' }}>
                    [{ev.type.toUpperCase()}]
                  </span>
                  {' '}
                  <span style={{ color: '#ccc', wordBreak: 'break-all' }}>
                    {ev.type === 'chunk' ? ev.data.slice(0, 80) + (ev.data.length > 80 ? '...' : '') : ev.data}
                  </span>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div data-panel="1" style={{ height: '100%', overflowY: 'auto', padding: 8, display: 'none' }}>
              <pre style={{ color: '#ccc', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, fontSize: 10 }}>
                {rawStream || <span style={{ color: '#444' }}>Raw stream appears here during generation...</span>}
              </pre>
            </div>
          </div>

          <div style={{ padding: '4px 8px', borderTop: '1px solid #222', color: '#444', fontSize: 10 }}>
            {events.length} events • {events.filter(e => e.type === 'chunk').length} chunks • {events.filter(e => e.type === 'done').length} done signals
          </div>
        </div>
      )}
    </>
  );
}
