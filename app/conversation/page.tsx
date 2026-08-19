import { createClient } from "@/lib/supabase/server";
import { ConversationClient } from "./ConversationClient";
import type { VocabularyMastery, MasteryMap } from "@/lib/types";

export default async function ConversationPage() {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";

  const { data } = await supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId);

  // Group by hanzi — a hanzi can have multiple saved senses.
  const masteryMap: MasteryMap = {};
  for (const word of (data ?? []) as VocabularyMastery[]) {
    (masteryMap[word.hanzi] ??= []).push(word);
  }

  return (
    // Body already reserves space for the fixed AppHeader (see globals.css)
    // — size against what's left instead of the full viewport, so this
    // chat's own h-full toolbar/transcript/input layout still fits exactly.
    <main className="overflow-hidden" style={{ height: "calc(100dvh - 56px - env(safe-area-inset-top))" }}>
      <ConversationClient masteryMap={masteryMap} />
    </main>
  );
}
