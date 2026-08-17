import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerT } from "@/lib/i18n-server";
import { BackButton } from "@/app/_components/BackButton";
import { HomeButton } from "@/app/_components/HomeButton";
import { getGeminiKeyStatus } from "@/app/actions/settings";
import { GeminiKeySettingsClient } from "./GeminiKeySettingsClient";

export const metadata = { title: "Gemini API key · SmartMandarin" };

export default async function GeminiKeySettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const [status, t] = await Promise.all([getGeminiKeyStatus(), getServerT()]);

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center p-6">
      <div className="absolute left-6" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
        <BackButton href="/profile" />
      </div>
      <div className="absolute right-6" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
        <HomeButton />
      </div>

      <div className="w-full max-w-md flex flex-col gap-6" style={{ paddingTop: "calc(max(24px, env(safe-area-inset-top)) + 40px)" }}>
        <div>
          <h1 className="text-2xl font-semibold">{t.geminiKeyPageTitle}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{t.geminiKeyPageDesc}</p>
        </div>

        <GeminiKeySettingsClient initialStatus={status} />
      </div>
    </main>
  );
}
