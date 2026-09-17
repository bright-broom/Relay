import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createUiContext, persistLocale } from "../i18n/context";
import { brand, type MessageKey } from "../i18n/messages";
import { activeNavigation, visibleNavigation } from "../prototype/navigation";
import { storageKey } from "../prototype/storage";
import { publicPreview, workspaceStorage } from "../prototype/access-mode";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Action, Notice } from "../ui/controls";
import { Icon } from "../ui/icons";
import { LanguageForm } from "../ui/language";
import { Admin } from "./admin";
import { Today, Cases, Details, Reviews, Imports } from "./pages";
import { Pricing } from "./pricing";
import { Scheduling } from "./scheduling";
import { Customers } from "./customers";
import { MyPage } from "./my-page";
import type { Workspace } from "./store";
type Modal =
  | "pricing"
  | "scheduling"
  | "language"
  | "preview-info"
  | "handoff";
const modalTitles: Record<Modal, MessageKey> = {
  pricing: "pricing",
  scheduling: "scheduling",
  language: "language",
  "preview-info": "previewInfo",
  handoff: "handoffHeading",
};
export function App({ workspace, isAdmin = false }: { workspace: Workspace; isAdmin?: boolean }) {
  const state = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
    workspace.getSnapshot,
  );
  const ui = useMemo(() => createUiContext(state.locale), [state.locale]);
  const { t } = ui;
  const [modal, setModal] = useState<Modal | null>(null),
    [presenting, setPresenting] = useState(false),
    [toast, setToast] = useState<MessageKey | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [calendarNotice] = useState<MessageKey | undefined>(() => {
    const result = new URLSearchParams(location.search).get("calendar");
    return result
      ? result === "connected"
        ? "calendarReady"
        : "scheduleReconnect"
      : undefined;
  });
  function open(value: Modal) {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setModal(value);
    setPresenting(false);
  }
  useEffect(() => {
    document.documentElement.lang = ui.language;
    document.documentElement.dir = ui.dir;
    document.title = t("app");
  }, [ui, t]);
  useEffect(() => {
    const route = () => {
      if (!workspace.route(location.hash)) return;
      setModal(null);
      setPresenting(false);
      window.scrollTo({top:0});
      requestAnimationFrame(() =>
        document.getElementById("page-title")?.focus({ preventScroll: true }),
      );
    };
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, [workspace]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const events: Record<string, () => void> = {
      offline: () => setToast("offlineStatus"),
      online: () => setToast("onlineStatus"),
      "relay-offline-unavailable": () => setToast("offlineUnavailable"),
    };
    for (const [name, handler] of Object.entries(events))
      window.addEventListener(name, handler);
    return () => {
      for (const [name, handler] of Object.entries(events))
        window.removeEventListener(name, handler);
    };
  }, []);
  useEffect(() => {
    if (calendarNotice) {
      const url = new URL(location.href);
      url.searchParams.delete("calendar");
      history.replaceState(null, "", url);
      setModal("scheduling");
    }
  }, [calendarNotice]);
  const c = state.cases.find((c) => c.id === state.caseId) ?? state.cases[0];
  const handoff = t("handoffTemplate", {
    name: c.name,
    stage: t(c.stage),
    action: c.title,
    status: t(c.status),
    owner: c.owner || t("unknown"),
    waiting: c.waiting,
    due: t(c.due),
    next: c.next,
    evidence: c.evidence,
    reports: c.notes.at(-1) ?? t("noReport"),
    caution: t("handoffCaution"),
  });
  const applyLocale = (locale: string) => {
    workspace.edit((d) => {
      d.locale = locale;
    });
    persistLocale(locale);
    const url = new URL(location.href);
    url.searchParams.set("lang", locale);
    try {
      history.replaceState(null, "", url);
    } catch {}
    setModal(null);
  };
  const props = { ui, state, workspace };
  return (
    <TooltipProvider>
      <Button className="skip" asChild>
        <a href="#main">{t("skip")}</a>
      </Button>
      <div className={"app " + (presenting ? "pricing-presenting" : "")}>
        <aside className="sidebar" aria-label={t("menu")}>
          <div className="sidebar-top">
            <Button variant="ghost" size="icon" asChild>
              <a className="brand" href="#today" aria-label={brand}>
                <span aria-hidden="true">{brand.slice(0, 1)}</span>
              </a>
            </Button>
          </div>
          <nav id="main-nav" aria-label={t("menu")}>
            {visibleNavigation(isAdmin).map((item) => (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  {item.kind === "page" ? (
                    <Button variant="ghost" className={"nav-link" + (item.id === "mypage" ? " nav-personal-start" : "") + (item.id === "admin" && !isAdmin ? " nav-restricted" : "")} asChild>
                      <a
                        href={"#" + item.id}
                        aria-label={t(item.label)}
                        aria-current={
                          activeNavigation(state.page) === item.id
                            ? "page"
                            : undefined
                        }
                      >
                        <Icon name={item.icon} />
                        {item.id === "reviews" &&
                          state.review === "pending" && (
                            <>
                              <span className="nav-dot" aria-hidden="true" />
                              <span className="sr-only">
                                {t("reviewPending")}
                              </span>
                            </>
                          )}
                      </a>
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      className="nav-link"
                      aria-label={t(item.label)}
                      aria-haspopup="dialog"
                      aria-controls="modal"
                      aria-expanded={modal === item.id}
                      onClick={() => open(item.id)}
                    >
                      <Icon name={item.icon} />
                    </Button>
                  )}
                </TooltipTrigger>
                <TooltipContent side={ui.dir === "rtl" ? "left" : "right"}>
                  {t(item.label)}
                </TooltipContent>
              </Tooltip>
            ))}
          </nav>
          <div className="sidebar-footer">
            <Action
              ui={ui}
              label="language"
              iconOnly
              symbol="language"
              variant="ghost"
              className="nav-link"
              aria-haspopup="dialog"
              aria-controls="modal"
              aria-expanded={modal === "language"}
              onClick={() => open("language")}
            />
          </div>
        </aside>
        <main id="main" tabIndex={-1}>
          <div className="topbar" hidden={(state.page === "admin" || state.page === "mypage" || state.page === "customers") && !ui.fallback}>
            {state.page !== "admin" && state.page !== "mypage" && state.page !== "customers" && <span className="meta">{t(publicPreview() ? "publicPreviewHint" : "previewShort")}</span>}
            {ui.fallback && (
              <span className="meta" role="status">
                {t("languageFallback")}
              </span>
            )}
          </div>
          {state.page !== "admin" && state.page !== "mypage" && state.page !== "customers" && state.storageError && <Notice error>{t(state.storageError)}</Notice>}
          <div id="page">
            {state.page === "customers" ? (
              <Customers ui={ui} />
            ) : state.page === "mypage" ? (
              <MyPage ui={ui} onLanguage={() => open("language")} />
            ) : state.page === "admin" ? (
              <Admin ui={ui} />
            ) : state.page === "today" ? (
              <Today {...props} />
            ) : state.page === "cases" ? (
              <Cases {...props} />
            ) : state.page === "reviews" ? (
              <Reviews {...props} />
            ) : state.page === "imports" ? (
              <Imports {...props} />
            ) : (
              <Details {...props} onHandoff={() => open("handoff")} />
            )}
          </div>
        </main>
      </div>
      <Dialog
        open={Boolean(modal)}
        onOpenChange={(value) => {
          if (!value) {
            setModal(null);
            setPresenting(false);
          }
        }}
      >
        <DialogContent
          id="modal"
          className={presenting ? "pricing-presentation" : ""}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
            else document.getElementById("page-title")?.focus();
          }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div className="dialog-head">
            <DialogTitle>{modal ? t(modalTitles[modal]) : ""}</DialogTitle>
            <DialogClose asChild>
              <Button variant="ghost" size="icon" aria-label={t("close")}>
                <Icon name="close" />
              </Button>
            </DialogClose>
          </div>
          <div className="dialog-body">
            {modal === "pricing" ? (
              <Pricing
                ui={ui}
                customer={state.page === "detail" ? c.name : ""}
                presenting={presenting}
                onPresent={setPresenting}
              />
            ) : modal === "scheduling" ? (
              <Scheduling
                ui={ui}
                title={state.page === "detail" ? c.title : ""}
                initialNotice={calendarNotice}
              />
            ) : modal === "language" ? (
              <LanguageForm ui={ui} onApply={applyLocale} />
            ) : modal === "handoff" ? (
              <>
                <p className="pre">{handoff}</p>
                <Action
                  ui={ui}
                  label="copy"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(handoff);
                      setToast("copied");
                    } catch {
                      setToast("copyError");
                    }
                  }}
                />
              </>
            ) : modal === "preview-info" ? (
              <div className="stack">
                <p>{t("demoNote")}</p>
                <p>{t("previewFooter")}</p>
                <p>{t("asOf")}</p>
                <p>{t("originalData")}</p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline">{t("resetDemo")}</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle>{t("resetDemo")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("resetConfirm")}
                    </AlertDialogDescription>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("close")}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          try {
                            workspaceStorage()?.removeItem(storageKey);
                            location.reload();
                          } catch {
                            setToast("localFailure");
                          }
                        }}
                      >
                        {t("resetDemo")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      {toast && <Notice className="toast">{t(toast)}</Notice>}
    </TooltipProvider>
  );
}
