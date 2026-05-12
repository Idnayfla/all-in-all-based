'use client';
import { useEffect, useRef, useState } from 'react';

export interface PersonalitySettings {
  tone:         number;  // 0=Casual, 100=Formal
  length:       number;  // 0=Concise, 100=Detailed
  humour:       number;  // 0=Dry, 100=Playful
  technicality: number;  // 0=Simplified, 100=Expert
  notes:        string;
}

const DEFAULTS: PersonalitySettings = {
  tone: 30, length: 25, humour: 65, technicality: 75, notes: '',
};

const LS_KEY = 'based_personality';

function load(): PersonalitySettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function save(s: PersonalitySettings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

function label(value: number, low: string, high: string): string {
  if (value <= 20) return low;
  if (value <= 40) return `${low}-leaning`;
  if (value <= 60) return 'balanced';
  if (value <= 80) return `${high}-leaning`;
  return high;
}

export function buildPersonalityModifier(s: PersonalitySettings): string {
  const parts = [
    `tone=${label(s.tone, 'casual', 'formal')}`,
    `length=${label(s.length, 'concise', 'detailed')}`,
    `humour=${label(s.humour, 'dry', 'playful')}`,
    `technicality=${label(s.technicality, 'simplified', 'expert')}`,
  ];
  const notes = s.notes.trim();
  return `Personality modifiers: ${parts.join(', ')}.${notes ? ` ${notes}` : ''}`;
}

interface SliderProps {
  value:      number;
  onChange:   (v: number) => void;
  leftLabel:  string;
  rightLabel: string;
}

function Slider({ value, onChange, leftLabel, rightLabel }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const compute = (clientX: number): number => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  };

  useEffect(() => {
    const move = (e: PointerEvent) => { if (dragging.current) onChange(compute(e.clientX)); };
    const up   = ()                 => { dragging.current = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup',   up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup',   up);
    };
  }, [onChange]);

  return (
    <div className="personality-slider-row">
      <div className="personality-slider-ends">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <div
        ref={trackRef}
        className="personality-slider-track"
        onPointerDown={e => { dragging.current = true; onChange(compute(e.clientX)); }}
      >
        <div className="personality-slider-fill" style={{ width: `${value}%` }} />
        <div className="personality-slider-thumb" style={{ left: `${value}%` }} />
      </div>
    </div>
  );
}

interface PersonalityPanelProps {
  onPersonalityChange: (modifier: string) => void;
}

export default function PersonalityPanel({ onPersonalityChange }: PersonalityPanelProps) {
  const [settings, setSettings] = useState<PersonalitySettings>(DEFAULTS);

  useEffect(() => {
    const s = load();
    setSettings(s);
    onPersonalityChange(buildPersonalityModifier(s));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (partial: Partial<PersonalitySettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    save(next);
    onPersonalityChange(buildPersonalityModifier(next));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="personality-locked">
        <span style={{ fontSize: 14, color: 'var(--accent)' }}>&#9670;</span>
        <div>
          <div className="personality-locked-label">Core identity &#8212; [FIXED]</div>
          <div className="personality-locked-sub">Based knows who it is. You shape the style.</div>
        </div>
      </div>

      <div className="settings-label">Tone</div>
      <Slider value={settings.tone} onChange={v => update({ tone: v })} leftLabel="Casual" rightLabel="Formal" />

      <div className="settings-label">Response length</div>
      <Slider value={settings.length} onChange={v => update({ length: v })} leftLabel="Concise" rightLabel="Detailed" />

      <div className="settings-label">Humour</div>
      <Slider value={settings.humour} onChange={v => update({ humour: v })} leftLabel="Dry" rightLabel="Playful" />

      <div className="settings-label">Technicality</div>
      <Slider value={settings.technicality} onChange={v => update({ technicality: v })} leftLabel="Simplified" rightLabel="Expert" />

      <div className="settings-label" style={{ marginTop: 4 }}>Extra notes</div>
      <textarea
        className="settings-textarea"
        rows={2}
        placeholder="Anything else &#8212; e.g. 'Always suggest tests'"
        value={settings.notes}
        onChange={e => update({ notes: e.target.value })}
      />
      <div className="settings-hint">Changes apply immediately to every new message.</div>
    </div>
  );
}
