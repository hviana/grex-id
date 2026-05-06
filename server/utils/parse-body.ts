import "server-only";

/**
 * Wraps `req.json()` in try/catch so malformed or empty JSON bodies produce a
 * 400 validation error instead of an unhandled SyntaxError (500).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseBody(
  req: Request,
): Promise<{ body: Record<string, any>; error: Response | null }> {
  try {
    return { body: await req.json(), error: null };
  } catch {
    return {
      body: {},
      error: Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["validation.json.invalid"],
          },
        },
        { status: 400 },
      ),
    };
  }
}
