import { cedictLookupAll, hskLookup } from "@/lib/cedict";
import { cedictDecompose } from "@/lib/defineWord";
import { createClient } from "@/lib/supabase/server";
import type { VocabularyMastery } from "@/lib/types";
import { WordDetailClient } from "./WordDetailClient";

export default async function WordDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ hanzi: string }>;
  searchParams: Promise<{ id?: string; pinyin?: string }>;
}) {
  const { hanzi: rawHanzi } = await params;
  // `id` used to pin one specific saved sense — no longer needed, every
  // saved sense for this hanzi is fetched and shown now. Still accepted in
  // the type so old `?id=` links (e.g. from /vocab) don't break.
  const { pinyin: selectedPinyin } = await searchParams;
  const hanzi = decodeURIComponent(rawHanzi);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // A hanzi can have multiple saved senses now (行 xíng vs háng, 打 dǎ's many
  // meanings, ...) — fetch every one so each can be added/removed independently.
  let savedWords: VocabularyMastery[] = [];
  if (user) {
    const { data } = await supabase
      .from("vocabulary_mastery")
      .select("*")
      .eq("user_id", user.id)
      .eq("hanzi", hanzi);
    savedWords = (data as VocabularyMastery[] | null) ?? [];
  }

  const [entries, hsk_level] = await Promise.all([
    cedictLookupAll(hanzi),
    hskLookup(hanzi),
  ]);

  // Not a CEDICT headword itself (e.g. a raw multi-char selection dragged
  // from the popup or the extension, like "哪个内蒙古自治") — instead of a
  // dead end, break it into its real constituent words the same way the
  // popup's own decomposition does, so there's still something useful here.
  let breakdown: { word: string; entries: { pinyin: string; meaning: string; hsk_level: number | null }[] }[] | null = null;
  if (entries.length === 0 && Array.from(hanzi).length > 1 && !savedWords.length) {
    const decomposed = await cedictDecompose(hanzi);
    if (decomposed.some((p) => p.entries.length > 0)) {
      breakdown = decomposed.map((p) => ({
        word: p.word,
        entries: p.entries.map((e) => ({ pinyin: e.pinyin, meaning: e.meaning, hsk_level: e.hsk_level })),
      }));
    }
  }

  return (
    <WordDetailClient
      hanzi={hanzi}
      entries={entries}
      hskLevel={hsk_level}
      savedWords={savedWords}
      selectedPinyin={selectedPinyin ?? null}
      breakdown={breakdown}
    />
  );
}
