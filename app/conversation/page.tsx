import { createClient } from "@/lib/supabase/server";
import { ConversationClient } from "./ConversationClient";
import type { VocabularyMastery } from "@/lib/types";

export default async function ConversationPage() {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";

  const { data } = await supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId);

  const masteryMap: Record<string, VocabularyMastery> = {};
  for (const word of (data ?? []) as VocabularyMastery[]) {
    masteryMap[word.hanzi] = word;
  }

  return (
    <main className="h-screen overflow-hidden">
      <ConversationClient masteryMap={masteryMap} />
    </main>
  );
}
