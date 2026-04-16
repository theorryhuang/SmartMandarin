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

  console.log("[transcribe] audio size:", audio.size, "type:", audio.type);
  // Spot-check PCM data (WAV header is 44 bytes, PCM starts after)
  if (audio.type === "audio/wav") {
    const buf = await audio.arrayBuffer();
    const samples = new Int16Array(buf, 44, Math.min(1000, (buf.byteLength - 44) / 2));
    const maxAbs = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    console.log("[transcribe] WAV max sample value:", maxAbs, "(0 = silent)");
  }

  const isWav = audio.type === "audio/wav";
  const filename = isWav ? "audio.wav" : "audio.webm";

  const elForm = new FormData();
  elForm.append("file", audio, filename);
  elForm.append("model_id", "scribe_v1");
  elForm.append("language_code", "zh");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: elForm,
  });

  const rawText = await res.text();
  if (!res.ok) {
    console.error("[transcribe] ElevenLabs error:", res.status, rawText.slice(0, 500));
    return NextResponse.json({ error: `Transcription failed (${res.status}): ${rawText.slice(0, 200)}` }, { status: res.status });
  }

  let data: { text?: string };
  try {
    data = JSON.parse(rawText);
  } catch {
    console.error("[transcribe] Failed to parse ElevenLabs response:", rawText.slice(0, 500));
    return NextResponse.json({ error: `Invalid response from ElevenLabs: ${rawText.slice(0, 100)}` }, { status: 500 });
  }

  console.log("[transcribe] ElevenLabs full response:", JSON.stringify(data));
  return NextResponse.json({ text: data.text ?? "" });
}
