"use client";

/**
 * useGeminiLive
 *
 * Full-duplex voice conversation over the Gemini Live API (raw WebSocket —
 * BidiGenerateContent). Model is "Native Audio Dialog"-class: one streaming
 * session does STT + reasoning + TTS together, replacing the separate
 * record → ElevenLabs transcribe → Gemini text → browser TTS turn-based
 * pipeline used elsewhere (useVoiceConversation.ts) with real low-latency,
 * interruptible conversation.
 *
 * Wire format (per ai.google.dev/gemini-api/docs/live-guide, verified
 * 2026-08): camelCase field names, singular `realtimeInput.audio` (not the
 * old `realtime_input.media_chunks` array), and text only comes through if
 * you explicitly turn on `inputAudioTranscription`/`outputAudioTranscription`
 * in the setup message — response_modalities can only be one of AUDIO or
 * TEXT, not both, so audio-with-live-captions requires those transcription
 * configs rather than requesting a second modality.
 *
 * State machine:
 *   idle → connecting → connected → (user speaks ↔ ai speaks) → disconnected
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionState = "idle" | "connecting" | "connected" | "error";

export interface GeminiLiveOptions {
  slangMode: boolean;
  forcedWords: string[];
  /** Derived HSK level of the user — shapes vocab difficulty in system prompt */
  hskLevel: number;
  /** Words flagged in past sessions — persistent unknown word bank */
  unknownWords: { hanzi: string; pinyin: string; meaning: string }[];
  /**
   * Fires on every transcript update, both at a turn's start and again for
   * every streamed chunk within it. `text` is always the FULL utterance so
   * far for `turnId`, not just the new fragment — callers can key a message
   * bubble by `turnId` and just overwrite its content each call rather than
   * tracking partials themselves. Input (user speech) transcription arrives
   * as a single complete message per the API, so it only fires once per
   * user turn; output (model speech) streams word-by-word.
   */
  onTranscriptUpdate: (text: string, role: "user" | "assistant", turnId: string) => void;
  onAITurnEnd: () => void;
}

export interface GeminiLiveHandle {
  connectionState: ConnectionState;
  error: string | null;
  isMuted: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
}

export function useGeminiLive(opts: GeminiLiveOptions): GeminiLiveHandle {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const isMutedRef = useRef(false);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  // Tracks the AudioBufferSourceNode currently coming out of the speaker, so
  // a barge-in (serverContent.interrupted) can stop it immediately instead
  // of just draining the queue and letting whatever's already playing finish.
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const assistantTextRef = useRef("");
  const assistantTurnIdRef = useRef(`assistant_${Date.now()}`);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const disconnect = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    activeSourceRef.current = null;
    setConnectionState("idle");
  }, []);

  const connect = useCallback(async () => {
    setConnectionState("connecting");
    setError(null);
    assistantTextRef.current = "";
    assistantTurnIdRef.current = `assistant_${Date.now()}`;

    try {
      // 1. Fetch session config from our server (keeps API key off client
      //    except for the WebRTC/WS handshake itself, which Gemini Live
      //    requires client-side — see resolveGeminiKey()'s doc comment for
      //    why that's a per-user BYOK key rather than a shared one).
      const tokenRes = await fetch("/api/gemini-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slang_mode: optsRef.current.slangMode,
          forced_words: optsRef.current.forcedWords,
          hsk_level: optsRef.current.hskLevel,
          unknown_words: optsRef.current.unknownWords,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) {
        setError(tokenData.error ?? "Couldn't start a voice session");
        setConnectionState("error");
        return;
      }
      const { api_key, model, system_instruction } = tokenData;

      // 2. Open WebSocket to Gemini Live
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${api_key}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        // Send session setup message. responseModalities is AUDIO-only —
        // the Live API accepts exactly one modality, so getting text
        // alongside speech goes through the transcription configs below,
        // not by also requesting TEXT here.
        ws.send(
          JSON.stringify({
            setup: {
              model,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
              },
              systemInstruction: system_instruction,
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          })
        );

        // 3. Capture microphone
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;

        const ctx = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (isMutedRef.current) return;

          const pcm = e.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(pcm.length);
          for (let i = 0; i < pcm.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, pcm[i] * 32768));
          }
          const base64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));

          ws.send(
            JSON.stringify({
              realtimeInput: {
                audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
              },
            })
          );
        };

        source.connect(processor);
        processor.connect(ctx.destination);
        setConnectionState("connected");
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      };

      ws.onerror = () => {
        setError("Voice connection error");
        setConnectionState("error");
      };
      ws.onclose = () => setConnectionState("idle");
    } catch (err) {
      console.error("Gemini Live connect error:", err);
      setError(err instanceof Error ? err.message : "Couldn't start a voice session");
      setConnectionState("error");
    }
  }, []);

  function playNextInQueue() {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    const ctx = audioContextRef.current;
    if (!ctx) return;

    isPlayingRef.current = true;
    const buffer = audioQueueRef.current.shift()!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    activeSourceRef.current = source;
    source.onended = () => {
      isPlayingRef.current = false;
      activeSourceRef.current = null;
      playNextInQueue();
    };
    source.start();
  }

  function handleAudioChunk(base64: string, mimeType: string) {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    // Parse sample rate from mime type, e.g. "audio/pcm;rate=24000"
    const rateMatch = mimeType.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;

    // Decode base64 → Int16Array → Float32Array → AudioBuffer
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32, 0);
    audioQueueRef.current.push(buffer);
    playNextInQueue();
  }

  function handleServerMessage(msg: Record<string, unknown>) {
    const serverContent = (msg as { serverContent?: Record<string, unknown> })?.serverContent;
    if (!serverContent) return;

    const modelTurn = serverContent.modelTurn as { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } | undefined;
    if (modelTurn?.parts) {
      for (const part of modelTurn.parts) {
        if (part.inlineData?.data && part.inlineData?.mimeType) {
          handleAudioChunk(part.inlineData.data, part.inlineData.mimeType);
        }
      }
    }

    // Model's speech, transcribed — streams in word-by-word. Always emit the
    // full accumulated text for the current turnId (see doc comment above).
    const outputText = (serverContent.outputTranscription as { text?: string } | undefined)?.text;
    if (outputText) {
      assistantTextRef.current += outputText;
      optsRef.current.onTranscriptUpdate(assistantTextRef.current, "assistant", assistantTurnIdRef.current);
    }

    // User's speech, transcribed — arrives as one complete message per turn.
    const inputText = (serverContent.inputTranscription as { text?: string } | undefined)?.text;
    if (inputText) {
      optsRef.current.onTranscriptUpdate(inputText, "user", `user_${Date.now()}`);
    }

    // Barge-in: user started talking over the model. Stop whatever's
    // playing right now, not just what's still queued — generation was
    // cancelled server-side too, so nothing more is coming for this turn.
    if (serverContent.interrupted) {
      activeSourceRef.current?.stop();
      activeSourceRef.current = null;
      audioQueueRef.current = [];
      isPlayingRef.current = false;
    }

    if (serverContent.turnComplete) {
      optsRef.current.onAITurnEnd();
      // Reset for the next assistant turn.
      assistantTextRef.current = "";
      assistantTurnIdRef.current = `assistant_${Date.now()}`;
    }
  }

  useEffect(() => () => disconnect(), [disconnect]);

  return {
    connectionState,
    error,
    isMuted,
    connect,
    disconnect,
    toggleMute: () => setIsMuted((m) => {
      isMutedRef.current = !m;
      return !m;
    }),
  };
}
