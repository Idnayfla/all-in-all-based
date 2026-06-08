#!/usr/bin/env python3
"""
Based — Raspberry Pi voice companion
Say the wake word → speak → Based responds with voice

Wake word engines (priority order):
  1. openWakeWord  — free, offline; default model: hey_mycroft (open source)
                     Train a custom "hey based" model at openWakeWord.github.io
  2. pvporcupine   — supports fully custom wake words, requires Picovoice key
  3. ENTER key     — fallback when neither library is available

LLM backends:
  "based"  — cloud, full Claude quality via getbased.dev API
  "ollama" — local, fully offline via Ollama (http://localhost:11434)

TTS backends:
  "based"  — cloud, ElevenLabs / F5-TTS via getbased.dev API
  "local"  — offline, pyttsx3 (install: pip install pyttsx3)
"""

import os
import base64
import json
import time
import struct
import wave
import tempfile
import requests
import pyaudio
import pygame
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────
CONFIG_FILE = Path(__file__).parent / 'config.json'


def load_config():
    if not CONFIG_FILE.exists():
        print("ERROR: config.json not found. Copy config.example.json → config.json.")
        exit(1)
    with open(CONFIG_FILE) as f:
        return json.load(f)


# ── Audio constants ───────────────────────────────────────────────────────
SAMPLE_RATE     = 16000
CHANNELS        = 1
OWW_CHUNK       = 1280   # 80 ms at 16 kHz — openWakeWord default frame size
RECORD_CHUNK    = 1024
SILENCE_THRESH  = 600    # raise if mic is too noisy
SILENCE_SECS    = 1.8
MAX_RECORD_SECS = 30


# ── Wake word ─────────────────────────────────────────────────────────────
def init_wake_word(config):
    """Returns (engine, model, wake_word_label)."""
    engine  = config.get('wake_word_engine', 'openwakeword')
    ww_name = config.get('wake_word', 'hey_mycroft')

    if engine in ('openwakeword', 'auto'):
        try:
            from openwakeword.model import Model
            oww = Model(wakeword_models=[ww_name], inference_framework='tflite')
            print(f"Wake word '{ww_name}' active  [openWakeWord]")
            return ('oww', oww, ww_name)
        except Exception as e:
            print(f"openWakeWord unavailable ({e}) — trying pvporcupine...")

    if engine in ('pvporcupine', 'auto', 'openwakeword'):
        pkey = config.get('porcupine_key', '')
        if pkey:
            try:
                import pvporcupine
                porcupine = pvporcupine.create(access_key=pkey, keywords=[ww_name])
                print(f"Wake word '{ww_name}' active  [pvporcupine]")
                return ('porcupine', porcupine, ww_name)
            except Exception as e:
                print(f"pvporcupine unavailable ({e}) — falling back to ENTER key")

    print("No wake word engine available — press ENTER to speak.")
    return ('enter', None, ww_name)


# ── Recording ─────────────────────────────────────────────────────────────
def record_until_silence(audio_instance):
    stream = audio_instance.open(
        format=pyaudio.paInt16,
        channels=CHANNELS,
        rate=SAMPLE_RATE,
        input=True,
        frames_per_buffer=RECORD_CHUNK,
    )
    frames        = []
    silent_chunks = 0
    max_silent    = int(SILENCE_SECS * SAMPLE_RATE / RECORD_CHUNK)
    max_chunks    = int(MAX_RECORD_SECS * SAMPLE_RATE / RECORD_CHUNK)

    print("  Listening...  (speak now)")
    while len(frames) < max_chunks:
        data   = stream.read(RECORD_CHUNK, exception_on_overflow=False)
        frames.append(data)
        energy = sum(abs(s) for s in struct.unpack(f'{RECORD_CHUNK}h', data)) / RECORD_CHUNK
        if energy < SILENCE_THRESH:
            silent_chunks += 1
            if silent_chunks >= max_silent and len(frames) > 8:
                break
        else:
            silent_chunks = 0

    stream.stop_stream()
    stream.close()
    return frames


def frames_to_wav(frames):
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    with wave.open(tmp.name, 'wb') as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(b''.join(frames))
    return tmp.name


# ── STT ───────────────────────────────────────────────────────────────────
def transcribe(wav_path, config):
    """Send WAV to Based /api/transcribe (Groq Whisper). Returns transcript."""
    with open(wav_path, 'rb') as f:
        r = requests.post(
            f"{config['based_url']}/api/transcribe",
            headers={'Authorization': f"Bearer {config['auth_token']}"},
            files={'audio': ('recording.wav', f, 'audio/wav')},
            data={'locale': 'en'},
            timeout=30,
        )
    if not r.ok:
        print(f"  STT error: {r.status_code}  {r.text[:120]}")
        return ''
    return r.json().get('text', '').strip()


# ── LLM: Based cloud ──────────────────────────────────────────────────────
def generate_based(text, history, config):
    """Stream /api/companion, return full reply text."""
    messages = history + [{'role': 'user', 'content': text}]
    r = requests.post(
        f"{config['based_url']}/api/companion",
        headers={
            'Authorization': f"Bearer {config['auth_token']}",
            'Content-Type': 'application/json',
        },
        json={'messages': messages, 'memory': config.get('memory', '')},
        stream=True,
        timeout=60,
    )
    if not r.ok:
        print(f"  Based error: {r.status_code}  {r.text[:120]}")
        return ''

    reply = ''
    for line in r.iter_lines():
        if not line or not line.startswith(b'data: '):
            continue
        raw = line[6:]
        if raw == b'[DONE]':
            break
        try:
            d = json.loads(raw)
            if 'text' in d:
                reply += d['text']
            if 'error' in d:
                print(f"  Stream error: {d['error']}")
                return ''
        except Exception:
            pass
    return reply.strip()


# ── LLM: Ollama local ─────────────────────────────────────────────────────
BASED_SYSTEM = (
    "You are Based — a sharp, direct AI voice companion running locally on a device. "
    "Keep every response under 2 sentences unless the user explicitly asks for more detail. "
    "No bullet points, no markdown — plain conversational speech only."
)


def generate_ollama(text, history, config):
    """Call local Ollama (OpenAI-compatible endpoint), return full reply text."""
    ollama_url = config.get('ollama_url', 'http://localhost:11434')
    model      = config.get('ollama_model', 'llama3.2:3b')

    messages = [{'role': 'system', 'content': BASED_SYSTEM}]
    for m in history:
        messages.append({'role': m['role'], 'content': m['content']})
    messages.append({'role': 'user', 'content': text})

    try:
        r = requests.post(
            f"{ollama_url}/v1/chat/completions",
            headers={'Content-Type': 'application/json'},
            json={'model': model, 'messages': messages, 'stream': True},
            stream=True,
            timeout=60,
        )
        if not r.ok:
            print(f"  Ollama error: {r.status_code}  {r.text[:120]}")
            return ''

        reply = ''
        for line in r.iter_lines():
            if not line or not line.startswith(b'data: '):
                continue
            raw = line[6:]
            if raw == b'[DONE]':
                break
            try:
                d     = json.loads(raw)
                delta = d.get('choices', [{}])[0].get('delta', {})
                if delta.get('content'):
                    reply += delta['content']
            except Exception:
                pass
        return reply.strip()

    except requests.exceptions.ConnectionError:
        print("  Ollama not running — is it installed? Run: ollama serve")
        return "My local brain is offline. Make sure Ollama is running."


# ── TTS ───────────────────────────────────────────────────────────────────
def speak_based(text, config):
    """Call Based /api/tts, decode base64 audio, play through speakers."""
    gender = config.get('gender', 'male')
    r = requests.post(
        f"{config['based_url']}/api/tts",
        headers={
            'Authorization': f"Bearer {config['auth_token']}",
            'Content-Type': 'application/json',
        },
        json={'text': text, 'gender': gender},
        timeout=30,
    )
    if not r.ok:
        print(f"  TTS error {r.status_code}: {r.text[:100]}")
        return

    data        = r.json()
    audio_bytes = base64.b64decode(data['audioBase64'])
    mime        = data.get('mime', 'audio/wav')
    ext         = '.wav' if 'wav' in mime else '.mp3'

    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tmp.write(audio_bytes)
    tmp.close()

    try:
        pygame.mixer.music.load(tmp.name)
        pygame.mixer.music.play()
        while pygame.mixer.music.get_busy():
            time.sleep(0.05)
    finally:
        os.unlink(tmp.name)


def speak_local(text):
    """Offline TTS via pyttsx3. Install: pip install pyttsx3"""
    try:
        import pyttsx3
        engine = pyttsx3.init()
        engine.setProperty('rate', 165)
        engine.say(text)
        engine.runAndWait()
    except ImportError:
        print(f"  [Based]: {text}")
    except Exception as e:
        print(f"  pyttsx3 error ({e}) — text: {text}")


def speak(text, config):
    tts_backend = config.get('tts_backend', 'based')
    if tts_backend == 'local':
        speak_local(text)
    else:
        speak_based(text, config)


# ── Handle a single voice turn ────────────────────────────────────────────
def _handle_turn(audio, history, config):
    frames   = record_until_silence(audio)
    wav_path = frames_to_wav(frames)

    print("  Transcribing...")
    text = transcribe(wav_path, config)
    os.unlink(wav_path)

    if not text:
        print("  (nothing heard — try again)")
        return

    print(f"  You:   {text}")
    print("  Thinking...")

    backend = config.get('llm_backend', 'based')
    reply   = generate_ollama(text, history, config) if backend == 'ollama' \
              else generate_based(text, history, config)

    if not reply:
        print("  (no reply received)")
        return

    print(f"  Based: {reply}\n")

    history.append({'role': 'user',      'content': text})
    history.append({'role': 'assistant', 'content': reply})
    del history[:-10]

    speak(reply, config)


# ── Main loop ─────────────────────────────────────────────────────────────
def main():
    config = load_config()
    audio  = pyaudio.PyAudio()
    pygame.mixer.init()

    engine, model, ww_label = init_wake_word(config)
    history = []

    llm = config.get('llm_backend', 'based')
    tts = config.get('tts_backend', 'based')
    print(f"  LLM: {llm}  |  TTS: {tts}")

    if engine == 'oww':
        import numpy as np
        threshold  = float(config.get('wake_word_threshold', 0.5))
        det_stream = audio.open(
            rate=SAMPLE_RATE, channels=1, format=pyaudio.paInt16,
            input=True, frames_per_buffer=OWW_CHUNK,
        )
        print(f"\nBased is live.  Say '{ww_label}' to activate.  Ctrl+C to quit.\n")
        try:
            while True:
                pcm         = det_stream.read(OWW_CHUNK, exception_on_overflow=False)
                audio_np    = np.frombuffer(pcm, dtype=np.int16)
                predictions = model.predict(audio_np)
                score = max(predictions.values()) if predictions else 0.0
                if score >= threshold:
                    model.reset()
                    det_stream.stop_stream()
                    print(f"\n[Wake word detected — score {score:.2f}]")
                    _handle_turn(audio, history, config)
                    det_stream.start_stream()
        except KeyboardInterrupt:
            print("\nStopped.")
        finally:
            det_stream.close()

    elif engine == 'porcupine':
        det_stream = audio.open(
            rate=model.sample_rate, channels=1, format=pyaudio.paInt16,
            input=True, frames_per_buffer=model.frame_length,
        )
        print(f"\nBased is live.  Say '{ww_label}' to activate.  Ctrl+C to quit.\n")
        try:
            while True:
                pcm = det_stream.read(model.frame_length, exception_on_overflow=False)
                pcm = struct.unpack_from(f'{model.frame_length}h', pcm)
                if model.process(pcm) >= 0:
                    det_stream.stop_stream()
                    print("\n[Wake word detected]")
                    _handle_turn(audio, history, config)
                    det_stream.start_stream()
        except KeyboardInterrupt:
            print("\nStopped.")
        finally:
            det_stream.close()
            model.delete()

    else:
        print("\nBased is live.  Press ENTER to speak.  Ctrl+C to quit.\n")
        try:
            while True:
                input()
                _handle_turn(audio, history, config)
        except KeyboardInterrupt:
            print("\nStopped.")

    audio.terminate()


if __name__ == '__main__':
    main()
