import { cedictLookupAll, hskLookup } from "@/lib/cedict";
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
  const { id, pinyin: selectedPinyin } = await searchParams;
  const hanzi = decodeURIComponent(rawHanzi);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let savedWord: VocabularyMastery | null = null;
  if (user) {
    const query = supabase
      .from("vocabulary_mastery")
      .select("*")
      .eq("user_id", user.id);
    const { data } = id
      ? await query.eq("id", id).maybeSingle()
      : await query.eq("hanzi", hanzi).maybeSingle();
    savedWord = (data as VocabularyMastery | null) ?? null;
  }

  const [entries, hsk_level] = await Promise.all([
    cedictLookupAll(hanzi),
    hskLookup(hanzi),
  ]);

  return (
    <WordDetailClient
      hanzi={hanzi}
      entries={entries}
      hskLevel={hsk_level}
      savedWord={savedWord}
      selectedPinyin={selectedPinyin ?? null}
    />
  );
}
