import { NextRequest, NextResponse } from "next/server";

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3.6-flash";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

  const {
    userMessage,
    history = [],
    slang_mode = false,
    forced_words = [],
    hsk_level = 1,
    unknown_words = [],
  } = await req.json().catch(() => ({}));

  if (!userMessage) return NextResponse.json({ error: "No userMessage provided" }, { status: 400 });

  const hskNext = Math.min(hsk_level + 1, 9);
  let systemText = "You are a friendly Mandarin Chinese conversation partner called XiaoLing helping a learner practice natural Mandarin.\n";
  systemText += "- Respond ONLY in Mandarin (simplified characters). No pinyin.\n";
  systemText += "- Keep responses concise: 2 to 4 sentences.\n";
  systemText += "- Gently correct errors by rephrasing naturally.\n";
  systemText += "- End with a follow-up question.\n";
  systemText += "The user is at HSK " + hsk_level + ". Use HSK " + hsk_level + " vocabulary. Occasionally use 1-2 HSK " + hskNext + " words.\n";
  if (unknown_words.length > 0) {
    systemText += "Words the user struggled with:\n";
    for (const w of unknown_words) systemText += "- " + w.hanzi + " (" + w.pinyin + "): " + w.meaning + "\n";
  }
  if (slang_mode) systemText += "Slang mode ON: use modern internet slang where natural.\n";
  if (forced_words.length > 0) systemText += "PRIORITY: work these words into your next reply: " + forced_words.join(", ") + "\n";

  // Format history + system as a single input with context
  const historyText = history.slice(-10)
    .map((m: { role: string; content: string }) => (m.role === "user" ? "User: " : "XiaoLing: ") + m.content)
    .join("\n");
  const fullInput = historyText ? historyText + "\nUser: " + userMessage : userMessage;

  const res = await fetch(INTERACTIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      model: MODEL,
      input: "[Instructions]\n" + systemText + "\n[Conversation]\n" + fullInput,
      store: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();

    return NextResponse.json({ error: errText.slice(0, 200) }, { status: 500 });
  }

  const data = await res.json();
const modelStep = data.steps?.find((s: { type: string }) => s.type === "model_output");
  const reply: string = modelStep?.content
    ?.filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text)
    .join("") ?? "";
  return NextResponse.json({ reply: reply.trim() });
}
