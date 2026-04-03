/* Copyright 2026 Marimo. All rights reserved. */

/**
 * Iframe postMessage bridge for embedding marimo in external applications.
 *
 * When marimo runs inside an iframe (e.g., embedded in an LMS, IDE, or
 * custom application), the parent window can request notebook state and
 * subscribe to updates via the standard postMessage API.
 *
 * This module is the marimo-side handler. The parent window sends typed
 * messages and receives typed responses.
 *
 * ## Supported messages (parent -> marimo):
 *
 *   { type: "marimo:get-state", requestId?: string }
 *     Returns the current state of all cells (code, output, status).
 *
 *   { type: "marimo:read-code", requestId?: string }
 *     Returns the full notebook serialized as a Python file.
 *
 * ## Responses (marimo -> parent):
 *
 *   { type: "marimo:state", requestId?, cells: MarimoIframeCell[] }
 *   { type: "marimo:code", requestId?, contents: string }
 *   { type: "marimo:ready" }
 *
 * ## Pushed messages (marimo -> parent, continuous):
 *
 *   { type: "marimo:paste", cellId, cellName, textLength, timestamp }
 *     Emitted when the user pastes text into a cell editor in embed mode.
 *     See paste-reporter.ts for implementation.
 *
 * ## Activation:
 *
 * The messenger activates when the `embed` query parameter is present
 * and the page is running inside an iframe (window.parent !== window).
 *
 * @see https://github.com/marimo-team/marimo/issues/8139
 */

import { Logger } from "@/utils/Logger";
import { store } from "@/core/state/jotai";
import {
  flattenTopLevelNotebookCells,
  notebookAtom,
} from "@/core/cells/cells";
import { isEmbedded } from "@/core/vscode/vscode-bindings";
import { isEmbedMode } from "@/core/iframe/embed-config";

/**
 * Shape of a cell in the iframe response. Kept minimal and JSON-safe.
 */
export interface MarimoIframeCell {
  /** Internal cell ID */
  id: string;
  /** User-given cell name (or default) */
  name: string;
  /** Current cell source code */
  code: string;
  /** Runtime status: "idle", "running", "queued", "disabled-transitively", or null if unknown */
  status: string | null;
  /** Whether the cell has been edited since last run */
  edited: boolean;
  /** Last execution time in milliseconds, if available */
  runElapsedTimeMs: number | null;
  /** Cell output as a MIME bundle, or null if no output */
  output: {
    mimetype: string;
    data: unknown;
    channel?: string;
  } | null;
  /** Console outputs (stdout/stderr) as MIME bundles */
  consoleOutputs: Array<{
    mimetype: string;
    data: unknown;
    channel?: string;
  }>;
}

/**
 * Register the iframe postMessage listener.
 *
 * Call this during app initialization (alongside maybeRegisterVSCodeBindings).
 * It is a no-op if the page is not embedded in an iframe or if the `embed`
 * query parameter is not present.
 *
 * Panel visibility is handled separately by embed-config.ts, which is
 * imported at module-init time by types.ts (before React renders).
 */
export function maybeRegisterIframeMessenger(): void {
  if (!isEmbedded) {
    return;
  }

  if (!isEmbedMode) {
    return;
  }

  Logger.log("[iframe-messenger] Registering postMessage bridge");

  window.addEventListener("message", handleMessage);

  // Notify the parent that marimo is ready to receive messages.
  window.parent.postMessage({ type: "marimo:ready" }, "*");
}

function handleMessage(event: MessageEvent): void {
  const msg = event.data;
  if (!msg || typeof msg.type !== "string") {
    return;
  }

  switch (msg.type) {
    case "marimo:get-state": {
      const notebook = store.get(notebookAtom);
      const cells = flattenTopLevelNotebookCells(notebook);

      const serialized: MarimoIframeCell[] = cells.map((cell) => ({
        id: String(cell.id),
        name: cell.name,
        code: cell.code,
        status: cell.status ?? null,
        edited: cell.edited,
        runElapsedTimeMs: cell.runElapsedTimeMs,
        output: cell.output
          ? {
              mimetype: cell.output.mimetype,
              data: cell.output.data,
              channel: cell.output.channel,
            }
          : null,
        consoleOutputs: (cell.consoleOutputs ?? []).map((co) => ({
          mimetype: co.mimetype,
          data: co.data,
          channel: co.channel,
        })),
      }));

      window.parent.postMessage(
        {
          type: "marimo:state",
          requestId: msg.requestId,
          cells: serialized,
        },
        "*",
      );
      break;
    }

    case "marimo:read-code": {
      // Reading the notebook as a .py file requires the bridge, which may
      // not be available in all modes. Fail gracefully.
      const bridge = (
        window as Record<string, unknown>
      )._marimo_private_PyodideBridge;
      if (bridge && typeof (bridge as Record<string, unknown>).readCode === "function") {
        (bridge as { readCode: () => Promise<{ contents: string }> })
          .readCode()
          .then((result) => {
            window.parent.postMessage(
              {
                type: "marimo:code",
                requestId: msg.requestId,
                contents: result.contents,
              },
              "*",
            );
          })
          .catch((error: unknown) => {
            Logger.error("[iframe-messenger] readCode failed", error);
          });
      }
      break;
    }

    default:
      // Ignore unknown message types — other listeners may handle them.
      break;
  }
}
