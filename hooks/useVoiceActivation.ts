'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceState = 'idle' | 'listening' | 'activated' | 'unsupported';

export function useVoiceActivation(onCommand: (text: string) => void, triggerWord = 'based') {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);
  const stateRef = useRef<VoiceState>('idle');
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const updateState = (s: VoiceState) => { stateRef.current = s; setState(s); };

  const stop = useCallback(() => {
    recognitionRef.current?.abort();
    updateState('idle');
    setTranscript('');
  }, []);

  const start = useCallback(() => {
    const SR = typeof window !== 'undefined'
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;
    if (!SR) { updateState('unsupported'); return; }

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';
    recognitionRef.current = rec;

    rec.onresult = (e: any) => {
      const text: string = e.results[0][0].transcript.trim();
      if (text.toLowerCase().startsWith(triggerWord)) {
        const command = text.replace(new RegExp(`^${triggerWord}[,\\s]*`, 'i'), '').trim();
        if (command) {
          updateState('activated');
          setTranscript(command);
          onCommandRef.current(command);
          setTimeout(() => { setTranscript(''); if (stateRef.current === 'activated') updateState('listening'); }, 900);
        }
      }
    };

    // Silently ignore no-speech; log anything unexpected
    rec.onerror = (e: any) => { if (e.error !== 'no-speech') console.warn('[voice]', e.error); };

    // Auto-restart after each utterance so the mic stays open
    rec.onend = () => { if (stateRef.current === 'listening' || stateRef.current === 'activated') { try { rec.start(); } catch {} } };

    updateState('listening');
    try { rec.start(); } catch {}
  }, [triggerWord]);

  const toggle = useCallback(() => {
    stateRef.current === 'idle' ? start() : stop();
  }, [start, stop]);

  useEffect(() => () => { recognitionRef.current?.abort(); }, []);

  return { state, transcript, toggle };
}
