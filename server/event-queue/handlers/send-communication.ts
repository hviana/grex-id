import "server-only";

import { get } from "../../utils/instrumentation-cache.ts";
import { publish } from "../publisher.ts";
import { channelHandlerName, hasChannel } from "../../module-registry.ts";

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
  let channels = Array.isArray(payload.channels)
    ? (payload.channels as unknown[]).filter(
      (c): c is string => typeof c === "string",
    )
    : [];

  if (channels.length === 0) {
    const raw = await get(
      undefined,
      "setting.auth.communication.defaultChannels",
    );
    if (raw) {
      try {
        const parsed = JSON.parse(raw as string);
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
