import { getServerT } from "@/lib/i18n-server";
import { getOnboardingStatus } from "@/app/actions/onboarding";
import { InstructionsClient } from "./InstructionsClient";

export const metadata = { title: "Instructions · SmartMandarin" };

export default async function InstructionsPage() {
  // Signed out: page still renders (see middleware's /instructions
  // exception) so "Learn more" on /auth has somewhere to send people who
  // don't have an account yet. The global AppHeader routes Back/Home
  // accordingly and hides Home/Profile/streak when there's no session.
  const [status, t] = await Promise.all([getOnboardingStatus(), getServerT()]);

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center p-6">
      <div className="w-full max-w-md flex flex-col gap-6 pt-8" style={{ paddingBottom: 24 }}>
        <div>
          <h1 className="text-2xl font-semibold">{t.instructionsPageTitle}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{t.instructionsPageDesc}</p>
        </div>

        <InstructionsClient status={status} />
      </div>
    </main>
  );
}
