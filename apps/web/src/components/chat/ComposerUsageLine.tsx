import type {
  ContextTokenDisplay,
  EnvironmentId,
  ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import { memo, type ReactNode, useEffect, useMemo } from "react";
import { cn } from "../../lib/utils";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import { useNowMinute } from "../../hooks/useNowMinute";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildComposerUsageLine, type ComposerUsageTone } from "./ComposerUsageLine.logic";

const TONE_TEXT: Record<ComposerUsageTone, string> = {
  muted: "text-foreground/80",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

const TONE_FILL: Record<ComposerUsageTone, string> = {
  muted: "bg-muted-foreground/60",
  warning: "bg-amber-600 dark:bg-amber-400",
  error: "bg-destructive",
};

/**
 * `87k ctx` and `5h 74% · resets in 19m` in the strip below the composer, each over a
 * hairline bar filled to its percentage so the headroom reads without
 * parsing digits. Always on, no popover; the bars are static and the shared
 * minute clock keeps the countdown honest. Limits refresh on mount and window
 * focus through the client-runtime throttle so a thread open all day does not
 * hammer the provider.
 */
export interface ComposerUsageLineProps {
  environmentId: EnvironmentId;
  contextWindow: ContextWindowSnapshot | null;
  contextDisplay: ContextTokenDisplay | null;
  limits: ServerProviderUsageLimits | null | undefined;
  compact: boolean;
  className?: string;
}

export const ComposerUsageLine = memo(function ComposerUsageLine(props: ComposerUsageLineProps) {
  const { environmentId, contextWindow, contextDisplay, limits, compact, className } = props;
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  useEffect(() => {
    const refresh = () => {
      void refreshUsageLimits(
        environmentId,
        () => refreshProviders({ environmentId, input: {} }),
        true,
      );
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [environmentId, refreshProviders]);

  const nowMinute = useNowMinute();
  const segments = useMemo(
    () =>
      buildComposerUsageLine({
        contextWindow,
        contextDisplay,
        limits,
        now: Date.parse(`${nowMinute}:00.000Z`),
        compact,
      }),
    [compact, contextDisplay, contextWindow, limits, nowMinute],
  );
  const context = segments.find((segment) => segment.id === "context");
  const session = segments.find((segment) => segment.id === "session");
  const reset = segments.find((segment) => segment.id === "reset");
  if (!context && !session) return null;

  return (
    <div
      data-chat-composer-usage-line="true"
      className={cn(
        "flex shrink-0 items-center gap-3 px-1.5 text-[11px] leading-none tabular-nums",
        className,
      )}
    >
      {context ? (
        <UsageBlock percent={context.percent} tone={context.tone}>
          <span className={TONE_TEXT[context.tone]}>{context.value}</span>
          <span className="text-muted-foreground/70">{context.label}</span>
        </UsageBlock>
      ) : null}
      {session ? (
        <UsageBlock percent={session.percent} tone={session.tone}>
          <span className="text-muted-foreground/70">{session.label}</span>
          <span className={TONE_TEXT[session.tone]}>{session.value}</span>
          {reset ? (
            <span className="text-muted-foreground/55">
              <span aria-hidden="true">· </span>
              {reset.label ? `${reset.label} ` : ""}
              {reset.value}
            </span>
          ) : null}
        </UsageBlock>
      ) : null}
    </div>
  );
});

function UsageBlock(props: {
  percent: number | null;
  tone: ComposerUsageTone;
  children: ReactNode;
}) {
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1 whitespace-nowrap">{props.children}</span>
      {props.percent === null ? null : (
        <span
          className="h-0.5 w-full overflow-hidden rounded-full bg-muted-foreground/15"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={props.percent}
        >
          <span
            className={cn("block h-full rounded-full", TONE_FILL[props.tone])}
            style={{ width: `${Math.max(0, Math.min(100, props.percent))}%` }}
          />
        </span>
      )}
    </span>
  );
}
