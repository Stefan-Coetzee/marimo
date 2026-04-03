/* Copyright 2026 Marimo. All rights reserved. */

/**
 * Reports paste events from CodeMirror cell editors to the parent window
 * via postMessage when running in embed mode inside an iframe.
 *
 * This allows parent applications to detect when users paste content into
 * notebook cells — useful for analytics, activity logging, and integrity
 * checks in embedded notebook workflows.
 *
 * The extension is a no-op when not in embed mode.
 *
 * Message shape:
 *   { type: "marimo:paste", cellId: string, cellName: string,
 *     textLength: number, timestamp: number }
 */

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isEmbedded } from "@/core/vscode/vscode-bindings";
import { isEmbedMode } from "@/core/iframe/embed-config";
import { cellIdState } from "@/core/codemirror/cells/state";
import { store } from "@/core/state/jotai";
import { notebookAtom } from "@/core/cells/cells";

/**
 * CodeMirror extension that posts a message to the parent window whenever
 * the user pastes text into an embedded cell editor.
 */
export function embedPasteReporter(): Extension[] {
  if (!isEmbedded || !isEmbedMode) {
    return [];
  }

  return [
    EditorView.domEventHandlers({
      paste: (event: ClipboardEvent, view: EditorView) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) {
          return false;
        }

        const cellId = String(view.state.facet(cellIdState));

        // Look up cell name from notebook state
        const notebook = store.get(notebookAtom);
        const cell = notebook.cellIds
          .inOrderIds()
          .map((id) => notebook.cellData[id])
          .find((c) => String(c?.id) === cellId);
        const cellName = cell?.name ?? "";

        window.parent.postMessage(
          {
            type: "marimo:paste",
            cellId,
            cellName,
            textLength: text.length,
            timestamp: Date.now(),
          },
          "*",
        );

        // Don't consume the event — let CodeMirror and other handlers
        // (like pasteBundle) process the paste normally.
        return false;
      },
    }),
  ];
}
