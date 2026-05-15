'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceState = 'idle' | 'listening' | 'activated' | 'unsupported';

export function useVoiceActivation(onCommand: (text: string) => void, triggerWord = 'based') {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const stateRef = useRef<VoiceState>('idle');
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  // Keep a ref to the active recognition instance so stop() can abort it
  const activeRef = useRef<any>(null);

  const updateState = (s: VoiceState) => { stateRef.current = s; setState(s); };

  // Creates and starts one recognition utterance. When it ends, schedules itself again.
  const startOnce = useCallback(() => {
    const SR = typeof window !== 'undefined'
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;
    if (!SR) { updateState('unsupported'); return; }

    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;      // one utterance per instance — most reliable cross-browser
    rec.interimResults = false;  // final results only — cleaner trigger matching
    rec.maxAlternatives = 1;
    activeRef.current = rec;

    rec.onresult = (e: any) => {
      const text: string = e.results[0][0].transcript.trim();
      if (text.toLowerCase().startsWith(triggerWord)) {
        const command = text.replace(new RegExp(`^${triggerWord}[,!.?\\s]*`, 'i'), '').trim();
        if (command) {
          updateState('activated');
          setTranscript(command);
          onCommandRef.current(command);
          setTimeout(() => {
            setTranscript('');
            if (stateRef.current === 'activated') updateState('listening');
          }, 900);
        }
      }
    };

    // Silently swallow no-speech; warn on anything else
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        updateState('idle'); // mic permission denied — stop trying
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[voice]', e.error);
      }
    };

    // Fresh instance next time — 150ms gap prevents "already started" errors
    rec.onend = () => {
      if (stateRef.current === 'listening' || stateRef.current === 'activated') {
        setTimeout(startOnce, 150);
      }
    };

    try { rec.start(); } catch (err) { console.warn('[voice] start failed', err); }
  }, [triggerWord]);

  const start = useCallback(() => {
    updateState('listening');
    startOnce();
  }, [startOnce]);

  const stop = useCallback(() => {
    try { activeRef.current?.abort(); } catch {}
    activeRef.current = null;
    updateState('idle');
    setTranscript('');
  }, []);

  const toggle = useCallback(() => {
    stateRef.current === 'idle' ? start() : stop();
  }, [start, stop]);

  useEffect(() => () => { try { activeRef.current?.abort(); } catch {} }, []);

  return { state, transcript, toggle };
}
