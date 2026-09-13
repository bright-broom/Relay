import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageKey } from "../i18n/messages";
export type Request = <T>(path: string, body?: object) => Promise<T>;
export function useRemote(fallback: MessageKey) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<MessageKey | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );
  const run = useCallback(
    async (task: (request: Request) => Promise<void>) => {
      if (controller.current) return;
      const abort = new AbortController();
      controller.current = abort;
      setBusy(true);
      setNotice(null);
      const request: Request = async <T>(path: string, body?: object) => {
        const response = await fetch("/api/" + path, {
          signal: abort.signal,
          method: body ? "POST" : "GET",
          cache: "no-store",
          credentials: "same-origin",
          ...(body
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        });
        if (response.status === 401) {
          location.replace("/");
          throw new Error("unauthorized");
        }
        const value = await response.json();
        if (!response.ok) throw new Error(value.error);
        return value as T;
      };
      try {
        await task(request);
      } catch (error) {
        if (!abort.signal.aborted) {
          const keys: Record<string, MessageKey> = {
            personalFirst: "personalFirst",
            rateLimit: "lineRateLimit",
            delivery: "lineRetry",
            pending: "lineRetry",
            calendarConnect: "scheduleReconnect",
            calendarReconnect: "scheduleReconnect",
            calendarConflict: "scheduleConflict",
            proposalExpired: "scheduleExpired",
            calendarChanged: "scheduleChanged",
          };
          setNotice(
            keys[error instanceof Error ? error.message : ""] ?? fallback,
          );
        }
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          setBusy(false);
        }
      }
    },
    [fallback],
  );
  return { busy, notice, setNotice, run };
}
