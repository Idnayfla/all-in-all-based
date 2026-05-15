'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceState = 'idle' | 'listening' | 'activated' | 'unsupported';

export function useVoiceActivation(onCommand: (text: string) => void, triggerWord = 'based') {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<VoiceState>('idle');
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const activeRef = useRef<any>(null);

  const updateState = (s: VoiceState) => { stateRef.current = s; setState(s); };

  const startOnce = useCallback(() => {
    const SR = typeof window !== 'undefined'
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;

    if (!SR) {
      updateState('unsupported');
      setError('Speech recognition not supported in this browser');
      return;
    }

    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    activeRef.current = rec;

    rec.onstart = () => {
      console.log('[voice] recognition started');
      setError(null);
    };

    rec.onresult = (e: any) => {
      const text: string = e.results[0][0].transcript.trim();
      console.log('[voice] heard:', text);
      if (text.toLowerCase().startsWith(triggerWord)) {
        const command = text.replace(new RegExp(`^${triggerWord}[,!.?\\s]*`, 'i'), '').trim();
        console.log('[voice] command:', command);
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

    rec.onerror = (e: any) => {
      console.warn('[voice] error:', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microphone access denied — allow mic in browser settings');
        updateState('idle');
      } else if (e.error === 'network') {
        setError('Network error — voice needs internet connection');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setError(`Voice error: ${e.error}`);
      }
    };

    rec.onend = () => {
      console.log('[voice] recognition ended, state:', stateRef.current);
      if (stateRef.current === 'listening' || stateRef.current === 'activated') {
        setTimeout(startOnce, 150);
      }
    };

    try {
      rec.start();
      console.log('[voice] rec.start() called');
    } catch (err: any) {
      console.warn('[voice] start threw:', err.message);
      setError(`Could not start mic: ${err.message}`);
    }
  }, [triggerWord]);

  const start = useCallback(() => {
    setError(null);
    updateState('listening');
    startOnce();
  }, [startOnce]);

  const stop = useCallback(() => {
    try { activeRef.current?.abort(); } catch {}
    activeRef.current = null;
    updateState('idle');
    setTranscript('');
    setError(null);
  }, []);

  const toggle = useCallback(() => {
    stateRef.current === 'idle' ? start() : stop();
  }, [start, stop]);

  useEffect(() => () => { try { activeRef.current?.abort(); } catch {} }, []);

  return { state, transcript, error, toggle };
}
