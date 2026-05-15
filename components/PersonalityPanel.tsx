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

function blend(value: number, low: string, high: string): string {
  if (value <= 15) return low;
  if (value <= 35) return `mostly ${low}`;
  if (value <= 65) return `a balance of ${low} and ${high}`;
  if (value <= 85) return `mostly ${high}`;
  return high;
}

export function buildPersonalityModifier(s: PersonalitySettings): string {
  const instructions = [
    `Tone: ${blend(s.tone, 'casual and informal — use contractions, be relaxed', 'professional and formal — be precise, avoid contractions')}`,
    `Response length: ${blend(s.length, 'ultra-concise — 1-3 sentences max, no elaboration', 'thorough and detailed — explain fully, cover edge cases')}`,
    `Humour: ${blend(s.humour, 'completely dry and deadpan — zero jokes, zero warmth', 'actively playful and witty — use jokes, puns, and light-hearted language freely')}`,
    `Technicality: ${blend(s.technicality, 'explain everything simply — no jargon, assume beginner', 'go full expert mode — use precise technical terms, skip basics')}`,
  ];
  const notes = s.notes.trim();
  return instructions.join('\n') + (notes ? `\nExtra: ${notes}` : '');
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
