import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await params;

  // OAuth redirect to provider
  // Implementation depends on configured providers (Google, GitHub, etc.)
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: `OAuth provider "${provider}" is not yet configured`,
      },
    },
    { status: 501 },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await params;

  // OAuth callback handler
  // Verifies OAuth token, creates/links user, issues system + SurrealDB tokens
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: `OAuth callback for "${provider}" is not yet configured`,
      },
    },
    { status: 501 },
  );
}
