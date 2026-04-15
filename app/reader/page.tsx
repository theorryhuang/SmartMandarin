import { createClient } from "@/lib/supabase/server";
import { ReaderClient } from "./ReaderClient";
import { BackButton } from "@/app/_components/BackButton";
import type { VocabularyMastery } from "@/lib/types";

export default async function ReaderPage() {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";

  // Fetch the user's full mastery map for highlighting
  const { data } = await supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId);

  const masteryMap: Record<string, VocabularyMastery> = {};
  for (const word of (data ?? []) as VocabularyMastery[]) {
    masteryMap[word.hanzi] = word;
  }

  // Compute average HSK level for story calibration
  const words = Object.values(masteryMap);
  const avgHSK =
    words.length > 0
      ? words.reduce((sum, w) => sum + w.hsk_level, 0) / words.length
      : 3.0;

  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <BackButton href="/" />
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)] mt-4">
            Interactive Reader
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Tap any word to see its definition and save it for review.
          </p>
        </div>
        <ReaderClient masteryMap={masteryMap} hskLevel={avgHSK} />
      </div>
    </main>
  );
}
