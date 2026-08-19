import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FriendsClient } from "./FriendsClient";
import { getFriends, getIncomingRequests, getOutgoingRequests, getFriendProgress } from "@/app/actions/friends";
import type { Friend, FriendProgress } from "@/lib/types";

export const metadata = { title: "Friends · SmartMandarin" };

export default async function FriendsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const [friends, incoming, outgoing] = await Promise.all([
    getFriends(),
    getIncomingRequests(),
    getOutgoingRequests(),
  ]);

  // One RPC per friend, in parallel — fine at the friend-list sizes this
  // feature actually sees; not worth a batched RPC for N usually in the
  // single digits.
  const progressEntries = await Promise.all(
    friends.map(async (f): Promise<[string, FriendProgress]> => [f.friendId, await getFriendProgress(f.friendId)])
  );
  const progressByFriend: Record<string, FriendProgress> = Object.fromEntries(progressEntries);

  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="max-w-lg mx-auto px-4 pt-8 pb-10">
        <FriendsClient
          initialFriends={friends}
          initialIncoming={incoming}
          initialOutgoing={outgoing}
          initialProgress={progressByFriend}
        />
      </div>
    </main>
  );
}
