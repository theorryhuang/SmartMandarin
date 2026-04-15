import { AssessmentClient } from "./AssessmentClient";
import { BackButton } from "@/app/_components/BackButton";

export const metadata = { title: "Level Assessment · SmartMandarin" };

export default function AssessmentPage() {
  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="absolute top-6 left-6">
        <BackButton href="/" />
      </div>
      <AssessmentClient />
    </main>
  );
}
