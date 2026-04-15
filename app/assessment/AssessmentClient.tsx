"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveAssessmentResults, markAssessmentComplete } from "@/app/actions/vocabulary";
import type { AssessmentWord } from "@/app/actions/vocabulary";
import { useLanguage } from "@/app/_components/LanguageContext";

// ─── Word bank ────────────────────────────────────────────────────────────────

interface WordEntry {
  hanzi: string;
  pinyin: string;
  meaning: string;
}

interface AssessmentLevel {
  level: number;
  words: WordEntry[];
}

const LEVELS: AssessmentLevel[] = [
  {
    level: 1,
    words: [
      { hanzi: "你好", pinyin: "nǐ hǎo", meaning: "hello" },
      { hanzi: "谢谢", pinyin: "xièxiè", meaning: "thank you" },
      { hanzi: "我", pinyin: "wǒ", meaning: "I / me" },
      { hanzi: "吃", pinyin: "chī", meaning: "to eat" },
      { hanzi: "家", pinyin: "jiā", meaning: "home / family" },
      { hanzi: "水", pinyin: "shuǐ", meaning: "water" },
    ],
  },
  {
    level: 2,
    words: [
      { hanzi: "因为", pinyin: "yīnwèi", meaning: "because" },
      { hanzi: "觉得", pinyin: "juéde", meaning: "to feel / think" },
      { hanzi: "已经", pinyin: "yǐjīng", meaning: "already" },
      { hanzi: "练习", pinyin: "liànxí", meaning: "to practice" },
      { hanzi: "明白", pinyin: "míngbai", meaning: "to understand" },
      { hanzi: "身体", pinyin: "shēntǐ", meaning: "body / health" },
    ],
  },
  {
    level: 3,
    words: [
      { hanzi: "虽然", pinyin: "suīrán", meaning: "although" },
      { hanzi: "环境", pinyin: "huánjìng", meaning: "environment" },
      { hanzi: "影响", pinyin: "yǐngxiǎng", meaning: "to influence / effect" },
      { hanzi: "认为", pinyin: "rènwéi", meaning: "to think / believe" },
      { hanzi: "除了", pinyin: "chúle", meaning: "except for / besides" },
      { hanzi: "突然", pinyin: "tūrán", meaning: "suddenly" },
    ],
  },
  {
    level: 4,
    words: [
      { hanzi: "尽管", pinyin: "jǐnguǎn", meaning: "despite / even though" },
      { hanzi: "逐渐", pinyin: "zhújiàn", meaning: "gradually" },
      { hanzi: "效果", pinyin: "xiàoguǒ", meaning: "effect / result" },
      { hanzi: "否则", pinyin: "fǒuzé", meaning: "otherwise" },
      { hanzi: "表达", pinyin: "biǎodá", meaning: "to express" },
      { hanzi: "推测", pinyin: "tuīcè", meaning: "to speculate / infer" },
    ],
  },
  {
    level: 5,
    words: [
      { hanzi: "彻底", pinyin: "chèdǐ", meaning: "thorough / completely" },
      { hanzi: "迫切", pinyin: "pòqiè", meaning: "urgent / pressing" },
      { hanzi: "感慨", pinyin: "gǎnkǎi", meaning: "deeply moved / sigh" },
      { hanzi: "况且", pinyin: "kuàngqiě", meaning: "furthermore / moreover" },
      { hanzi: "陶醉", pinyin: "táozuì", meaning: "to be intoxicated / engrossed" },
      { hanzi: "凑巧", pinyin: "còuqiǎo", meaning: "by coincidence" },
    ],
  },
  {
    level: 6,
    words: [
      { hanzi: "斟酌", pinyin: "zhēnzhuó", meaning: "to weigh / consider carefully" },
      { hanzi: "俨然", pinyin: "yǎnrán", meaning: "just like / solemn" },
      { hanzi: "晦涩", pinyin: "huìsè", meaning: "obscure / difficult to understand" },
      { hanzi: "彷徨", pinyin: "pánghuáng", meaning: "to hesitate / wander" },
      { hanzi: "潜移默化", pinyin: "qiányímòhuà", meaning: "imperceptible influence" },
      { hanzi: "瞻前顾后", pinyin: "zhānqiángùhòu", meaning: "to look before and after / over-cautious" },
    ],
  },
];

const PASS_THRESHOLD = 3;

type Phase = "intro" | "quiz" | "saving" | "done";

interface Result extends WordEntry {
  hsk_level: number;
  knew: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AssessmentClient() {
  const router = useRouter();
  const { t } = useLanguage();
  const [phase, setPhase] = useState<Phase>("intro");
  const [revealed, setRevealed] = useState(false);
  const [levelIndex, setLevelIndex] = useState(0);
  const [wordIndex, setWordIndex] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [levelKnewCount, setLevelKnewCount] = useState(0);

  const totalWords = LEVELS.reduce((s, l) => s + l.words.length, 0);
  const wordsAnswered = results.length;
  const progress = wordsAnswered / totalWords;

  const currentLevel = LEVELS[levelIndex];
  const currentWord = currentLevel?.words[wordIndex];

  // ── Answer handler ──────────────────────────────────────────────────────────

  function answer(knew: boolean) {
    const result: Result = { ...currentWord, hsk_level: currentLevel.level, knew };
    const newResults = [...results, result];
    const newLevelKnew = levelKnewCount + (knew ? 1 : 0);

    setResults(newResults);
    setRevealed(false);

    const isLastWordInLevel = wordIndex === currentLevel.words.length - 1;

    if (isLastWordInLevel) {
      const passedLevel = newLevelKnew >= PASS_THRESHOLD;
      const isLastLevel = levelIndex === LEVELS.length - 1;

      if (!passedLevel || isLastLevel) {
        finishQuiz(newResults);
      } else {
        setLevelIndex((i) => i + 1);
        setWordIndex(0);
        setLevelKnewCount(0);
      }
    } else {
      setWordIndex((i) => i + 1);
      setLevelKnewCount(newLevelKnew);
    }
  }

  // ── Finish / save ───────────────────────────────────────────────────────────

  async function finishQuiz(finalResults: Result[]) {
    setPhase("saving");
    const payload: AssessmentWord[] = finalResults.map((r) => ({
      hanzi: r.hanzi,
      pinyin: r.pinyin,
      meaning: r.meaning,
      hsk_level: r.hsk_level,
      knew: r.knew,
    }));
    await saveAssessmentResults(payload);
    setPhase("done");
  }

  async function skip() {
    setPhase("saving");
    await markAssessmentComplete();
    setPhase("done");
  }

  // ── Derived level ───────────────────────────────────────────────────────────

  function derivedHskLevel(): number {
    for (let i = LEVELS.length - 1; i >= 0; i--) {
      const lvl = LEVELS[i].level;
      const knew = results.filter((r) => r.hsk_level === lvl && r.knew).length;
      if (knew >= PASS_THRESHOLD) return lvl;
    }
    return 1;
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (phase === "intro") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 gap-8 max-w-md mx-auto text-center">
        <div>
          <div className="text-4xl mb-4">🈶</div>
          <h1 className="text-2xl font-semibold mb-2">{t.quickLevelCheck}</h1>
          <p className="text-[var(--color-text-secondary)] leading-relaxed">
            {t.assessmentDesc}
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-3">{t.takesAbout}</p>
        </div>

        <div className="flex flex-col gap-3 w-full">
          <button
            onClick={() => setPhase("quiz")}
            className="w-full py-3.5 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white font-medium text-sm transition-all"
          >
            {t.startAssessment}
          </button>
          <button
            onClick={skip}
            className="w-full py-3 rounded-2xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-sm transition-all"
          >
            {t.beginnerSkip}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "quiz" && currentWord) {
    const levelLabel = `HSK ${currentLevel.level}`;
    const wordNum = wordIndex + 1;
    const totalInLevel = currentLevel.words.length;

    return (
      <div className="flex flex-col min-h-screen max-w-md mx-auto px-6">
        {/* Progress bar */}
        <div className="pt-8 pb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--color-text-muted)]">{levelLabel}</span>
            <span className="text-xs text-[var(--color-text-muted)]">
              {wordNum}/{totalInLevel}
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-[var(--color-surface-raised)]">
            <div
              className="h-1 rounded-full bg-violet-600 transition-all duration-300"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>

        {/* Flashcard */}
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <button
            onClick={() => setRevealed(true)}
            disabled={revealed}
            className={`w-full rounded-3xl border px-8 py-10 text-center transition-all ${
              revealed
                ? "border-[var(--color-border)] bg-[var(--color-surface)] cursor-default"
                : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-violet-400 hover:bg-violet-50 active:scale-[0.98] cursor-pointer"
            }`}
          >
            <p className="text-6xl font-light mb-6 tracking-wide">{currentWord.hanzi}</p>

            {revealed ? (
              <div className="space-y-1 animate-in fade-in duration-200">
                <p className="text-lg text-[var(--color-text-secondary)]">{currentWord.pinyin}</p>
                <p className="text-sm text-[var(--color-text-muted)]">{currentWord.meaning}</p>
              </div>
            ) : (
              <p className="text-xs text-[var(--color-text-muted)] tracking-wide uppercase">
                {t.tapToReveal}
              </p>
            )}
          </button>

          {/* Level progress pips */}
          <div className="flex gap-1.5">
            {currentLevel.words.map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-all ${
                  i < wordIndex
                    ? "bg-violet-500"
                    : i === wordIndex
                    ? "bg-violet-400 ring-2 ring-violet-400/30"
                    : "bg-[var(--color-surface-raised)]"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Answer buttons — only show after reveal */}
        <div className="flex gap-3 py-8">
          {revealed ? (
            <>
              <button
                onClick={() => answer(false)}
                className="flex-1 py-4 rounded-2xl border border-red-200 bg-red-50 text-red-600 font-medium text-sm hover:bg-red-100 transition-all"
              >
                {t.dontKnowBtn}
              </button>
              <button
                onClick={() => answer(true)}
                className="flex-1 py-4 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 font-medium text-sm hover:bg-emerald-100 transition-all"
              >
                {t.knowItBtn}
              </button>
            </>
          ) : (
            <button
              onClick={() => setRevealed(true)}
              className="flex-1 py-4 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white font-medium text-sm transition-all"
            >
              {t.reveal}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === "saving") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <div className="w-6 h-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
        <p className="text-sm text-[var(--color-text-muted)]">{t.savingResults}</p>
      </div>
    );
  }

  // done
  const level = derivedHskLevel();
  const knownCount = results.filter((r) => r.knew).length;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 gap-8 max-w-md mx-auto text-center">
      <div>
        <div className="text-4xl mb-4">🎯</div>
        <h1 className="text-2xl font-semibold mb-2">{t.assessmentComplete}</h1>
        {results.length > 0 ? (
          <>
            <p className="text-[var(--color-text-secondary)] leading-relaxed">
              {t.youRecognised(knownCount, results.length)}{" "}
              <span className="text-violet-600 font-medium">HSK {level}</span>.
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-3">
              {t.aiWillSpeak}
            </p>
          </>
        ) : (
          <p className="text-[var(--color-text-secondary)] leading-relaxed">
            {t.beginnerStart}
          </p>
        )}
      </div>

      <button
        onClick={() => router.push("/")}
        className="w-full py-3.5 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white font-medium text-sm transition-all"
      >
        {t.letsGo}
      </button>
    </div>
  );
}
