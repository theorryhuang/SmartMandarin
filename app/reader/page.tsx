import { createClient } from "@/lib/supabase/server";
import { ReaderClient } from "./ReaderClient";
import type { VocabularyMastery, MasteryMap } from "@/lib/types";

export default async function ReaderPage() {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";

  // Fetch the user's full mastery map for highlighting
  const { data } = await supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId);

  // Group by hanzi — a hanzi can have multiple saved senses.
  const masteryMap: MasteryMap = {};
  for (const word of (data ?? []) as VocabularyMastery[]) {
    (masteryMap[word.hanzi] ??= []).push(word);
  }

  // Compute average HSK level for story calibration
  const words = Object.values(masteryMap).flat();
  const avgHSK =
    words.length > 0
      ? words.reduce((sum, w) => sum + (w.hsk_level ?? 3), 0) / words.length
      : 3.0;

  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-8">
        <ReaderClient masteryMap={masteryMap} hskLevel={avgHSK} />
      </div>
    </main>
  );
}
