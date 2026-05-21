'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceState = 'idle' | 'listening' | 'activated' | 'unsupported';

// Browser SpeechRecognition API types (not yet in TypeScript's lib.dom.d.ts)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

export function useVoiceActivation(onCommand: (text: string) => void, triggerWord = 'based') {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<VoiceState>('idle');
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const activeRef = useRef<SpeechRecognitionInstance | null>(null);
  const lastCommandRef = useRef('');
  const permissionGranted = useRef(false);
  // Accumulate all transcript text while the user is speaking (push-to-talk mode)
  const accumulatedRef = useRef('');

  const updateState = (s: VoiceState) => {
    stateRef.current = s;
    setState(s);
  };

  const stop = useCallback((submitAccumulated = false) => {
    try {
      activeRef.current?.stop();
    } catch {}
    activeRef.current = null;

    // Push-to-talk: if the user manually stopped, submit whatever they said
    if (submitAccumulated && accumulatedRef.current.trim()) {
      const text = accumulatedRef.current.trim();
      updateState('activated');
      setTranscript(text);
      onCommandRef.current(text);
      setTimeout(() => {
        setTranscript('');
        if (stateRef.current === 'activated') updateState('idle');
      }, 900);
    } else {
      updateState('idle');
      setTranscript('');
    }

    accumulatedRef.current = '';
    setError(null);
    lastCommandRef.current = '';
  }, []);

  const startRec = useCallback(() => {
    const w =
      typeof window !== 'undefined'
        ? (window as Window & {
            SpeechRecognition?: SpeechRecognitionConstructor;
            webkitSpeechRecognition?: SpeechRecognitionConstructor;
          })
        : null;
    const SR: SpeechRecognitionConstructor | undefined =
      w?.SpeechRecognition ?? w?.webkitSpeechRecognition;
    if (!SR) return;

    accumulatedRef.current = '';
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    activeRef.current = rec;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let full = '';
      for (let i = 0; i < e.results.length; i++) full += e.results[i][0].transcript;
      full = full.trim();

      // Always update accumulated transcript so push-to-talk can submit it
      accumulatedRef.current = full;
      setTranscript(full);

      // Wake-word detection (hands-free mode)
      const lower = full.toLowerCase();
      const idx = lower.indexOf(triggerWord);
      if (idx !== -1) {
        const command = full
          .slice(idx + triggerWord.length)
          .replace(/^[,!.?\s]+/, '')
          .trim();
        if (command && command !== lastCommandRef.current) {
          const lastResult = e.results[e.results.length - 1];
          if (lastResult.isFinal) {
            lastCommandRef.current = command;
            updateState('activated');
            setTranscript(command);
            onCommandRef.current(command);
            accumulatedRef.current = '';
            setTimeout(() => {
              setTranscript('');
              lastCommandRef.current = '';
              if (stateRef.current === 'activated') updateState('listening');
            }, 900);
          }
        }
      }
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Mic denied — click the lock icon in the address bar → allow Microphone');
        updateState('idle');
      } else if (e.error === 'network') {
        setError('Network error — Chrome voice requires internet access');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setError(`Voice error: ${e.error}`);
      }
    };

    rec.onend = () => {
      if (stateRef.current === 'listening' || stateRef.current === 'activated') {
        setTimeout(() => {
          if (stateRef.current === 'listening' || stateRef.current === 'activated') startRec();
        }, 300);
      }
    };

    try {
      rec.start();
    } catch (err: unknown) {
      setError(`Could not start mic: ${err instanceof Error ? err.message : String(err)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerWord]);

  const start = useCallback(async () => {
    const w2 =
      typeof window !== 'undefined'
        ? (window as Window & {
            SpeechRecognition?: SpeechRecognitionConstructor;
            webkitSpeechRecognition?: SpeechRecognitionConstructor;
          })
        : null;
    const SR: SpeechRecognitionConstructor | undefined =
      w2?.SpeechRecognition ?? w2?.webkitSpeechRecognition;
    if (!SR) {
      updateState('unsupported');
      setError('Speech recognition not supported — use Chrome or Edge');
      return;
    }

    setError(null);

    if (!permissionGranted.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        permissionGranted.current = true;
        await new Promise(r => setTimeout(r, 300));
      } catch (err: unknown) {
        const name = err instanceof Error ? err.name : '';
        const msg = err instanceof Error ? err.message : String(err);
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setError('Mic blocked — click the lock icon in the address bar → allow Microphone');
        } else if (name === 'NotFoundError') {
          setError('No microphone found — plug in a mic and try again');
        } else {
          setError(`Mic error: ${msg}`);
        }
        updateState('idle');
        return;
      }
    }

    updateState('listening');
    startRec();
  }, [startRec]);

  // Toggle: start if idle, stop-and-submit if listening
  const toggle = useCallback(() => {
    if (stateRef.current === 'idle') {
      start();
    } else {
      stop(true); // submit whatever was accumulated
    }
  }, [start, stop]);

  useEffect(
    () => () => {
      try {
        activeRef.current?.stop();
      } catch {}
    },
    []
  );

  return { state, transcript, error, toggle };
}
