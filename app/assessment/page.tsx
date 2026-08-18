import { AssessmentClient } from "./AssessmentClient";
import { BackButton } from "@/app/_components/BackButton";
import { HomeButton } from "@/app/_components/HomeButton";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";

export const metadata = { title: "Level Assessment · SmartMandarin" };

export default function AssessmentPage() {
  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="absolute top-6 left-6">
        <BackButton href="/" />
      </div>
      <div className="absolute top-6 right-6 flex items-center gap-3">
        <LanguageSwitcher />
        <HomeButton />
      </div>
      <AssessmentClient />
    </main>
  );
}
