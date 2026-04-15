/**
 * POST /api/transcribe
 * Body: FormData with field "audio" (webm/opus blob)
 * Returns: { text: string }
 *
 * Uses Groq Whisper (free) for speech-to-text.
 */
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY not set" }, { status: 500 });
  }

  const formData = await req.formData();
  const audio = formData.get("audio") as Blob | null;
  if (!audio) {
    return NextResponse.json({ error: "No audio provided" }, { status: 400 });
  }

  // Forward to Groq Whisper
  const groqForm = new FormData();
  groqForm.append("file", audio, "audio.webm");
  groqForm.append("model", "whisper-large-v3-turbo");
  groqForm.append("language", "zh"); // hint: Chinese
  groqForm.append("response_format", "json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: groqForm,
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Transcription failed: ${err.slice(0, 200)}` }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json({ text: data.text ?? "" });
}
