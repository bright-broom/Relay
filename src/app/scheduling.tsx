import { useEffect, useState } from "react";
import { publicPreview } from '../prototype/access-mode';
import type { UiContext } from "../i18n/context";
import type { MessageKey } from "../i18n/messages";
import { relativeDate } from "../ui/input-values";
import { Action, ChoiceField, SelectField, Fold, Notice } from "../ui/controls";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRemote, type Request } from "./remote";
type Proposal = {
  id: string;
  title: string;
  start: string;
  end: string;
  timeZone: string;
};
type CalendarStatus = { ready: boolean; connected: boolean };
type TokenInfo = { id: string; permission: string; expires_at: string };
export function Scheduling({
  ui,
  title,
  initialNotice,
}: {
  ui: UiContext;
  title: string;
  initialNotice?: MessageKey;
}) {
  const { t } = ui;
  const [form, setForm] = useState({
    title: title || t("scheduleDefaultTitle"),
    fromDate: relativeDate("Asia/Tokyo", 0),
    days: 7,
    durationMinutes: 60,
    bufferMinutes: 15,
    startHour: 9,
    endHour: 18,
    timeZone: "Asia/Tokyo",
    weekdays: [1, 2, 3, 4, 5],
  });
  const [status, setStatus] = useState<CalendarStatus | null>(null),
    [keys, setKeys] = useState<TokenInfo[]>([]),
    [permission, setPermission] = useState("read"),
    [key, setKey] = useState<{ token: string; endpoint: string } | null>(null),
    [proposals, setProposals] = useState<Proposal[]>([]);
  const { busy, notice, setNotice, run } = useRemote("scheduleFailure");
  const online = location.protocol !== "file:" && !publicPreview();
  const [titles] = useState(() =>
    [
      ...new Set([
        title || t("scheduleDefaultTitle"),
        ...(
          [
            "scheduleVisit",
            "scheduleOnline",
            "scheduleCall",
            "scheduleReview",
          ] as const
        ).map((k) => t(k)),
      ]),
    ].map((value) => ({ value, label: value })),
  );
  const [zones] = useState(() =>
    [
      ...new Set([
        "Asia/Tokyo",
        "UTC",
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        "America/New_York",
        "Europe/London",
        ...Intl.supportedValuesOf("timeZone"),
      ]),
    ].map((value) => ({ value, label: value })),
  );
  async function refresh(request: Request) {
    const [status, keys] = await Promise.all([
      request<CalendarStatus>("calendar/status"),
      request<TokenInfo[]>("mcp/tokens"),
    ]);
    setStatus(status);
    setKeys(keys);
  }
  useEffect(() => {
    if (online)
      void run(async (request) => {
        await refresh(request);
        if (initialNotice) setNotice(initialNotice);
      });
  }, [online, run, initialNotice, setNotice]);
  function change(patch: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...patch }));
    setProposals([]);
    setNotice("scheduleRecalculate");
  }
  const action = (name: string, id = "") =>
    void run(async (request) => {
      if (name === "connect") {
        const result = await request<{ url: string }>("calendar/connect", {});
        location.assign(result.url);
        return;
      }
      if (name === "disconnect") {
        await request("calendar/disconnect", {});
        setProposals([]);
      }
      if (name === "find") {
        const result = await request<{ proposals: Proposal[] }>(
          "schedule/propose",
          form,
        );
        setProposals(result.proposals);
        if (!result.proposals.length) setNotice("scheduleEmpty");
        return;
      }
      if (name === "book") {
        await request("schedule/book", { proposalId: id });
        setProposals([]);
        setNotice("scheduleBooked");
        return;
      }
      if (name === "issue") setKey(await request("mcp/token", { permission }));
      if (name === "revoke") {
        await request("mcp/revoke", { id });
        setKey(null);
      }
      if (name === "copy-key" && key) {
        try {
          await navigator.clipboard.writeText(
            JSON.stringify(
              {
                url: key.endpoint,
                headers: { Authorization: "Bearer " + key.token },
              },
              null,
              2,
            ),
          );
          setNotice("copied");
        } catch {
          setNotice("copyError");
        }
        return;
      }
      await refresh(request);
    });
  const button = (
    label: MessageKey,
    name: string,
    id = "",
    primary = false,
  ) => (
    <Action
      ui={ui}
      label={label}
      variant={primary ? "default" : "outline"}
      disabled={busy}
      onClick={() => action(name, id)}
    />
  );
  const numbers = (values: number[], kind: "minutes" | "days" | "hour") =>
    values.map((value) => ({
      value: String(value),
      label:
        kind === "hour"
          ? ui.number(value, { minimumIntegerDigits: 2 }) +
            ":" +
            ui.number(0, { minimumIntegerDigits: 2 })
          : t(kind === "days" ? "scheduleDayCount" : "scheduleMinutes", {
              count: value,
            }),
    }));
  const numberField = (
    key: "days" | "durationMinutes" | "bufferMinutes" | "startHour" | "endHour",
    label: MessageKey,
    values: number[],
    kind: "minutes" | "days" | "hour",
  ) => (
    <SelectField
      ui={ui}
      label={label}
      value={String(form[key])}
      options={numbers(values, kind)}
      disabled={busy}
      onChange={(event) => change({ [key]: Number(event.target.value) })}
    />
  );
  if (!online) return <Notice>{t(publicPreview() ? "publicSignInHint" : "authOnline")}</Notice>;
  return (
    <div className="stack" aria-busy={busy}>
      {!status && busy && <Notice>{t("loading")}</Notice>}
      {status &&
        (!status.ready ? (
          <Notice>{t("calendarSetup")}</Notice>
        ) : !status.connected ? (
          button("calendarConnect", "connect", "", true)
        ) : (
          <>
            <p className="meta">{t("calendarReady")}</p>
            <ChoiceField
              ui={ui}
              id="schedule-title"
              label="scheduleTitle"
              options={titles}
              value={form.title}
              onChange={(title) => change({ title })}
              disabled={busy}
            />
            <div className="form-grid">
              <div className="field">
                <Label htmlFor="schedule-date">{t("scheduleDate")}</Label>
                <Input
                  id="schedule-date"
                  type="date"
                  value={form.fromDate}
                  min={relativeDate(form.timeZone, 0)}
                  max={relativeDate(form.timeZone, 60)}
                  onChange={(event) => change({ fromDate: event.target.value })}
                  disabled={busy}
                />
              </div>
              {numberField(
                "durationMinutes",
                "scheduleDuration",
                [15, 30, 45, 60, 90, 120],
                "minutes",
              )}
            </div>
            <div className="row">
              {(
                [
                  [0, "dateToday"],
                  [1, "dateTomorrow"],
                  [7, "dateNextWeek"],
                ] as const
              ).map(([days, label]) => (
                <Button
                  variant="outline"
                  key={days}
                  disabled={busy}
                  onClick={() =>
                    change({ fromDate: relativeDate(form.timeZone, days) })
                  }
                >
                  {t(label)}
                </Button>
              ))}
            </div>
            <Fold ui={ui} label="scheduleOptions">
              <div className="stack">
                {numberField("days", "scheduleDays", [3, 7, 14], "days")}
                {numberField(
                  "bufferMinutes",
                  "scheduleBuffer",
                  [0, 15, 30, 60],
                  "minutes",
                )}
                <SelectField
                  ui={ui}
                  label="scheduleZone"
                  value={form.timeZone}
                  options={zones}
                  onChange={(event) => change({ timeZone: event.target.value })}
                  disabled={busy}
                />
                <SelectField
                  ui={ui}
                  label="scheduleWorkingDays"
                  value={form.weekdays.length === 5 ? "week" : "all"}
                  options={[
                    { value: "week", label: t("scheduleWeekdays") },
                    { value: "all", label: t("scheduleEveryDay") },
                  ]}
                  onChange={(event) =>
                    change({
                      weekdays:
                        event.target.value === "all"
                          ? [1, 2, 3, 4, 5, 6, 7]
                          : [1, 2, 3, 4, 5],
                    })
                  }
                  disabled={busy}
                />
                <div className="form-grid" aria-label={t("scheduleHours")}>
                  {numberField(
                    "startHour",
                    "scheduleStart",
                    Array.from({ length: 24 }, (_, i) => i),
                    "hour",
                  )}
                  {numberField(
                    "endHour",
                    "scheduleEnd",
                    Array.from({ length: 24 }, (_, i) => i + 1),
                    "hour",
                  )}
                </div>
              </div>
            </Fold>
            <p className="meta">{t("scheduleHint")}</p>
            {button("scheduleFind", "find", "", true)}
            <div className="stack">
              {proposals.map((proposal) => (
                <Card key={proposal.id} className="panel stack">
                  <h3>
                    {ui.dateRange(
                      new Date(proposal.start),
                      new Date(proposal.end),
                      {
                        timeZone: proposal.timeZone,
                        dateStyle: "medium",
                        timeStyle: "short",
                      },
                    )}
                  </h3>
                  <p className="meta">{proposal.timeZone}</p>
                  <p>{proposal.title}</p>
                  {button("scheduleBook", "book", proposal.id)}
                </Card>
              ))}
            </div>
            {button("calendarDisconnect", "disconnect")}
          </>
        ))}
      {notice && <Notice>{t(notice)}</Notice>}
      {!status && !busy && button("refreshConnections", "refresh")}
      <Fold ui={ui} label="mcpSettings" required={Boolean(key)}>
        <div className="stack">
          <p className="meta">{t("mcpHint")}</p>
          <SelectField
            ui={ui}
            id="mcp-permission"
            label="mcpSettings"
            value={permission}
            disabled={busy}
            options={[
              { value: "read", label: t("mcpRead") },
              { value: "book", label: t("mcpBook") },
            ]}
            onChange={(event) => setPermission(event.target.value)}
          />
          {button("mcpIssue", "issue")}
          {key && (
            <>
              <Label htmlFor="mcp-key">{t("mcpTokenLabel")}</Label>
              <Textarea id="mcp-key" readOnly value={key.token} />
              <p>
                {t("mcpEndpointLabel")}: {key.endpoint}
              </p>
              {button("mcpCopy", "copy-key")}
            </>
          )}
          {keys.map((item) => (
            <div className="row space-between" key={item.id}>
              <span>
                {t(item.permission === "book" ? "mcpBook" : "mcpRead")} ·{" "}
                {ui.date(new Date(item.expires_at), { dateStyle: "medium" })}
              </span>
              {button("mcpRevoke", "revoke", item.id)}
            </div>
          ))}
        </div>
      </Fold>
    </div>
  );
}
