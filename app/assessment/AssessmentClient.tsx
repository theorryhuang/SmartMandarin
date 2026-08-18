"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveAssessmentResults, saveAssessmentBaseline, markAssessmentComplete } from "@/app/actions/vocabulary";
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

// Word counts per level are proportional to how many words that HSK level
// actually contains (data/hsk.txt: 300/200/500/1000/1600/1800 for L1-L6) —
// round(total / 50), so a bigger level gets more questions and a more
// reliable placement signal (e.g. HSK1's 300 words → 6 questions, HSK2's
// smaller 200 → 4, same 1.5x ratio as the level sizes themselves).
const LEVELS: AssessmentLevel[] = [
  {
    level: 1,
    words: [
      { hanzi: "爱", pinyin: "ài", meaning: "to love; to be fond of; to like" },
      { hanzi: "饭店", pinyin: "fàn diàn", meaning: "restaurant" },
      { hanzi: "看见", pinyin: "kàn jiàn", meaning: "to see; to catch sight of" },
      { hanzi: "牛奶", pinyin: "niú nǎi", meaning: "cow's milk" },
      { hanzi: "它", pinyin: "tā", meaning: "it" },
      { hanzi: "雪", pinyin: "xuě", meaning: "snow" },
    ],
  },
  {
    level: 2,
    words: [
      { hanzi: "啊", pinyin: "à", meaning: "interjection or grunt of agreement" },
      { hanzi: "过去", pinyin: "guò qù", meaning: "past; former; previous" },
      { hanzi: "门口", pinyin: "mén kǒu", meaning: "doorway" },
      { hanzi: "往", pinyin: "wǎng", meaning: "to go" },
    ],
  },
  {
    level: 3,
    words: [
      { hanzi: "阿姨", pinyin: "ā yí", meaning: "maternal aunt" },
      { hanzi: "查", pinyin: "chá", meaning: "to research" },
      { hanzi: "冬天", pinyin: "dōng tiān", meaning: "winter" },
      { hanzi: "刮", pinyin: "guā", meaning: "to scrape" },
      { hanzi: "见面", pinyin: "jiàn miàn", meaning: "to meet; to see each other" },
      { hanzi: "练习", pinyin: "liàn xí", meaning: "to practice" },
      { hanzi: "起", pinyin: "qǐ", meaning: "to rise" },
      { hanzi: "特别", pinyin: "tè bié", meaning: "unusual; special" },
      { hanzi: "鞋", pinyin: "xié", meaning: "shoe" },
      { hanzi: "语言", pinyin: "yǔ yán", meaning: "language" },
    ],
  },
  {
    level: 4,
    words: [
      { hanzi: "爱情", pinyin: "ài qíng", meaning: "romance; love" },
      { hanzi: "不得不", pinyin: "bù dé bù", meaning: "have no choice or option but to" },
      { hanzi: "此外", pinyin: "cǐ wài", meaning: "besides; in addition; moreover; furthermore" },
      { hanzi: "低温", pinyin: "dī wēn", meaning: "low temperature" },
      { hanzi: "分数", pinyin: "fēn shù", meaning: "grade" },
      { hanzi: "功夫", pinyin: "gōng fu", meaning: "skill" },
      { hanzi: "护士", pinyin: "hù shi", meaning: "nurse" },
      { hanzi: "减轻", pinyin: "jiǎn qīng", meaning: "to lighten" },
      { hanzi: "警察", pinyin: "jǐng chá", meaning: "police; police officer" },
      { hanzi: "来得及", pinyin: "lái de jí", meaning: "to have enough time; can do it in time; can still make it" },
      { hanzi: "美好", pinyin: "měi hǎo", meaning: "beautiful" },
      { hanzi: "批评", pinyin: "pī píng", meaning: "to criticize; criticism" },
      { hanzi: "全都", pinyin: "quán dōu", meaning: "all" },
      { hanzi: "剩", pinyin: "shèng", meaning: "to remain" },
      { hanzi: "说明书", pinyin: "shuō míng shū", meaning: "manual" },
      { hanzi: "痛", pinyin: "tòng", meaning: "ache" },
      { hanzi: "线下", pinyin: "xiàn xià", meaning: "offline" },
      { hanzi: "演唱", pinyin: "yǎn chàng", meaning: "to sing" },
      { hanzi: "原来", pinyin: "yuán lái", meaning: "original; former" },
      { hanzi: "职业", pinyin: "zhí yè", meaning: "occupation; profession; vocation" },
    ],
  },
  {
    level: 5,
    words: [
      { hanzi: "哎", pinyin: "āi", meaning: "hey!" },
      { hanzi: "毕竟", pinyin: "bì jìng", meaning: "after all" },
      { hanzi: "差别", pinyin: "chā bié", meaning: "difference; distinction; disparity" },
      { hanzi: "成员", pinyin: "chéng yuán", meaning: "member" },
      { hanzi: "从前", pinyin: "cóng qián", meaning: "previously" },
      { hanzi: "当作", pinyin: "dàng zuò", meaning: "to treat as" },
      { hanzi: "短处", pinyin: "duǎn chù", meaning: "shortcoming" },
      { hanzi: "分类", pinyin: "fēn lèi", meaning: "to classify" },
      { hanzi: "个性", pinyin: "gè xìng", meaning: "individuality" },
      { hanzi: "国庆", pinyin: "Guó qìng", meaning: "National Day" },
      { hanzi: "化学", pinyin: "huà xué", meaning: "chemistry" },
      { hanzi: "嘉宾", pinyin: "jiā bīn", meaning: "esteemed guest" },
      { hanzi: "结构", pinyin: "jié gòu", meaning: "structure" },
      { hanzi: "开幕", pinyin: "kāi mù", meaning: "to open" },
      { hanzi: "理论", pinyin: "lǐ lùn", meaning: "theory" },
      { hanzi: "忙碌", pinyin: "máng lù", meaning: "busy; bustling" },
      { hanzi: "念", pinyin: "niàn", meaning: "to read" },
      { hanzi: "期间", pinyin: "qī jiān", meaning: "period of time" },
      { hanzi: "全面", pinyin: "quán miàn", meaning: "all-around" },
      { hanzi: "山区", pinyin: "shān qū", meaning: "mountain area" },
      { hanzi: "胜", pinyin: "shèng", meaning: "victory" },
      { hanzi: "手套", pinyin: "shǒu tào", meaning: "glove" },
      { hanzi: "他人", pinyin: "tā rén", meaning: "another person; sb else; other people" },
      { hanzi: "图画", pinyin: "tú huà", meaning: "drawing" },
      { hanzi: "稳定", pinyin: "wěn dìng", meaning: "steady" },
      { hanzi: "相似", pinyin: "xiāng sì", meaning: "similar; alike" },
      { hanzi: "休闲", pinyin: "xiū xián", meaning: "leisure" },
      { hanzi: "移", pinyin: "yí", meaning: "to move" },
      { hanzi: "优质", pinyin: "yōu zhì", meaning: "excellent quality" },
      { hanzi: "早晚", pinyin: "zǎo wǎn", meaning: "morning and evening" },
      { hanzi: "直", pinyin: "zhí", meaning: "straight" },
      { hanzi: "住宿", pinyin: "zhù sù", meaning: "to stay at" },
    ],
  },
  {
    level: 6,
    words: [
      { hanzi: "岸", pinyin: "àn", meaning: "bank; shore; beach; coast" },
      { hanzi: "比重", pinyin: "bǐ zhòng", meaning: "proportion" },
      { hanzi: "材质", pinyin: "cái zhì", meaning: "texture of timber" },
      { hanzi: "撤销", pinyin: "chè xiāo", meaning: "to repeal" },
      { hanzi: "处处", pinyin: "chù chù", meaning: "everywhere" },
      { hanzi: "大幅", pinyin: "dà fú", meaning: "large-format" },
      { hanzi: "点燃", pinyin: "diǎn rán", meaning: "to ignite" },
      { hanzi: "二氧化碳", pinyin: "èr yǎng huà tàn", meaning: "carbon dioxide CO2" },
      { hanzi: "夫人", pinyin: "fū ren", meaning: "lady" },
      { hanzi: "跟随", pinyin: "gēn suí", meaning: "to follow" },
      { hanzi: "广阔", pinyin: "guǎng kuò", meaning: "wide" },
      { hanzi: "恨", pinyin: "hèn", meaning: "to hate" },
      { hanzi: "活力", pinyin: "huó lì", meaning: "energy" },
      { hanzi: "坚决", pinyin: "jiān jué", meaning: "firm; resolute; determined" },
      { hanzi: "解说", pinyin: "jiě shuō", meaning: "to explain; to give a running commentary" },
      { hanzi: "聚集", pinyin: "jù jí", meaning: "to assemble; to gather" },
      { hanzi: "枯燥", pinyin: "kū zào", meaning: "dry and dull; uninteresting; tedious" },
      { hanzi: "两极", pinyin: "liǎng jí", meaning: "the two poles" },
      { hanzi: "弥补", pinyin: "mí bǔ", meaning: "to complement" },
      { hanzi: "内科", pinyin: "nèi kē", meaning: "internal medicine; general medicine" },
      { hanzi: "平方米", pinyin: "píng fāng mǐ", meaning: "square meter" },
      { hanzi: "亲密", pinyin: "qīn mì", meaning: "intimate" },
      { hanzi: "人事", pinyin: "rén shì", meaning: "personnel" },
      { hanzi: "上市", pinyin: "shàng shì", meaning: "to hit the market" },
      { hanzi: "释放", pinyin: "shì fàng", meaning: "to release" },
      { hanzi: "虽", pinyin: "suī", meaning: "although" },
      { hanzi: "跳水", pinyin: "tiào shuǐ", meaning: "to dive" },
      { hanzi: "娃娃", pinyin: "wá wa", meaning: "baby" },
      { hanzi: "误", pinyin: "wù", meaning: "mistake" },
      { hanzi: "消灭", pinyin: "xiāo miè", meaning: "to put an end to" },
      { hanzi: "淹", pinyin: "yān", meaning: "to flood" },
      { hanzi: "一律", pinyin: "yī lǜ", meaning: "same; identical" },
      { hanzi: "由来", pinyin: "yóu lái", meaning: "origin" },
      { hanzi: "遭遇", pinyin: "zāo yù", meaning: "to meet with; to encounter" },
      { hanzi: "职位", pinyin: "zhí wèi", meaning: "position; post; job" },
      { hanzi: "主张", pinyin: "zhǔ zhāng", meaning: "to advocate" },
    ],
  },
];

// A level is "passed" once a learner knows at least 75% of its words —
// scales with each level's (variable) word count rather than a fixed count.
// Deliberately stricter than a bare majority: this level's words seed both
// the derived starting HSK level *and* which words get queued for review, so
// a coin-flip pass would place someone a level above where they're solid.
function passThreshold(level: AssessmentLevel): number {
  return Math.ceil(level.words.length * 0.75);
}

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

    const threshold = passThreshold(currentLevel);
    const wordsRemainingInLevel = currentLevel.words.length - (wordIndex + 1);
    const passedLevel = newLevelKnew >= threshold;
    // Once the majority is already reached, or there aren't enough words
    // left in this level to ever reach it even with a perfect run, the rest
    // of the level's words can't change the outcome — stop right there
    // instead of grinding through questions that no longer matter.
    const failedLevel = newLevelKnew + wordsRemainingInLevel < threshold;
    const levelDecided = passedLevel || failedLevel || wordsRemainingInLevel === 0;

    if (levelDecided) {
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
    await Promise.all([saveAssessmentResults(payload), saveAssessmentBaseline(deriveLevelFrom(finalResults))]);
    setPhase("done");
  }

  async function skip() {
    setPhase("saving");
    // "I'm a complete beginner" is itself the placement signal — HSK 1.
    await Promise.all([markAssessmentComplete(), saveAssessmentBaseline(1)]);
    setPhase("done");
  }

  // ── Derived level ───────────────────────────────────────────────────────────

  function deriveLevelFrom(fromResults: Result[]): number {
    for (let i = LEVELS.length - 1; i >= 0; i--) {
      const knew = fromResults.filter((r) => r.hsk_level === LEVELS[i].level && r.knew).length;
      if (knew >= passThreshold(LEVELS[i])) return LEVELS[i].level;
    }
    return 1;
  }

  // Reads from `results` state — used by the "done" render, one tick behind
  // finishQuiz's own `finalResults` param, which is why finishQuiz derives
  // its own level from finalResults directly rather than calling this.
  function derivedHskLevel(): number {
    return deriveLevelFrom(results);
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
        <div className="pb-6" style={{ paddingTop: "calc(max(24px, env(safe-area-inset-top)) + 40px)" }}>
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
