import { ReviewFilterPicker } from "./ReviewFilterPicker";
import { BackButton } from "@/app/_components/BackButton";

export default function ReviewPage() {
  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center justify-center p-6">
      <div className="absolute left-6" style={{ top: "max(24px, env(safe-area-inset-top))" }}>
        <BackButton href="/" />
      </div>
      <ReviewFilterPicker />
    </main>
  );
}
