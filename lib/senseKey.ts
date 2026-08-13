/**
 * Identity for a CEDICT sense: pinyin alone can collide (CEDICT sometimes
 * lists distinct senses under the same reading — 打 dǎ covers "to hit", "to
 * make", "dozen", ... as separate entries), so the meaning is part of the
 * key. `vocabulary_mastery` is keyed by (hanzi, pinyin, meaning) for the
 * same reason — use this anywhere a hanzi's multiple saved senses need to
 * be told apart (popup, word page, search results).
 */
export function senseKey(s: { pinyin: string; meaning: string }): string {
  return s.pinyin + String.fromCharCode(1) + s.meaning;
}
