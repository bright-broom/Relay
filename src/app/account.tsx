import { useEffect, useState } from "react";
import type { UiContext } from "../i18n/context";
import { Action, SelectField, Notice } from "../ui/controls";
import { Card } from "@/components/ui/card";
import { storageKey } from "../prototype/storage";
import { useRemote, type Request } from "./remote";
type Destination = {
  id: string;
  kind: "user" | "group";
  enabled: boolean;
  reference: string;
};
type Identity = { email: string; lineReady: boolean };
const pendingNotifications = new Map<string, string>();
export function Account({ ui }: { ui: UiContext }) {
  const [identity, setIdentity] = useState<Identity | null>(null),
    [rows, setRows] = useState<Destination[]>([]),
    [kind, setKind] = useState("user"),
    [code, setCode] = useState("");
  const { busy, notice, setNotice, run } = useRemote("integrationFailure");
  const online = location.protocol !== "file:";
  async function refresh(request: Request) {
    const identity = await request<Identity>("session");
    const rows = identity.lineReady
      ? await request<Destination[]>("line/destinations")
      : [];
    setIdentity(identity);
    setRows(rows);
  }
  useEffect(() => {
    if (online) void run(refresh);
  }, [online, run]);
  const action = (name: string, id = "") =>
    void run(async (request) => {
      if (name === "logout") {
        await request("auth/logout", {});
        try {
          localStorage.removeItem(storageKey);
          localStorage.removeItem("relay-account");
        } catch {}
        location.replace("/");
        return;
      }
      if (name === "copy-code") {
        try {
          await navigator.clipboard.writeText(code);
          setNotice("copied");
        } catch {
          setNotice("copyError");
        }
        return;
      }
      if (name === "code") {
        const value = await request<{ code: string }>("line/code", { kind });
        setCode(value.code);
      }
      if (name === "confirm" || name === "remove")
        await request("line/destination", { id, action: name });
      if (name === "notify") {
        const retryId = pendingNotifications.get(id) ?? crypto.randomUUID();
        pendingNotifications.set(id, retryId);
        await request("line/notify", {
          id: retryId,
          destinationId: id,
          locale: ui.language,
        });
        pendingNotifications.delete(id);
        setNotice("lineSent");
      }
      await refresh(request);
    });
  const button = (
    label: Parameters<typeof Action>[0]["label"],
    name: string,
    id = "",
  ) => (
    <Action
      ui={ui}
      label={label}
      variant="outline"
      disabled={busy}
      onClick={() => action(name, id)}
    />
  );
  if (!online) return <Notice>{ui.t("authOnline")}</Notice>;
  return (
    <div className="stack" aria-busy={busy}>
      {identity && (
        <>
          <div className="row space-between">
            <p>{identity.email}</p>
            {button("signOut", "logout")}
          </div>
          {identity.lineReady ? (
            <>
              <SelectField
                ui={ui}
                id="line-kind"
                label="lineDestination"
                value={kind}
                disabled={busy}
                onChange={(event) => {
                  setKind(event.target.value);
                  setCode("");
                }}
                options={[
                  { value: "user", label: ui.t("linePersonal") },
                  { value: "group", label: ui.t("lineGroup") },
                ]}
              />
              <div className="row">
                {button("lineConnect", "code")}
                {button("refreshConnections", "refresh")}
              </div>
              <p className="meta">{ui.t("lineCodeHint")}</p>
              {code && (
                <>
                  <p className="pre">{code}</p>
                  {button("copyLinkCode", "copy-code")}
                </>
              )}
              {rows.map((row) => (
                <Card key={row.id} className="panel stack">
                  <h3>
                    {ui.t(row.kind === "user" ? "linePersonal" : "lineGroup")} ·{" "}
                    {row.reference}
                  </h3>
                  <p>{ui.t(row.enabled ? "lineConnected" : "linePending")}</p>
                  <div className="row">
                    {row.enabled
                      ? button("lineTest", "notify", row.id)
                      : button("lineConfirm", "confirm", row.id)}
                    {button("lineRemove", "remove", row.id)}
                  </div>
                </Card>
              ))}
            </>
          ) : (
            <Notice>{ui.t("lineSetup")}</Notice>
          )}
        </>
      )}
      {!identity && busy && <Notice>{ui.t("loading")}</Notice>}
      {notice && <Notice>{ui.t(notice)}</Notice>}
      {!identity && !busy && button("refreshConnections", "refresh")}
    </div>
  );
}
