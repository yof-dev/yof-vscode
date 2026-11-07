/**
 * What to do after a check (2026-11-07): copy the fix prompt, get a signed report, turn on Patch. Each button only
 * opens a page on yof.io or app.yof.io in the browser: no network call from the extension, no telemetry.
 *
 * Ordering opens when yof's payments are set up. Until then the buttons say "(opens soon)", the same words app.yof.io
 * shows on its order buttons, and the pages they open say the same. ORDERING_OPEN is flipped in the release that
 * follows the launch; the extension never asks a server whether it is open.
 */

export const ORDERING_OPEN = false;
export const SIGNED_REPORT_URL = "https://app.yof.io/yof/orders";
export const PATCH_URL = "https://app.yof.io/yof/patch";
export const SAMPLE_REPORT_URL = "https://yof.io/sample";

export type NextStep = "copyPrompts" | "signedReport" | "patch";

export function nextStepLabel(step: NextStep, open = ORDERING_OPEN): string {
  if (step === "copyPrompts") return "Copy fix prompt";
  const base = step === "signedReport" ? "Get a signed report" : "Turn on Patch";
  return open ? base : `${base} (opens soon)`;
}

export const nextStepUrl = (step: Exclude<NextStep, "copyPrompts">) => (step === "signedReport" ? SIGNED_REPORT_URL : PATCH_URL);

/** The buttons after a check: "Copy fix prompt" only when there is something to fix. */
export function nextSteps(openFindings: number): NextStep[] {
  return openFindings > 0 ? ["copyPrompts", "signedReport", "patch"] : ["signedReport", "patch"];
}

/** Every open finding's fix prompt, numbered, to paste into an AI assistant in one go (masked values only). */
export function combinedPrompt(prompts: readonly string[]): string {
  const list = prompts.map((p) => p.trim()).filter(Boolean);
  if (list.length <= 1) return list[0] ?? "";
  return [`yof found ${list.length} problems. Fix them one by one:`, ...list.map((p, i) => `${i + 1}. ${p}`)].join("\n\n");
}

/** The message after a check that the person started. */
export function nextStepsText(openFindings: number): string {
  return openFindings > 0
    ? `yof: ${openFindings} to fix. Paste the fix prompt into your AI assistant, or get a signed report for your app.`
    : "yof: nothing to fix in this workspace. A signed report covers your live app too.";
}
