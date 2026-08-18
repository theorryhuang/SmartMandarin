import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOnboardingStatus } from "@/app/actions/onboarding";
import { OnboardingClient } from "./OnboardingClient";

export const metadata = { title: "Welcome · SmartMandarin" };

// No BackButton/HomeButton here on purpose — this is the very first thing a
// new account sees (see the redirect chain in app/page.tsx), so there's
// nothing meaningful behind it to go back to. Still fully skippable via the
// page's own "Continue to app" button, just not via a header nav icon.
export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const status = await getOnboardingStatus();

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center p-6">
      <div
        className="w-full max-w-md flex flex-col gap-4"
        style={{ paddingTop: "max(48px, env(safe-area-inset-top))", paddingBottom: 24 }}
      >
        <OnboardingClient initialStatus={status} />
      </div>
    </main>
  );
}
