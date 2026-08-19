import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerT } from "@/lib/i18n-server";
import { ExtensionSettingsClient } from "./ExtensionSettingsClient";

export const metadata = { title: "Browser extension · SmartMandarin" };

export default async function ExtensionSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  const t = await getServerT();
  // "from=onboarding" back-target is handled by the global AppHeader now
  // (see getRouteConfig in app/_components/AppHeader.tsx).

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center p-6">
      <div className="w-full max-w-md flex flex-col gap-6 pt-8">
        <div>
          <h1 className="text-2xl font-semibold">{t.extPageTitle}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{t.extPageDesc}</p>
        </div>

        <ExtensionSettingsClient />
      </div>
    </main>
  );
}
