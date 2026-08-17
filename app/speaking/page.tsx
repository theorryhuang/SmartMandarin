import { createClient } from "@/lib/supabase/server";
import type { VocabularyMastery, MasteryMap } from "@/lib/types";
import { SpeakingClientLoader } from "./SpeakingClientLoader";

export default async function SpeakingPage() {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";

  const { data } = await supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId);

  // Group by hanzi — a hanzi can have multiple saved senses. Same shape
  // ConversationClient's page.tsx builds — needed by the shared word popup
  // (useWordPopup/TappableText) for the mastery-level highlight.
  const masteryMap: MasteryMap = {};
  for (const word of (data ?? []) as VocabularyMastery[]) {
    (masteryMap[word.hanzi] ??= []).push(word);
  }

  return (
    <main className="h-screen overflow-hidden">
      <SpeakingClientLoader masteryMap={masteryMap} />
    </main>
  );
}
