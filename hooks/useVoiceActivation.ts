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
  const lastCommandRef = useRef('');
  // Once granted we skip getUserMedia on subsequent starts to avoid device contention
  const permissionGranted = useRef(false);

  const updateState = (s: VoiceState) => { stateRef.current = s; setState(s); };

  const stop = useCallback(() => {
    try { activeRef.current?.stop(); } catch {}
    activeRef.current = null;
    updateState('idle');
    setTranscript('');
    setError(null);
    lastCommandRef.current = '';
  }, []);

  const startRec = useCallback(() => {
    const SR = typeof window !== 'undefined'
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;
    if (!SR) return;

    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    activeRef.current = rec;

    rec.onstart = () => console.log('[voice] recognition started ✓');
    rec.onspeechstart = () => console.log('[voice] speech detected ✓');
    rec.onspeechend   = () => console.log('[voice] speech ended');

    rec.onresult = (e: any) => {
      let full = '';
      for (let i = 0; i < e.results.length; i++) full += e.results[i][0].transcript;
      full = full.trim();
      console.log('[voice] transcript:', full);

      const lower = full.toLowerCase();
      const idx = lower.indexOf(triggerWord);
      if (idx === -1) return;

      const command = full.slice(idx + triggerWord.length).replace(/^[,!.?\s]+/, '').trim();
      if (!command || command === lastCommandRef.current) return;

      const lastResult = e.results[e.results.length - 1];
      if (!lastResult.isFinal) return;

      lastCommandRef.current = command;
      console.log('[voice] command:', command);
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
        setError('Mic denied — click the 🔒 lock icon in the address bar → allow Microphone');
        updateState('idle');
      } else if (e.error === 'network') {
        setError('Network error — Chrome voice requires internet access');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setError(`Voice error: ${e.error}`);
      }
    };

    rec.onend = () => {
      console.log('[voice] ended, state:', stateRef.current);
      if (stateRef.current === 'listening' || stateRef.current === 'activated') {
        setTimeout(() => {
          if (stateRef.current === 'listening' || stateRef.current === 'activated') startRec();
        }, 300);
      }
    };

    console.log('[voice] calling rec.start()');
    try { rec.start(); } catch (err: any) {
      console.warn('[voice] start threw:', err.message);
      setError(`Could not start mic: ${err.message}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerWord]);

  const start = useCallback(async () => {
    const SR = typeof window !== 'undefined'
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;
    if (!SR) {
      updateState('unsupported');
      setError('Speech recognition not supported — use Chrome or Edge');
      return;
    }

    setError(null);

    if (!permissionGranted.current) {
      // First run: probe permission via getUserMedia then release immediately.
      // We don't skip this even if Permissions API says granted — some browsers lie.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        permissionGranted.current = true;
        console.log('[voice] mic permission confirmed ✓ — waiting for device to release');
        // Give the audio hardware 300ms to fully release before SR grabs it
        await new Promise(r => setTimeout(r, 300));
      } catch (err: any) {
        console.warn('[voice] getUserMedia failed:', err.name, err.message);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError('Mic blocked — click the 🔒 lock icon in the address bar → allow Microphone');
        } else if (err.name === 'NotFoundError') {
          setError('No microphone found — plug in a mic and try again');
        } else {
          setError(`Mic error: ${err.message}`);
        }
        updateState('idle');
        return;
      }
    }

    updateState('listening');
    startRec();
  }, [startRec]);

  const toggle = useCallback(() => {
    stateRef.current === 'idle' ? start() : stop();
  }, [start, stop]);

  useEffect(() => () => { try { activeRef.current?.stop(); } catch {} }, []);

  return { state, transcript, error, toggle };
}
