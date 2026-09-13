import {
  createSnapshotWriter,
  restore,
  type Snapshot,
} from "../prototype/storage";
import {
  initialCases,
  demoMembers,
  demoMeta,
  sourceMessage,
} from "../prototype/data";
import { resolveRoute, type Page } from "../prototype/navigation";
import { emptyReport, saveReport, validateReport } from "../prototype/report";
import { translate, type MessageKey } from "../i18n/messages";
export type State = Snapshot & {
  page: Page;
  caseId: number;
  search: string;
  owner: string;
  filter: string;
  statusFilter: string;
  error: MessageKey | null;
  notice: MessageKey | null;
  storageError: MessageKey | null;
};
export function createWorkspace(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  locale: string,
  preferred: boolean,
  hash = "",
) {
  const defaults: Snapshot = {
    locale,
    cases: structuredClone(initialCases),
    drafts: {},
    review: "pending",
    reviewOwner: demoMembers[0],
    reviewDue: "dueNow",
    imported: false,
  };
  const saved = storage ? restore(storage) : null;
  let state: State = {
    ...defaults,
    ...saved,
    page: "today",
    caseId: 1,
    search: "",
    owner: "",
    filter: "all",
    statusFilter: "",
    error: null,
    notice: null,
    storageError: null,
  };
  if (preferred) state.locale = locale;
  Object.assign(
    state,
    resolveRoute(
      hash,
      state.cases.map((c) => c.id),
    ) ?? {},
  );
  let writer: ReturnType<typeof createSnapshotWriter> | null = null;
  try {
    if (storage) writer = createSnapshotWriter(storage, state);
  } catch {}
  const listeners = new Set<() => void>();
  const edit = (recipe: (draft: State) => void) => {
    const next = structuredClone(state);
    recipe(next);
    const result = writer?.(next) ?? "unavailable";
    if (result === "saved") next.storageError = null;
    if (result === "unavailable" || result === "conflict") {
      next.storageError =
        result === "conflict" ? "storageConflict" : "localFailure";
      next.notice = null;
    }
    state = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    edit,
    route(hash: string) {
      const route = resolveRoute(
        hash,
        state.cases.map((c) => c.id),
      );
      if (route)
        edit((draft) => {
          Object.assign(draft, route);
          draft.error = null;
          draft.notice = null;
        });
      return Boolean(route);
    },
    saveReport() {
      const report = state.drafts[state.caseId] ?? emptyReport();
      const error = validateReport(report);
      if (error) {
        edit((draft) => {
          draft.error = error.key;
        });
        return error.field;
      }
      edit((draft) => {
        const c = draft.cases.find((c) => c.id === draft.caseId)!;
        if (saveReport(c, report, draft.locale)) {
          draft.notice =
            report.mode === "complete" ? "taskCompleted" : "reportSaved";
          draft.drafts[c.id] = emptyReport();
          draft.error = null;
        }
      });
      return "report-channel";
    },
    approve() {
      edit((draft) => {
        const c = draft.cases.find((c) => c.id === 1)!;
        if (c.version !== 1) {
          draft.error = "reviewConflict";
          return;
        }
        c.owner = draft.reviewOwner;
        c.due = draft.reviewDue;
        c.level =
          c.due === "dueNow"
            ? "today"
            : c.due === "dueUnknown"
              ? "unknown"
              : "upcoming";
        c.status = "todo";
        c.title = translate("ja", "afterText");
        c.reason = translate("ja", "reviewCaution");
        c.waiting = "—";
        c.evidence = sourceMessage;
        c.version++;
        c.history = [...c.history, [demoMeta.messageTime, sourceMessage]];
        draft.review = "approved";
        draft.error = null;
      });
    },
  };
}
export type Workspace = ReturnType<typeof createWorkspace>;
