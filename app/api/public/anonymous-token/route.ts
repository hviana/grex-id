import { get } from "@/server/utils/cache";

export async function GET(): Promise<Response> {
  try {
    const jwt = await get(undefined, "anonymous-jwt") as string;
    return Response.json({ success: true, data: { token: jwt } });
  } catch (err) {
    console.error("[anonymous-token] error:", err);
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}
