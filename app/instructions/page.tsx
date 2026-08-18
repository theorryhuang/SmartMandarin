import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerT } from "@/lib/i18n-server";
import { getOnboardingStatus } from "@/app/actions/onboarding";
import { BackButton } from "@/app/_components/BackButton";
import { HomeButton } from "@/app/_components/HomeButton";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { InstructionsClient } from "./InstructionsClient";

export const metadata = { title: "Instructions · SmartMandarin" };

export default async function InstructionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const [status, t] = await Promise.all([getOnboardingStatus(), getServerT()]);

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center p-6">
      <div className="absolute left-6" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
        <BackButton href="/profile" />
      </div>
      <div className="absolute right-6 flex items-center gap-3" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
        <LanguageSwitcher />
        <HomeButton />
      </div>

      <div
        className="w-full max-w-md flex flex-col gap-6"
        style={{ paddingTop: "calc(max(24px, env(safe-area-inset-top)) + 40px)", paddingBottom: 24 }}
      >
        <div>
          <h1 className="text-2xl font-semibold">{t.instructionsPageTitle}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{t.instructionsPageDesc}</p>
        </div>

        <InstructionsClient status={status} />
      </div>
    </main>
  );
}
