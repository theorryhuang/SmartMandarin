/**
 * POST /api/transcribe
 * Body: FormData with field "audio" (wav blob — converted client-side from webm/opus)
 * Returns: { text: string }
 *
 * Uses ElevenLabs Scribe for speech-to-text.
 * Note: ElevenLabs does not reliably decode webm/opus, so the client converts to WAV first.
 */
import { NextRequest, NextResponse } from "next/server";

// Default Vercel function timeout (10s on Hobby) can be shorter than
// cold-start + ElevenLabs round trip — bump the budget where the plan allows it.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("[transcribe] ELEVENLABS_API_KEY not set in this environment");
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });
  }

  const formData = await req.formData();
  const audio = formData.get("audio") as Blob | null;
  const peakAmplitude = formData.get("peak_amplitude"); // diagnostic only, from client-side toWav()
  if (!audio) {
    return NextResponse.json({ error: "No audio provided" }, { status: 400 });
  }

  console.log(`[transcribe] received ${audio.size} bytes, type=${audio.type}, client-measured peak=${peakAmplitude ?? "n/a"}`);

  const filename = audio.type === "audio/wav" ? "audio.wav" : "audio.webm";

  const elForm = new FormData();
  elForm.append("file", audio, filename);
  elForm.append("model_id", "scribe_v1");
  elForm.append("language_code", "zh");

  let res: Response;
  try {
    res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: elForm,
    });
  } catch (e) {
    // Network-level failure (DNS, timeout, fetch not permitted, etc.) —
    // surface as JSON instead of letting it throw into an HTML 500 page,
    // which the client can't parse and reports as a confusing error.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[transcribe] fetch to ElevenLabs failed:", msg);
    return NextResponse.json({ error: `Could not reach ElevenLabs: ${msg}` }, { status: 502 });
  }

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

  console.log(`[transcribe] ElevenLabs returned: ${JSON.stringify(data.text ?? "")}`);
  return NextResponse.json({ text: data.text ?? "" });
}
