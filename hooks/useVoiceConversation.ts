"use client";

/**
 * useVoiceConversation
 *
 * Turn-based voice conversation using:
 *   - MediaRecorder (browser) → captures user audio
 *   - ElevenLabs Scribe (/api/transcribe) → speech-to-text
 *   - Gemini (/api/converse) → Mandarin response
 *   - SpeechSynthesis (browser) → text-to-speech playback
 *
 * State machine:
 *   idle → recording (user holds mic) → transcribing → thinking → speaking → idle
 */

import { useCallback, useRef, useState } from "react";
import { tokenizeTranscript } from "./useGeminiLive";
import type { TranscriptToken } from "@/lib/types";

export type ConvState = "idle" | "recording" | "transcribing" | "thinking" | "speaking" | "error";

export interface VoiceConvOptions {
  slangMode: boolean;
  forcedWords: string[];
  hskLevel: number;
  unknownWords: { hanzi: string; pinyin: string; meaning: string }[];
  onTranscriptUpdate: (tokens: TranscriptToken[], role: "user" | "assistant", audioUrl?: string) => void;
  onAITurnEnd: () => void;
  speechRate?: number; // multiplier: 1 = normal (0.9), 2 = fast (1.8)
}

export interface VoiceConvHandle {
  state: ConvState;
  error: string | null;
  startRecording: () => void;
  stopRecording: () => void;
  cancel: () => void;
  replay: (text: string, onEnd?: () => void) => void;
}

type HistoryEntry = { role: "user" | "assistant"; content: string };

export function useVoiceConversation(opts: VoiceConvOptions & { initialHistory?: HistoryEntry[] }): VoiceConvHandle {
  const [state, setState] = useState<ConvState>("idle");
  const [error, setError] = useState<string | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Seed with restored history so the AI has context when resuming a session
  const historyRef = useRef<HistoryEntry[]>(opts.initialHistory ?? []);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);

  const cancel = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    window.speechSynthesis?.cancel();
    setState("idle");
    setError(null);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      // Just use whatever the browser/OS considers the default input device.
      // This used to try to out-guess that with a label-sniffing heuristic
      // ("prefer a real mic over Teams/Zoom/etc. virtual devices"), but that
      // heuristic has caused more bugs than it prevented (a stale deviceId
      // triggering OverconstrainedError, and — likely — silently picking a
      // wrong/quiet input over the device the user actually meant to use).
      // If virtual-mic-as-default becomes a real problem again, that needs
      // an explicit device picker in the UI, not a silent guess.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          // Without AGC, quiet/low-gain input never gets boosted — records
          // technically-valid but near-silent audio that clears our local
          // duration check yet gives ElevenLabs nothing to transcribe,
          // coming back as an empty (not erroring) result.
          autoGainControl: true,
        },
      });
      const recorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(100); // 100ms timeslice — flush data continuously
      setState("recording");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      const message =
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Microphone access denied — check browser/site permissions"
          : name === "NotFoundError"
          ? "No microphone found"
          : name === "NotReadableError"
          ? "Microphone is in use by another app"
          : `Microphone error: ${name || (err instanceof Error ? err.message : String(err))}`;
      setError(message);
      setState("error");
    }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    recorder.onstop = async () => {
      // Stop mic tracks
      recorder.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current = null;

      const mimeType = getSupportedMimeType();
      const rawBlob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];

      // Only catch a genuinely empty capture here (permission/device glitch —
      // no ondataavailable events fired at all). Compressed byte size is NOT
      // a reliable proxy for duration: opus's VBR encoder shrinks quiet/low-
      // gain audio (mic runs with autoGainControl off) to a few hundred bytes
      // even for a multi-second hold, which used to trip a false "too short"
      // here before we ever measured real elapsed time below.
      if (rawBlob.size < 200) {
        setError("No audio captured — check your microphone");
        setState("error");
        return;
      }

      // Convert webm/opus → WAV so ElevenLabs can decode it reliably, and
      // read the actual decoded duration (ground truth, unlike byte size) to
      // bail before wasting a round trip to ElevenLabs, which rejects
      // anything it considers too short with an opaque "audio_too_short" error.
      let blob: Blob;
      let peakAmplitude: number | undefined;
      try {
        const wav = await toWav(rawBlob);
        if (wav.durationSec < 0.35) {
          setError("Recording too short — hold the button a bit longer");
          setState("error");
          return;
        }
        blob = wav.blob;
        peakAmplitude = wav.peakAmplitude;
        // eslint-disable-next-line no-console
        console.log(`[recording] duration=${wav.durationSec.toFixed(2)}s peak=${wav.peakAmplitude.toFixed(4)} (0=silence, 1=clipping)`);
      } catch (e) {
        console.warn("[recording] WAV conversion failed, sending raw:", e);
        blob = rawBlob;
      }

      // ── Step 1: Transcribe ────────────────────────────────────────────────
      setState("transcribing");
      const form = new FormData();
      form.append("audio", blob, "audio.webm");
      // Diagnostic only — lets the server log what was actually captured
      // alongside ElevenLabs' response, instead of guessing blind.
      if (peakAmplitude !== undefined) form.append("peak_amplitude", peakAmplitude.toFixed(4));
      let transcribeData: { text?: string; error?: string };
      try {
        const transcribeRes = await fetch("/api/transcribe", { method: "POST", body: form });
        transcribeData = await transcribeRes.json();
      } catch (e) {
        setError(`Transcription request failed: ${e instanceof Error ? e.message : String(e)}`);
        setState("error");
        return;
      }
      if (transcribeData.error || !transcribeData.text?.trim()) {
        const raw = transcribeData.error ?? "Could not hear any speech — try speaking louder or closer to the mic";
        setError(
          /audio_too_short/i.test(raw)
            ? "Recording too short — hold the button a bit longer"
            : raw
        );
        setState("error");
        return;
      }
      const userText: string = transcribeData.text.trim();
      const userTokens = tokenizeTranscript(userText);
      const audioUrl = URL.createObjectURL(blob);
      optsRef.current.onTranscriptUpdate(userTokens, "user", audioUrl);

      // ── Step 2: Get AI reply ──────────────────────────────────────────────
      setState("thinking");
      const converseRes = await fetch("/api/converse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userMessage: userText,
          history: historyRef.current,
          slang_mode: optsRef.current.slangMode,
          forced_words: optsRef.current.forcedWords,
          hsk_level: optsRef.current.hskLevel,
          unknown_words: optsRef.current.unknownWords,
        }),
      });
      const converseData = await converseRes.json();
      if (converseData.error) {
        setError(converseData.error);
        setState("error");
        return;
      }
      const reply: string = converseData.reply;
      const replyTokens = tokenizeTranscript(reply);
      optsRef.current.onTranscriptUpdate(replyTokens, "assistant");

      // Update history for context
      historyRef.current = [
        ...historyRef.current,
        { role: "user" as const, content: userText },
        { role: "assistant" as const, content: reply },
      ].slice(-20);

      // ── Step 3: Speak reply ───────────────────────────────────────────────
      setState("speaking");
      speakText(reply, () => {
        optsRef.current.onAITurnEnd();
        setState("idle");
      }, optsRef.current.speechRate ?? 1);
    };

    recorder.stop();
  }, []);

  const replay = useCallback((text: string, onEnd?: () => void) => {
    speakText(text, onEnd ?? (() => {}), optsRef.current.speechRate ?? 1);
  }, []);

  return { state, error, startRecording, stopRecording, cancel, replay };
}

/** Speak text using the browser SpeechSynthesis API with a Chinese voice if available. */
function speakText(text: string, onEnd: () => void, rateMultiplier = 1) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    onEnd();
    return;
  }

  // Strip pinyin annotations before speaking
  const hanziOnly = text.replace(/\s*\([^)]+\)/g, "");

  const utterance = new SpeechSynthesisUtterance(hanziOnly);
  utterance.lang = "zh-CN";
  utterance.rate = 0.9 * rateMultiplier;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;

  const doSpeak = () => {
    const voices = window.speechSynthesis.getVoices();
    // Pick any Chinese voice — don't exclude Google voices, they're the most common on Chrome
    const chineseVoice = voices.find((v) => v.lang.startsWith("zh"));
    if (chineseVoice) utterance.voice = chineseVoice;
    window.speechSynthesis.cancel(); // clear any queued utterances
    window.speechSynthesis.speak(utterance);
  };

  // getVoices() is async on first call — wait for onvoiceschanged if list is empty
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    doSpeak();
  } else {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = null;
      doSpeak();
    };
    // Fallback: if onvoiceschanged never fires, speak anyway after 500ms
    setTimeout(() => {
      if (!utterance.voice) doSpeak();
    }, 500);
  }
}

/** Decode any browser-recorded audio blob and re-encode as 16-bit PCM WAV. */
async function toWav(blob: Blob): Promise<{ blob: Blob; durationSec: number; peakAmplitude: number }> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  audioCtx.close();

  // Mix down to mono, resample to 16 kHz
  const sampleRate = 16000;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * sampleRate), sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();

  const pcm = rendered.getChannelData(0);
  const samples = new Int16Array(pcm.length);
  let peakAmplitude = 0;
  for (let i = 0; i < pcm.length; i++) {
    samples[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
    const abs = Math.abs(pcm[i]);
    if (abs > peakAmplitude) peakAmplitude = abs;
  }

  const wavBuffer = new ArrayBuffer(44 + samples.byteLength);
  const view = new DataView(wavBuffer);
  const write = (offset: number, val: number, bytes: number) => {
    for (let i = 0; i < bytes; i++) view.setUint8(offset + i, (val >> (8 * i)) & 0xff);
  };
  // RIFF header
  [0x52, 0x49, 0x46, 0x46].forEach((b, i) => view.setUint8(i, b)); // "RIFF"
  write(4, 36 + samples.byteLength, 4);
  [0x57, 0x41, 0x56, 0x45].forEach((b, i) => view.setUint8(8 + i, b)); // "WAVE"
  [0x66, 0x6d, 0x74, 0x20].forEach((b, i) => view.setUint8(12 + i, b)); // "fmt "
  write(16, 16, 4);       // subchunk size
  write(20, 1, 2);        // PCM
  write(22, 1, 2);        // mono
  write(24, sampleRate, 4);
  write(28, sampleRate * 2, 4); // byte rate
  write(32, 2, 2);        // block align
  write(34, 16, 2);       // bits per sample
  [0x64, 0x61, 0x74, 0x61].forEach((b, i) => view.setUint8(36 + i, b)); // "data"
  write(40, samples.byteLength, 4);
  new Int16Array(wavBuffer, 44).set(samples);

  return {
    blob: new Blob([wavBuffer], { type: "audio/wav" }),
    durationSec: audioBuffer.duration,
    peakAmplitude,
  };
}

function getSupportedMimeType(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const type of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "audio/webm";
}
