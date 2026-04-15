"use client";

/**
 * useGroqConversation
 *
 * Turn-based voice conversation using:
 *   - MediaRecorder (browser) → captures user audio
 *   - Groq Whisper (/api/transcribe) → speech-to-text
 *   - Groq LLaMA (/api/converse) → Mandarin response
 *   - SpeechSynthesis (browser) → text-to-speech playback
 *
 * State machine:
 *   idle → recording (user holds mic) → transcribing → thinking → speaking → idle
 */

import { useCallback, useRef, useState } from "react";
import { tokenizeTranscript } from "./useGeminiLive";
import type { TranscriptToken } from "@/lib/types";

export type ConvState = "idle" | "recording" | "transcribing" | "thinking" | "speaking" | "error";

export interface GroqConvOptions {
  slangMode: boolean;
  forcedWords: string[];
  hskLevel: number;
  unknownWords: { hanzi: string; pinyin: string; meaning: string }[];
  onTranscriptUpdate: (tokens: TranscriptToken[], role: "user" | "assistant") => void;
  onAITurnEnd: () => void;
}

export interface GroqConvHandle {
  state: ConvState;
  error: string | null;
  startRecording: () => void;
  stopRecording: () => void;
  cancel: () => void;
}

type HistoryEntry = { role: "user" | "assistant"; content: string };

export function useGroqConversation(opts: GroqConvOptions): GroqConvHandle {
  const [state, setState] = useState<ConvState>("idle");
  const [error, setError] = useState<string | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const historyRef = useRef<HistoryEntry[]>([]);
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setState("recording");
    } catch (err) {
      setError("Microphone access denied");
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
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];

      // ── Step 1: Transcribe ────────────────────────────────────────────────
      setState("transcribing");
      const form = new FormData();
      form.append("audio", blob, "audio.webm");
      const transcribeRes = await fetch("/api/transcribe", { method: "POST", body: form });
      const transcribeData = await transcribeRes.json();
      if (transcribeData.error || !transcribeData.text?.trim()) {
        setError(transcribeData.error ?? "Could not transcribe speech");
        setState("error");
        return;
      }
      const userText: string = transcribeData.text.trim();
      const userTokens = tokenizeTranscript(userText);
      optsRef.current.onTranscriptUpdate(userTokens, "user");

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
      });
    };

    recorder.stop();
  }, []);

  return { state, error, startRecording, stopRecording, cancel };
}

/** Speak text using the browser SpeechSynthesis API with a Chinese voice if available. */
function speakText(text: string, onEnd: () => void) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    onEnd();
    return;
  }

  // Strip pinyin annotations before speaking
  const hanziOnly = text.replace(/\s*\([^)]+\)/g, "");

  const utterance = new SpeechSynthesisUtterance(hanziOnly);
  utterance.lang = "zh-CN";
  utterance.rate = 0.9;
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

function getSupportedMimeType(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const type of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "audio/webm";
}
