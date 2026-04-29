import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { publish } from "@/server/event-queue/publisher";

async function postHandler(req: Request, _ctx: RequestContext) {
  try {
    const body = await req.json();
    const { locationId, embeddings } = body;

    if (
      !locationId || !Array.isArray(embeddings) || embeddings.length === 0
    ) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["validation.grexid.detectFields"],
          },
        },
        { status: 400 },
      );
    }

    for (const embedding of embeddings) {
      if (!Array.isArray(embedding) || embedding.length !== 1024) {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              errors: ["validation.embedding.dimensions"],
            },
          },
          { status: 400 },
        );
      }
    }

    const eventId = await publish("grexid_process_detection", {
      locationId,
      embeddings,
    });

    return Response.json({
      success: true,
      data: {
        eventId,
      },
    });
  } catch {
    return Response.json(
      {
        success: false,
        error: {
          code: "ERROR",
          message: "common.error.generic",
        },
      },
      { status: 500 },
    );
  }
}

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    roles: ["grexid.detect", "admin"],
  }),
  async (req, ctx) => postHandler(req, ctx),
);
