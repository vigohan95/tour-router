/** Next.js server start hook: with QLOO_WARM=1 and a live key, pre-warm the suggestion acts in the background. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.QLOO_WARM !== "1" || !process.env.QLOO_API_KEY) return;
  const { warmCache } = await import("./lib/warm");
  void warmCache().then((r) => console.log(`[warm] ${r.warmed.length} acts warmed${r.errors.length ? `; errors: ${r.errors.join(" | ")}` : ""}`));
}
