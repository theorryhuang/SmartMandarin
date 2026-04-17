import { getDueSlangWords, getAllSlangWords } from "@/app/actions/vocabulary";
import { ReviewSession } from "../ReviewSession";
import { BackButton } from "@/app/_components/BackButton";

export default async function SlangReviewPage() {
  const due = await getDueSlangWords(20);

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center justify-center p-6">
      <div className="absolute top-6 left-6">
        <BackButton href="/" />
      </div>
      <ReviewSession
        initialCards={due}
        sessionKey="sm_review_session_slang"
        getAllWordsFn={getAllSlangWords}
      />
    </main>
  );
}
