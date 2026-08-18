"use client";

import { useCallback, useEffect, useRef } from "react";

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
  // True only during the async gap between play() being called and speak()
  // actually firing (see startChunksFrom) — voices load asynchronously in
  // Chrome, so the very first play() of a page session can't call speak()
  // synchronously and has to wait on `onvoiceschanged` or a fallback
  // timeout. The caller's UI flips to "playing" the instant play() is
  // called, though (that's synchronous), so a pause() landing in this gap
  // used to hit an idle queue — a no-op — and then the deferred speak()
  // fired anyway once voices loaded, ignoring the pause entirely. This flag
  // makes that deferred speak() check whether a pause happened first.
  const pausedBeforeStartRef = useRef(false);

  // Voices load asynchronously on first use in Chrome — priming the list on
  // mount means that gap has almost always already closed by the time a
  // user actually finishes their first turn and hits play, so the
  // synchronous path below is what actually runs in practice.
  useEffect(() => {
    window.speechSynthesis?.getVoices();
  }, []);

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

    // A pause() landed while this call was still deferred waiting on voices
    // (see startChunksFrom/pause) — don't start speaking out from under a
    // pause the user already asked for. Stays silent until resume() calls
    // startChunksFrom again.
    if (pausedBeforeStartRef.current) return;

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
    pausedBeforeStartRef.current = false;
    chunksRef.current = splitIntoSentences(text);
    chunkIndexRef.current = 0;
    startChunksFrom(rate, onEnd);
  }, [startChunksFrom]);

  const pause = useCallback(() => {
    if (!currentUtteranceRef.current) {
      // Nothing has actually started speaking yet — still waiting on
      // voices to load (see startChunksFrom). speechSynthesis.pause() on an
      // idle queue is a no-op, and without this flag the deferred speak()
      // would fire right past this pause once voices came in, making the
      // click look like it did nothing (or, worse, look like a restart once
      // the user gives up and clicks again).
      pausedBeforeStartRef.current = true;
      return;
    }
    window.speechSynthesis?.pause();
  }, []);

  /** Plain resume if `rate` matches what's currently playing (exact
   *  position, no gap). Only restarts — from the current sentence, not the
   *  whole turn — when `rate` is actually different. */
  const resume = useCallback((rate: number, onEnd: () => void) => {
    if (pausedBeforeStartRef.current) {
      // Paused before anything was ever audible — chunkIndexRef is still 0,
      // so this "restarts" in name only; nothing was heard before it to
      // restart from.
      pausedBeforeStartRef.current = false;
      startChunksFrom(rate, onEnd);
      return;
    }
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
    pausedBeforeStartRef.current = false;
    window.speechSynthesis?.cancel();
  }, []);

  return { play, pause, resume, stop };
}
