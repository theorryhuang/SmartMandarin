"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function resetMyData() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Only available in development");
  }

  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error("Not authenticated");

  // Delete review_log first (FK references vocabulary_mastery)
  await supabase.from("review_log").delete().eq("user_id", userId);
  await supabase.from("vocabulary_mastery").delete().eq("user_id", userId);

  const cookieStore = await cookies();
  cookieStore.delete("sm_assessed");

  redirect("/assessment");
}
