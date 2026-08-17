import type { TranscriptToken } from "@/lib/types";

/**
 * Splits a Mandarin text string into individual character/word tokens.
 * Strips pinyin parentheticals into a separate field.
 *
 * Input:  "你好 (nǐ hǎo)！今天天气怎么样 (jīntiān tiānqì zěnme yàng)？"
 * Output: [{hanzi:"你好", pinyin:"nǐ hǎo"}, {hanzi:"今天天气怎么样", pinyin:"..."}]
 *
 * Was previously tucked inside hooks/useGeminiLive.ts (unrelated to that
 * hook's actual job) purely because useVoiceConversation.ts needed to borrow
 * it — pulled out so each file only exports what it's actually about.
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
