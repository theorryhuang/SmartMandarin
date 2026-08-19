"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getServerT } from "@/lib/i18n-server";
import { deriveCurrentHSK } from "@/lib/fsrs";
import { computeStreak } from "@/lib/streak";
import type { Friend, FriendRequest, FriendProgress } from "@/lib/types";
import type { HSKLevelStats } from "@/lib/types";

/** Set by /friends itself on visit — see FriendsClient — so "someone
 *  accepted your request" stops counting as a notification once you've
 *  actually seen it. Incoming *pending* requests don't need this: they're
 *  self-clearing (they leave the pending set the moment you accept/decline). */
const SEEN_COOKIE = "sm_friends_seen_at";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function getUserId(supabase: SupabaseClient): Promise<string> {
  return (await supabase.auth.getUser()).data.user?.id ?? "";
}

// ─── Send / respond ─────────────────────────────────────────────────────────

/**
 * Looks the target up by exact email (see find_user_by_email in
 * 020_friends.sql — the only way to resolve an email to a user id from
 * here, since regular clients can't query auth.users). If they'd already
 * sent *us* a pending request, accepts it instead of creating a duplicate —
 * nicer than making both people separately click "add" to become friends.
 */
export async function sendFriendRequest(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = await getServerT();
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: t.addFriendErrorEmpty };

  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) return { ok: false, error: t.addFriendErrorNotSignedIn };

  const { data: found, error: lookupErr } = await supabase
    .rpc("find_user_by_email", { p_email: trimmed })
    .maybeSingle();
  if (lookupErr) return { ok: false, error: lookupErr.message };
  if (!found) return { ok: false, error: t.addFriendErrorNotFound };
  if (found.id === userId) return { ok: false, error: t.addFriendErrorSelf };

  const { data: existing, error: existingErr } = await supabase
    .from("friend_requests")
    .select("id, requester_id, status")
    .or(`and(requester_id.eq.${userId},addressee_id.eq.${found.id}),and(requester_id.eq.${found.id},addressee_id.eq.${userId})`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingErr) return { ok: false, error: existingErr.message };

  if (existing?.status === "accepted") return { ok: false, error: t.addFriendErrorAlreadyFriends };
  if (existing?.status === "pending") {
    if (existing.requester_id === userId) return { ok: false, error: t.addFriendErrorAlreadySent };
    // They beat us to it — accept theirs instead of erroring.
    const { error } = await supabase
      .from("friend_requests")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error: insertErr } = await supabase
    .from("friend_requests")
    .insert({ requester_id: userId, addressee_id: found.id, status: "pending" });
  if (insertErr) return { ok: false, error: insertErr.message };
  return { ok: true };
}

export async function acceptFriendRequest(requestId: string): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) throw new Error("Not signed in");

  const { error } = await supabase
    .from("friend_requests")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("addressee_id", userId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) throw new Error("Not signed in");

  const { error } = await supabase
    .from("friend_requests")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("addressee_id", userId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) throw new Error("Not signed in");

  const { error } = await supabase
    .from("friend_requests")
    .delete()
    .eq("id", requestId)
    .eq("requester_id", userId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}

export async function removeFriend(requestId: string): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) throw new Error("Not signed in");

  const { error } = await supabase
    .from("friend_requests")
    .delete()
    .eq("id", requestId)
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  if (error) throw new Error(error.message);
}

// ─── Listing ────────────────────────────────────────────────────────────────

export async function getFriends(): Promise<Friend[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_friends");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    friendId: r.friend_id,
    requestId: r.request_id,
    displayName: r.display_name ?? "",
    avatarUrl: r.avatar_url,
    since: r.since,
  }));
}

export async function getIncomingRequests(): Promise<FriendRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_incoming_friend_requests");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    requestId: r.request_id,
    userId: r.user_id,
    displayName: r.display_name ?? "",
    avatarUrl: r.avatar_url,
    createdAt: r.created_at,
  }));
}

export async function getOutgoingRequests(): Promise<FriendRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_outgoing_friend_requests");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    requestId: r.request_id,
    userId: r.user_id,
    displayName: r.display_name ?? "",
    avatarUrl: r.avatar_url,
    createdAt: r.created_at,
  }));
}

/**
 * Badge count for the profile icon: incoming requests waiting on you, plus
 * requests *you sent* that turned "accepted" since you last opened
 * /friends — someone else accepting your request is news to you.
 *
 * Deliberately NOT the mirror case (a request sent *to* you turning
 * accepted): that only happens by your own hand — you're the one clicking
 * Accept — so it's never a surprise and shouldn't re-inflate the badge the
 * moment you act on it. Queries friend_requests directly (RLS already
 * scopes every row to auth.uid() being requester or addressee) rather than
 * the get_friends()/get_incoming_friend_requests() RPCs, which don't carry
 * enough to tell the two directions apart.
 */
export async function getFriendNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) return 0;

  const cookieStore = await cookies();
  const seenAt = cookieStore.get(SEEN_COOKIE)?.value ?? new Date(0).toISOString();

  const [{ count: incomingCount, error: incErr }, { count: acceptedCount, error: accErr }] = await Promise.all([
    supabase
      .from("friend_requests")
      .select("id", { count: "exact", head: true })
      .eq("addressee_id", userId)
      .eq("status", "pending"),
    supabase
      .from("friend_requests")
      .select("id", { count: "exact", head: true })
      .eq("requester_id", userId)
      .eq("status", "accepted")
      .gt("responded_at", seenAt),
  ]);
  if (incErr) throw new Error(incErr.message);
  if (accErr) throw new Error(accErr.message);

  return (incomingCount ?? 0) + (acceptedCount ?? 0);
}

// ─── Progress ───────────────────────────────────────────────────────────────

/**
 * Same "current HSK" / mastery-pct / streak derivation the home page uses
 * for yourself (deriveCurrentHSK, computeStreak), fed a friend's own stats
 * instead — get_friend_stats() re-checks the friendship server-side before
 * returning anything, so this can't be used to peek at a stranger's data by
 * guessing a friend_id.
 */
export async function getFriendProgress(friendId: string): Promise<FriendProgress> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) throw new Error("Not signed in");

  const { data, error } = await supabase.rpc("get_friend_stats", { p_friend_id: friendId });
  if (error) throw new Error(error.message);

  const parsed = data as unknown as {
    words_tracked: number;
    assessment_hsk_level: number | null;
    hsk_stats: HSKLevelStats[];
    batch_dates: string[];
  };

  const derived = deriveCurrentHSK(parsed.hsk_stats ?? [], parsed.assessment_hsk_level ?? null);

  return {
    wordsTracked: parsed.words_tracked ?? 0,
    currentHSK: derived?.level ?? null,
    currentLevelMasteryPct: derived ? Math.round(derived.fraction * 100) : 0,
    streak: computeStreak(parsed.batch_dates ?? []),
  };
}
