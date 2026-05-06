import "server-only";

// Live query definition for real-time messages
// Used by the frontend via useLiveQuery hook
export const LIVE_MESSAGES_QUERY =
  `LIVE SELECT * FROM message WHERE recipientId = $auth.id ORDER BY createdAt DESC`;
