import type { UiContext } from "../i18n/context";
import type { MessageKey } from "../i18n/messages";
import {
  sourceMessage,
  demoMembers,
  demoMeta,
  type CaseRecord,
} from "../prototype/data";
import {
  channels,
  outcomes,
  emptyReport,
  validateReport,
  type ReportDraft,
} from "../prototype/report";
import type { State, Workspace } from "./store";
import {
  Action,
  Fold,
  Heading,
  IconLink,
  SelectField,
  Notice,
  keyOptions,
} from "../ui/controls";
import { Icon } from "../ui/icons";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
type Props = { ui: UiContext; state: State; workspace: Workspace };
const owner = (ui: UiContext, c: CaseRecord) => c.owner || ui.t("unknown");
function Status({ ui, c }: { ui: UiContext; c: CaseRecord }) {
  return (
    <Badge variant="outline" aria-label={ui.t(c.status)} title={ui.t(c.status)}>
      <Icon
        name={
          (
            {
              todo: "todo",
              doing: "clock",
              awaiting: "waiting",
              done: "check",
            } as const
          )[c.status]
        }
      />
      <span className="sr-only">{ui.t(c.status)}</span>
    </Badge>
  );
}
function Due({ ui, c }: { ui: UiContext; c: CaseRecord }) {
  return (
    <Badge variant="outline">
      {c.level === "overdue" && <Icon name="clock" />}
      {c.level === "overdue"
        ? ui.t("overdueDeadline", { date: ui.t(c.due) })
        : ui.t(c.due)}
    </Badge>
  );
}
function Fact({
  ui,
  label,
  value,
}: {
  ui: UiContext;
  label: MessageKey;
  value: string;
}) {
  const symbol = (
    { owner: "user", next: "calendar" } as Partial<Record<MessageKey, string>>
  )[label];
  return (
    <div className="fact">
      <dt>
        {symbol ? (
          <span title={ui.t(label)}>
            <Icon name={symbol} />
            <span className="sr-only">{ui.t(label)}</span>
          </span>
        ) : (
          ui.t(label)
        )}
      </dt>
      <dd dir="auto">{value}</dd>
    </div>
  );
}
export function Today({ ui, state }: Props) {
  const active = state.cases.filter((c) => c.status !== "done");
  const due = active
    .filter((c) => ["today", "overdue"].includes(c.level))
    .sort(
      (a, b) => Number(b.level === "overdue") - Number(a.level === "overdue"),
    );
  return (
    <>
      <Heading ui={ui} label="today" />
      <section className="metrics" aria-label={ui.t("today")}>
        {(
          [
            ["dueToday", due.length],
            [
              "overdue",
              active.filter((c) => c.level === "overdue").length,
            ],
            [
              "unassigned",
              active.filter((c) => !c.owner || c.due === "dueUnknown").length,
            ],
          ] as const
        ).map(([label, count]) => (
          <div className="metric" key={label}>
            <p className="metric-label">
              {ui.t(label)}
            </p>
            <p className="metric-value">{ui.number(count)}</p>
          </div>
        ))}
      </section>
      {state.review === "pending" && (
        <a className="review-strip" href="#reviews">
          <Icon name="reviews" />
          <span>{ui.t("reviewPending")}</span>
          <Badge>{ui.number(1)}</Badge>
          <Icon name="arrow" />
        </a>
      )}
      <section className="reading">
        {due.length ? (
          due.map((c) => (
            <article className="task" key={c.id}>
              <div>
                <div className="row space-between">
                  <a className="details-link" href={"#case/" + c.id}>
                    {c.name}
                  </a>
                  <Due ui={ui} c={c} />
                </div>
                <h3 className="task-title">{c.title}</h3>
                <div className="task-foot">
                  <div className="row">
                    <span className="meta">{owner(ui, c)}</span>
                    <Status ui={ui} c={c} />
                  </div>
                  <IconLink
                    ui={ui}
                    label="open"
                    href={"#case/" + c.id}
                    symbol="arrow"
                  />
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="empty">
            <h2>{ui.t("emptyToday")}</h2>
            <IconLink ui={ui} label="browse" href="#cases" symbol="cases" />
          </div>
        )}
      </section>
    </>
  );
}
export function Cases({ ui, state, workspace }: Props) {
  const change = (
    key: "search" | "owner" | "filter" | "statusFilter",
    value: string,
  ) =>
    workspace.edit((draft) => {
      draft[key] = value;
    });
  const reset = () =>
    workspace.edit((draft) => {
      draft.search = "";
      draft.owner = "";
      draft.filter = "all";
      draft.statusFilter = "";
    });
  const data = state.cases.filter(
    (c) =>
      (!state.owner || c.owner === state.owner) &&
      (!state.statusFilter || c.status === state.statusFilter) &&
      `${c.name} ${c.area} ${c.title}`
        .toLocaleLowerCase()
        .includes(state.search.toLocaleLowerCase()) &&
      (state.filter === "all" ||
        (state.filter === "unknown"
          ? !c.owner
          : ["today", "overdue"].includes(c.level) && c.status !== "done")),
  );
  return (
    <>
      <Heading ui={ui} label="casesTitle" />
      <div className="toolbar">
        <div className="search-wrap">
          <Icon name="search" />
          <Label className="sr-only" htmlFor="search">
            {ui.t("search")}
          </Label>
          <Input
            className="search"
            id="search"
            type="search"
            list="case-search-options"
            value={state.search}
            onChange={(event) => change("search", event.target.value)}
            placeholder={ui.t("searchShort")}
          />
          <datalist id="case-search-options">
            {[
              ...new Set(state.cases.flatMap((c) => [c.name, c.area, c.title])),
            ].map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </div>
        <SelectField
          ui={ui}
          label="owner"
          hideLabel
          id="owner"
          value={state.owner}
          onChange={(event) => change("owner", event.target.value)}
          options={[
            { value: "", label: ui.t("allOwners") },
            ...demoMembers.map((value) => ({ value, label: value })),
          ]}
        />
        <SelectField
          ui={ui}
          label="filterLabel"
          hideLabel
          id="case-filter"
          value={state.filter}
          onChange={(event) => change("filter", event.target.value)}
          options={keyOptions(ui, ["all", "needsAttention", "unknown"])}
        />
        <SelectField
          ui={ui}
          label="status"
          hideLabel
          id="status-filter"
          value={state.statusFilter}
          onChange={(event) => change("statusFilter", event.target.value)}
          options={[
            { value: "", label: ui.t("allStatuses") },
            ...keyOptions(ui, ["todo", "doing", "awaiting", "done"]),
          ]}
        />
        <Action ui={ui} label="resetFilters" variant="ghost" onClick={reset} />
      </div>
      <p className="meta result-count" role="status">
        {ui.t("count", { count: data.length })}
      </p>
      {!data.length ? (
        <div className="empty">
          <h2>{ui.t("noResults")}</h2>
          <p>{ui.t("noResultsSub")}</p>
          <Action
            ui={ui}
            label="resetFilters"
            variant="ghost"
            onClick={reset}
          />
        </div>
      ) : (
        <>
          <section className="case-cards" aria-label={ui.t("cases")}>
            {data.map((c) => (
              <Card className="case-card" key={c.id}>
                <div className="row space-between">
                  <div>
                    <a className="details-link" href={"#case/" + c.id}>
                      {c.name}
                    </a>
                    <p className="meta">{c.area}</p>
                  </div>
                  <Due ui={ui} c={c} />
                </div>
                <h2 className="case-card-title">{c.title}</h2>
                <div className="row">
                  <Badge variant="outline">{ui.t(c.stage)}</Badge>
                  <Status ui={ui} c={c} />
                </div>
                <div className="task-foot">
                  <span className="row meta">
                    <Icon name="user" />
                    {owner(ui, c)}
                  </span>
                  <IconLink
                    ui={ui}
                    label="open"
                    href={"#case/" + c.id}
                    symbol="arrow"
                  />
                </div>
              </Card>
            ))}
          </section>
          <div
            className="cases-table"
            role="region"
            aria-label={ui.t("cases")}
            tabIndex={0}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  {(["name", "stage", "action", "owner", "due"] as const).map(
                    (key) => (
                      <TableHead key={key}>{ui.t(key)}</TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <a className="details-link" href={"#case/" + c.id}>
                        {c.name}
                      </a>
                      <p className="meta">{c.area}</p>
                    </TableCell>
                    <TableCell>{ui.t(c.stage)}</TableCell>
                    <TableCell>
                      {c.title}
                      <Status ui={ui} c={c} />
                    </TableCell>
                    <TableCell>{owner(ui, c)}</TableCell>
                    <TableCell>
                      <Due ui={ui} c={c} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}
function Report({ ui, state, workspace, c }: Props & { c: CaseRecord }) {
  const d = state.drafts[c.id] ?? emptyReport();
  const required = d.channel === "channelOther" || d.outcome === "resultOther";
  const invalid = state.error ? validateReport(d) : null;
  const update = (patch: Partial<ReportDraft>) =>
    workspace.edit((draft) => {
      draft.drafts[c.id] = { ...d, ...patch };
      draft.error = null;
      draft.notice = null;
    });
  const attrs = (id: string) => ({
    "aria-invalid": invalid?.field === id,
    "aria-describedby": invalid?.field === id ? "report-error" : undefined,
  });
  return (
    <Card className="panel">
      <h2>{ui.t("activity")}</h2>
      <form
        className="stack block-gap"
        onSubmit={(event) => {
          event.preventDefault();
          const field = workspace.saveReport();
          requestAnimationFrame(() => document.getElementById(field)?.focus());
        }}
      >
        <SelectField
          ui={ui}
          label="recordMethod"
          id="report-channel"
          value={d.channel}
          onChange={(event) =>
            update({ channel: event.target.value as ReportDraft["channel"] })
          }
          options={[
            { value: "", label: ui.t("choose") },
            ...keyOptions(ui, channels),
          ]}
          {...attrs("report-channel")}
        />
        <SelectField
          ui={ui}
          label="recordOutcome"
          id="report-outcome"
          value={d.outcome}
          onChange={(event) =>
            update({ outcome: event.target.value as ReportDraft["outcome"] })
          }
          options={[
            { value: "", label: ui.t("choose") },
            ...keyOptions(ui, outcomes),
          ]}
          {...attrs("report-outcome")}
        />
        <SelectField
          ui={ui}
          label="recordMode"
          id="report-mode"
          value={d.mode}
          onChange={(event) =>
            update({
              mode: event.target.value === "complete" ? "complete" : "record",
            })
          }
          options={[
            { value: "record", label: ui.t("recordOnly") },
            {
              value: "complete",
              label: ui.t("recordAndComplete"),
              disabled: c.status === "done",
            },
          ]}
          {...attrs("report-mode")}
        />
        <Fold
          ui={ui}
          label={required ? "noteRequired" : "noteOptional"}
          required={required}
          defaultOpen={Boolean(d.note)}
        >
          <Label className="sr-only" htmlFor="report">
            {ui.t(required ? "noteRequired" : "noteOptional")}
          </Label>
          <Textarea
            id="report"
            value={d.note}
            onChange={(event) => update({ note: event.target.value })}
            placeholder={ui.t("recordNotePlaceholder")}
            {...attrs("report")}
          />
        </Fold>
        {state.error && (
          <Notice error id="report-error">
            {ui.t(state.error)}
          </Notice>
        )}
        <Action
          ui={ui}
          label={d.mode === "complete" ? "saveComplete" : "saveRecord"}
          type="submit"
        />
        {state.notice && <Notice>{ui.t(state.notice)}</Notice>}
      </form>
    </Card>
  );
}
export function Details({
  ui,
  state,
  workspace,
  onHandoff,
}: Props & { onHandoff: () => void }) {
  const c = state.cases.find((c) => c.id === state.caseId)!;
  return (
    <>
      <header className="page-head">
        <div className="case-heading">
          <IconLink ui={ui} label="back" href="#cases" symbol="back" />
          <div>
            <h1 id="page-title" tabIndex={-1}>
              {c.name}
            </h1>
            <p>{c.area}</p>
          </div>
        </div>
        <Action ui={ui} label="handoff" variant="ghost" onClick={onHandoff} />
      </header>
      <div className="detail-grid">
        <section>
          <div className="row">
            <Badge variant="outline">{ui.t(c.stage)}</Badge>
            <Status ui={ui} c={c} />
            <Due ui={ui} c={c} />
          </div>
          <h2 className="block-gap">{c.title}</h2>
          <dl className="fact-grid">
            <Fact ui={ui} label="owner" value={owner(ui, c)} />
            <Fact ui={ui} label="next" value={c.next} />
            {c.waiting !== "—" && (
              <Fact ui={ui} label="waiting" value={c.waiting} />
            )}
          </dl>
          <Fold ui={ui} label="context">
            <p>{c.reason}</p>
          </Fold>
          <Fold ui={ui} label="timeline">
            <ol className="timeline">
              {c.history.map(([date, body], index) => (
                <li key={index}>
                  <span className="meta">{date}</span>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          </Fold>
          <Fold ui={ui} label="evidence">
            <p className="meta">{ui.t("evidenceOrigin")}</p>
            <p className="block-gap">{c.evidence}</p>
          </Fold>
          {c.notes.length > 0 && (
            <Fold ui={ui} label="reports">
              {c.notes.map((note, index) => (
                <div className="evidence" key={index}>
                  <small>{ui.t("reported")}</small>
                  <p className="pre">{note}</p>
                </div>
              ))}
            </Fold>
          )}
        </section>
        <aside>
          <Report
            key={c.id}
            ui={ui}
            state={state}
            workspace={workspace}
            c={c}
          />
        </aside>
      </div>
    </>
  );
}
export function Reviews({ ui, state, workspace }: Props) {
  return (
    <>
      <Heading ui={ui} label="reviews" />
      {state.review !== "pending" ? (
        <div className="empty">
          <h2>
            {ui.t(
              state.review === "approved" ? "reviewComplete" : "reviewRejected",
            )}
          </h2>
          <IconLink ui={ui} label="open" href="#case/1" symbol="arrow" />
        </div>
      ) : (
        <div className="reading">
          <div className="row space-between">
            <Badge variant="outline">
              <Icon name="info" />
              {ui.t("proposal")}
            </Badge>
            <span className="meta">{demoMeta.messageTime}</span>
          </div>
          <h2 className="block-gap">{ui.t("proposalHeading")}</h2>
          <div className="diff">
            <section className="diff-side">
              <span className="meta">{ui.t("before")}</span>
              <p>{ui.t("beforeText")}</p>
            </section>
            <section className="diff-side after">
              <span className="meta">{ui.t("after")}</span>
              <p>{ui.t("afterText")}</p>
            </section>
          </div>
          <Fold ui={ui} label="evidence">
            <p>{sourceMessage}</p>
            <p className="meta block-gap">{ui.t("evidenceOrigin")}</p>
          </Fold>
          <div className="split block-gap">
            <SelectField
              ui={ui}
              label="owner"
              id="review-owner"
              value={state.reviewOwner}
              options={demoMembers.map((value) => ({ value, label: value }))}
              onChange={(event) =>
                workspace.edit((d) => {
                  d.reviewOwner = event.target.value;
                })
              }
            />
            <SelectField
              ui={ui}
              label="due"
              id="review-due"
              value={state.reviewDue}
              options={keyOptions(ui, ["dueNow", "futureDate", "dueUnknown"])}
              onChange={(event) =>
                workspace.edit((d) => {
                  d.reviewDue = event.target.value as State["reviewDue"];
                })
              }
            />
          </div>
          <Notice className="block-gap">{ui.t("reviewCaution")}</Notice>
          {state.error && <Notice error>{ui.t(state.error)}</Notice>}
          <div className="form-actions">
            <Action
              ui={ui}
              label="approve"
              onClick={() => workspace.approve()}
            />
            <Action
              ui={ui}
              label="reject"
              variant="outline"
              onClick={() =>
                workspace.edit((d) => {
                  d.review = "rejected";
                })
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
export function Imports({ ui, state, workspace }: Props) {
  return (
    <>
      <Heading ui={ui} label="imports" />
      <div className="reading">
        <div className="row">
          <Icon name="imports" />
          <span>{ui.t("sampleSource")}</span>
        </div>
        <div className="block-gap">
          <Action
            ui={ui}
            label={state.imported ? "sampleShown" : "sample"}
            onClick={() =>
              workspace.edit((d) => {
                d.imported = true;
              })
            }
          />
        </div>
        <p className="meta block-gap">{ui.t("importNote")}</p>
        {state.imported && (
          <section className="section-gap">
            <h2>
              <Icon name="check" />
              {ui.t("importSummary")}
            </h2>
            <dl className="fact-grid">
              <Fact ui={ui} label="duplicates" value={ui.t("two")} />
              <Fact ui={ui} label="newMessages" value={ui.t("one")} />
            </dl>
            <Fold ui={ui} label="file">
              <p>{demoMeta.fileName}</p>
              <p>{demoMeta.referenceDate}</p>
            </Fold>
            <Button className="block-gap" variant="outline" asChild>
              <a href="#reviews">
                {ui.t("reviewOpen")}
                <Icon name="arrow" />
              </a>
            </Button>
          </section>
        )}
      </div>
    </>
  );
}
