import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { authenticateExtensionRequest, EXTENSION_CORS_HEADERS } from "@/lib/extensionAuth";
import { defineWord } from "@/lib/defineWord";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: EXTENSION_CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const userId = await authenticateExtensionRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: EXTENSION_CORS_HEADERS });
  }

  const { hanzi, slang_mode } = await req.json().catch(() => ({}));
  if (!hanzi) {
    return NextResponse.json({ error: "hanzi required" }, { status: 400, headers: EXTENSION_CORS_HEADERS });
  }

  const supabase = createServiceClient();
  const result = await defineWord({ supabase, userId, hanzi, slangMode: slang_mode });
  const status = result.error ? 500 : 200;
  return NextResponse.json(result, { status, headers: EXTENSION_CORS_HEADERS });
}
