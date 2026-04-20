import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { publicLeadPostHandler } from "@/app/api/leads/public/route";
import {
  searchOrphanFaceByEmbedding,
  linkOrphanFaceToLead,
  tryUpsertFace,
} from "@/server/db/queries/systems/grex-id/faces";
import { getAnonymousTenant } from "@/server/utils/tenant";

const DEFAULT_SENSITIVITY = 0.5;

async function postHandler(req: Request, ctx: RequestContext) {
  try {
    const body = await req.json();
    const { faceDescriptor } = body;

    // Delegate lead creation / verification to core handler
    const coreReq = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(body),
    });
    const coreCtx: RequestContext = {
      tenant: getAnonymousTenant("grex-id"),
    };
    const coreRes = await publicLeadPostHandler(coreReq, coreCtx);
    const coreJson = await coreRes.json();

    // If core failed or requires verification, return as-is
    if (!coreJson.success || coreJson.data?.requiresVerification) {
      return Response.json(coreJson, { status: coreRes.status });
    }

    // Handle face biometrics for new leads
    const leadId = coreJson.data?.id;
    if (leadId && faceDescriptor && Array.isArray(faceDescriptor)) {
      try {
        const orphanMatch = await searchOrphanFaceByEmbedding(
          faceDescriptor,
          DEFAULT_SENSITIVITY,
        );
        if (orphanMatch.length > 0) {
          await linkOrphanFaceToLead(orphanMatch[0].id, leadId);
        } else {
          await tryUpsertFace({
            leadId,
            embedding_type1: faceDescriptor,
          }, {
            route: "systems/grex-id/leads/public:POST",
          });
        }
      } catch {
        await tryUpsertFace({
          leadId,
          embedding_type1: faceDescriptor,
        }, {
          route: "systems/grex-id/leads/public:POST",
        });
      }
    }

    return Response.json(coreJson, { status: coreRes.status });
  } catch (err) {
    console.error("grex-id leads/public error:", err);
    return Response.json(
      {
        success: false,
        error: { code: "INTERNAL", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 10 }),
  async (req, ctx) => postHandler(req, ctx),
);
