import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import {
  buildComposerUsageLine,
  formatContextValue,
  formatSessionWindowLabel,
  selectSessionWindow,
  usageTone,
} from "./ComposerUsageLine.logic";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const MINUTE = 60_000;

function contextWindow(overrides: Partial<ContextWindowSnapshot> = {}): ContextWindowSnapshot {
  return {
    usedTokens: 62_000,
    totalProcessedTokens: null,
    maxTokens: 200_000,
    remainingTokens: 138_000,
    usedPercentage: 31,
    remainingPercentage: 69,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    lastUsedTokens: null,
    lastInputTokens: null,
    lastCachedInputTokens: null,
    lastOutputTokens: null,
    lastReasoningOutputTokens: null,
    toolUses: null,
    durationMs: null,
    compactsAutomatically: false,
    autoCompactThreshold: null,
    updatedAt: "2026-09-17T11:59:00.000Z",
    ...overrides,
  };
}

function sessionWindow(
  overrides: Partial<ServerProviderUsageWindow> = {},
): ServerProviderUsageWindow {
  return {
    id: "five_hour",
    kind: "session",
    label: "Current session",
    usedPercent: 42,
    resetsAt: new Date(NOW + 80 * MINUTE).toISOString(),
    windowDurationMins: 300,
    ...overrides,
  };
}

function limits(windows: ReadonlyArray<ServerProviderUsageWindow>): ServerProviderUsageLimits {
  return { checkedAt: "2026-09-17T11:58:00.000Z", windows };
}

describe("selectSessionWindow", () => {
  it("picks the session window and ignores the others", () => {
    const weekly = sessionWindow({ id: "seven_day", kind: "weekly", usedPercent: 10 });
    const session = sessionWindow();
    expect(selectSessionWindow(limits([weekly, session]))).toBe(session);
  });

  it("returns null without limits, when unavailable, or without a session window", () => {
    expect(selectSessionWindow(null)).toBeNull();
    expect(selectSessionWindow(undefined)).toBeNull();
    expect(
      selectSessionWindow({ ...limits([sessionWindow()]), unavailable: { reason: "unsupported" } }),
    ).toBeNull();
    expect(selectSessionWindow(limits([sessionWindow({ kind: "weekly" })]))).toBeNull();
  });
});

describe("formatSessionWindowLabel", () => {
  it("shortens whole-hour windows and falls back otherwise", () => {
    expect(formatSessionWindowLabel(sessionWindow({ windowDurationMins: 300 }))).toBe("5h");
    expect(formatSessionWindowLabel(sessionWindow({ windowDurationMins: 60 }))).toBe("1h");
    expect(formatSessionWindowLabel(sessionWindow({ windowDurationMins: 90 }))).toBe("session");
    expect(formatSessionWindowLabel(sessionWindow({ windowDurationMins: undefined }))).toBe(
      "session",
    );
  });
});

describe("usageTone", () => {
  it("warns at 80 and errors at 95", () => {
    expect(usageTone(79.9)).toBe("muted");
    expect(usageTone(80)).toBe("warning");
    expect(usageTone(94.9)).toBe("warning");
    expect(usageTone(95)).toBe("error");
  });
});

describe("formatContextValue", () => {
  it("renders each display mode", () => {
    expect(formatContextValue(contextWindow(), "used")).toBe("62k");
    expect(formatContextValue(contextWindow(), "used-of-max")).toBe("62k / 200k");
    expect(formatContextValue(contextWindow(), "percent")).toBe("31%");
  });

  it("falls back to used tokens when the model's maximum is unknown", () => {
    const unknownMax = contextWindow({ maxTokens: null, usedPercentage: null });
    expect(formatContextValue(unknownMax, "used-of-max")).toBe("62k");
    expect(formatContextValue(unknownMax, "percent")).toBe("62k");
    expect(
      buildComposerUsageLine({
        contextWindow: unknownMax,
        contextDisplay: "used",
        limits: null,
        now: NOW,
      })[0]?.percent,
    ).toBeNull();
  });
});

describe("buildComposerUsageLine", () => {
  it("joins context, session and reset segments", () => {
    expect(
      buildComposerUsageLine({
        contextWindow: contextWindow(),
        contextDisplay: "used",
        limits: limits([sessionWindow()]),
        now: NOW,
      }),
    ).toEqual([
      { id: "context", label: "ctx", value: "62k", tone: "muted", percent: 31 },
      { id: "session", label: "5h", value: "42%", tone: "muted", percent: 42 },
      { id: "reset", label: "resets in", value: "1h 20m", tone: "muted", percent: null },
    ]);
  });

  it("omits the context segment when the display is off or no snapshot exists", () => {
    const line = buildComposerUsageLine({
      contextWindow: contextWindow(),
      contextDisplay: null,
      limits: limits([sessionWindow()]),
      now: NOW,
    });
    expect(line.map((segment) => segment.id)).toEqual(["session", "reset"]);
    expect(
      buildComposerUsageLine({
        contextWindow: null,
        contextDisplay: "used",
        limits: limits([]),
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("colours the session by remaining headroom", () => {
    const at = (usedPercent: number) =>
      buildComposerUsageLine({
        contextWindow: null,
        contextDisplay: null,
        limits: limits([sessionWindow({ usedPercent })]),
        now: NOW,
      })[0]?.tone;
    expect(at(42)).toBe("muted");
    expect(at(80)).toBe("warning");
    expect(at(95)).toBe("error");
  });

  it("says resetting… inside the last minute", () => {
    const line = buildComposerUsageLine({
      contextWindow: null,
      contextDisplay: null,
      limits: limits([sessionWindow({ resetsAt: new Date(NOW + 30_000).toISOString() })]),
      now: NOW,
    });
    expect(line.map((segment) => segment.value)).toEqual(["42%", "resetting…"]);
    expect(line[1]?.label).toBe("");
  });

  it("shows an expired window as empty and drops the reset until fresh data lands", () => {
    const line = buildComposerUsageLine({
      contextWindow: null,
      contextDisplay: null,
      limits: limits([sessionWindow({ resetsAt: new Date(NOW - MINUTE).toISOString() })]),
      now: NOW,
    });
    expect(line).toEqual([{ id: "session", label: "5h", value: "0%", tone: "muted", percent: 0 }]);
  });

  it("omits the reset when the window has no reset time", () => {
    const line = buildComposerUsageLine({
      contextWindow: null,
      contextDisplay: null,
      limits: limits([sessionWindow({ resetsAt: undefined })]),
      now: NOW,
    });
    expect(line.map((segment) => segment.id)).toEqual(["session"]);
  });

  it("renders nothing while limits are unavailable and context is hidden", () => {
    expect(
      buildComposerUsageLine({
        contextWindow: contextWindow(),
        contextDisplay: null,
        limits: { ...limits([sessionWindow()]), unavailable: { reason: "probeFailed" } },
        now: NOW,
      }),
    ).toEqual([]);
  });
});
