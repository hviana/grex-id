import { NextRequest, NextResponse } from "next/server";
import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { publish } from "@/server/event-queue/publisher";

async function postHandler(req: NextRequest, _ctx: RequestContext) {
  try {
    const body = await req.json();
    const { locationId, embeddings } = body;

    if (
      !locationId || !Array.isArray(embeddings) || embeddings.length === 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "validation.grexid.detectFields",
          },
        },
        { status: 400 },
      );
    }

    for (const embedding of embeddings) {
      if (!Array.isArray(embedding) || embedding.length !== 1024) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              message: "validation.embedding.dimensions",
            },
          },
          { status: 400 },
        );
      }
    }

    const eventId = await publish("GREXID_DETECTION", {
      locationId,
      embeddings,
    });

    return NextResponse.json({
      success: true,
      data: {
        eventId,
      },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL",
          message: "common.error.generic",
        },
      },
      { status: 500 },
    );
  }
}

export const POST = compose(
  withRateLimit({ windowMs: 60000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true, permissions: ["grexid.detect"] }),
  async (req, _ctx) => postHandler(req as NextRequest, _ctx),
);
