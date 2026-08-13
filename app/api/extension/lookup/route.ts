import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { authenticateExtensionRequest, EXTENSION_CORS_HEADERS } from "@/lib/extensionAuth";
import { defineWord } from "@/lib/defineWord";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: EXTENSION_CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  // Any misconfiguration (e.g. SUPABASE_SERVICE_ROLE_KEY missing on this
  // deployment) throws inside auth/service-client setup — without this catch
  // that's an unhandled crash: a bare 500 with no body and no CORS headers,
  // which reads as "the token is broken" when it's actually the deployment.
  try {
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
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500, headers: EXTENSION_CORS_HEADERS }
    );
  }
}
