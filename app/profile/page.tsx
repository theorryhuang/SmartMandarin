import { redirect } from "next/navigation";
import Link from "next/link";
import { Puzzle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BackButton } from "@/app/_components/BackButton";
import { SignOutButton } from "./SignOutButton";

export const metadata = { title: "Profile · SmartMandarin" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const name =
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    "No name";
  const email = user.email ?? user.user_metadata?.email ?? "No email";
  const avatar = user.user_metadata?.avatar_url as string | undefined;

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center justify-center p-8">
      <div className="absolute left-6" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
        <BackButton href="/" />
      </div>

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

        {/* Browser extension */}
        <Link
          href="/settings/extension"
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-violet-300 transition-colors"
        >
          <Puzzle size={18} className="text-violet-600 shrink-0" />
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">Browser extension</div>
            <div className="text-xs text-[var(--color-text-muted)]">Popup dictionary on any page</div>
          </div>
        </Link>

        {/* Sign out */}
        <SignOutButton />
      </div>
    </main>
  );
}
