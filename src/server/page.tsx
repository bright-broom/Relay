import { renderToStaticMarkup } from "react-dom/server";
import { brand } from "../i18n/messages";
import { createUiContext } from "../i18n/context";
import { LanguageForm } from "../ui/language";
import { palette } from "../design/tokens";
import { Button } from "@/components/ui/button";
export function loginPage(
  locale: string,
  ready: boolean,
  denied: boolean,
  admin = false,
): string {
  const ui = createUiContext(locale),
    { t } = ui;
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
          <title>{brand}</title>
          <link rel="stylesheet" href="/assets/styles.css" />
          <link rel="manifest" href="/manifest.webmanifest" />
          <link rel="apple-touch-icon" href="/icons/icon-180.png" />
          <script defer src="/assets/session.js" />
        </head>
        <body>
          <main className="auth-page">
            <div className="stack">
              <h1>{admin ? t("admin") : brand}</h1>
              <p role="status">
                {t(admin && denied ? "adminDenied" : denied ? "authDenied" : ready ? (admin ? "adminLoginHint" : "loginHint") : "authSetup")}
              </p>
              {ready && (
                <Button asChild>
                  <a href={admin ? "/api/auth/start?destination=admin" : "/api/auth/start"}>{t("googleSignIn")}</a>
                </Button>
              )}
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
