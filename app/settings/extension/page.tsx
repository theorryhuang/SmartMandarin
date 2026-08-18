import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerT } from "@/lib/i18n-server";
import { BackButton } from "@/app/_components/BackButton";
import { HomeButton } from "@/app/_components/HomeButton";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { ExtensionSettingsClient } from "./ExtensionSettingsClient";

export const metadata = { title: "Browser extension · SmartMandarin" };

export default async function ExtensionSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  const t = await getServerT();

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center p-6">
      <div className="absolute left-6" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
        <BackButton href="/profile" />
      </div>
      <div className="absolute right-6 flex items-center gap-3" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
        <LanguageSwitcher />
        <HomeButton />
      </div>

      <div className="w-full max-w-md flex flex-col gap-6" style={{ paddingTop: "calc(max(24px, env(safe-area-inset-top)) + 40px)" }}>
        <div>
          <h1 className="text-2xl font-semibold">{t.extPageTitle}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{t.extPageDesc}</p>
        </div>

        <ExtensionSettingsClient />
      </div>
    </main>
  );
}
