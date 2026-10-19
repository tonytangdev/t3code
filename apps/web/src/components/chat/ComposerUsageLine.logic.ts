import type {
  ContextTokenDisplay,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/usageLimits";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "../../lib/contextWindow";

const MINUTE = 60_000;

export type ComposerUsageTone = "muted" | "warning" | "error";

/**
 * One block of the usage line. `value` is the number the eye lands on, `label`
 * the quieter word beside it (`87k` / `ctx`, `5h` / `74%`, `resets in` / `19m`).
 */
export interface ComposerUsageSegment {
  readonly id: "context" | "session" | "reset";
  readonly label: string;
  readonly value: string;
  readonly tone: ComposerUsageTone;
  /** Fill for the hairline bar under the segment, 0..100; null when unknown. */
  readonly percent: number | null;
}

/** The provider's rolling session window (Claude `five_hour`, Codex `primary`), if it reports one. */
export function selectSessionWindow(
  limits: ServerProviderUsageLimits | null | undefined,
): ServerProviderUsageWindow | null {
  if (!limits || limits.unavailable) return null;
  return limits.windows.find((window) => window.kind === "session") ?? null;
}

/** `5h` for whole-hour windows; the provider's label is too long for the footer. */
export function formatSessionWindowLabel(window: ServerProviderUsageWindow): string {
  const minutes = window.windowDurationMins;
  if (minutes !== undefined && minutes > 0 && minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  return "session";
}

export function usageTone(usedPercent: number): ComposerUsageTone {
  if (usedPercent >= 95) return "error";
  if (usedPercent >= 80) return "warning";
  return "muted";
}

/** The context value in the chosen display; falls back to used tokens when the max is unknown. */
export function formatContextValue(
  contextWindow: ContextWindowSnapshot,
  display: ContextTokenDisplay,
): string {
  const used = formatContextWindowTokens(contextWindow.usedTokens ?? null);
  const maxTokens = contextWindow.maxTokens ?? null;
  if (display === "used-of-max" && maxTokens !== null) {
    return `${used} / ${formatContextWindowTokens(maxTokens)}`;
  }
  if (display === "percent" && contextWindow.usedPercentage !== null) {
    return `${Math.round(contextWindow.usedPercentage)}%`;
  }
  return used;
}

/**
 * Segments for the composer footer's usage line. `contextDisplay: null` hides
 * the context segment. An expired window reads as empty until the next probe
 * replaces it. Compact mode is presentational: the strip's overflow measurement
 * assumes the needed width does not depend on whether it is already compact,
 * so the component always mounts every segment and collapses the extras with CSS.
 */
export function buildComposerUsageLine(input: {
  readonly contextWindow: ContextWindowSnapshot | null;
  readonly contextDisplay: ContextTokenDisplay | null;
  readonly limits: ServerProviderUsageLimits | null | undefined;
  readonly now: number;
}): ReadonlyArray<ComposerUsageSegment> {
  const segments: ComposerUsageSegment[] = [];

  if (input.contextWindow && input.contextDisplay) {
    const usedPercentage = input.contextWindow.usedPercentage ?? null;
    segments.push({
      id: "context",
      label: "ctx",
      value: formatContextValue(input.contextWindow, input.contextDisplay),
      tone: "muted",
      percent: usedPercentage === null ? null : Math.round(usedPercentage),
    });
  }

  const session = selectSessionWindow(input.limits);
  if (!session) return segments;

  const resetsAt = session.resetsAt === undefined ? null : Date.parse(session.resetsAt);
  const untilReset = resetsAt !== null && Number.isFinite(resetsAt) ? resetsAt - input.now : null;
  const expired = untilReset !== null && untilReset <= 0;
  const usedPercent = expired ? 0 : session.usedPercent;
  segments.push({
    id: "session",
    label: formatSessionWindowLabel(session),
    value: `${Math.round(usedPercent)}%`,
    tone: usageTone(usedPercent),
    percent: Math.round(usedPercent),
  });

  if (untilReset !== null && !expired) {
    segments.push({
      id: "reset",
      ...(untilReset < MINUTE
        ? { label: "", value: "resetting…" }
        : { label: "resets in", value: formatDuration(untilReset) }),
      tone: "muted",
      percent: null,
    });
  }

  return segments;
}
