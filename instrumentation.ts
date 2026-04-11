export async function register() {
  console.log("[instrumentation] register() called");
  try {
    const { startAllJobs } = await import("@/server/jobs/index");
    await startAllJobs();
  } catch (err) {
    console.error("[instrumentation] Failed to start jobs:", err);
  }
}
