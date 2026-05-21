'use client';
import { useState, useEffect, useRef } from 'react';

interface DebugEvent {
  time: string;
  type: 'chunk' | 'done' | 'error' | 'info';
  data: string;
}

export default function DebugPanel() {
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [tab, setTab] = useState<'events' | 'raw'>('events');
  const [rawStream, setRawStream] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDebug = (e: CustomEvent) => {
      const { type, data } = e.detail;
      const time = new Date().toISOString().split('T')[1].slice(0, 12);
      setEvents(prev => [...prev.slice(-200), { time, type, data }]);
      if (type === 'chunk') setRawStream(prev => prev + data);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    };
    window.addEventListener('debug-event', handleDebug as EventListener);
    return () => window.removeEventListener('debug-event', handleDebug as EventListener);
  }, []);

  return (
    <div className="debug-panel">
      <div className="debug-header">
        <span className="debug-title">Stream Debug</span>
        <button
          className="debug-clear"
          onClick={() => {
            setEvents([]);
            setRawStream('');
          }}
        >
          Clear
        </button>
      </div>

      <div className="debug-tabs">
        <button
          className={`debug-tab${tab === 'events' ? ' active' : ''}`}
          onClick={() => setTab('events')}
        >
          Events
        </button>
        <button
          className={`debug-tab${tab === 'raw' ? ' active' : ''}`}
          onClick={() => setTab('raw')}
        >
          Raw Stream
        </button>
      </div>

      <div className="debug-body">
        {tab === 'events' && (
          <div className="debug-scroll">
            {events.length === 0 && (
              <div className="debug-empty">No events yet. Send a message.</div>
            )}
            {events.map((ev, i) => (
              <div key={i} className={`debug-event debug-event-${ev.type}`}>
                <span className="debug-time">{ev.time} </span>
                <span className="debug-type">[{ev.type.toUpperCase()}]</span>{' '}
                <span className="debug-data">
                  {ev.type === 'chunk'
                    ? ev.data.slice(0, 80) + (ev.data.length > 80 ? '…' : '')
                    : ev.data}
                </span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
        {tab === 'raw' && (
          <div className="debug-scroll">
            <pre className="debug-raw">
              {rawStream || 'Raw stream appears here during generation…'}
            </pre>
          </div>
        )}
      </div>

      <div className="debug-footer">
        {events.length} events · {events.filter(e => e.type === 'chunk').length} chunks ·{' '}
        {events.filter(e => e.type === 'done').length} done
      </div>
    </div>
  );
}
