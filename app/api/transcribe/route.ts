/**
 * POST /api/transcribe
 * Body: FormData with field "audio" (webm/opus blob)
 * Returns: { text: string }
 *
 * Uses ElevenLabs Scribe for speech-to-text.
 */
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });
  }

  const formData = await req.formData();
  const audio = formData.get("audio") as Blob | null;
  if (!audio) {
    return NextResponse.json({ error: "No audio provided" }, { status: 400 });
  }

  const elForm = new FormData();
  elForm.append("file", audio, "audio.webm");
  elForm.append("model_id", "scribe_v1");
  elForm.append("language_code", "zh");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: elForm,
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Transcription failed: ${err.slice(0, 200)}` }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json({ text: data.text ?? "" });
}
