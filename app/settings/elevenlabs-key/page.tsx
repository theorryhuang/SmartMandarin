import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerT } from "@/lib/i18n-server";
import { getElevenLabsKeyStatus } from "@/app/actions/settings";
import { ElevenLabsKeySettingsClient } from "./ElevenLabsKeySettingsClient";

export const metadata = { title: "ElevenLabs API key · SmartMandarin" };

export default async function ElevenLabsKeySettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const [status, t] = await Promise.all([getElevenLabsKeyStatus(), getServerT()]);
  // "from=onboarding" back-target is handled by the global AppHeader now
  // (see getRouteConfig in app/_components/AppHeader.tsx).

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center p-6">
      <div className="w-full max-w-md flex flex-col gap-6 pt-8">
        <div>
          <h1 className="text-2xl font-semibold">{t.elevenLabsKeyPageTitle}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{t.elevenLabsKeyPageDesc}</p>
        </div>

        <ElevenLabsKeySettingsClient initialStatus={status} />
      </div>
    </main>
  );
}
