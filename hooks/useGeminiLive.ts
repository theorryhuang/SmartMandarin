"use client";

/**
 * useGeminiLive
 *
 * Manages a Gemini Multimodal Live session over WebSocket (the JS SDK wraps
 * the raw WebSocket under the hood).  We use @google/genai which exposes
 * the Live client.
 *
 * State machine:
 *   idle → connecting → connected → (user speaks ↔ ai speaks) → disconnected
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptToken } from "@/lib/types";

export type ConnectionState = "idle" | "connecting" | "connected" | "error";

export interface GeminiLiveOptions {
  slangMode: boolean;
  forcedWords: string[];
  onTranscriptUpdate: (tokens: TranscriptToken[], role: "user" | "assistant") => void;
  onAITurnEnd: () => void;
}

export interface GeminiLiveHandle {
  connectionState: ConnectionState;
  isMuted: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
}

export function useGeminiLive(opts: GeminiLiveOptions): GeminiLiveHandle {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [isMuted, setIsMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
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
    setConnectionState("idle");
  }, []);

  const connect = useCallback(async () => {
    setConnectionState("connecting");

    try {
      // 1. Fetch session config from our server (keeps API key off client)
      const tokenRes = await fetch("/api/gemini-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slang_mode: optsRef.current.slangMode,
          forced_words: optsRef.current.forcedWords,
        }),
      });
      const { api_key, model, system_instruction } = await tokenRes.json();

      // 2. Open WebSocket to Gemini Live
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${api_key}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        // Send session setup message
        ws.send(
          JSON.stringify({
            setup: {
              model,
              generation_config: {
                response_modalities: ["AUDIO", "TEXT"],
                speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } } },
              },
              system_instruction: { parts: [{ text: system_instruction }] },
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
          if (ws.readyState !== WebSocket.OPEN || optsRef.current.slangMode === undefined) return;
          if (isMuted) return;

          const pcm = e.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(pcm.length);
          for (let i = 0; i < pcm.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, pcm[i] * 32768));
          }
          const base64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));

          ws.send(
            JSON.stringify({
              realtime_input: {
                media_chunks: [{ data: base64, mime_type: "audio/pcm;rate=16000" }],
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

      ws.onerror = () => setConnectionState("error");
      ws.onclose = () => setConnectionState("idle");
    } catch (err) {
      console.error("Gemini Live connect error:", err);
      setConnectionState("error");
    }
  }, [isMuted]);

  function handleServerMessage(msg: Record<string, unknown>) {
    // Text transcript from the model
    const candidates = (msg as any)?.serverContent?.modelTurn?.parts;
    if (candidates) {
      const text: string = candidates
        .filter((p: any) => p.text)
        .map((p: any) => p.text as string)
        .join("");

      if (text) {
        const tokens = tokenizeTranscript(text);
        optsRef.current.onTranscriptUpdate(tokens, "assistant");
      }
    }

    // Turn complete signal
    if ((msg as any)?.serverContent?.turnComplete) {
      optsRef.current.onAITurnEnd();
    }

    // User speech transcript (when available from Live API)
    const inputTranscript = (msg as any)?.serverContent?.inputTranscript;
    if (inputTranscript) {
      const tokens = tokenizeTranscript(inputTranscript);
      optsRef.current.onTranscriptUpdate(tokens, "user");
    }
  }

  useEffect(() => () => disconnect(), [disconnect]);

  return {
    connectionState,
    isMuted,
    connect,
    disconnect,
    toggleMute: () => setIsMuted((m) => !m),
  };
}

/**
 * Splits a Mandarin text string into individual character/word tokens.
 * Strips pinyin parentheticals into a separate field.
 *
 * Input:  "你好 (nǐ hǎo)！今天天气怎么样 (jīntiān tiānqì zěnme yàng)？"
 * Output: [{hanzi:"你好", pinyin:"nǐ hǎo"}, {hanzi:"今天天气怎么样", pinyin:"..."}]
 */
export function tokenizeTranscript(text: string): TranscriptToken[] {
  const tokens: TranscriptToken[] = [];

  // Split on Chinese word boundaries + pinyin annotations
  // Pattern: one or more Chinese chars optionally followed by (pinyin)
  const re = /([^\s，。！？、…（）()\n]+)(?:\s*\(([^)]+)\))?/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const hanzi = match[1].trim();
    const pinyin = match[2]?.trim();
    if (hanzi) {
      tokens.push({ hanzi, pinyin, flagged: false });
    }
  }

  return tokens.length > 0 ? tokens : [{ hanzi: text, flagged: false }];
}
