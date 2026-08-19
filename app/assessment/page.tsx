import { AssessmentClient } from "./AssessmentClient";

export const metadata = { title: "Level Assessment · SmartMandarin" };

export default function AssessmentPage() {
  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <AssessmentClient />
    </main>
  );
}
