import {brand} from '../i18n/messages';
import {createUiContext} from '../i18n/context';
import {languageForm} from '../ui/language';
import {palette} from '../design/tokens';
export function loginPage(locale:string,ready:boolean,denied:boolean):string{
 const ui=createUiContext(locale),{t}=ui;
 return `<!doctype html><html lang="${ui.language}" dir="${ui.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><meta name="theme-color" content="${palette.sub}"><title>${brand}</title><link rel="stylesheet" href="/assets/styles.css"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/icon-180.png"><script defer src="/assets/session.js"></script></head><body><main class="auth-page"><div class="stack"><h1>${brand}</h1><p role="status">${t(denied?'authDenied':ready?'loginHint':'authSetup')}</p>${ready?`<a class="button primary" href="/api/auth/start">${t('googleSignIn')}</a>`:''}<details class="disclosure"><summary>${t('language')}</summary>${languageForm(ui)}</details></div></main></body></html>`;
}
