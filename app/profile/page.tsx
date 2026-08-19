import { redirect } from "next/navigation";
import Link from "next/link";
import { Puzzle, KeyRound, AudioLines, CircleHelp, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getServerT } from "@/lib/i18n-server";
import { getFriendNotificationCount } from "@/app/actions/friends";
import { SignOutButton } from "./SignOutButton";
import { DeleteAccountSection } from "./DeleteAccountSection";

export const metadata = { title: "Profile · SmartMandarin" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const t = await getServerT();

  if (!user) redirect("/auth");

  // Same count the global header's profile badge shows (see AppHeader) —
  // repeated here because that badge hides itself on /profile (see
  // getRouteConfig's showProfile: false, since you're already here), so
  // this is the one place on this page a pending request is otherwise
  // invisible without opening /friends to check.
  const friendNotifCount = await getFriendNotificationCount();

  const name =
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    "No name";
  const email = user.email ?? user.user_metadata?.email ?? "No email";
  const avatar = user.user_metadata?.avatar_url as string | undefined;

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        {/* Avatar */}
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt={name}
            className="w-20 h-20 rounded-full object-cover ring-2 ring-[var(--color-border)]"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-violet-700 flex items-center justify-center text-3xl font-semibold text-white">
            {name.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Info */}
        <div className="text-center">
          <h1 className="text-2xl font-semibold">{name}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{email}</p>
        </div>

        {/* Friends */}
        <Link
          href="/friends"
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-violet-300 transition-colors"
        >
          <div className="relative shrink-0">
            <Users size={18} className="text-violet-600" />
            {friendNotifCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
                {friendNotifCount}
              </span>
            )}
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{t.profileNavFriends}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t.profileNavFriendsDesc}</div>
          </div>
        </Link>

        {/* Browser extension */}
        <Link
          href="/settings/extension"
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-violet-300 transition-colors"
        >
          <Puzzle size={18} className="text-violet-600 shrink-0" />
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{t.profileNavExtension}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t.profileNavExtensionDesc}</div>
          </div>
        </Link>

        {/* Gemini API key */}
        <Link
          href="/settings/gemini-key"
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-violet-300 transition-colors"
        >
          <KeyRound size={18} className="text-violet-600 shrink-0" />
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{t.profileNavGeminiKey}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t.profileNavGeminiKeyDesc}</div>
          </div>
        </Link>

        {/* ElevenLabs API key */}
        <Link
          href="/settings/elevenlabs-key"
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-violet-300 transition-colors"
        >
          <AudioLines size={18} className="text-violet-600 shrink-0" />
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{t.profileNavElevenLabsKey}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t.profileNavElevenLabsKeyDesc}</div>
          </div>
        </Link>

        {/* Instructions */}
        <Link
          href="/instructions"
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-violet-300 transition-colors"
        >
          <CircleHelp size={18} className="text-violet-600 shrink-0" />
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{t.instructionsPageTitle}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t.instructionsPageDesc}</div>
          </div>
        </Link>

        {/* Sign out */}
        <SignOutButton />

        {/* Danger zone */}
        <DeleteAccountSection />
      </div>
    </main>
  );
}
