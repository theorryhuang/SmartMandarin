import { getDueWords } from "@/app/actions/vocabulary";
import { ReviewSession } from "./ReviewSession";
import { BackButton } from "@/app/_components/BackButton";

export default async function ReviewPage() {
  const due = await getDueWords(20);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="absolute top-6 left-6">
        <BackButton href="/" />
      </div>
      <ReviewSession initialCards={due} />
    </main>
  );
}
