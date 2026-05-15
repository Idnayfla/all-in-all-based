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
  // Prevent double-firing on the same utterance
  const lastCommandRef = useRef('');

  const updateState = (s: VoiceState) => { stateRef.current = s; setState(s); };

  const stop = useCallback(() => {
    try { activeRef.current?.stop(); } catch {}
    activeRef.current = null;
    updateState('idle');
    setTranscript('');
    setError(null);
    lastCommandRef.current = '';
  }, []);

  const start = useCallback(() => {
    const SR = typeof window !== 'undefined'
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;

    if (!SR) {
      updateState('unsupported');
      setError('Speech recognition not supported in this browser');
      return;
    }

    setError(null);
    lastCommandRef.current = '';

    const rec = new SR();
    // continuous + interimResults: streams partial results as you speak,
    // instead of waiting for a silence gap to finalize — much more responsive
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    activeRef.current = rec;

    rec.onstart = () => {
      console.log('[voice] started — say "Based, [command]"');
      setError(null);
    };

    rec.onspeechstart = () => console.log('[voice] speech detected');
    rec.onspeechend  = () => console.log('[voice] speech ended');
    rec.onnomatch    = () => console.log('[voice] no match');

    rec.onresult = (e: any) => {
      // Collect all results into one transcript string
      let full = '';
      for (let i = 0; i < e.results.length; i++) {
        full += e.results[i][0].transcript;
      }
      full = full.trim();
      console.log('[voice] transcript:', full);

      const lower = full.toLowerCase();
      const idx = lower.indexOf(triggerWord);
      if (idx === -1) return;

      // Extract everything after the trigger word
      const command = full.slice(idx + triggerWord.length).replace(/^[,!.?\s]+/, '').trim();
      if (!command || command === lastCommandRef.current) return;

      // Only fire when the result following the trigger is a final result
      const lastResult = e.results[e.results.length - 1];
      if (!lastResult.isFinal) return;

      lastCommandRef.current = command;
      console.log('[voice] command fired:', command);
      updateState('activated');
      setTranscript(command);
      onCommandRef.current(command);
      setTimeout(() => {
        setTranscript('');
        lastCommandRef.current = '';
        if (stateRef.current === 'activated') updateState('listening');
      }, 900);
    };

    rec.onerror = (e: any) => {
      console.warn('[voice] error:', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microphone access denied — allow mic in browser settings');
        updateState('idle');
      } else if (e.error === 'network') {
        setError('Network error — Chrome voice needs internet to work');
      } else if (e.error === 'no-speech') {
        console.log('[voice] no-speech timeout — mic may not be picking up audio');
        // don't show error — onend will restart
      } else {
        setError(`Voice error: ${e.error}`);
      }
    };

    rec.onend = () => {
      console.log('[voice] ended, state:', stateRef.current);
      // With continuous: true this fires on network drop or browser stop.
      // Restart after a short gap to keep listening.
      if (stateRef.current === 'listening' || stateRef.current === 'activated') {
        setTimeout(() => {
          if (stateRef.current === 'listening' || stateRef.current === 'activated') start();
        }, 300);
      }
    };

    try {
      rec.start();
      console.log('[voice] rec.start() called');
    } catch (err: any) {
      console.warn('[voice] start threw:', err.message);
      setError(`Could not start mic: ${err.message}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerWord]);

  const toggle = useCallback(() => {
    if (stateRef.current === 'idle') {
      updateState('listening');
      start();
    } else {
      stop();
    }
  }, [start, stop]);

  useEffect(() => () => { try { activeRef.current?.stop(); } catch {} }, []);

  return { state, transcript, error, toggle };
}
