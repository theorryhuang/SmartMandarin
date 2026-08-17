"use client";

import { useCallback, useRef } from "react";

/**
 * Imperative controller for replaying a single transcript turn via the
 * browser's SpeechSynthesis TTS. No state of its own (playing/paused index
 * lives in the caller, e.g. SpeakingClient's `playingTurnIndex`/`isSpeechPaused`).
 *
 * Default path is plain native pause()/resume() — exact position, no gap,
 * no restart. SpeechSynthesis has no live-rate API though: an utterance's
 * `.rate` is fixed the moment `.speak()` is called, so a rate change can
 * only take effect by starting a new utterance. That only happens when the
 * rate you're resuming at actually differs from what was playing — resume()
 * compares against the rate the current utterance started at and only
 * restarts in that case, restarting just the current *sentence* (turns are
 * split on 。！？ into chunks spoken back-to-back via onend), not the whole
 * turn. Unconditionally restarting on every resume was the previous bug
 * here — this was supposed to be conditional on a rate change and wasn't.
 */
export function useTurnPlayback() {
  const chunksRef = useRef<string[]>([]);
  const chunkIndexRef = useRef(0);
  // Rate the currently-speaking/paused utterance actually started at —
  // compared against resume()'s `rate` argument to decide restart vs. plain resume.
  const currentRateRef = useRef(1);
  // Identity token for "is this utterance still the one anyone cares about."
  // cancel() fires an "error" event (not "end") on whatever utterance was
  // mid-flight, per spec — without this check, a deliberate stop/restart's
  // cancel() would fire that utterance's onerror and be mistaken for the
  // turn actually finishing.
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const splitIntoSentences = (text: string): string[] =>
    text
      .split(/(?<=[。！？.!?])\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

  const speakChunk = useCallback((rate: number, onDone: () => void) => {
    if (chunkIndexRef.current >= chunksRef.current.length) {
      currentUtteranceRef.current = null;
      onDone();
      return;
    }

    const hanziOnly = chunksRef.current[chunkIndexRef.current].replace(/\s*\([^)]+\)/g, "");
    const utterance = new SpeechSynthesisUtterance(hanziOnly);
    utterance.lang = "zh-CN";
    utterance.rate = 0.9 * rate;
    currentRateRef.current = rate;
    utterance.onend = () => {
      if (currentUtteranceRef.current !== utterance) return; // superseded — a stop/restart already took over
      chunkIndexRef.current += 1;
      speakChunk(rate, onDone);
    };
    utterance.onerror = () => {
      if (currentUtteranceRef.current !== utterance) return; // an intentional interruption, not a real failure
      currentUtteranceRef.current = null;
      onDone();
    };

    const voices = window.speechSynthesis.getVoices();
    const chineseVoice = voices.find((v) => v.lang.startsWith("zh"));
    if (chineseVoice) utterance.voice = chineseVoice;

    currentUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

  const startChunksFrom = useCallback((rate: number, onDone: () => void) => {
    // getVoices() is async on first call — wait for onvoiceschanged if list is empty.
    if (window.speechSynthesis.getVoices().length > 0) {
      speakChunk(rate, onDone);
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        speakChunk(rate, onDone);
      };
      setTimeout(() => { if (!currentUtteranceRef.current) speakChunk(rate, onDone); }, 500);
    }
  }, [speakChunk]);

  /** Starts a turn's text from the beginning. */
  const play = useCallback((text: string, rate: number, onEnd: () => void) => {
    window.speechSynthesis?.cancel();
    currentUtteranceRef.current = null;
    chunksRef.current = splitIntoSentences(text);
    chunkIndexRef.current = 0;
    startChunksFrom(rate, onEnd);
  }, [startChunksFrom]);

  const pause = useCallback(() => {
    window.speechSynthesis?.pause();
  }, []);

  /** Plain resume if `rate` matches what's currently playing (exact
   *  position, no gap). Only restarts — from the current sentence, not the
   *  whole turn — when `rate` is actually different. */
  const resume = useCallback((rate: number, onEnd: () => void) => {
    if (rate === currentRateRef.current) {
      window.speechSynthesis?.resume();
      return;
    }
    currentUtteranceRef.current = null;
    window.speechSynthesis?.cancel();
    startChunksFrom(rate, onEnd);
  }, [startChunksFrom]);

  const stop = useCallback(() => {
    currentUtteranceRef.current = null;
    window.speechSynthesis?.cancel();
  }, []);

  return { play, pause, resume, stop };
}
