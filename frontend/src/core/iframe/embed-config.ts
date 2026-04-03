/* Copyright 2026 Marimo. All rights reserved. */

/**
 * Embed mode configuration.
 *
 * When marimo runs in an iframe with ?embed=true, certain panels are hidden
 * by default to provide a cleaner UI for learners/end-users.
 *
 * This module is imported at module-init time (before React renders) so
 * panel visibility is applied before the sidebar first renders.
 */

const params =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();

/** Whether marimo is running in embed mode (?embed=true) */
export const isEmbedMode = params.has("embed");

/**
 * Panels hidden by default in embed mode.
 * The parent application typically provides its own chat/AI.
 */
const DEFAULT_HIDDEN_PANELS: ReadonlySet<string> = new Set([
  "ai",
  "secrets",
  "logs",
  "tracing",
  "snippets",
  "cache",
]);

/**
 * If ?panels=files,variables,outline is specified, only those panels are shown.
 * Otherwise, DEFAULT_HIDDEN_PANELS are hidden.
 */
const explicitPanels = params.get("panels");
const allowedPanels: ReadonlySet<string> | null = explicitPanels
  ? new Set(explicitPanels.split(",").map((s) => s.trim()))
  : null;

/**
 * Check if a panel should be hidden in embed mode.
 * Called from the PANELS definition in types.ts at module init time.
 */
export function isHiddenInEmbedMode(panelType: string): boolean {
  if (!isEmbedMode) {
    return false;
  }
  if (allowedPanels) {
    // Explicit allowlist: hide everything not listed
    return !allowedPanels.has(panelType);
  }
  // Default: hide the panels that don't belong in a learning environment
  return DEFAULT_HIDDEN_PANELS.has(panelType);
}
