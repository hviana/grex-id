import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { publicLeadPostHandler } from "@/app/api/leads/public/route";
import {
  linkOrphanFaceToLead,
  searchOrphanFaceByEmbedding,
  tryUpsertFace,
} from "@/server/db/queries/systems/grex-id/faces";
import { getSetting } from "@/server/db/queries/systems/grex-id/settings";

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
    const coreRes = await publicLeadPostHandler(coreReq, ctx);
    const coreJson = await coreRes.json();

    // If core failed, return as-is
    if (!coreJson.success) {
      return Response.json(coreJson, { status: coreRes.status });
    }

    // Handle face biometrics for new leads (process even when verification
    // is pending — the lead already exists in the database).
    const leadId = coreJson.data?.id;
    const companyId = coreJson.data?.companyId;
    const systemId = coreJson.data?.systemId;

    if (
      leadId && faceDescriptor && Array.isArray(faceDescriptor) &&
      typeof companyId === "string" && typeof systemId === "string"
    ) {
      const tenantId = ctx.tenant.id;
      const sensitivity = parseFloat(
        await getSetting(tenantId, "detection.sensitivity"),
      );
      try {
        const orphanMatch = await searchOrphanFaceByEmbedding(
          faceDescriptor,
          sensitivity,
        );
        if (orphanMatch.length > 0) {
          await linkOrphanFaceToLead(orphanMatch[0].id, leadId);
        } else {
          await tryUpsertFace({
            leadId,
            embedding_type1: faceDescriptor,
          }, {
            route: "systems/grex-id/leads/public:POST",
            tenantId,
          });
        }
      } catch {
        await tryUpsertFace({
          leadId,
          embedding_type1: faceDescriptor,
        }, {
          route: "systems/grex-id/leads/public:POST",
          tenantId,
        });
      }
    }

    return Response.json(coreJson, { status: coreRes.status });
  } catch (err) {
    console.error("grex-id leads/public error:", err);
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

export const POST = compose(
  withAuth(),
  withRateLimit({ windowMs: 60_000, maxRequests: 10 }),
  async (req, ctx) => postHandler(req, ctx),
);
