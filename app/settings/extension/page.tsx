import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackButton } from "@/app/_components/BackButton";
import { ExtensionSettingsClient } from "./ExtensionSettingsClient";

export const metadata = { title: "Browser extension · SmartMandarin" };

export default async function ExtensionSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center p-6">
      <div className="absolute left-6" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
        <BackButton href="/profile" />
      </div>

      <div className="w-full max-w-md flex flex-col gap-6 pt-16">
        <div>
          <h1 className="text-2xl font-semibold">Browser extension</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Pop up the same dictionary you get in the app — hover, click, queue for review — on any page you're reading, like Wikipedia.
          </p>
        </div>

        <ExtensionSettingsClient />
      </div>
    </main>
  );
}
