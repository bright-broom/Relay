import { renderToStaticMarkup } from "react-dom/server";
import { brand } from "../i18n/messages";
import { createUiContext } from "../i18n/context";
import { LanguageForm } from "../ui/language";
import { palette } from "../design/tokens";
import { Icon } from "../ui/icons";
import { Button } from "@/components/ui/button";
export type LoginStatus = "ready" | "denied" | "setup" | "unavailable";
export function loginPage(locale: string, status: LoginStatus, admin = false): string {
  const ui = createUiContext(locale),
    { t } = ui;
  const entry = admin ? "/admin" : "/";
  const start = new URLSearchParams({lang: ui.locale});
  if (admin) start.set("destination", "admin");
  const message = status === "setup" ? "authSetup" : status === "unavailable" ? "authUnavailable" : status === "denied" ? (admin ? "adminDenied" : "authDenied") : (admin ? "adminLoginHint" : "loginHint");
  return (
    "<!doctype html>" +
    renderToStaticMarkup(
      <html lang={ui.language} dir={ui.dir}>
        <head>
          <meta charSet="utf-8" />
          <meta
            name="viewport"
            content="width=device-width,initial-scale=1,viewport-fit=cover"
          />
          <meta name="robots" content="noindex" />
          <meta name="theme-color" content={palette.sub} />
          <title>{admin ? `${t("admin")} · ${brand}` : brand}</title>
          <link rel="stylesheet" href="/assets/styles.css" />
          <link rel="manifest" href="/manifest.webmanifest" />
          <link rel="apple-touch-icon" href="/icons/icon-180.png" />
          <script defer src="/assets/session.js" />
        </head>
        <body>
          <main className="auth-page">
            <div className="stack">
              <div className="eyebrow">{brand}</div>
              <h1><Icon name={admin ? "adminLocked" : "user"} /> {admin ? t("admin") : t("googleSignIn")}</h1>
              <p id="login-status" role={status === "ready" ? "status" : "alert"}>{t(message)}</p>
              <Button asChild>
                <a href={status === "setup" ? `${entry}?lang=${encodeURIComponent(ui.locale)}` : `/api/auth/start?${start}`} aria-describedby="login-status">
                  {status === "setup" ? <Icon name="refresh" /> : <Icon name="arrow" />}
                  {t(status === "setup" ? "refreshConnections" : "googleSignIn")}
                </a>
              </Button>
              <Button asChild variant="ghost">
                <a href={`${admin ? "/" : "/admin"}?lang=${encodeURIComponent(ui.locale)}`}>
                  <Icon name={admin ? "home" : "adminLocked"} />{t(admin ? "today" : "admin")}
                </a>
              </Button>
              <details className="disclosure">
                <summary>{t("language")}</summary>
                <LanguageForm ui={ui} action={admin ? "/admin" : "/"} />
              </details>
            </div>
          </main>
        </body>
      </html>,
    )
  );
}
