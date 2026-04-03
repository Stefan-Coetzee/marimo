/* Copyright 2026 Marimo. All rights reserved. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("@/utils/Logger", () => ({
  Logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/core/state/jotai", () => ({
  store: { get: vi.fn() },
}));

vi.mock("@/core/cells/cells", () => ({
  notebookAtom: Symbol("notebookAtom"),
  flattenTopLevelNotebookCells: vi.fn(),
}));

vi.mock("@/core/vscode/vscode-bindings", () => ({
  isEmbedded: true,
}));

import { maybeRegisterIframeMessenger } from "../iframe-messenger";
import { store } from "@/core/state/jotai";
import { flattenTopLevelNotebookCells } from "@/core/cells/cells";

describe("iframe-messenger", () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const originalLocation = window.location;

  beforeEach(() => {
    postMessageSpy = vi.fn();

    // Simulate being in an iframe: window.parent !== window
    Object.defineProperty(window, "parent", {
      value: { postMessage: postMessageSpy },
      writable: true,
      configurable: true,
    });

    // Capture the message handler registered by maybeRegisterIframeMessenger
    addEventListenerSpy = vi.spyOn(window, "addEventListener");
    addEventListenerSpy.mockImplementation((type: string, handler: unknown) => {
      if (type === "message") {
        messageHandler = handler as (event: MessageEvent) => void;
      }
    });

    // Set ?embed query param
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, search: "?embed=true" },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    messageHandler = undefined;
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it("sends marimo:ready on registration", () => {
    maybeRegisterIframeMessenger();
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: "marimo:ready" },
      "*",
    );
  });

  it("registers a message event listener", () => {
    maybeRegisterIframeMessenger();
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
  });

  it("responds to marimo:get-state with serialized cells", () => {
    const mockCells = [
      {
        id: "cell-1",
        name: "setup",
        code: "import pandas as pd",
        status: "idle",
        edited: false,
        runElapsedTimeMs: 42,
        output: {
          mimetype: "text/plain",
          data: "done",
          channel: "output",
        },
        consoleOutputs: [
          { mimetype: "text/plain", data: "hello\n", channel: "stdout" },
        ],
      },
    ];

    vi.mocked(store.get).mockReturnValue({} as never);
    vi.mocked(flattenTopLevelNotebookCells).mockReturnValue(mockCells as never);

    maybeRegisterIframeMessenger();
    expect(messageHandler).toBeDefined();

    // Simulate parent sending get-state
    messageHandler!(
      new MessageEvent("message", {
        data: { type: "marimo:get-state", requestId: "req-1" },
      }),
    );

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: "marimo:state",
        requestId: "req-1",
        cells: [
          {
            id: "cell-1",
            name: "setup",
            code: "import pandas as pd",
            status: "idle",
            edited: false,
            runElapsedTimeMs: 42,
            output: {
              mimetype: "text/plain",
              data: "done",
              channel: "output",
            },
            consoleOutputs: [
              { mimetype: "text/plain", data: "hello\n", channel: "stdout" },
            ],
          },
        ],
      },
      "*",
    );
  });

  it("handles cells with null output", () => {
    const mockCells = [
      {
        id: "cell-2",
        name: "empty",
        code: "x = 1",
        status: "idle",
        edited: true,
        runElapsedTimeMs: null,
        output: null,
        consoleOutputs: [],
      },
    ];

    vi.mocked(store.get).mockReturnValue({} as never);
    vi.mocked(flattenTopLevelNotebookCells).mockReturnValue(mockCells as never);

    maybeRegisterIframeMessenger();

    messageHandler!(
      new MessageEvent("message", {
        data: { type: "marimo:get-state" },
      }),
    );

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "marimo:state",
        cells: [
          expect.objectContaining({
            id: "cell-2",
            output: null,
            consoleOutputs: [],
          }),
        ],
      }),
      "*",
    );
  });

  it("ignores unknown message types", () => {
    maybeRegisterIframeMessenger();
    const callCount = postMessageSpy.mock.calls.length; // after ready message

    messageHandler!(
      new MessageEvent("message", {
        data: { type: "some-other-message" },
      }),
    );

    // No additional postMessage calls
    expect(postMessageSpy.mock.calls.length).toBe(callCount);
  });

  it("ignores messages without a type", () => {
    maybeRegisterIframeMessenger();
    const callCount = postMessageSpy.mock.calls.length;

    messageHandler!(
      new MessageEvent("message", {
        data: { foo: "bar" },
      }),
    );

    expect(postMessageSpy.mock.calls.length).toBe(callCount);
  });
});
