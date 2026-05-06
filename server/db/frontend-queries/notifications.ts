import "server-only";

// Live query definition for real-time notifications
// Used by the frontend via useLiveQuery hook
export const LIVE_NOTIFICATIONS_QUERY =
  `LIVE SELECT * FROM notification WHERE userId = $auth.id ORDER BY createdAt DESC`;
