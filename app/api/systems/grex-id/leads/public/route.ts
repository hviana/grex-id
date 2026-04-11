import { NextRequest, NextResponse } from "next/server";
import { POST as corePublicLeadPost } from "@/app/api/leads/public/route";
import { tryUpsertFace } from "@/server/db/queries/systems/grex-id/faces";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { faceDescriptor } = body;

    // Delegate lead creation / verification to core
    const coreReq = new NextRequest(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(body),
    });
    const coreRes = await corePublicLeadPost(coreReq);
    const coreJson = await coreRes.json();

    // If core failed or requires verification, return as-is
    if (!coreJson.success || coreJson.data?.requiresVerification) {
      return NextResponse.json(coreJson, { status: coreRes.status });
    }

    // Handle face biometrics for new leads
    const leadId = coreJson.data?.id;
    if (leadId && faceDescriptor && Array.isArray(faceDescriptor)) {
      await tryUpsertFace({
        leadId,
        embedding_type1: faceDescriptor,
      }, {
        route: "systems/grex-id/leads/public:POST",
      });
    }

    return NextResponse.json(coreJson, { status: coreRes.status });
  } catch (err) {
    console.error("grex-id leads/public error:", err);
    return NextResponse.json(
      {
        success: false,
        error: { code: "INTERNAL", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}
