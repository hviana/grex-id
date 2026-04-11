import { NextRequest, NextResponse } from "next/server";
import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getLocationById } from "@/server/db/queries/locations";
import { publish } from "@/server/event-queue/publisher";

const pipeline = compose(
  withRateLimit({ windowMs: 60000, maxRequests: 60 }),
  withAuth({ permissions: ["grexid.detect"] }),
);

export async function POST(req: NextRequest) {
  const ctx: RequestContext = {
    userId: "",
    companyId: "",
    systemId: "",
    roles: [],
    permissions: [],
  };

  return pipeline(req, ctx, async () => {
    try {
      const body = await req.json();
      const { locationId, embedding } = body;

      if (!locationId || !embedding || !Array.isArray(embedding)) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              message: "locationId and embedding (array) are required",
            },
          },
          { status: 400 },
        );
      }

      if (embedding.length !== 1024) {
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

      const location = await getLocationById(locationId);
      if (!location) {
        return NextResponse.json(
          {
            success: false,
            error: { code: "NOT_FOUND", message: "common.error.notFound" },
          },
          { status: 404 },
        );
      }

      const eventId = await publish("GREXID_DETECTION", {
        locationId,
        embedding,
        companyId: location.companyId,
        systemId: location.systemId,
      });

      return NextResponse.json({
        success: true,
        data: {
          eventId,
        },
      });
    } catch (err) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INTERNAL",
            message: err instanceof Error ? err.message : "Detection failed",
          },
        },
        { status: 500 },
      );
    }
  });
}
