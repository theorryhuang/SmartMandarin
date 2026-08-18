import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerT } from "@/lib/i18n-server";
import { BackButton } from "@/app/_components/BackButton";
import { HomeButton } from "@/app/_components/HomeButton";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { getElevenLabsKeyStatus } from "@/app/actions/settings";
import { ElevenLabsKeySettingsClient } from "./ElevenLabsKeySettingsClient";

export const metadata = { title: "ElevenLabs API key · SmartMandarin" };

interface Props {
  searchParams: Promise<{ from?: string }>;
}

export default async function ElevenLabsKeySettingsPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const [status, t, { from }] = await Promise.all([getElevenLabsKeyStatus(), getServerT(), searchParams]);
  // Arriving from onboarding's "get your key" link should return there, not
  // to Profile — otherwise the back button strands the user mid-setup.
  const fromOnboarding = from === "onboarding";

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center p-6">
      <div className="absolute left-6" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
        <BackButton href={fromOnboarding ? "/onboarding" : "/profile"} label={fromOnboarding ? t.backToSetup : undefined} />
      </div>
      <div className="absolute right-6 flex items-center gap-3" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
        <LanguageSwitcher />
        <HomeButton />
      </div>

      <div className="w-full max-w-md flex flex-col gap-6" style={{ paddingTop: "calc(max(24px, env(safe-area-inset-top)) + 40px)" }}>
        <div>
          <h1 className="text-2xl font-semibold">{t.elevenLabsKeyPageTitle}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{t.elevenLabsKeyPageDesc}</p>
        </div>

        <ElevenLabsKeySettingsClient initialStatus={status} />
      </div>
    </main>
  );
}
