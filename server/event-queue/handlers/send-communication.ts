import Core from "../../utils/Core.ts";
import { publish } from "../publisher.ts";
import { channelHandlerName, hasChannel } from "../../module-registry.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("send-communication");

/**
 * Channel-agnostic communication dispatcher.
 *
 * Resolves the ordered list of target channels, picks the first one that has
 * a registered handler, and publishes `send_<channel>`. Remaining channels
 * become `channelFallback`; per-channel handlers cascade to the next on
 * recoverable failures.
 */
export async function dispatchCommunication(
  payload: Record<string, unknown>,
): Promise<void> {
  const core = Core.getInstance();

  let channels = Array.isArray(payload.channels)
    ? (payload.channels as unknown[]).filter(
      (c): c is string => typeof c === "string",
    )
    : [];

  if (channels.length === 0) {
    const raw = await core.getSetting("auth.communication.defaultChannels");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          channels = parsed.filter(
            (c): c is string => typeof c === "string",
          );
        }
      } catch {
        // ignore; fall through to empty → nothing published
      }
    }
  }

  const pickedIndex = channels.findIndex((c) => hasChannel(c));
  if (pickedIndex === -1) {
    console.warn(
      "[dispatchCommunication] no registered channel in the chain; dropping",
    );
    return;
  }

  const picked = channels[pickedIndex];
  const fallback = channels
    .slice(pickedIndex + 1)
    .filter((c) => hasChannel(c));

  await publish(channelHandlerName(picked), {
    ...payload,
    channel: picked,
    channelFallback: fallback,
  });
}
