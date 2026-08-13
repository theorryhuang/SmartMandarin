import { createClient } from "@/lib/supabase/server";
import { ReaderClient } from "./ReaderClient";
import { BackButton } from "@/app/_components/BackButton";
import { HomeButton } from "@/app/_components/HomeButton";
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
      <div className="max-w-2xl mx-auto relative px-4 pt-[max(32px,env(safe-area-inset-top))] pb-8">
        <div className="absolute left-6" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
          <BackButton href="/" />
        </div>
        <div className="absolute right-6" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
          <HomeButton />
        </div>
        <div className="pt-10">
          <ReaderClient masteryMap={masteryMap} hskLevel={avgHSK} />
        </div>
      </div>
    </main>
  );
}
