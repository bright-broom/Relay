// Generated from src/server/handler.ts. Do not edit.

// src/server/config.ts
function allowed(email, list = process.env.ALLOWED_GOOGLE_EMAILS ?? "") {
  return typeof email === "string" && list.split(",").some((item) => item.trim().toLowerCase() === email.toLowerCase() && item.trim() !== "");
}
function origin() {
  const url = new URL(process.env.APP_ORIGIN ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("configuration");
  return url.origin;
}
function configured() {
  try {
    origin();
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.DATABASE_URL && process.env.ALLOWED_GOOGLE_EMAILS?.trim());
  } catch {
    return false;
  }
}
function lineConfigured() {
  return Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN);
}
function sameOrigin(request) {
  return request.headers.get("origin") === origin();
}

// src/server/auth.ts
import { createHash, randomBytes } from "node:crypto";
import * as oidc from "openid-client";

// src/server/access.ts
import { z } from "zod";
function addresses(raw) {
  return (raw ?? "").split(",").map((value) => value.trim().toLowerCase());
}
function administratorIssues(env = process.env) {
  const issues = [];
  for (const field of ["ALLOWED_GOOGLE_EMAILS", "ADMIN_GOOGLE_EMAILS"]) {
    if (!env[field]?.trim()) issues.push({ field, code: "missing" });
    else if (addresses(env[field]).some((value) => !z.email().safeParse(value).success))
      issues.push({ field, code: "invalid" });
  }
  if (!issues.length && addresses(env.ADMIN_GOOGLE_EMAILS).some((email) => !allowed(email, env.ALLOWED_GOOGLE_EMAILS)))
    issues.push({ field: "ADMIN_GOOGLE_EMAILS", code: "adminNotAllowed" });
  return issues;
}
function administratorAllowed(email) {
  return administratorIssues().length === 0 && allowed(email) && allowed(email, process.env.ADMIN_GOOGLE_EMAILS ?? "");
}

// src/server/database.ts
import postgres from "postgres";
function wrap(sql) {
  return {
    async query(text, values = []) {
      return await sql.unsafe(text, values);
    },
    async transaction(work) {
      if (!("begin" in sql)) return work(wrap(sql));
      return await sql.begin((tx) => work(wrap(tx)));
    }
  };
}
var connection;
function database() {
  if (!process.env.DATABASE_URL) throw new Error("configuration");
  return connection ??= wrap(postgres(process.env.DATABASE_URL, {
    ssl: "verify-full",
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10
  }));
}

// src/server/auth.ts
var sessionCookie = "__Host-relay-session";
var oauthCookie = "__Host-relay-oauth";
var hash = (value) => createHash("sha256").update(value).digest("hex");
var randomToken = () => randomBytes(32).toString("base64url");
function cookie(name, value, age) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
}
function readCookie(request, name) {
  const value = (request.headers.get("cookie") ?? "").split(";").map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
}
async function session(request, db = database()) {
  const token = readCookie(request, sessionCookie);
  if (!token) return null;
  const [row] = await db.query("SELECT email, subject FROM relay_private.sessions WHERE token_hash=$1 AND expires_at > now()", [hash(token)]);
  return row && allowed(row.email) ? row : null;
}
var provider;
function google() {
  return provider ??= oidc.discovery(new URL("https://accounts.google.com"), process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, void 0, { execute: [oidc.enableNonRepudiationChecks] }).catch((error) => {
    provider = void 0;
    throw error;
  });
}
async function startLogin(db = database(), configuration, destination = "/") {
  if (destination === "/admin" && administratorIssues().length)
    return new Response(null, { status: 303, headers: { Location: "/admin" } });
  const config = configuration ?? await google();
  const token = randomToken(), state = (destination === "/admin" ? "admin." : "") + oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier();
  await db.query("DELETE FROM relay_private.oauth_attempts WHERE expires_at < now()");
  await db.query("INSERT INTO relay_private.oauth_attempts(token_hash,state,nonce,verifier,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')", [hash(token), state, nonce, verifier]);
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: `${origin()}/api/auth/callback`,
    scope: "openid email",
    prompt: "select_account",
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256"
  });
  return new Response(null, { status: 303, headers: { Location: url.href, "Set-Cookie": cookie(oauthCookie, token, 600) } });
}
function verifiedIdentity(claims) {
  if (!claims || claims.email_verified !== true || !allowed(claims.email) || typeof claims.sub !== "string" || !claims.sub) return null;
  if (!claims.email.toLowerCase().endsWith("@gmail.com") && !(typeof claims.hd === "string" && claims.hd)) return null;
  return { email: claims.email.toLowerCase(), subject: claims.sub };
}
async function finishLogin(request, db = database(), configuration) {
  const token = readCookie(request, oauthCookie);
  const headers = new Headers({ "Set-Cookie": cookie(oauthCookie, "", 0) });
  let destination = "/";
  const failure = (reason = "denied") => {
    headers.set("Location", destination + "?auth=" + reason);
    return new Response(null, { status: 303, headers });
  };
  if (!token) return failure();
  const [attempt] = await db.query("DELETE FROM relay_private.oauth_attempts WHERE token_hash=$1 AND expires_at > now() RETURNING state,nonce,verifier", [hash(token)]);
  if (!attempt) return failure();
  destination = attempt.state.startsWith("admin.") ? "/admin" : "/";
  let verified = false;
  try {
    const callback = new URL(`${origin()}/api/auth/callback`);
    const incoming = new URL(request.url);
    for (const key of ["code", "state", "error", "error_description", "iss"]) for (const value of incoming.searchParams.getAll(key)) callback.searchParams.append(key, value);
    const tokens2 = await oidc.authorizationCodeGrant(configuration ?? await google(), callback, {
      pkceCodeVerifier: attempt.verifier,
      expectedState: attempt.state,
      expectedNonce: attempt.nonce,
      idTokenExpected: true
    });
    const identity = verifiedIdentity(tokens2.claims());
    if (!identity || destination === "/admin" && !administratorAllowed(identity.email)) return failure();
    verified = true;
    const newToken = randomToken();
    await db.transaction(async (tx) => {
      await tx.query("DELETE FROM relay_private.sessions WHERE expires_at < now() OR token_hash=$1", [hash(readCookie(request, sessionCookie))]);
      await tx.query("INSERT INTO relay_private.sessions(token_hash,subject,email,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')", [hash(newToken), identity.subject, identity.email]);
    });
    headers.append("Set-Cookie", cookie(sessionCookie, newToken, 28800));
    headers.set("Location", destination);
    return new Response(null, { status: 303, headers });
  } catch {
    return failure(verified ? "unavailable" : "denied");
  }
}
async function logout(request, db = database()) {
  await db.query("DELETE FROM relay_private.sessions WHERE token_hash=$1", [hash(readCookie(request, sessionCookie))]);
  const headers = new Headers({ "Set-Cookie": cookie(sessionCookie, "", 0) });
  headers.append("Set-Cookie", cookie(oauthCookie, "", 0));
  return Response.json({ ok: true }, { headers });
}

// src/server/line.ts
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

// src/i18n/messages.ts
import { createInstance } from "i18next";

// src/i18n/locales/ja.ts
var ja = {
  myPage: "\u30DE\u30A4\u30DA\u30FC\u30B8",
  myProfile: "\u30ED\u30B0\u30A4\u30F3\u60C5\u5831",
  myPageFailure: "\u30DE\u30A4\u30DA\u30FC\u30B8\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  myNotifications: "LINE\u901A\u77E5\u306E\u8A2D\u5B9A",
  myLanguage: "\u8868\u793A\u8A00\u8A9E",
  myGoogle: "Google\u3067\u30ED\u30B0\u30A4\u30F3\u4E2D",
  admin: "\u7BA1\u7406\u8005",
  adminLocked: "\u7BA1\u7406\u8005\u5C02\u7528\u30FB\u8A8D\u8A3C\u304C\u5FC5\u8981",
  adminGateTitle: "\u7BA1\u7406\u8005\u8A8D\u8A3C",
  adminContinueOnline: "\u516C\u958B\u7248\u306E\u7BA1\u7406\u8005\u30ED\u30B0\u30A4\u30F3\u30DA\u30FC\u30B8\u3078\u79FB\u52D5\u3057\u307E\u3059\u3002",
  adminLoginHint: "\u7BA1\u7406\u8005\u3068\u3057\u3066\u8A31\u53EF\u3055\u308C\u305FGoogle\u30A2\u30AB\u30A6\u30F3\u30C8\u3067\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  adminDenied: "\u3053\u306E\u30A2\u30AB\u30A6\u30F3\u30C8\u306B\u306F\u7BA1\u7406\u8005\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093\u3002",
  adminAccounts: "\u5229\u7528\u8A31\u53EF\u30A2\u30AB\u30A6\u30F3\u30C8",
  adminRole: "\u7BA1\u7406\u8005",
  memberRole: "\u30E1\u30F3\u30D0\u30FC",
  adminSessions: "\u6709\u52B9\u306A\u30ED\u30B0\u30A4\u30F3\u6570",
  adminSettings: "\u9023\u643A\u8A2D\u5B9A",
  adminGoogle: "Google\u8A8D\u8A3C",
  adminDatabase: "\u30C7\u30FC\u30BF\u30D9\u30FC\u30B9",
  adminLine: "LINE\u901A\u77E5",
  adminCalendar: "\u30AB\u30EC\u30F3\u30C0\u30FC\u6697\u53F7\u5316",
  adminConfigured: "\u8A2D\u5B9A\u6E08\u307F",
  adminNotConfigured: "\u672A\u8A2D\u5B9A",
  adminConfigurationHint: "\u8A2D\u5B9A\u306E\u6709\u7121\u3092\u8868\u793A\u3057\u3066\u3044\u307E\u3059\u3002\u5916\u90E8\u30B5\u30FC\u30D3\u30B9\u3068\u306E\u63A5\u7D9A\u6210\u529F\u3092\u793A\u3059\u3082\u306E\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
  adminReadOnly: "\u5229\u7528\u8A31\u53EF\u3068\u6A29\u9650\u3092\u78BA\u8A8D\u3067\u304D\u307E\u3059\u3002\u5909\u66F4\u306F\u904B\u7528\u62C5\u5F53\u8005\u306B\u4F9D\u983C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  adminFailure: "\u7BA1\u7406\u60C5\u5831\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  lineDestination: "\u901A\u77E5\u5148",
  loading: "\u8AAD\u307F\u8FBC\u307F\u4E2D",
  customValue: "\u305D\u306E\u4ED6\u30FB\u76F4\u63A5\u5165\u529B",
  customFor: "{field}\u3092\u76F4\u63A5\u5165\u529B",
  languageTag: "\u8A00\u8A9E\u30B3\u30FC\u30C9\u3092\u6307\u5B9A",
  amountZero: "0\u5186",
  amountZeroFor: "{field}\u30920\u5186\u306B\u3059\u308B",
  sourceQuote: "\u898B\u7A4D\u66F8",
  sourceInvoice: "\u8ACB\u6C42\u66F8",
  sourcePriceList: "\u6599\u91D1\u8868",
  sourceDate: "\u8CC7\u6599\u306E\u65E5\u4ED8",
  sourceReference: "\u8CC7\u6599\u540D\u30FB\u756A\u53F7\uFF08\u4EFB\u610F\uFF09",
  sourceReferenceRequired: "\u51FA\u5178\u306E\u8A73\u7D30",
  sourceInvalid: "\u51FA\u5178\u306E\u7A2E\u985E\u30FB\u6709\u52B9\u306A\u65E5\u4ED8\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u300C\u305D\u306E\u4ED6\u300D\u3067\u306F\u8A73\u7D30\u3082\u5FC5\u8981\u3067\u3059\u3002",
  scheduleVisit: "\u8A2A\u554F\u30FB\u5546\u8AC7",
  scheduleOnline: "\u30AA\u30F3\u30E9\u30A4\u30F3\u6253\u3061\u5408\u308F\u305B",
  scheduleCall: "\u96FB\u8A71\u3067\u78BA\u8A8D",
  scheduleReview: "\u793E\u5185\u6253\u3061\u5408\u308F\u305B",
  dateToday: "\u4ECA\u65E5",
  dateTomorrow: "\u660E\u65E5",
  dateNextWeek: "7\u65E5\u5F8C",
  scheduleRecalculate: "\u6761\u4EF6\u3092\u5909\u66F4\u3057\u307E\u3057\u305F\u3002\u5019\u88DC\u3092\u4F5C\u6210\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  originalData: "\u6848\u4EF6\u540D\u30FB\u4F1A\u8A71\u30FB\u6D3B\u52D5\u5C65\u6B74\u306F\u539F\u6587\u3067\u8868\u793A\u3057\u307E\u3059\u3002\u753B\u9762\u306E\u8A00\u8A9E\u3092\u5909\u3048\u3066\u3082\u696D\u52D9\u30C7\u30FC\u30BF\u306F\u66F8\u304D\u63DB\u3048\u307E\u305B\u3093\u3002",
  count_one: "{count}\u4EF6\u306E\u6848\u4EF6",
  handoffTemplate: "{name}\n\u6BB5\u968E: {stage}\n\u5BFE\u5FDC: {action}\n\u72B6\u614B: {status}\n\u62C5\u5F53: {owner}\n\u5F85\u3061\u5148: {waiting}\n\u671F\u9650: {due}\n\u6B21\u306E\u5BFE\u5FDC: {next}\n\u6839\u62E0: {evidence}\n\u8A18\u9332: {reports}\n\n{caution}",
  languageCoverage: "\u65E5\u672C\u8A9E\u30FB\u82F1\u8A9E\u306F\u7FFB\u8A33\u6E08\u307F\u3067\u3059\u3002\u4ED6\u306E\u8A00\u8A9E\u30B3\u30FC\u30C9\uFF08\u4F8B\uFF1Aar\u3001fr-CA\uFF09\u3082\u6307\u5B9A\u3067\u304D\u307E\u3059\u3002\u672A\u7FFB\u8A33\u306E\u753B\u9762\u306F\u82F1\u8A9E\u306B\u306A\u308A\u3001\u6570\u5024\u30FB\u65E5\u4ED8\u306E\u5F62\u5F0F\u3068\u6587\u5B57\u65B9\u5411\u306F\u6307\u5B9A\u8A00\u8A9E\u306B\u5408\u308F\u305B\u307E\u3059\u3002",
  applyLanguage: "\u9069\u7528",
  invalidLanguage: "ja\u3001en-US\u3001ar\u306A\u3069\u306E\u6709\u52B9\u306A\u8A00\u8A9E\u30B3\u30FC\u30C9\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  languageFallback: "\u3053\u306E\u8A00\u8A9E\u306E\u753B\u9762\u7FFB\u8A33\u306F\u672A\u63D0\u4F9B\u306E\u305F\u3081\u3001\u82F1\u8A9E\u3067\u8868\u793A\u3057\u3066\u3044\u307E\u3059\u3002",
  importSummary: "\u53D6\u8FBC\u7D50\u679C",
  pricingUpfrontSummary: "\u521D\u56DE\u306B\u5225\u9014 {amount}\u3002\u4E0B\u306E\u7DCF\u652F\u6255\u984D\u306B\u542B\u307F\u307E\u3059\u3002",
  pricingEstimateLabel: "\u6982\u7B97\u30FB\u7A0E\u8FBC",
  pricingMonthlyHeading: "\u6BCE\u6708\u306E\u304A\u652F\u6255\u3044",
  pricingMonthlyReduction: "\u6BCE\u6708 {amount} \u5C11\u306A\u304F",
  pricingMonthlyIncrease: "\u6BCE\u6708 {amount} \u591A\u304F",
  pricingMonthlySame: "\u6BCE\u6708\u306E\u652F\u6255\u984D\u306F\u540C\u3058",
  pricingDuringTerm: "\u5206\u5272\u6255\u3044\u4E2D\u306E\u6BD4\u8F03",
  pricingFromMonth: "{month}\u304B\u6708\u76EE\u304B\u3089",
  pricingConditionsHeading: "\u6BD4\u8F03\u306E\u6761\u4EF6",
  pricing: "\u6599\u91D1\u30B7\u30DF\u30E5\u30EC\u30FC\u30B7\u30E7\u30F3",
  pricingCurrent: "\u5C0E\u5165\u524D\u306E\u6708\u984D\uFF08\u7A0E\u8FBC\u30FB\u5186\uFF09",
  pricingRunning: "\u5C0E\u5165\u5F8C\u306E\u6708\u984D\uFF08\u7A0E\u8FBC\u30FB\u5186\uFF0F\u5206\u5272\u6255\u3044\u3092\u9664\u304F\uFF09",
  pricingUpfront: "\u521D\u671F\u8CBB\u7528\uFF08\u7A0E\u8FBC\u30FB\u5186\uFF0F\u982D\u91D1\u30FB\u624B\u6570\u6599\u306A\u3069\uFF09",
  pricingPayment: "\u5206\u5272\u6255\u3044\u306E\u6708\u984D\uFF08\u7A0E\u8FBC\u30FB\u5186\uFF09",
  pricingTerm: "\u5206\u5272\u6255\u3044\u306E\u671F\u9593",
  pricingHorizon: "\u6BD4\u8F03\u3059\u308B\u671F\u9593",
  pricingNoPayment: "\u5206\u5272\u6255\u3044\u306A\u3057",
  pricingMonths: "{count}\u304B\u6708",
  pricingAssumptions: "\u524D\u63D0\u30FB\u8A08\u7B97\u6839\u62E0",
  pricingSource: "\u91D1\u984D\u306E\u51FA\u5178",
  pricingConfirm: "\u5165\u529B\u91D1\u984D\u30FB\u8CBB\u7528\u306E\u7BC4\u56F2\u30FB\u6BD4\u8F03\u671F\u9593\u3092\u78BA\u8A8D\u3057\u305F",
  pricingPresent: "\u304A\u5BA2\u69D8\u306B\u63D0\u793A",
  pricingEdit: "\u6761\u4EF6\u3092\u5909\u66F4",
  pricingEmpty: "\u91D1\u984D\u3092\u5165\u529B\u3059\u308B\u3068\u6BD4\u8F03\u7D50\u679C\u304C\u8868\u793A\u3055\u308C\u307E\u3059\u3002",
  pricingInvalid: "\u91D1\u984D\u306F0\u301C9,999,999,999\u5186\u306E\u6574\u6570\u3001\u671F\u9593\u306F1\u301C420\u304B\u6708\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u5206\u5272\u6255\u3044\u306A\u3057\u306F\u6708\u984D\u30FB\u671F\u9593\u3068\u30820\u306B\u3057\u307E\u3059\u3002",
  pricingBefore: "\u5C0E\u5165\u524D",
  pricingAfter: "\u5C0E\u5165\u5F8C",
  pricingMonthly: "\u6708\u984D\uFF08\u5206\u5272\u6255\u3044\u4E2D\uFF09",
  pricingMonthlyPlain: "\u6708\u984D",
  pricingAfterTerm: "\u5206\u5272\u6255\u3044\u7D42\u4E86\u5F8C\u306E\u6708\u984D",
  pricingTotal: "\u6BD4\u8F03\u671F\u9593\u306E\u7DCF\u652F\u6255\u984D",
  pricingReduction: "\u652F\u6255\u3044\u304C\u6E1B\u308B\u984D",
  pricingIncrease: "\u652F\u6255\u3044\u304C\u5897\u3048\u308B\u984D",
  pricingSame: "\u652F\u6255\u3044\u306E\u5DEE\u984D",
  pricingRemaining: "\u6BD4\u8F03\u671F\u9593\u5F8C\u306B\u6B8B\u308B\u5206\u5272\u6255\u3044",
  pricingRemainingHint: "\u3053\u306E\u6B8B\u984D\u306F\u3001\u4E0A\u306E\u7DCF\u652F\u6255\u984D\u306B\u542B\u307E\u308C\u3066\u3044\u307E\u305B\u3093\u3002",
  pricingScope: "\u7A0E\u8FBC\u30FB\u5186\u3002\u6BCE\u6708\u306E\u8CBB\u7528\u306F\u4E00\u5B9A\u3001\u5206\u5272\u6255\u3044\u306F\u521D\u6708\u304B\u3089\u958B\u59CB\u3002\u521D\u671F\u8CBB\u7528\u306F\u5225\u9014\u52A0\u7B97\u3057\u307E\u3059\u3002\u88DC\u52A9\u91D1\u30FB\u58F2\u96FB\u53CE\u5165\u30FB\u4FA1\u683C\u5909\u52D5\u30FB\u5C06\u6765\u306E\u4EA4\u63DB\u8CBB\u7528\u306F\u8A08\u7B97\u306B\u542B\u307F\u307E\u305B\u3093\u3002\u878D\u8CC7\u6761\u4EF6\u3092\u7B97\u51FA\u3059\u308B\u6A5F\u80FD\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
  pricingEstimate: "\u5165\u529B\u6761\u4EF6\u306B\u57FA\u3065\u304F\u6982\u7B97\u3067\u3059\u3002\u5C06\u6765\u306E\u652F\u6255\u984D\u3084\u524A\u6E1B\u52B9\u679C\u3092\u4FDD\u8A3C\u3059\u308B\u3082\u306E\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
  pricingSession: "\u5165\u529B\u5185\u5BB9\u306F\u3001\u3053\u306E\u753B\u9762\u3092\u9589\u3058\u308B\u3068\u7834\u68C4\u3055\u308C\u307E\u3059\u3002",
  pricingFormulaBefore: "\u5C0E\u5165\u524D\uFF1A\u6708\u984D \xD7 \u6BD4\u8F03\u6708\u6570",
  pricingFormulaAfter: "\u5C0E\u5165\u5F8C\uFF1A\u521D\u671F\u8CBB\u7528 \uFF0B \u5C0E\u5165\u5F8C\u306E\u6708\u984D \xD7 \u6BD4\u8F03\u6708\u6570 \uFF0B \u5206\u5272\u6708\u984D \xD7 \u6BD4\u8F03\u671F\u9593\u5185\u306E\u652F\u6255\u56DE\u6570",
  pricingPrecision: "\u8A08\u7B97\u306F\u6574\u6570\u5186\u3002\u9014\u4E2D\u30FB\u8868\u793A\u3068\u3082\u7AEF\u6570\u306E\u4E38\u3081\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
  pricingVersion: "\u8A08\u7B97\u30D0\u30FC\u30B8\u30E7\u30F3\uFF1A{version}",
  pricingBreakdown: "\u7DCF\u652F\u6255\u984D\u306E\u5185\u8A33",
  pricingRunningTotal: "\u6BD4\u8F03\u671F\u9593\u306E\u6708\u984D\u8CBB\u7528\u5408\u8A08",
  pricingPaymentTotal: "\u6BD4\u8F03\u671F\u9593\u306E\u5206\u5272\u6255\u3044\u5408\u8A08",
  pricingEvidenceNeeded: "\u63D0\u793A\u3059\u308B\u306B\u306F\u3001\u91D1\u984D\u306E\u51FA\u5178\u3092\u5165\u529B\u3057\u3001\u6761\u4EF6\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  scheduling: "\u65E5\u7A0B\u3092\u7D44\u3080",
  calendarConnect: "Google\u30AB\u30EC\u30F3\u30C0\u30FC\u3092\u63A5\u7D9A",
  calendarDisconnect: "\u30AB\u30EC\u30F3\u30C0\u30FC\u9023\u643A\u3092\u89E3\u9664",
  calendarReady: "Google\u30AB\u30EC\u30F3\u30C0\u30FC\u3068\u63A5\u7D9A\u6E08\u307F",
  calendarSetup: "\u30AB\u30EC\u30F3\u30C0\u30FC\u306E\u63A5\u7D9A\u8A2D\u5B9A\u3092\u6E96\u5099\u3057\u3066\u3044\u307E\u3059\u3002",
  scheduleTitle: "\u4E88\u5B9A\u540D",
  scheduleDuration: "\u6240\u8981\u6642\u9593",
  scheduleDate: "\u958B\u59CB\u65E5",
  scheduleFind: "\u7A7A\u304D\u6642\u9593\u304B\u3089\u5019\u88DC\u3092\u4F5C\u6210",
  scheduleBook: "\u3053\u306E\u65E5\u6642\u3067\u767B\u9332",
  scheduleBooked: "Google\u30AB\u30EC\u30F3\u30C0\u30FC\u306B\u767B\u9332\u3057\u307E\u3057\u305F\u3002",
  scheduleEmpty: "\u6761\u4EF6\u306B\u5408\u3046\u7A7A\u304D\u6642\u9593\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u671F\u9593\u3084\u6642\u9593\u5E2F\u3092\u5909\u3048\u3066\u304F\u3060\u3055\u3044\u3002",
  scheduleOptions: "\u8ABF\u6574\u6761\u4EF6",
  scheduleZone: "\u30BF\u30A4\u30E0\u30BE\u30FC\u30F3",
  scheduleDays: "\u691C\u7D22\u671F\u9593",
  scheduleBuffer: "\u524D\u5F8C\u306E\u4F59\u88D5",
  scheduleHours: "\u55B6\u696D\u6642\u9593",
  scheduleStart: "\u958B\u59CB\u6642\u523B",
  scheduleEnd: "\u7D42\u4E86\u6642\u523B",
  scheduleMinutes: "{count}\u5206",
  scheduleDayCount: "{count}\u65E5\u9593",
  scheduleHint: "\u5E73\u65E5\u306E\u7A7A\u304D\u6642\u9593\u3092\u78BA\u8A8D\u3057\u307E\u3059\u3002\u767B\u9332\u76F4\u524D\u306B\u3082\u518D\u78BA\u8A8D\u3057\u307E\u3059\u3002\u62DB\u5F85\u30E1\u30FC\u30EB\u306F\u9001\u308A\u307E\u305B\u3093\u3002",
  scheduleExpired: "\u5019\u88DC\u306E\u671F\u9650\u304C\u5207\u308C\u307E\u3057\u305F\u3002\u3082\u3046\u4E00\u5EA6\u5019\u88DC\u3092\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  scheduleConflict: "\u3053\u306E\u6642\u9593\u306F\u5225\u306E\u4E88\u5B9A\u304C\u5165\u308A\u307E\u3057\u305F\u3002\u3082\u3046\u4E00\u5EA6\u5019\u88DC\u3092\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  scheduleReconnect: "Google\u30AB\u30EC\u30F3\u30C0\u30FC\u3092\u63A5\u7D9A\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  scheduleFailure: "\u51E6\u7406\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u767B\u9332\u7D50\u679C\u304C\u4E0D\u660E\u306A\u5834\u5408\u306F\u3001\u540C\u3058\u5019\u88DC\u3067\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  scheduleChanged: "\u30AB\u30EC\u30F3\u30C0\u30FC\u5074\u3067\u5909\u66F4\u307E\u305F\u306F\u524A\u9664\u3055\u308C\u3066\u3044\u307E\u3059\u3002Google\u30AB\u30EC\u30F3\u30C0\u30FC\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  scheduleDefaultTitle: "\u6253\u3061\u5408\u308F\u305B",
  scheduleWorkingDays: "\u5BFE\u8C61\u66DC\u65E5",
  scheduleWeekdays: "\u5E73\u65E5",
  scheduleEveryDay: "\u6BCE\u65E5",
  mcpSettings: "AI\u30C4\u30FC\u30EB\u3068\u306E\u9023\u643A",
  mcpRead: "\u7A7A\u304D\u6642\u9593\u306E\u78BA\u8A8D\u306E\u307F",
  mcpBook: "\u4E88\u5B9A\u306E\u767B\u9332\u3082\u8A31\u53EF",
  mcpIssue: "\u63A5\u7D9A\u30AD\u30FC\u3092\u767A\u884C",
  mcpRevoke: "\u63A5\u7D9A\u30AD\u30FC\u3092\u7121\u52B9\u5316",
  mcpCopy: "\u63A5\u7D9A\u60C5\u5831\u3092\u30B3\u30D4\u30FC",
  mcpHint: "MCP\u5BFE\u5FDC\u30C4\u30FC\u30EB\u7528\u3002\u63A5\u7D9A\u30AD\u30FC\u306F\u3053\u306E\u753B\u9762\u3067\u4E00\u5EA6\u3060\u3051\u8868\u793A\u3057\u307E\u3059\u3002\u6709\u52B9\u671F\u9650\u306F30\u65E5\u3067\u3059\u3002",
  mcpTokenLabel: "\u63A5\u7D9A\u30AD\u30FC",
  mcpEndpointLabel: "\u63A5\u7D9AURL",
  mcpStatusDescription: "\u63A5\u7D9A\u4E2D\u306E\u672C\u4EBA\u306EGoogle\u30AB\u30EC\u30F3\u30C0\u30FC\u63A5\u7D9A\u72B6\u614B\u3092\u8FD4\u3057\u307E\u3059\u3002",
  mcpFindDescription: "\u672C\u4EBA\u306E\u30E1\u30A4\u30F3\u30AB\u30EC\u30F3\u30C0\u30FC\u306E\u7A7A\u304D\u6642\u9593\u3092\u691C\u7D22\u3057\u307E\u3059\u3002\u55B6\u696D\u6642\u9593\u3001\u66DC\u65E5\u3001\u30BF\u30A4\u30E0\u30BE\u30FC\u30F3\u3001\u524D\u5F8C\u306E\u4F59\u88D5\u3092\u6307\u5B9A\u3067\u304D\u307E\u3059\u3002\u4E88\u5B9A\u3084\u53C2\u52A0\u8005\u306E\u5408\u610F\u3092\u4F5C\u6210\u3057\u307E\u305B\u3093\u3002",
  mcpProposeDescription: "\u672C\u4EBA\u306E\u30E1\u30A4\u30F3\u30AB\u30EC\u30F3\u30C0\u30FC\u3092\u78BA\u8A8D\u3057\u300115\u5206\u3067\u5931\u52B9\u3059\u308B\u65E5\u7A0B\u5019\u88DC\u3092\u4FDD\u5B58\u3057\u307E\u3059\u3002\u307E\u3060\u30AB\u30EC\u30F3\u30C0\u30FC\u306B\u306F\u767B\u9332\u3057\u307E\u305B\u3093\u3002\u30E6\u30FC\u30B6\u30FC\u306B\u5019\u88DC\u3092\u63D0\u793A\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  mcpBookDescription: "\u8A31\u53EF\u3055\u308C\u305F\u672C\u4EBA\u306E\u5019\u88DCID\u3067\u4E88\u5B9A\u3092\u767B\u9332\u3057\u307E\u3059\u3002\u4E88\u5B9A\u4F5C\u6210\u306E\u4F9D\u983C\u304C\u3042\u308B\u5834\u5408\u306B\u4F7F\u3044\u307E\u3059\u3002\u7A7A\u304D\u6642\u9593\u3092\u518D\u78BA\u8A8D\u3057\u3001\u540C\u3058\u5019\u88DC\u306E\u518D\u8A66\u884C\u3067\u306F\u91CD\u8907\u767B\u9332\u3057\u307E\u305B\u3093\u3002\u62DB\u5F85\u306F\u9001\u308A\u307E\u305B\u3093\u3002\u53C2\u52A0\u8005\u306E\u5408\u610F\u3092\u610F\u5473\u3057\u307E\u305B\u3093\u3002",
  mcpConnectHelp: "Relay\u306B\u30ED\u30B0\u30A4\u30F3\u3057\u3001\u30AB\u30EC\u30F3\u30C0\u30FC\u3092\u63A5\u7D9A\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  mcpRetryHelp: "\u5165\u529B\u6761\u4EF6\u307E\u305F\u306FRelay\u306E\u63A5\u7D9A\u72B6\u614B\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u5019\u88DC\u671F\u9650\u5207\u308C\u3084\u7AF6\u5408\u306E\u5834\u5408\u306F\u65B0\u3057\u3044\u5019\u88DC\u3092\u53D6\u5F97\u3057\u3001\u7D50\u679C\u4E0D\u660E\u306E\u5834\u5408\u306F\u540C\u3058\u5019\u88DCID\u3092\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  googleSignIn: "Google\u3067\u30ED\u30B0\u30A4\u30F3",
  loginHint: "\u767B\u9332\u6E08\u307F\u306EGoogle\u30A2\u30AB\u30A6\u30F3\u30C8\u3067\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  authUnavailable: "\u8A8D\u8A3C\u30B5\u30FC\u30D3\u30B9\u306B\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u3057\u3070\u3089\u304F\u5F85\u3063\u3066\u304B\u3089\u3001\u3082\u3046\u4E00\u5EA6Google\u3067\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  authSetup: "\u30ED\u30B0\u30A4\u30F3\u306B\u5FC5\u8981\u306A\u63A5\u7D9A\u8A2D\u5B9A\u304C\u5B8C\u4E86\u3057\u3066\u3044\u307E\u305B\u3093\u3002\u8A2D\u5B9A\u5B8C\u4E86\u5F8C\u306B\u66F4\u65B0\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  authDenied: "\u3053\u306E\u30A2\u30AB\u30A6\u30F3\u30C8\u3067\u306F\u5229\u7528\u3067\u304D\u306A\u3044\u304B\u3001\u30ED\u30B0\u30A4\u30F3\u306E\u6709\u52B9\u671F\u9650\u304C\u5207\u308C\u307E\u3057\u305F\u3002",
  signOut: "\u30ED\u30B0\u30A2\u30A6\u30C8",
  linePersonal: "\u500B\u4EBA\u306ELINE",
  lineGroup: "LINE\u30B0\u30EB\u30FC\u30D7",
  lineConnect: "\u9023\u643A\u30B3\u30FC\u30C9\u3092\u767A\u884C",
  lineCodeHint: "10\u5206\u4EE5\u5185\u306B\u3001\u8868\u793A\u3055\u308C\u305F\u30B3\u30FC\u30C9\u3092\u901A\u77E5\u5148\u306E\u30C8\u30FC\u30AF\u3078\u9001\u4FE1\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u305D\u306E\u5F8C\u3001\u3053\u3053\u3067\u66F4\u65B0\u3057\u3066\u9023\u643A\u3092\u78BA\u5B9A\u3057\u307E\u3059\u3002\u30B0\u30EB\u30FC\u30D7\u306F\u500B\u4EBALINE\u306E\u9023\u643A\u5F8C\u306B\u767B\u9332\u3067\u304D\u307E\u3059\u3002",
  lineConfirm: "\u3053\u306E\u901A\u77E5\u5148\u3092\u9023\u643A",
  lineRemove: "\u9023\u643A\u89E3\u9664",
  linePending: "\u78BA\u8A8D\u5F85\u3061",
  lineConnected: "\u9023\u643A\u6E08\u307F",
  lineTest: "\u30C6\u30B9\u30C8\u901A\u77E5\u3092\u9001\u4FE1",
  lineTestMessage: "Relay\u304B\u3089\u306E\u30C6\u30B9\u30C8\u901A\u77E5\u3067\u3059\u3002\u901A\u77E5\u5148\u306E\u9023\u643A\u3092\u78BA\u8A8D\u3057\u307E\u3057\u305F\u3002",
  lineSent: "LINE\u304C\u901A\u77E5\u3092\u53D7\u3051\u4ED8\u3051\u307E\u3057\u305F\u3002\u30C8\u30FC\u30AF\u3092\u3054\u78BA\u8A8D\u304F\u3060\u3055\u3044\u3002",
  lineSetup: "LINE\u63A5\u7D9A\u306E\u8A2D\u5B9A\u304C\u5B8C\u4E86\u3057\u3066\u3044\u307E\u305B\u3093\u3002",
  integrationFailure: "\u51E6\u7406\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u6642\u9593\u3092\u304A\u3044\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  personalFirst: "\u5148\u306B\u500B\u4EBALINE\u3092\u9023\u643A\u30FB\u78BA\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  lineRetry: "\u9001\u4FE1\u7D50\u679C\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3002\u540C\u3058\u901A\u77E5\u3092\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  lineRateLimit: "\u901A\u77E5\u306E\u4E0A\u9650\u306B\u9054\u3057\u307E\u3057\u305F\u30021\u6642\u9593\u307B\u3069\u304A\u5F85\u3061\u304F\u3060\u3055\u3044\u3002",
  refreshConnections: "\u66F4\u65B0",
  authOnline: "\u5229\u7528\u306B\u306F\u30AA\u30F3\u30E9\u30A4\u30F3\u3067\u306E\u30ED\u30B0\u30A4\u30F3\u78BA\u8A8D\u304C\u5FC5\u8981\u3067\u3059\u3002",
  copyLinkCode: "\u9023\u643A\u30B3\u30FC\u30C9\u3092\u30B3\u30D4\u30FC",
  storageConflict: "\u5225\u306E\u753B\u9762\u3067\u8A18\u9332\u304C\u66F4\u65B0\u3055\u308C\u307E\u3057\u305F\u3002\u3053\u306E\u753B\u9762\u306E\u5165\u529B\u3092\u30B3\u30D4\u30FC\u3057\u3066\u304B\u3089\u3001\u958B\u304D\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  localFailure: "\u7AEF\u672B\u306B\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3002\u8A18\u9332\u3092\u30B3\u30D4\u30FC\u3057\u3066\u4FDD\u7BA1\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  offlineUnavailable: "\u30A2\u30D7\u30EA\u3092\u66F4\u65B0\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u63A5\u7D9A\u3092\u78BA\u8A8D\u3057\u3066\u518D\u5EA6\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002",
  offlineStatus: "\u30AA\u30D5\u30E9\u30A4\u30F3 \xB7 \u518D\u63A5\u7D9A\u3057\u3066\u30ED\u30B0\u30A4\u30F3\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  onlineStatus: "\u63A5\u7D9A\u304C\u623B\u308A\u307E\u3057\u305F\u3002",
  resetDemo: "\u30B5\u30F3\u30D7\u30EB\u3092\u521D\u671F\u5316",
  resetConfirm: "\u3053\u306E\u7AEF\u672B\u306E\u8A18\u9332\u3068\u4E0B\u66F8\u304D\u3092\u524A\u9664\u3057\u3066\u3001\u30B5\u30F3\u30D7\u30EB\u3092\u521D\u671F\u5316\u3057\u307E\u3059\u304B\uFF1F",
  filterLabel: "\u8868\u793A\u6761\u4EF6",
  allStatuses: "\u3059\u3079\u3066\u306E\u72B6\u614B",
  noteOptional: "\u88DC\u8DB3\uFF08\u4EFB\u610F\uFF09",
  recordMethod: "\u9023\u7D61\u65B9\u6CD5",
  recordOutcome: "\u7D50\u679C",
  recordMode: "\u4FDD\u5B58\u65B9\u6CD5",
  recordOnly: "\u8A18\u9332\u306E\u307F",
  recordAndComplete: "\u8A18\u9332\u3057\u3066\u5B8C\u4E86",
  choose: "\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044",
  chooseChannel: "\u9023\u7D61\u65B9\u6CD5\u3092\u9078\u3093\u3067\u304F\u3060\u3055\u3044\u3002",
  chooseOutcome: "\u7D50\u679C\u3092\u9078\u3093\u3067\u304F\u3060\u3055\u3044\u3002",
  completeMismatch: "\u5B8C\u4E86\u306B\u3059\u308B\u306B\u306F\u3001\u7D50\u679C\u3067\u300C\u3053\u306E\u5BFE\u5FDC\u3092\u5B8C\u4E86\u300D\u3092\u9078\u3093\u3067\u304F\u3060\u3055\u3044\u3002",
  channelPhone: "\u96FB\u8A71",
  channelEmail: "\u30E1\u30FC\u30EB",
  channelChat: "\u30C1\u30E3\u30C3\u30C8",
  channelMeeting: "\u9762\u8AC7",
  channelOther: "\u305D\u306E\u4ED6",
  resultAgreed: "\u76F8\u624B\u304C\u4E86\u627F",
  resultNoAnswer: "\u5FDC\u7B54\u306A\u3057",
  resultFollowup: "\u78BA\u8A8D\u30FB\u8FD4\u7B54\u5F85\u3061",
  resultCompleted: "\u3053\u306E\u5BFE\u5FDC\u3092\u5B8C\u4E86",
  resultOther: "\u305D\u306E\u4ED6",
  structuredReport: "{channel}\uFF1A{outcome}",
  structuredReportNote: "{report}\n\u88DC\u8DB3\uFF1A{note}",
  saveRecord: "\u4FDD\u5B58",
  saveComplete: "\u4FDD\u5B58\u3057\u3066\u5B8C\u4E86",
  context: "\u80CC\u666F",
  previewInfo: "\u30D7\u30EC\u30D3\u30E5\u30FC\u306B\u3064\u3044\u3066",
  reviewPending: "\u672A\u78BA\u8A8D\u306E\u66F4\u65B0\u6848",
  searchShort: "\u691C\u7D22",
  recordNotePlaceholder: "\u5FC5\u8981\u306A\u3068\u304D\u3060\u3051\u88DC\u8DB3",
  sampleSource: "\u67B6\u7A7A\u306E\u4F1A\u8A71\u30B5\u30F3\u30D7\u30EB",
  noteRequired: "\u88DC\u8DB3\uFF08\u305D\u306E\u4ED6\u306E\u5185\u5BB9\uFF09",
  activity: "\u5BFE\u5FDC\u8A18\u9332",
  previewShort: "\u30D7\u30EC\u30D3\u30E5\u30FC",
  app: "Relay \xB7 \u6848\u4EF6\u30EF\u30FC\u30AF\u30B9\u30DA\u30FC\u30B9",
  today: "\u4ECA\u65E5\u306E\u5BFE\u5FDC",
  cases: "\u6848\u4EF6\u4E00\u89A7",
  reviews: "\u66F4\u65B0\u6848\u306E\u78BA\u8A8D",
  imports: "\u60C5\u5831\u306E\u53D6\u8FBC",
  demoNote: "\u67B6\u7A7A\u30C7\u30FC\u30BF \xB7 \u5916\u90E8\u63A5\u7D9A\u306A\u3057",
  language: "\u8868\u793A\u8A00\u8A9E",
  menu: "\u30E1\u30CB\u30E5\u30FC",
  skip: "\u672C\u6587\u3078\u79FB\u52D5",
  dueToday: "\u672C\u65E5\u307E\u3067",
  overdue: "\u671F\u9650\u8D85\u904E",
  unassigned: "\u672A\u8A2D\u5B9A",
  asOf: "\u60C5\u5831\u57FA\u6E96\uFF1A2026\u5E749\u670811\u65E5 10:30",
  reviewOpen: "\u66F4\u65B0\u6848\u3078",
  browse: "\u6848\u4EF6\u3092\u898B\u308B",
  open: "\u8A73\u7D30\u3092\u958B\u304F",
  owner: "\u793E\u5185\u62C5\u5F53",
  waiting: "\u5F85\u3063\u3066\u3044\u308B\u76F8\u624B",
  due: "\u5BFE\u5FDC\u671F\u9650",
  stage: "\u9032\u884C\u6BB5\u968E",
  next: "\u6B21\u306E\u4E88\u5B9A",
  status: "\u72B6\u614B",
  name: "\u304A\u5BA2\u69D8",
  action: "\u6B21\u306E\u5BFE\u5FDC",
  casesTitle: "\u6848\u4EF6\u4E00\u89A7",
  search: "\u9867\u5BA2\u540D\u30FB\u30A8\u30EA\u30A2\u30FB\u5BFE\u5FDC\u5185\u5BB9\u3067\u691C\u7D22",
  allOwners: "\u3059\u3079\u3066\u306E\u62C5\u5F53\u8005",
  all: "\u3059\u3079\u3066",
  needsAttention: "\u4ECA\u65E5\u307E\u3067\u306E\u5BFE\u5FDC",
  unknown: "\u62C5\u5F53\u672A\u8A2D\u5B9A",
  count: "{count}\u4EF6\u306E\u6848\u4EF6",
  noResults: "\u6761\u4EF6\u306B\u5408\u3046\u6848\u4EF6\u304C\u3042\u308A\u307E\u305B\u3093",
  noResultsSub: "\u691C\u7D22\u3059\u308B\u8A00\u8449\u3084\u62C5\u5F53\u8005\u3092\u5909\u66F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  resetFilters: "\u6761\u4EF6\u3092\u89E3\u9664\u3059\u308B",
  todo: "\u672A\u7740\u624B",
  doing: "\u5BFE\u5FDC\u4E2D",
  awaiting: "\u76F8\u624B\u5F85\u3061",
  done: "\u5B8C\u4E86",
  dueNow: "\u672C\u65E5 17:00",
  dueDay: "\u672C\u65E5\u4E2D",
  dueUnknown: "\u672A\u8A2D\u5B9A",
  overdueDate: "9\u670810\u65E5",
  futureDate: "9\u670814\u65E5",
  stageSchedule: "\u5546\u8AC7\u8ABF\u6574",
  stageContract: "\u5951\u7D04\u5F8C\u5BFE\u5FDC",
  stageInstall: "\u5DE5\u4E8B\u8ABF\u6574",
  back: "\u6848\u4EF6\u4E00\u89A7\u3078\u623B\u308B",
  timeline: "\u5C65\u6B74",
  evidence: "\u6839\u62E0",
  evidenceOrigin: "\u696D\u52D9LINE \xB7 \u65E5\u672C\u8A9E\u306E\u67B6\u7A7A\u306E\u4F1A\u8A71",
  reportError: "\u300C\u305D\u306E\u4ED6\u300D\u306E\u5185\u5BB9\u30925\u6587\u5B57\u4EE5\u4E0A\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  reportSaved: "\u5BFE\u5FDC\u30E1\u30E2\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F\u3002",
  taskCompleted: "\u62C5\u5F53\u8005\u306E\u5831\u544A\u306B\u57FA\u3065\u304D\u3001\u3053\u306E\u30BF\u30B9\u30AF\u3092\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002",
  reported: "\u672C\u4EBA\u306B\u3088\u308B\u5831\u544A",
  reports: "\u62C5\u5F53\u8005\u306E\u8A18\u9332",
  handoff: "\u5F15\u304D\u7D99\u304E\u3092\u4F5C\u6210",
  handoffHeading: "\u5F15\u304D\u7D99\u304E\u30E1\u30E2",
  close: "\u9589\u3058\u308B",
  copy: "\u30B3\u30D4\u30FC\u3059\u308B",
  copied: "\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\u3002\u5916\u90E8\u3078\u306E\u9001\u4FE1\u306F\u3057\u3066\u3044\u307E\u305B\u3093\u3002",
  copyError: "\u81EA\u52D5\u30B3\u30D4\u30FC\u3067\u304D\u307E\u305B\u3093\u3002\u8868\u793A\u6587\u3092\u9078\u629E\u3057\u3066\u30B3\u30D4\u30FC\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  noReport: "\u5BFE\u5FDC\u8A18\u9332\u306A\u3057",
  handoffCaution: "\u3053\u306E\u6587\u306F\u53D6\u5F97\u6E08\u307F\u306E\u67B6\u7A7A\u30C7\u30FC\u30BF\u306B\u57FA\u3065\u304F\u30D7\u30EC\u30D3\u30E5\u30FC\u3067\u3059\u3002",
  proposal: "\u65B0\u3057\u3044\u4F1A\u8A71\u304B\u3089\u4F5C\u6210",
  proposalHeading: "\u9867\u5BA2A\u69D8\u306E\u73FE\u8ABF\u65E5\u306B\u3064\u3044\u3066",
  before: "\u3053\u308C\u307E\u3067",
  after: "\u53CD\u6620\u3059\u308B\u5185\u5BB9",
  beforeText: "\u304A\u5BA2\u69D8\u3078\u73FE\u8ABF\u5019\u88DC\u65E5\u3092\u78BA\u8A8D",
  afterText: "\u5DE5\u4E8B\u4F1A\u793E\u3078\u73FE\u8ABF\u65E5\u306E\u78BA\u5B9A\u9023\u7D61",
  reviewCaution: "\u5DE5\u4E8B\u4F1A\u793E\u306F\u672A\u4E86\u627F\u3002\u73FE\u8ABF\u65E5\u306F\u5019\u88DC\u3067\u3059\u3002",
  approve: "\u53CD\u6620",
  reject: "\u5374\u4E0B",
  reviewComplete: "\u66F4\u65B0\u6848\u3092\u53CD\u6620\u3057\u307E\u3057\u305F",
  reviewRejected: "\u66F4\u65B0\u6848\u3092\u5374\u4E0B\u3057\u307E\u3057\u305F",
  reviewConflict: "\u8A18\u9332\u304C\u66F4\u65B0\u3055\u308C\u3066\u3044\u307E\u3059\u3002\u3053\u306E\u66F4\u65B0\u6848\u306F\u53CD\u6620\u3067\u304D\u307E\u305B\u3093\u3002\u30B5\u30F3\u30D7\u30EB\u3092\u3084\u308A\u76F4\u3059\u5834\u5408\u306F\u60C5\u5831\u30E1\u30CB\u30E5\u30FC\u304B\u3089\u521D\u671F\u5316\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  sample: "\u30B5\u30F3\u30D7\u30EB\u7D50\u679C\u3092\u898B\u308B",
  sampleShown: "\u30B5\u30F3\u30D7\u30EB\u7D50\u679C\u3092\u8868\u793A\u4E2D",
  file: "\u5C65\u6B74\u30D5\u30A1\u30A4\u30EB",
  duplicates: "\u91CD\u8907\u3057\u305F\u6295\u7A3F",
  newMessages: "\u65B0\u3057\u3044\u6295\u7A3F",
  two: "2\u4EF6\u3092\u9664\u5916",
  one: "1\u4EF6 \u2192 \u66F4\u65B0\u6848\u3092\u4F5C\u6210",
  importNote: "\u30D5\u30A1\u30A4\u30EB\u306E\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3084AI\u89E3\u6790\u306F\u884C\u3063\u3066\u3044\u307E\u305B\u3093\u3002",
  overdueDeadline: "\u671F\u9650\u8D85\u904E \xB7 {date}",
  emptyToday: "\u4ECA\u65E5\u307E\u3067\u306E\u5BFE\u5FDC\u306F\u5B8C\u4E86\u3057\u307E\u3057\u305F",
  previewFooter: "\u8A18\u9332\u306F\u3053\u306E\u7AEF\u672B\u306E\u30D6\u30E9\u30A6\u30B6\u30FC\u306B\u4FDD\u5B58\u3055\u308C\u307E\u3059\u3002\u7AEF\u672B\u9593\u306E\u540C\u671F\u306F\u3042\u308A\u307E\u305B\u3093\u3002\u30D6\u30E9\u30A6\u30B6\u30FC\u30C7\u30FC\u30BF\u306E\u524A\u9664\u3067\u8A18\u9332\u3082\u6D88\u3048\u307E\u3059\u3002"
};

// src/i18n/locales/en.ts
var en = {
  myPage: "My page",
  myProfile: "Sign-in details",
  myPageFailure: "Could not load your profile. Please refresh.",
  myNotifications: "LINE notification settings",
  myLanguage: "Display language",
  myGoogle: "Signed in with Google",
  admin: "Administration",
  adminLocked: "Administration \xB7 authorization required",
  adminGateTitle: "Administrator sign-in",
  adminContinueOnline: "Continue to the administrator sign-in page on the live app.",
  adminLoginHint: "Sign in with a Google account authorized as an administrator.",
  adminDenied: "This account does not have administrator access.",
  adminAccounts: "Allowed accounts",
  adminRole: "Administrator",
  memberRole: "Member",
  adminSessions: "Active sessions",
  adminSettings: "Integration configuration",
  adminGoogle: "Google authentication",
  adminDatabase: "Database",
  adminLine: "LINE notifications",
  adminCalendar: "Calendar encryption",
  adminConfigured: "Configured",
  adminNotConfigured: "Not configured",
  adminConfigurationHint: "These indicators show configuration presence, not successful connections to external services.",
  adminReadOnly: "Review access and roles here. Ask your operator to make changes.",
  adminFailure: "Could not load administration data. Please reload.",
  lineDestination: "Notification destination",
  loading: "Loading",
  customValue: "Other / custom",
  customFor: "Custom {field}",
  languageTag: "Enter a language tag",
  amountZero: "Zero",
  amountZeroFor: "Set {field} to zero",
  sourceQuote: "Quote",
  sourceInvoice: "Invoice",
  sourcePriceList: "Price list",
  sourceDate: "Source date",
  sourceReference: "Source name / number (optional)",
  sourceReferenceRequired: "Source details",
  sourceInvalid: "Select a source type and a valid date. Other sources also need details.",
  scheduleVisit: "Visit / sales meeting",
  scheduleOnline: "Online meeting",
  scheduleCall: "Follow-up call",
  scheduleReview: "Internal meeting",
  dateToday: "Today",
  dateTomorrow: "Tomorrow",
  dateNextWeek: "In 7 days",
  scheduleRecalculate: "Conditions changed. Find new time slots.",
  originalData: "Case names, conversations and activity history stay in their original language. Changing the UI language does not rewrite business data.",
  count_one: "{count} case",
  handoffTemplate: "{name}\nStage: {stage}\nAction: {action}\nStatus: {status}\nOwner: {owner}\nWaiting on: {waiting}\nDue: {due}\nNext action: {next}\nEvidence: {evidence}\nReports: {reports}\n\n{caution}",
  languageCoverage: "Japanese and English are translated. You can enter any valid language tag (e.g. ar or fr-CA). Untranslated text falls back to English; number/date formats and direction follow your locale.",
  applyLanguage: "Apply",
  invalidLanguage: "Enter a valid language tag such as ja, en-US or ar.",
  languageFallback: "UI translations for this locale are not available. Text is shown in English.",
  importSummary: "Import summary",
  pricingUpfrontSummary: "An additional {amount} is due upfront, included in the total below.",
  pricingEstimateLabel: "Estimate \xB7 tax included",
  pricingMonthlyHeading: "Your monthly payment",
  pricingMonthlyReduction: "{amount} less each month",
  pricingMonthlyIncrease: "{amount} more each month",
  pricingMonthlySame: "The same monthly payment",
  pricingDuringTerm: "During installments",
  pricingFromMonth: "From month {month}",
  pricingConditionsHeading: "Comparison terms",
  pricing: "Cost comparison",
  pricingCurrent: "Current monthly cost (JPY, tax included)",
  pricingRunning: "New monthly cost (JPY, tax included, excluding installments)",
  pricingUpfront: "Upfront cost (JPY, including tax, deposit and fees)",
  pricingPayment: "Monthly installment (JPY, tax included)",
  pricingTerm: "Installment term",
  pricingHorizon: "Comparison period",
  pricingNoPayment: "No installments",
  pricingMonths: "{count} months",
  pricingAssumptions: "Assumptions and calculation",
  pricingSource: "Cost source",
  pricingConfirm: "I checked the amounts, included costs and comparison period",
  pricingPresent: "Present to customer",
  pricingEdit: "Edit assumptions",
  pricingEmpty: "Enter the costs to see a comparison.",
  pricingInvalid: "Enter whole-yen amounts from 0 to 9,999,999,999 and periods from 1 to 420 months. No installments requires both monthly payment and term to be zero.",
  pricingBefore: "Before",
  pricingAfter: "After",
  pricingMonthly: "Monthly cost during installments",
  pricingMonthlyPlain: "Monthly cost",
  pricingAfterTerm: "Monthly cost after installments",
  pricingTotal: "Total cost within comparison period",
  pricingReduction: "Cost reduction",
  pricingIncrease: "Cost increase",
  pricingSame: "Cost difference",
  pricingRemaining: "Installments remaining after comparison period",
  pricingRemainingHint: "This remaining amount is not included in the total above.",
  pricingScope: "JPY, tax included. Monthly costs stay constant; installments start in month one. Upfront costs are added separately. Subsidies, income, price changes and future replacement costs are excluded. This tool does not determine lending terms.",
  pricingEstimate: "Estimate based on the entered assumptions. Future costs and savings are not guaranteed.",
  pricingSession: "Inputs are discarded when you close this screen.",
  pricingFormulaBefore: "Before: monthly cost \xD7 comparison months",
  pricingFormulaAfter: "After: upfront cost + new monthly cost \xD7 comparison months + installment \xD7 payments within the comparison period",
  pricingPrecision: "Whole-yen calculations; no intermediate or display rounding.",
  pricingVersion: "Calculation version: {version}",
  pricingBreakdown: "Total cost breakdown",
  pricingRunningTotal: "Recurring costs within comparison period",
  pricingPaymentTotal: "Installments within comparison period",
  pricingEvidenceNeeded: "To present, enter the cost source and confirm the assumptions.",
  scheduling: "Schedule",
  calendarConnect: "Connect Google Calendar",
  calendarDisconnect: "Disconnect calendar",
  calendarReady: "Google Calendar connected",
  calendarSetup: "Calendar connection setup is in progress.",
  scheduleTitle: "Event title",
  scheduleDuration: "Duration",
  scheduleDate: "Starting date",
  scheduleFind: "Find available times",
  scheduleBook: "Book this time",
  scheduleBooked: "Added to Google Calendar.",
  scheduleEmpty: "No times match these conditions. Change the dates or working hours.",
  scheduleOptions: "Scheduling preferences",
  scheduleZone: "Time zone",
  scheduleDays: "Search period",
  scheduleBuffer: "Buffer before and after",
  scheduleHours: "Working hours",
  scheduleStart: "Starting hour",
  scheduleEnd: "Ending hour",
  scheduleMinutes: "{count} minutes",
  scheduleDayCount: "{count} days",
  scheduleHint: "Checks weekday availability, then checks again before booking. No invitations are sent.",
  scheduleExpired: "This proposal expired. Find available times again.",
  scheduleConflict: "Another event occupies this time. Find available times again.",
  scheduleReconnect: "Reconnect Google Calendar.",
  scheduleFailure: "Could not complete the request. If the booking result is uncertain, retry the same proposal.",
  scheduleChanged: "The event was changed or deleted in Google Calendar. Check your calendar.",
  scheduleDefaultTitle: "Meeting",
  scheduleWorkingDays: "Days of the week",
  scheduleWeekdays: "Weekdays",
  scheduleEveryDay: "Every day",
  mcpSettings: "AI tool connections",
  mcpRead: "Availability only",
  mcpBook: "Allow event creation too",
  mcpIssue: "Create connection key",
  mcpRevoke: "Revoke connection key",
  mcpCopy: "Copy connection settings",
  mcpHint: "For MCP clients. The key is shown only once and expires in 30 days.",
  mcpTokenLabel: "Connection key",
  mcpEndpointLabel: "Endpoint",
  mcpStatusDescription: "Returns Google Calendar connection status for the authenticated caller only.",
  mcpFindDescription: "Finds free times in the caller primary calendar using dates, IANA time zone, working hours, weekdays and buffers. Does not create events or obtain attendee consent.",
  mcpProposeDescription: "Checks the caller primary calendar and stores candidate slots expiring in 15 minutes. Does not create Google events. Present candidates to the user.",
  mcpBookDescription: "Books an owned proposal ID when the user has authorized event creation. Rechecks availability; retrying the same proposal does not duplicate the event. Sends no invitations and does not imply attendee agreement.",
  mcpConnectHelp: "Sign in to Relay and reconnect Google Calendar.",
  mcpRetryHelp: "Check the input and Relay connection. For expired or occupied slots, create fresh proposals. For uncertain booking outcomes, retry the same proposal ID.",
  googleSignIn: "Sign in with Google",
  loginHint: "Sign in with an approved Google account.",
  authUnavailable: "The sign-in service could not be reached. Wait a moment, then try signing in with Google again.",
  authSetup: "Sign-in setup is incomplete. Refresh this page after setup is complete.",
  authDenied: "This account is not allowed, or the sign-in attempt has expired.",
  signOut: "Sign out",
  linePersonal: "Personal LINE",
  lineGroup: "LINE group",
  lineConnect: "Create linking code",
  lineCodeHint: "Send this code to the destination chat within 10 minutes. Then refresh here and confirm the connection. Connect your personal LINE before a group.",
  lineConfirm: "Confirm this destination",
  lineRemove: "Disconnect",
  linePending: "Awaiting confirmation",
  lineConnected: "Connected",
  lineTest: "Send test notification",
  lineTestMessage: "This is a test notification from Relay. Your notification destination is connected.",
  lineSent: "LINE accepted the notification. Please check the chat.",
  lineSetup: "LINE connection setup is incomplete.",
  integrationFailure: "Could not complete the request. Please try again later.",
  personalFirst: "Connect and confirm your personal LINE first.",
  lineRetry: "Delivery could not be confirmed. Retry the same notification.",
  lineRateLimit: "Notification limit reached. Please wait about an hour.",
  refreshConnections: "Refresh",
  authOnline: "An online sign-in check is required to use Relay.",
  copyLinkCode: "Copy linking code",
  storageConflict: "Another window saved newer records. Copy your input before reopening this page.",
  localFailure: "Device storage failed. Copy your records to keep them.",
  offlineUnavailable: "The app could not be updated. Check your connection and open the app again.",
  offlineStatus: "Offline \xB7 Reconnect to verify your sign-in.",
  onlineStatus: "Connection restored.",
  resetDemo: "Reset sample",
  resetConfirm: "Delete records and drafts on this device and reset the sample?",
  filterLabel: "View filter",
  allStatuses: "All statuses",
  noteOptional: "Note (optional)",
  recordMethod: "Contact method",
  recordOutcome: "Outcome",
  recordMode: "Save as",
  recordOnly: "Record only",
  recordAndComplete: "Record and complete",
  choose: "Select an option",
  chooseChannel: "Select a contact method.",
  chooseOutcome: "Select an outcome.",
  completeMismatch: "Choose \u201CThis action completed\u201D before completing the task.",
  channelPhone: "Phone",
  channelEmail: "Email",
  channelChat: "Chat",
  channelMeeting: "Meeting",
  channelOther: "Other",
  resultAgreed: "Other party agreed",
  resultNoAnswer: "No response",
  resultFollowup: "Awaiting confirmation",
  resultCompleted: "This action completed",
  resultOther: "Other",
  structuredReport: "{channel}: {outcome}",
  structuredReportNote: "{report}\nNote: {note}",
  saveRecord: "Save",
  saveComplete: "Save and complete",
  context: "Context",
  previewInfo: "About this preview",
  reviewPending: "Pending updates",
  searchShort: "Search",
  recordNotePlaceholder: "Add context if needed",
  sampleSource: "Fictional conversation sample",
  noteRequired: "Note (describe other)",
  activity: "Activity",
  previewShort: "Preview",
  app: "Relay \xB7 Case workspace",
  today: "Today",
  cases: "Cases",
  reviews: "Review updates",
  imports: "Import conversations",
  demoNote: "Sample data \xB7 No connections",
  language: "Display language",
  menu: "Menu",
  skip: "Skip to content",
  dueToday: "Due by today",
  overdue: "Past due",
  unassigned: "Owner or date needed",
  asOf: "Information as of Sep 11, 2026, 10:30 JST",
  reviewOpen: "Review the update",
  browse: "Explore cases",
  open: "Open details",
  owner: "Internal owner",
  waiting: "Waiting for",
  due: "Response deadline",
  stage: "Case stage",
  next: "Next appointment",
  status: "Status",
  name: "Customer",
  action: "Next action",
  casesTitle: "All cases",
  search: "Search customers, areas, or actions",
  allOwners: "All owners",
  all: "All",
  needsAttention: "Due by today",
  unknown: "Unassigned",
  count: "{count} cases",
  noResults: "No cases match your filters",
  noResultsSub: "Try a different search or owner.",
  resetFilters: "Clear filters",
  todo: "To do",
  doing: "In progress",
  awaiting: "Waiting",
  done: "Completed",
  dueNow: "Today, 17:00",
  dueDay: "Today",
  dueUnknown: "Not set",
  overdueDate: "September 10",
  futureDate: "September 14",
  stageSchedule: "Meeting scheduling",
  stageContract: "Post-contract",
  stageInstall: "Installation scheduling",
  back: "Back to cases",
  timeline: "The story so far",
  evidence: "Supporting evidence",
  evidenceOrigin: "Work chat \xB7 Fictional Japanese conversation",
  reportError: "Describe \u201COther\u201D in at least five characters.",
  reportSaved: "Your note has been saved.",
  taskCompleted: "This task was completed based on your report.",
  reported: "Self-reported outcome",
  reports: "Team reports",
  handoff: "Prepare handoff",
  handoffHeading: "Handoff note",
  close: "Close",
  copy: "Copy text",
  copied: "Copied. Nothing was sent externally.",
  copyError: "Automatic copy failed. Select and copy the displayed text.",
  noReport: "No report recorded",
  handoffCaution: "This preview is based on available fictional records.",
  proposal: "From a new conversation",
  proposalHeading: "Customer A \xB7 Site visit",
  before: "Previously",
  after: "Proposed change",
  beforeText: "Confirm the proposed visit date with the customer",
  afterText: "Confirm the visit date with the installation team",
  reviewCaution: "Tentative: installation team approval is pending.",
  approve: "Apply",
  reject: "Reject",
  reviewComplete: "The update has been applied",
  reviewRejected: "The update has been rejected",
  reviewConflict: "This case has changed. The update cannot be applied. To restart the sample, reset it from the information menu.",
  sample: "View sample result",
  sampleShown: "Showing sample result",
  file: "History file",
  duplicates: "Duplicate messages",
  newMessages: "New messages",
  two: "2 excluded",
  one: "1 message \u2192 update proposal",
  importNote: "No file has been uploaded and no AI processing has run.",
  overdueDeadline: "Past due \xB7 {date}",
  emptyToday: "All work due today is complete",
  previewFooter: "Records are stored in this browser on this device. There is no device sync. Clearing browser data removes the records."
};

// src/i18n/messages.ts
var brand = "Relay";
var catalogs = { ja, en };
function canonicalLocale(value) {
  if (typeof value !== "string" || value.length > 100 || !value.trim()) return null;
  try {
    return Intl.getCanonicalLocales(value.trim())[0] ?? null;
  } catch {
    return null;
  }
}
var normalizeLocale = (value) => canonicalLocale(value) ?? "ja";
var engine = createInstance();
void engine.init({
  initAsync: false,
  lng: "en",
  fallbackLng: "en",
  keySeparator: false,
  nsSeparator: false,
  resources: Object.fromEntries(Object.entries(catalogs).map(([key, translation]) => [key, { translation }])),
  interpolation: { prefix: "{", suffix: "}", escapeValue: false, skipOnVariables: true },
  returnEmptyString: false
});
function translationLanguage(locale) {
  const base = normalizeLocale(locale).split("-")[0];
  return base in catalogs ? base : "en";
}
function direction(locale) {
  return engine.dir(normalizeLocale(locale));
}
function translate(locale, key, params = {}) {
  return String(engine.t(key, { ...params, lng: normalizeLocale(locale), interpolation: { alwaysFormat: true, format: (value) => typeof value === "number" ? new Intl.NumberFormat(normalizeLocale(locale)).format(value) : String(value) } }));
}

// src/server/line.ts
var ApiError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
  status;
  code;
};
var uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function validSignature(raw, signature, secret) {
  if (!secret || !signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const actual = Buffer.from(signature, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function destinations(identity, db = database()) {
  const rows = await db.query("SELECT id,kind,enabled,line_id FROM relay_private.line_destinations WHERE owner_email=$1 ORDER BY kind", [identity.email]);
  return rows.map(({ line_id, ...row }) => ({ ...row, reference: line_id.slice(-6) }));
}
async function issueCode(identity, kind, db = database()) {
  if (kind !== "user" && kind !== "group") throw new ApiError(400, "invalid");
  if (kind === "group") {
    const [personal] = await db.query("SELECT id FROM relay_private.line_destinations WHERE owner_email=$1 AND kind='user' AND enabled=true", [identity.email]);
    if (!personal) throw new ApiError(409, "personalFirst");
  }
  const token = randomToken();
  await db.query("INSERT INTO relay_private.line_codes(token_hash,owner_email,kind,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes') ON CONFLICT(owner_email,kind) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at", [hash(token), identity.email, kind]);
  return { code: `RELAY ${token}`, expiresIn: 600 };
}
async function changeDestination(identity, id, action, db = database()) {
  if (!uuid(id) || action !== "confirm" && action !== "remove") throw new ApiError(400, "invalid");
  await db.transaction(async (tx) => {
    const [row] = await tx.query("SELECT id,kind,enabled,line_id FROM relay_private.line_destinations WHERE id=$1 AND owner_email=$2 FOR UPDATE", [id, identity.email]);
    if (!row) throw new ApiError(404, "missing");
    if (action === "confirm") await tx.query("UPDATE relay_private.line_destinations SET enabled=true WHERE id=$1", [id]);
    else {
      await tx.query("DELETE FROM relay_private.line_destinations WHERE id=$1", [id]);
      if (row.kind === "user") await tx.query("DELETE FROM relay_private.line_destinations WHERE owner_email=$1 AND kind='group'", [identity.email]);
    }
  });
}
async function webhook(raw, signature, db = database()) {
  if (!validSignature(raw, signature, process.env.LINE_CHANNEL_SECRET ?? "")) throw new ApiError(401, "signature");
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "invalid");
  }
  if (!body || !Array.isArray(body.events) || body.events.length > 100) throw new ApiError(400, "invalid");
  for (const event of body.events) {
    if (!event || typeof event.webhookEventId !== "string" || !event.source) continue;
    const { source } = event;
    await db.transaction(async (tx) => {
      const inserted = await tx.query("INSERT INTO relay_private.line_events(event_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_id", [event.webhookEventId]);
      if (!inserted.length) return;
      const lineId = source.type === "group" ? source.groupId : source.type === "user" ? source.userId : void 0;
      if (!lineId) return;
      if (event.type === "unfollow" || event.type === "leave") {
        await tx.query("DELETE FROM relay_private.line_destinations WHERE line_id=$1 OR ($2='unfollow' AND actor_id=$1)", [lineId, event.type]);
        return;
      }
      if (event.type !== "message" || event.message?.type !== "text" || typeof event.message.text !== "string" || !source.userId) return;
      const match = /^RELAY ([A-Za-z0-9_-]{43})$/.exec(event.message.text.trim());
      if (!match) return;
      const [code] = await tx.query("SELECT owner_email,kind FROM relay_private.line_codes WHERE token_hash=$1 AND expires_at > now() FOR UPDATE", [hash(match[1])]);
      if (!code || code.kind !== source.type || !allowed(code.owner_email)) return;
      if (source.type === "group") {
        const [personal] = await tx.query("SELECT id FROM relay_private.line_destinations WHERE owner_email=$1 AND kind='user' AND line_id=$2 AND enabled=true", [code.owner_email, source.userId]);
        if (!personal) return;
      }
      await tx.query("DELETE FROM relay_private.line_codes WHERE token_hash=$1", [hash(match[1])]);
      await tx.query("DELETE FROM relay_private.line_destinations WHERE owner_email=$1 AND kind=$2", [code.owner_email, code.kind]);
      if (code.kind === "user") await tx.query("DELETE FROM relay_private.line_destinations WHERE owner_email=$1 AND kind='group'", [code.owner_email]);
      await tx.query("INSERT INTO relay_private.line_destinations(id,owner_email,kind,line_id,actor_id) VALUES($1,$2,$3,$4,$5)", [randomUUID(), code.owner_email, code.kind, lineId, source.userId]);
    });
  }
}
function notificationText(locale) {
  return `${translate(locale, "lineTestMessage")}
${origin()}`;
}
async function notify(identity, input, db = database(), send = fetch) {
  if (!uuid(input.id) || !uuid(input.destinationId) || input.locale !== "ja" && input.locale !== "en") throw new ApiError(400, "invalid");
  const id = input.id, destinationId = input.destinationId, locale = input.locale;
  const job = await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [identity.email]);
    const [dest] = await tx.query("SELECT id,kind,enabled,line_id FROM relay_private.line_destinations WHERE id=$1 AND owner_email=$2 AND enabled=true", [destinationId, identity.email]);
    if (!dest) throw new ApiError(404, "missing");
    const [existing] = await tx.query("SELECT * FROM relay_private.notifications WHERE id=$1", [id]);
    if (existing && (existing.owner_email !== identity.email || existing.destination_id !== destinationId || existing.locale !== locale)) throw new ApiError(409, "conflict");
    if (!existing) {
      const [count] = await tx.query("SELECT count(*) FROM relay_private.notifications WHERE owner_email=$1 AND created_at > now()-interval '1 hour'", [identity.email]);
      if (Number(count.count) >= 10) throw new ApiError(429, "rateLimit");
      await tx.query("INSERT INTO relay_private.notifications(id,owner_email,destination_id,line_id,locale) VALUES($1,$2,$3,$4,$5)", [id, identity.email, destinationId, dest.line_id, locale]);
    }
    if (existing?.state === "sent") return null;
    const [claimed] = await tx.query("UPDATE relay_private.notifications SET state='sending',attempts=attempts+1,lease_until=now()+interval '30 seconds' WHERE id=$1 AND created_at > now()-interval '23 hours' AND attempts < 5 AND state IN ('pending','sending') AND (lease_until IS NULL OR lease_until < now()) RETURNING *", [id]);
    if (!claimed) throw new ApiError(409, "pending");
    return claimed;
  });
  if (!job) return { state: "sent" };
  try {
    const response = await send("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, "X-Line-Retry-Key": job.id },
      body: JSON.stringify({ to: job.line_id, messages: [{ type: "text", text: notificationText(job.locale) }] }),
      signal: AbortSignal.timeout(1e4)
    });
    const accepted = response.ok || response.status === 409 && Boolean(response.headers.get("x-line-accepted-request-id"));
    await txResult(accepted ? "sent" : response.status === 429 || response.status >= 500 ? "pending" : "failed");
    if (!accepted) throw new ApiError(502, "delivery");
    return { state: "sent" };
  } catch (error) {
    if (!(error instanceof ApiError)) await txResult("pending");
    throw error instanceof ApiError ? error : new ApiError(502, "delivery");
  }
  async function txResult(state) {
    await db.query("UPDATE relay_private.notifications SET state=$2,lease_until=NULL WHERE id=$1", [id, state]);
  }
}

// src/server/admin.ts
async function adminOverview(request, db = database()) {
  const identity = await session(request, db);
  if (!identity) throw new ApiError(401, "unauthorized");
  if (!administratorAllowed(identity.email)) throw new ApiError(403, "forbidden");
  const rows = await db.query(
    "SELECT lower(email) AS email, count(*)::int AS sessions FROM relay_private.sessions WHERE expires_at > now() GROUP BY lower(email)"
  );
  const counts = new Map(rows.map((row) => [row.email, row.sessions]));
  const emails = [...new Set((process.env.ALLOWED_GOOGLE_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean))].sort();
  return {
    viewer: identity.email,
    accounts: emails.map((email) => ({ email, role: administratorAllowed(email) ? "admin" : "member", sessions: counts.get(email) ?? 0 })),
    // Configuration presence is not evidence of a successful provider connection.
    configuration: { google: configured(), database: true, line: lineConfigured(), calendar: Boolean(process.env.TOKEN_ENCRYPTION_KEY) }
  };
}

// src/server/handler.ts
import { ZodError } from "zod";

// src/server/calendar.ts
import * as oidc2 from "openid-client";
import { randomUUID as randomUUID2 } from "node:crypto";
import { z as z3 } from "zod";

// src/server/vault.ts
import { createCipheriv, createDecipheriv, randomBytes as randomBytes2 } from "node:crypto";
function encryptionKey() {
  const value = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("configuration");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("configuration");
  return key;
}
function calendarConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}
function seal(value, subject) {
  const iv = randomBytes2(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from("relay-calendar:" + subject));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
function unseal(value, subject) {
  const [version, iv, tag, data, ...extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data || extra.length) throw new Error("invalidCiphertext");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from("relay-calendar:" + subject));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// src/scheduling/slots.ts
import { Temporal } from "@js-temporal/polyfill";
import { z as z2 } from "zod";
var searchSchema = z2.object({
  fromDate: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z2.number().int().min(1).max(14).default(7),
  timeZone: z2.string().min(1).max(80).default("Asia/Tokyo"),
  durationMinutes: z2.union([z2.literal(15), z2.literal(30), z2.literal(45), z2.literal(60), z2.literal(90), z2.literal(120)]).default(60),
  startHour: z2.number().int().min(0).max(23).default(9),
  endHour: z2.number().int().min(1).max(24).default(18),
  weekdays: z2.array(z2.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5]),
  bufferMinutes: z2.number().int().min(0).max(60).default(15),
  limit: z2.number().int().min(1).max(10).default(5)
}).strict().refine((v) => v.startHour < v.endHour, { message: "invalidWorkingHours" });
function searchWindow(input, now) {
  const today = Temporal.Instant.from(now).toZonedDateTimeISO(input.timeZone).toPlainDate();
  const from = Temporal.PlainDate.from(input.fromDate);
  if (Temporal.PlainDate.compare(from, today) < 0 || Temporal.PlainDate.compare(from, today.add({ days: 60 })) > 0) throw new RangeError("invalidDate");
  const start = from.toZonedDateTime(input.timeZone).toInstant();
  const end = from.add({ days: input.days }).toZonedDateTime(input.timeZone).toInstant();
  return { start: start.toString(), end: end.toString() };
}
function findSlots(input, busy, now) {
  searchWindow(input, now);
  const intervals = busy.map((item) => {
    const start = Temporal.Instant.from(item.start).epochMilliseconds;
    const end = Temporal.Instant.from(item.end).epochMilliseconds;
    if (end <= start) throw new RangeError("invalidBusy");
    return { start: start - input.bufferMinutes * 6e4, end: end + input.bufferMinutes * 6e4 };
  });
  const minimum = Temporal.Instant.from(now).epochMilliseconds + 30 * 6e4;
  const slots = [];
  for (let day = 0; day < input.days && slots.length < input.limit; day++) {
    const date = Temporal.PlainDate.from(input.fromDate).add({ days: day });
    if (!input.weekdays.includes(date.dayOfWeek)) continue;
    const start = date.toZonedDateTime({ timeZone: input.timeZone, plainTime: { hour: input.startHour } });
    const end = input.endHour === 24 ? date.add({ days: 1 }).toZonedDateTime(input.timeZone) : date.toZonedDateTime({ timeZone: input.timeZone, plainTime: { hour: input.endHour } });
    for (let time = start; time.epochMilliseconds + input.durationMinutes * 6e4 <= end.epochMilliseconds && slots.length < input.limit; time = time.add({ minutes: 15 })) {
      const begin = time.epochMilliseconds, finish = begin + input.durationMinutes * 6e4;
      if (begin < minimum || intervals.some((item) => begin < item.end && finish > item.start)) continue;
      slots.push({ start: Temporal.Instant.fromEpochMilliseconds(begin).toString(), end: Temporal.Instant.fromEpochMilliseconds(finish).toString(), timeZone: input.timeZone });
    }
  }
  return slots;
}

// src/server/calendar.ts
var calendarScopes = ["https://www.googleapis.com/auth/calendar.events.freebusy", "https://www.googleapis.com/auth/calendar.events.owned"];
var connectCookie = "__Host-relay-calendar";
var callbackPath = "/api/calendar/callback";
var nowISO = () => (/* @__PURE__ */ new Date()).toISOString();
var proposalSchema = searchSchema.safeExtend({ title: z3.string().trim().min(1).max(120) });
function parseProposal(input) {
  const { title, ...criteria } = input;
  return { title: z3.string().trim().min(1).max(120).parse(title), search: searchSchema.parse(criteria) };
}
async function calendarStatus(identity, db = database()) {
  if (!calendarConfigured()) return { ready: false, connected: false };
  const [connection2] = await db.query("SELECT owner_subject FROM relay_private.calendar_connections WHERE owner_subject=$1", [identity.subject]);
  return { ready: true, connected: Boolean(connection2) };
}
async function startCalendar(identity, db = database(), configuration) {
  if (!calendarConfigured()) throw new ApiError(503, "configuration");
  const config = configuration ?? await google(), token = randomToken(), state = oidc2.randomState(), nonce = oidc2.randomNonce(), verifier = oidc2.randomPKCECodeVerifier();
  await db.query("DELETE FROM relay_private.calendar_oauth WHERE owner_subject=$1 OR expires_at<now()", [identity.subject]);
  await db.query("INSERT INTO relay_private.calendar_oauth VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')", [hash(token), identity.subject, state, verifier, nonce]);
  const url = oidc2.buildAuthorizationUrl(config, { redirect_uri: origin() + callbackPath, scope: "openid email " + calendarScopes.join(" "), state, nonce, code_challenge: await oidc2.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", access_type: "offline", prompt: "consent", login_hint: identity.email });
  return new Response(null, { status: 303, headers: { Location: url.href, "Set-Cookie": cookie(connectCookie, token, 600) } });
}
async function finishCalendar(request, identity, db = database(), configuration) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["calendar:" + identity.subject]);
    const headers = new Headers({ "Set-Cookie": cookie(connectCookie, "", 0), Location: "/?calendar=failed#today" });
    const token = readCookie(request, connectCookie);
    if (!token) return new Response(null, { status: 303, headers });
    const [attempt] = await tx.query("DELETE FROM relay_private.calendar_oauth WHERE token_hash=$1 AND owner_subject=$2 AND expires_at>now() RETURNING state,verifier,nonce", [hash(token), identity.subject]);
    if (!attempt) return new Response(null, { status: 303, headers });
    try {
      const callback = new URL(origin() + callbackPath), incoming = new URL(request.url);
      for (const key of ["code", "state", "error", "iss"]) for (const value of incoming.searchParams.getAll(key)) callback.searchParams.append(key, value);
      const tokens2 = await oidc2.authorizationCodeGrant(configuration ?? await google(), callback, { pkceCodeVerifier: attempt.verifier, expectedState: attempt.state, expectedNonce: attempt.nonce, idTokenExpected: true });
      const authenticated = verifiedIdentity(tokens2.claims());
      const scopes = new Set(tokens2.scope?.split(" "));
      if (authenticated?.subject !== identity.subject || !calendarScopes.every((scope) => scopes.has(scope)) || !tokens2.refresh_token) throw new Error("calendarConsent");
      await tx.query("INSERT INTO relay_private.calendar_connections(owner_subject,refresh_cipher) VALUES($1,$2) ON CONFLICT(owner_subject) DO UPDATE SET refresh_cipher=excluded.refresh_cipher,connected_at=now()", [identity.subject, seal(tokens2.refresh_token, identity.subject)]);
      headers.set("Location", "/?calendar=connected#today");
    } catch {
    }
    return new Response(null, { status: 303, headers });
  });
}
async function disconnectCalendar(identity, db = database()) {
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["calendar:" + identity.subject]);
    await tx.query("DELETE FROM relay_private.calendar_connections WHERE owner_subject=$1", [identity.subject]);
    await tx.query("DELETE FROM relay_private.calendar_oauth WHERE owner_subject=$1", [identity.subject]);
    await tx.query("DELETE FROM relay_private.schedule_proposals WHERE owner_subject=$1 AND state='proposed'", [identity.subject]);
  });
}
async function calendarClient(identity, db = database(), configuration, send = fetch) {
  const [connection2] = await db.query("SELECT refresh_cipher FROM relay_private.calendar_connections WHERE owner_subject=$1", [identity.subject]);
  if (!connection2) throw new ApiError(409, "calendarConnect");
  let access;
  try {
    const tokens2 = await oidc2.refreshTokenGrant(configuration ?? await google(), unseal(connection2.refresh_cipher, identity.subject));
    access = tokens2.access_token;
    if (tokens2.refresh_token) await db.query("UPDATE relay_private.calendar_connections SET refresh_cipher=$2 WHERE owner_subject=$1 AND refresh_cipher=$3", [identity.subject, seal(tokens2.refresh_token, identity.subject), connection2.refresh_cipher]);
  } catch {
    throw new ApiError(409, "calendarReconnect");
  }
  async function call(path, body) {
    const response = await send("https://www.googleapis.com/calendar/v3/" + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + access, ...body ? { "Content-Type": "application/json" } : {} }, ...body ? { body: JSON.stringify(body) } : {}, signal: AbortSignal.timeout(1e4) });
    if (response.status === 401) throw new ApiError(409, "calendarReconnect");
    return response;
  }
  const client = {
    async busy(start, end, timeZone) {
      const response = await call("freeBusy", { timeMin: start, timeMax: end, timeZone, items: [{ id: "primary" }] });
      if (!response.ok) throw new ApiError(502, "calendarUnavailable");
      const payload = await response.json();
      const calendar = payload.calendars?.primary;
      if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) throw new ApiError(502, "calendarUnavailable");
      return z3.array(z3.object({ start: z3.string().datetime({ offset: true }), end: z3.string().datetime({ offset: true }) }).refine((item) => Date.parse(item.end) > Date.parse(item.start))).max(1e4).parse(calendar.busy);
    },
    async get(id) {
      const response = await call("calendars/primary/events/" + encodeURIComponent(id));
      if (response.status === 404) return null;
      if (response.status === 410) throw new ApiError(409, "calendarChanged");
      if (!response.ok) throw new ApiError(502, "calendarUnavailable");
      return await response.json();
    },
    async insert(event) {
      const response = await call("calendars/primary/events?sendUpdates=none", { ...event, reminders: { useDefault: false }, visibility: "private", transparency: "opaque" });
      if (response.status === 409) {
        const existing = await client.get(event.id);
        if (existing) return existing;
      }
      if (!response.ok) throw new ApiError(502, "calendarRetry");
      return await response.json();
    }
  };
  return client;
}
async function integrationLimit(identity, db = database()) {
  const [row] = await db.query("INSERT INTO relay_private.integration_usage(owner_subject,window_start,count) VALUES($1,date_trunc('hour',now()),1) ON CONFLICT(owner_subject,window_start) DO UPDATE SET count=relay_private.integration_usage.count+1 RETURNING count", [identity.subject]);
  if (row.count > 120) throw new ApiError(429, "rateLimit");
}
async function availableSlots(identity, input, db = database(), client, now = nowISO()) {
  const criteria = searchSchema.parse(input), window = searchWindow(criteria, now);
  const api = client ?? await calendarClient(identity, db);
  const busy = await api.busy(window.start, window.end, criteria.timeZone);
  return { slots: findSlots(criteria, busy, now), timeZone: criteria.timeZone, checkedAt: now };
}
async function proposeSchedule(identity, input, db = database(), client, now = nowISO()) {
  const { title, search } = parseProposal(input);
  const found = await availableSlots(identity, search, db, client, now);
  const proposals = await db.transaction(async (tx) => {
    await tx.query("DELETE FROM relay_private.schedule_proposals WHERE owner_subject=$1 AND state='proposed' AND expires_at<now()", [identity.subject]);
    const result = [];
    for (const slot of found.slots) {
      const id = randomUUID2();
      await tx.query("INSERT INTO relay_private.schedule_proposals(id,owner_subject,title,starts_at,ends_at,time_zone,buffer_minutes,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '15 minutes')", [id, identity.subject, title, slot.start, slot.end, slot.timeZone, search.bufferMinutes]);
      result.push({ ...slot, id, title });
    }
    return result;
  });
  return { proposals, expiresIn: 900 };
}
async function bookSlot(identity, input, db = database(), client, now = nowISO()) {
  const id = z3.uuid().parse(input);
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["calendar:" + identity.subject]);
    const [proposal] = await tx.query("SELECT * FROM relay_private.schedule_proposals WHERE id=$1 AND owner_subject=$2 FOR UPDATE", [id, identity.subject]);
    if (!proposal) throw new ApiError(404, "missing");
    const api = client ?? await calendarClient(identity, tx);
    const eventId = hash("relay:" + identity.subject + ":" + id);
    const existing = await api.get(eventId);
    const start = proposal.starts_at.toISOString(), end = proposal.ends_at.toISOString();
    function verify(event) {
      if (event.id !== eventId || event.summary !== proposal.title || event.status === "cancelled" || event.extendedProperties?.private?.relayProposal !== id || Date.parse(event.start?.dateTime ?? "") !== Date.parse(start) || Date.parse(event.end?.dateTime ?? "") !== Date.parse(end)) throw new ApiError(409, "calendarChanged");
    }
    if (existing) {
      verify(existing);
      await tx.query("UPDATE relay_private.schedule_proposals SET state='booked' WHERE id=$1", [id]);
      return { id, start, end, timeZone: proposal.time_zone, title: proposal.title, state: "booked" };
    }
    if (proposal.state === "booked") throw new ApiError(409, "calendarChanged");
    if (proposal.expires_at.getTime() < Date.parse(now) || Date.parse(start) < Date.parse(now) + 3e4) throw new ApiError(409, "proposalExpired");
    const padding = proposal.buffer_minutes * 6e4;
    const busy = await api.busy(new Date(Date.parse(start) - padding).toISOString(), new Date(Date.parse(end) + padding).toISOString(), proposal.time_zone);
    if (busy.some((item) => Date.parse(item.start) < Date.parse(end) + padding && Date.parse(item.end) > Date.parse(start) - padding)) throw new ApiError(409, "calendarConflict");
    const created = await api.insert({ id: eventId, summary: proposal.title, start: { dateTime: start, timeZone: proposal.time_zone }, end: { dateTime: end, timeZone: proposal.time_zone }, extendedProperties: { private: { relayProposal: id } } });
    verify(created);
    await tx.query("UPDATE relay_private.schedule_proposals SET state='booked' WHERE id=$1", [id]);
    return { id, start, end, timeZone: proposal.time_zone, title: proposal.title, state: "booked" };
  });
}

// src/server/mcp.ts
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z as z4 } from "zod";
import { randomUUID as randomUUID3 } from "node:crypto";
async function issueMcpToken(identity, permission, db = database()) {
  if (permission !== "read" && permission !== "book") throw new ApiError(400, "invalid");
  const token = "relay_mcp_" + randomToken(), id = randomUUID3();
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["mcp:" + identity.subject]);
    await tx.query("DELETE FROM relay_private.mcp_tokens WHERE owner_subject=$1 AND expires_at<now()", [identity.subject]);
    const [count] = await tx.query("SELECT count(*) FROM relay_private.mcp_tokens WHERE owner_subject=$1", [identity.subject]);
    if (Number(count.count) >= 5) throw new ApiError(429, "rateLimit");
    await tx.query("INSERT INTO relay_private.mcp_tokens(id,token_hash,owner_subject,owner_email,permission,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 days')", [id, hash(token), identity.subject, identity.email, permission]);
  });
  return { id, token, endpoint: origin() + "/api/mcp", expiresInDays: 30, permission };
}
async function listMcpTokens(identity, db = database()) {
  return db.query("SELECT id,permission,expires_at FROM relay_private.mcp_tokens WHERE owner_subject=$1 AND expires_at>now() ORDER BY created_at DESC", [identity.subject]);
}
async function revokeMcpToken(identity, id, db = database()) {
  const rows = await db.query("DELETE FROM relay_private.mcp_tokens WHERE id=$1 AND owner_subject=$2 RETURNING id", [z4.uuid().parse(id), identity.subject]);
  if (!rows.length) throw new ApiError(404, "missing");
}
async function mcpIdentity(request, db = database()) {
  const match = /^Bearer (relay_mcp_[A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) return null;
  const [token] = await db.query("SELECT owner_email,owner_subject,permission FROM relay_private.mcp_tokens WHERE token_hash=$1 AND expires_at>now()", [hash(match[1])]);
  return token && allowed(token.owner_email) ? { email: token.owner_email, subject: token.owner_subject, permission: token.permission } : null;
}
function schedulingMcp(identity, db = database(), client, now) {
  const t = (key) => translate("en", key);
  const slot = z4.object({ start: z4.string(), end: z4.string(), timeZone: z4.string() });
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  return createMcpHandler(() => {
    const server = new McpServer({ name: "relay-mcp-server", version: "0.3.0" });
    const result = async (work) => {
      try {
        const data = await work();
        return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
      } catch (error) {
        return { content: [{ type: "text", text: t(error instanceof ApiError && ["calendarConnect", "calendarReconnect"].includes(error.code) ? "mcpConnectHelp" : "mcpRetryHelp") + " " + (error instanceof ApiError ? error.code : "invalidRequest") }], isError: true };
      }
    };
    server.registerTool("relay_get_calendar_status", { description: t("mcpStatusDescription"), inputSchema: z4.object({}).strict(), outputSchema: z4.object({ ready: z4.boolean(), connected: z4.boolean() }), annotations: read }, () => result(() => calendarStatus(identity, db)));
    server.registerTool("relay_find_slots", { description: t("mcpFindDescription"), inputSchema: searchSchema, outputSchema: z4.object({ slots: z4.array(slot), timeZone: z4.string(), checkedAt: z4.string() }), annotations: read }, (input) => result(() => availableSlots(identity, input, db, client, now)));
    if (identity.permission === "book") {
      server.registerTool("relay_propose_schedule", { description: t("mcpProposeDescription"), inputSchema: proposalSchema, outputSchema: z4.object({ proposals: z4.array(slot.extend({ id: z4.string(), title: z4.string() })), expiresIn: z4.number() }), annotations: { ...read, readOnlyHint: false, idempotentHint: false } }, (input) => result(() => proposeSchedule(identity, input, db, client, now)));
      server.registerTool("relay_book_slot", { description: t("mcpBookDescription"), inputSchema: z4.object({ proposalId: z4.uuid() }).strict(), outputSchema: slot.extend({ id: z4.string(), title: z4.string(), state: z4.literal("booked") }), annotations: { ...read, readOnlyHint: false } }, (input) => result(() => bookSlot(identity, input.proposalId, db, client, now)));
    }
    return server;
  }, { responseMode: "json", maxSubscriptions: 0, keepAliveMs: 0 });
}
async function handleMcp(request, raw, db = database()) {
  if (new URL(request.url).origin !== origin() || request.headers.has("origin") && request.headers.get("origin") !== origin()) throw new ApiError(403, "origin");
  const identity = await mcpIdentity(request, db);
  if (!identity) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="Relay"' } });
  await integrationLimit(identity, db);
  const handler = schedulingMcp(identity, db);
  try {
    const response = await handler.fetch(new Request(request.url, { method: "POST", headers: request.headers, body: raw }));
    const body = response.body ? await response.arrayBuffer() : null;
    return new Response(body, { status: response.status, headers: response.headers });
  } finally {
    await handler.close();
  }
}

// src/server/handler.ts
import { readFile } from "node:fs/promises";

// src/server/page.tsx
import { renderToStaticMarkup } from "react-dom/server";

// src/i18n/context.ts
function createUiContext(requested) {
  const locale = normalizeLocale(requested), language = translationLanguage(locale);
  const number = (value, options = {}) => new Intl.NumberFormat(locale, options).format(value);
  const digits = /* @__PURE__ */ new Map();
  for (const tag of [locale, "ar-u-nu-arab", "fa-u-nu-arabext", "en-u-nu-fullwide"]) for (let value = 0; value < 10; value++) digits.set(new Intl.NumberFormat(tag, { useGrouping: false }).format(value), String(value));
  const normalizeDigits = (value) => [...value].map((char) => digits.get(char) ?? char).join("");
  return Object.freeze({
    normalizeDigits,
    locale,
    language,
    dir: direction(locale),
    fallback: locale.split("-")[0] !== language,
    t: (key, params = {}) => translate(locale, key, params),
    number,
    money: (value, currency = "JPY") => number(BigInt(value), { style: "currency", currency, maximumFractionDigits: 0 }),
    date: (value, options) => new Intl.DateTimeFormat(locale, options).format(value),
    dateRange: (start, end, options) => new Intl.DateTimeFormat(locale, options).formatRange(start, end)
  });
}

// src/ui/language.tsx
import { useState as useState2 } from "react";

// src/ui/controls.tsx
import { useId, useState } from "react";

// src/ui/icons.tsx
import {
  Workflow,
  ShieldCheck,
  LockKeyhole,
  UserRound,
  CalendarDays,
  Copy,
  Search,
  NotebookPen,
  ChevronDown,
  TriangleAlert,
  Clock,
  Check,
  Info,
  House,
  Folder,
  ClipboardCheck,
  Upload,
  ArrowDown,
  ArrowUp,
  Minus,
  ArrowRight,
  ArrowLeft,
  X,
  Calculator,
  RefreshCw,
  LogOut,
  Unlink,
  Languages,
  Eye,
  Pencil,
  RotateCcw,
  FileText,
  SlidersHorizontal,
  Hourglass,
  Circle
} from "lucide-react";
import { jsx } from "react/jsx-runtime";
var icons = {
  brand: Workflow,
  admin: ShieldCheck,
  adminLocked: LockKeyhole,
  user: UserRound,
  calendar: CalendarDays,
  copy: Copy,
  search: Search,
  note: NotebookPen,
  chevron: ChevronDown,
  alert: TriangleAlert,
  clock: Clock,
  check: Check,
  info: Info,
  home: House,
  cases: Folder,
  reviews: ClipboardCheck,
  imports: Upload,
  decrease: ArrowDown,
  increase: ArrowUp,
  equal: Minus,
  arrow: ArrowRight,
  back: ArrowLeft,
  close: X,
  calculator: Calculator,
  refresh: RefreshCw,
  logout: LogOut,
  unlink: Unlink,
  language: Languages,
  present: Eye,
  edit: Pencil,
  reset: RotateCcw,
  file: FileText,
  options: SlidersHorizontal,
  waiting: Hourglass,
  todo: Circle
};
function Icon({
  name,
  ...props
}) {
  const Component = icons[name];
  if (!Object.hasOwn(icons, name) || !Component) throw new Error(`Unknown icon: ${name}`);
  return /* @__PURE__ */ jsx(
    Component,
    {
      "aria-hidden": "true",
      focusable: "false",
      ...props,
      className: [
        name === "arrow" || name === "back" ? "directional-icon" : "",
        props.className
      ].filter(Boolean).join(" ")
    }
  );
}
var iconOnly = {
  signOut: "logout",
  refreshConnections: "refresh",
  copyLinkCode: "copy",
  lineRemove: "unlink",
  calendarDisconnect: "unlink",
  mcpCopy: "copy",
  mcpRevoke: "unlink",
  pricingEdit: "edit",
  copy: "copy",
  close: "close",
  resetFilters: "reset",
  handoff: "note"
};
var labeled = {
  pricingPresent: "present",
  scheduleFind: "search",
  scheduleBook: "calendar",
  calendarConnect: "calendar",
  lineConnect: "user",
  lineConfirm: "check",
  lineTest: "info",
  mcpIssue: "user",
  saveRecord: "note",
  saveComplete: "check",
  approve: "check",
  reject: "close",
  sample: "imports",
  sampleShown: "check",
  reviewOpen: "reviews"
};

// src/components/ui/button.tsx
import { cva } from "class-variance-authority";

// src/lib/utils.ts
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// src/components/ui/button.tsx
import { Slot } from "radix-ui";
import { jsx as jsx2 } from "react/jsx-runtime";
var buttonVariants = cva("button", {
  variants: {
    variant: {
      default: "primary",
      destructive: "",
      outline: "",
      secondary: "",
      ghost: "ghost",
      link: "link-button"
    },
    size: {
      default: "",
      xs: "",
      sm: "",
      lg: "",
      icon: "icon-button",
      "icon-xs": "icon-button",
      "icon-sm": "icon-button",
      "icon-lg": "icon-button"
    }
  },
  defaultVariants: { variant: "default", size: "default" }
});
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot.Root : "button";
  return /* @__PURE__ */ jsx2(
    Comp,
    {
      "data-slot": "button",
      "data-variant": variant,
      "data-size": size,
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// src/components/ui/native-select.tsx
import { ChevronDownIcon } from "lucide-react";
import { jsx as jsx3, jsxs } from "react/jsx-runtime";
function NativeSelect({
  className,
  size = "default",
  ...props
}) {
  return /* @__PURE__ */ jsxs("div", { className: "", "data-slot": "native-select-wrapper", children: [
    /* @__PURE__ */ jsx3(
      "select",
      {
        "data-slot": "native-select",
        "data-size": size,
        className: cn(className),
        ...props
      }
    ),
    /* @__PURE__ */ jsx3(
      ChevronDownIcon,
      {
        className: "",
        "aria-hidden": "true",
        "data-slot": "native-select-icon"
      }
    )
  ] });
}
function NativeSelectOption({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx3(
    "option",
    {
      "data-slot": "native-select-option",
      className: cn(className),
      ...props
    }
  );
}

// src/components/ui/input.tsx
import { jsx as jsx4 } from "react/jsx-runtime";
function Input({ className, type, ...props }) {
  return /* @__PURE__ */ jsx4("input", { type, "data-slot": "input", className: cn(className), ...props });
}

// src/components/ui/label.tsx
import { Label as LabelPrimitive } from "radix-ui";
import { jsx as jsx5 } from "react/jsx-runtime";
function Label({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx5(
    LabelPrimitive.Root,
    {
      "data-slot": "label",
      className: cn(className),
      ...props
    }
  );
}

// src/components/ui/tooltip.tsx
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { jsx as jsx6, jsxs as jsxs2 } from "react/jsx-runtime";
function Tooltip({
  ...props
}) {
  return /* @__PURE__ */ jsx6(TooltipPrimitive.Root, { "data-slot": "tooltip", ...props });
}
function TooltipTrigger({
  ...props
}) {
  return /* @__PURE__ */ jsx6(TooltipPrimitive.Trigger, { "data-slot": "tooltip-trigger", ...props });
}
function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}) {
  return /* @__PURE__ */ jsx6(TooltipPrimitive.Portal, { children: /* @__PURE__ */ jsxs2(
    TooltipPrimitive.Content,
    {
      "data-slot": "tooltip-content",
      sideOffset,
      className: cn(className),
      ...props,
      children: [
        children,
        /* @__PURE__ */ jsx6(TooltipPrimitive.Arrow, { className: "" })
      ]
    }
  ) });
}

// src/components/ui/collapsible.tsx
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { jsx as jsx7 } from "react/jsx-runtime";
function Collapsible({
  ...props
}) {
  return /* @__PURE__ */ jsx7(CollapsiblePrimitive.Root, { "data-slot": "collapsible", ...props });
}
function CollapsibleTrigger({
  ...props
}) {
  return /* @__PURE__ */ jsx7(
    CollapsiblePrimitive.CollapsibleTrigger,
    {
      "data-slot": "collapsible-trigger",
      ...props
    }
  );
}
function CollapsibleContent({
  ...props
}) {
  return /* @__PURE__ */ jsx7(
    CollapsiblePrimitive.CollapsibleContent,
    {
      "data-slot": "collapsible-content",
      ...props
    }
  );
}

// src/components/ui/alert.tsx
import { cva as cva2 } from "class-variance-authority";
import { jsx as jsx8 } from "react/jsx-runtime";
var alertVariants = cva2("notice", {
  variants: { variant: { default: "", destructive: "" } },
  defaultVariants: { variant: "default" }
});

// src/ui/controls.tsx
import { jsx as jsx9, jsxs as jsxs3 } from "react/jsx-runtime";
function Action({
  ui,
  label,
  symbol,
  iconOnly: only,
  children,
  ...props
}) {
  const name = symbol ?? iconOnly[label] ?? labeled[label];
  const compact = only ?? Boolean(iconOnly[label]);
  const control = /* @__PURE__ */ jsxs3(
    Button,
    {
      type: "button",
      size: compact ? "icon" : "default",
      "aria-label": ui.t(label),
      ...props,
      children: [
        name && /* @__PURE__ */ jsx9(Icon, { name }),
        " ",
        !compact && /* @__PURE__ */ jsx9("span", { children: children ?? ui.t(label) })
      ]
    }
  );
  return compact ? /* @__PURE__ */ jsxs3(Tooltip, { children: [
    /* @__PURE__ */ jsx9(TooltipTrigger, { asChild: true, children: control }),
    /* @__PURE__ */ jsx9(TooltipContent, { children: ui.t(label) })
  ] }) : control;
}
function Fold({
  ui,
  label,
  children,
  required = false,
  defaultOpen = false,
  deferMount = false
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [activated, setActivated] = useState(!deferMount || defaultOpen || required);
  return /* @__PURE__ */ jsxs3(
    Collapsible,
    {
      className: "disclosure",
      open: required || open,
      onOpenChange: (value) => {
        if (value) setActivated(true);
        setOpen(value);
      },
      children: [
        /* @__PURE__ */ jsx9(CollapsibleTrigger, { asChild: true, children: /* @__PURE__ */ jsxs3(Button, { variant: "ghost", className: "disclosure-trigger", children: [
          ui.t(label),
          /* @__PURE__ */ jsx9(Icon, { name: "chevron" })
        ] }) }),
        /* @__PURE__ */ jsx9(
          CollapsibleContent,
          {
            className: "disclosure-body",
            forceMount: true,
            hidden: !(required || open),
            children: (activated || required) && children
          }
        )
      ]
    }
  );
}
function SelectField({
  ui,
  label,
  options,
  id,
  hideLabel = false,
  ...props
}) {
  const unique = useId();
  const fieldId = id ?? unique;
  return /* @__PURE__ */ jsxs3("div", { className: "field", children: [
    /* @__PURE__ */ jsx9(Label, { htmlFor: fieldId, className: hideLabel ? "sr-only" : void 0, children: ui.t(label) }),
    /* @__PURE__ */ jsx9(NativeSelect, { id: fieldId, ...props, children: options.map((option) => /* @__PURE__ */ jsx9(
      NativeSelectOption,
      {
        value: option.value,
        disabled: option.disabled,
        children: option.label
      },
      option.value
    )) })
  ] });
}

// src/ui/language.tsx
import { jsx as jsx10, jsxs as jsxs4 } from "react/jsx-runtime";
var suggestions = [
  "ja",
  "en",
  "ko",
  "zh-CN",
  "zh-TW",
  "fr",
  "es",
  "de",
  "pt-BR",
  "ar",
  "he",
  "hi",
  "id",
  "th",
  "vi"
];
function LanguageForm({
  ui,
  onApply,
  action = "/"
}) {
  const [selected, setSelected] = useState2(ui.locale), [custom, setCustom] = useState2(ui.locale), [error, setError] = useState2(false);
  const names = new Intl.DisplayNames([ui.language], { type: "language" });
  const options = [
    .../* @__PURE__ */ new Set([...Object.keys(catalogs), ...suggestions, ui.locale])
  ].map((value) => ({ value, label: names.of(value) ?? value }));
  function submit(event, value) {
    if (!onApply) return;
    event.preventDefault();
    const locale = canonicalLocale(value);
    if (!locale) {
      setError(true);
      requestAnimationFrame(() => document.getElementById("language-custom-tag")?.focus());
      return;
    }
    onApply(locale);
  }
  const customForm = /* @__PURE__ */ jsxs4(
    "form",
    {
      id: "language-custom-form",
      action,
      method: "get",
      className: "stack",
      onSubmit: (event) => submit(event, custom),
      children: [
        /* @__PURE__ */ jsxs4("div", { className: "field", children: [
          /* @__PURE__ */ jsx10(Label, { htmlFor: "language-custom-tag", children: ui.t("languageTag") }),
          /* @__PURE__ */ jsx10(
            Input,
            {
              id: "language-custom-tag",
              name: "lang",
              value: custom,
              onChange: (event) => {
                setError(false);
                setCustom(event.target.value);
              },
              maxLength: 100,
              required: true,
              autoCapitalize: "none",
              spellCheck: false,
              "aria-invalid": error,
              "aria-describedby": "language-help language-error"
            }
          )
        ] }),
        /* @__PURE__ */ jsx10("p", { id: "language-error", role: "alert", children: error ? ui.t("invalidLanguage") : "" }),
        /* @__PURE__ */ jsx10(Action, { ui, label: "applyLanguage", symbol: "check", type: "submit" })
      ]
    }
  );
  return /* @__PURE__ */ jsxs4("div", { className: "stack", children: [
    /* @__PURE__ */ jsxs4(
      "form",
      {
        id: "language-form",
        action,
        method: "get",
        className: "stack",
        onSubmit: (event) => submit(event, selected),
        children: [
          /* @__PURE__ */ jsx10(
            SelectField,
            {
              ui,
              id: "language-tag",
              label: "language",
              name: "lang",
              value: selected,
              options,
              onChange: (event) => setSelected(event.target.value),
              "aria-describedby": "language-help"
            }
          ),
          /* @__PURE__ */ jsx10(Action, { ui, label: "applyLanguage", symbol: "check", type: "submit" })
        ]
      }
    ),
    onApply ? /* @__PURE__ */ jsx10(Fold, { ui, label: "languageTag", children: customForm }) : /* @__PURE__ */ jsxs4("details", { className: "disclosure", children: [
      /* @__PURE__ */ jsx10("summary", { children: ui.t("languageTag") }),
      customForm
    ] }),
    /* @__PURE__ */ jsx10("p", { id: "language-help", className: "meta", children: ui.t("languageCoverage") })
  ] });
}

// src/design/tokens.ts
var palette = {
  main: "#0B0B0D",
  sub: "#FFFFFF",
  accent: "#0171E3"
};
var channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
var mix = (base, overlay, amount) => {
  const target = channels(overlay);
  return "#" + channels(base).map((value, i) => Math.round(value * (1 - amount) + target[i] * amount).toString(16).padStart(2, "0")).join("").toUpperCase();
};
var alpha = (hex, opacity) => `rgb(${channels(hex).join(" ")} / ${opacity})`;
var colorRecipes = {
  "main": ["main", "sub", 0],
  "sub": ["sub", "main", 0],
  "surface": ["sub", "main", 0],
  "subtle": ["sub", "main", 0.035],
  "input": ["sub", "main", 0],
  "ink": ["main", "sub", 0],
  "muted": ["main", "sub", 0.36],
  "line": ["sub", "main", 0.1],
  "control": ["main", "sub", 0.45],
  "accent": ["accent", "main", 0],
  "accent-hover": ["accent", "main", 0.14],
  "accent-pressed": ["accent", "main", 0.26],
  "on-accent": ["sub", "main", 0]
};
var colorTokens = Object.fromEntries(Object.entries(colorRecipes).map(
  ([key, [base, overlay, amount]]) => [key, mix(palette[base], palette[overlay], amount)]
));
var primitives = {
  "font": 'system-ui, -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif',
  "text-xs": "0.75rem",
  "text-sm": "0.875rem",
  "text-base": "1rem",
  "text-md": "1.125rem",
  "text-lg": "1.5rem",
  "text-xl": "2rem",
  "title-mobile": "1.75rem",
  "metric-size": "2.5rem",
  "regular": "400",
  "medium": "500",
  "semibold": "600",
  "leading": "1.75",
  "heading-leading": "1.4",
  "section-leading": "1.5",
  "label-leading": "1.5",
  "letter-normal": "0",
  "space-0": "0",
  "space-1": "0.25rem",
  "space-2": "0.5rem",
  "space-3": "0.75rem",
  "space-4": "1rem",
  "space-5": "1.5rem",
  "space-6": "2rem",
  "space-7": "3rem",
  "space-9": "6rem",
  "radius-sm": "0.5rem",
  "radius-card": "0.75rem",
  "radius-panel": "1rem",
  "radius-pill": "999px",
  "border-width": "1px",
  "focus-width": "2px",
  "focus-gap": "3px",
  "action": "3rem",
  "touch": "2.75rem",
  "row": "3.5rem",
  "icon": "1.25rem",
  "sidebar": "5.5rem",
  "topbar": "4rem",
  "content-max": "96rem",
  "reading": "45rem",
  "aside": "21rem",
  "table-min": "52rem",
  "field-min": "8rem",
  "dialog-max": "44rem",
  "desktop-gutter": "3rem",
  "mobile-gutter": "1.5rem",
  "backdrop": alpha(palette.main, 0.35),
  "floating-shadow": `0 16px 64px ${alpha(palette.main, 0.14)}`,
  "fast": "160ms",
  "reduced-motion": "0ms",
  "disabled-opacity": "0.55",
  "nav-z": "10",
  "toast-z": "30"
};
var componentTokens = {
  "type-page": primitives["text-xl"],
  "type-page-mobile": primitives["title-mobile"],
  "type-section": primitives["text-lg"],
  "type-subheading": primitives["text-md"],
  "type-body": primitives["text-base"],
  "type-label": primitives["text-sm"],
  "type-caption": primitives["text-xs"],
  "price-amount": "3rem",
  "price-amount-wide": "4rem",
  "price-secondary": primitives["text-xl"],
  "price-content-max": "68rem",
  "price-bar-height": primitives["space-3"],
  // Runtime comparison ratio; it does not define a new design value.
  "comparison-share": "0%",
  "gap-related": primitives["space-3"],
  "gap-group": primitives["space-5"],
  "gap-section": primitives["space-7"],
  "panel-padding": primitives["space-5"],
  "sidebar-mobile": "4.25rem",
  "sidebar-mobile-padding": primitives["space-2"],
  "rail-padding": primitives["space-4"],
  "tooltip-max": "14rem",
  "notification-dot": primitives["space-2"],
  "narrow-gutter": primitives["space-4"],
  "tablet-gutter": primitives["space-6"],
  "confirmation-overlay-z": "30",
  "confirmation-z": "31",
  "overlay-z": "20",
  "dialog-z": "21",
  "tooltip-z": "40",
  "safe-inline-start": "env(safe-area-inset-left)",
  "safe-inline-end": "env(safe-area-inset-right)",
  "viewport-block": "100dvh",
  "viewport-offset": "0px"
};
var tokens = { ...colorTokens, ...primitives, ...componentTokens };

// src/server/page.tsx
import { jsx as jsx11, jsxs as jsxs5 } from "react/jsx-runtime";
function loginPage(locale, status, admin = false) {
  const ui = createUiContext(locale), { t } = ui;
  const entry = admin ? "/admin" : "/";
  const start = new URLSearchParams({ lang: ui.locale });
  if (admin) start.set("destination", "admin");
  const message = status === "setup" ? "authSetup" : status === "unavailable" ? "authUnavailable" : status === "denied" ? admin ? "adminDenied" : "authDenied" : admin ? "adminLoginHint" : "loginHint";
  return "<!doctype html>" + renderToStaticMarkup(
    /* @__PURE__ */ jsxs5("html", { lang: ui.language, dir: ui.dir, children: [
      /* @__PURE__ */ jsxs5("head", { children: [
        /* @__PURE__ */ jsx11("meta", { charSet: "utf-8" }),
        /* @__PURE__ */ jsx11(
          "meta",
          {
            name: "viewport",
            content: "width=device-width,initial-scale=1,viewport-fit=cover"
          }
        ),
        /* @__PURE__ */ jsx11("meta", { name: "robots", content: "noindex" }),
        /* @__PURE__ */ jsx11("meta", { name: "theme-color", content: palette.sub }),
        /* @__PURE__ */ jsx11("title", { children: admin ? `${t("admin")} \xB7 ${brand}` : brand }),
        /* @__PURE__ */ jsx11("link", { rel: "stylesheet", href: "/assets/styles.css" }),
        /* @__PURE__ */ jsx11("link", { rel: "manifest", href: "/manifest.webmanifest" }),
        /* @__PURE__ */ jsx11("link", { rel: "apple-touch-icon", href: "/icons/icon-180.png" }),
        /* @__PURE__ */ jsx11("script", { defer: true, src: "/assets/session.js" })
      ] }),
      /* @__PURE__ */ jsx11("body", { children: /* @__PURE__ */ jsx11("main", { className: "auth-page", children: /* @__PURE__ */ jsxs5("div", { className: "stack", children: [
        /* @__PURE__ */ jsx11("div", { className: "eyebrow", children: brand }),
        /* @__PURE__ */ jsxs5("h1", { children: [
          /* @__PURE__ */ jsx11(Icon, { name: admin ? "adminLocked" : "user" }),
          " ",
          admin ? t("admin") : t("googleSignIn")
        ] }),
        /* @__PURE__ */ jsx11("p", { id: "login-status", role: status === "ready" ? "status" : "alert", children: t(message) }),
        /* @__PURE__ */ jsx11(Button, { asChild: true, children: /* @__PURE__ */ jsxs5("a", { href: status === "setup" ? `${entry}?lang=${encodeURIComponent(ui.locale)}` : `/api/auth/start?${start}`, "aria-describedby": "login-status", children: [
          status === "setup" ? /* @__PURE__ */ jsx11(Icon, { name: "refresh" }) : /* @__PURE__ */ jsx11(Icon, { name: "arrow" }),
          t(status === "setup" ? "refreshConnections" : "googleSignIn")
        ] }) }),
        /* @__PURE__ */ jsx11(Button, { asChild: true, variant: "ghost", children: /* @__PURE__ */ jsxs5("a", { href: `${admin ? "/" : "/admin"}?lang=${encodeURIComponent(ui.locale)}`, children: [
          /* @__PURE__ */ jsx11(Icon, { name: admin ? "home" : "adminLocked" }),
          t(admin ? "today" : "admin")
        ] }) }),
        /* @__PURE__ */ jsxs5("details", { className: "disclosure", children: [
          /* @__PURE__ */ jsx11("summary", { children: t("language") }),
          /* @__PURE__ */ jsx11(LanguageForm, { ui, action: admin ? "/admin" : "/" })
        ] })
      ] }) }) })
    ] })
  );
}

// src/server/handler.ts
var readRoutes = /* @__PURE__ */ new Set(["admin-page", "admin-overview", "page", "app", "session", "destinations", "start", "callback", "calendar-status", "calendar-callback", "mcp-tokens"]);
async function handle(request, db, authProvider) {
  const url = new URL(request.url), route = url.searchParams.get("route") ?? "";
  const locale = normalizeLocale(url.searchParams.get("lang") ?? request.headers.get("cookie")?.split("; ").find((value) => value.startsWith("relay-locale="))?.slice(13) ?? request.headers.get("accept-language")?.split(",")[0]?.split(";")[0]);
  try {
    if (!["admin-page", "admin-overview", "page", "app", "session", "destinations", "start", "callback", "logout", "code", "destination", "notify", "webhook", "calendar-status", "calendar-callback", "calendar-connect", "calendar-disconnect", "schedule-propose", "schedule-book", "mcp", "mcp-tokens", "mcp-token", "mcp-revoke"].includes(route)) throw new ApiError(404, "missing");
    if (request.method !== (readRoutes.has(route) ? "GET" : "POST")) throw new ApiError(405, "method");
    if (configured() && url.origin !== origin()) {
      if (route === "page" || route === "admin-page") {
        const target = new URL(route === "admin-page" ? "/admin" : "/", origin());
        if (url.searchParams.has("lang")) target.searchParams.set("lang", locale);
        return new Response(null, { status: 303, headers: { Location: target.href } });
      }
      throw new ApiError(403, "origin");
    }
    if (route === "page" || route === "admin-page") {
      const adminEntry = route === "admin-page";
      const ready = configured() && (!adminEntry || administratorIssues().length === 0);
      const identity2 = ready ? await session(request, db) : null;
      const authOutcome = url.searchParams.get("auth");
      const failedLogin = authOutcome === "denied" || authOutcome === "unavailable";
      if (identity2 && (!adminEntry || administratorAllowed(identity2.email)) && !failedLogin) {
        const html = (await readFile("prototype/index.html", "utf8")).replace('<div id="app">', `<div id="app" data-admin="${administratorAllowed(identity2.email)}">`);
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      const loginStatus = !ready ? "setup" : authOutcome === "unavailable" ? "unavailable" : identity2 || authOutcome === "denied" ? "denied" : "ready";
      const status = loginStatus === "setup" || loginStatus === "unavailable" ? 503 : loginStatus === "denied" ? 403 : 200;
      return new Response(loginPage(locale, loginStatus, adminEntry), { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (!configured()) throw new ApiError(503, "configuration");
    if (route === "start") {
      const response = await startLogin(db, authProvider, url.searchParams.get("destination") === "admin" ? "/admin" : "/");
      response.headers.append("Set-Cookie", `relay-locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
      return response;
    }
    if (route === "callback") return await finishLogin(request, db, authProvider);
    if (route === "webhook") {
      if (!lineConfigured()) throw new ApiError(503, "configuration");
      await webhook(await limitedBody(request), request.headers.get("x-line-signature"));
      return Response.json({ ok: true });
    }
    if (route === "mcp") return await handleMcp(request, await limitedBody(request));
    const identity = await session(request, db);
    if (!identity) throw new ApiError(401, "unauthorized");
    if (request.method === "POST" && !sameOrigin(request)) throw new ApiError(403, "origin");
    if (route === "app") return new Response(await readFile("prototype/assets/app.js", "utf8"), { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
    if (route === "admin-overview") return Response.json(await adminOverview(request, db));
    if (route === "session") return Response.json({ isAdmin: administratorAllowed(identity.email), email: identity.email, subject: identity.subject, lineReady: lineConfigured() });
    if (route === "logout") return await logout(request);
    if (route === "calendar-status") return Response.json(await calendarStatus(identity));
    if (route === "calendar-callback") return await finishCalendar(request, identity);
    if (route === "calendar-connect") {
      const started = await startCalendar(identity);
      return Response.json({ url: started.headers.get("location") }, { headers: { "Set-Cookie": started.headers.get("set-cookie") } });
    }
    if (route === "calendar-disconnect") {
      await disconnectCalendar(identity);
      return Response.json({ ok: true });
    }
    if (route === "mcp-tokens") return Response.json(await listMcpTokens(identity));
    if (["destinations", "code", "destination", "notify"].includes(route) && !lineConfigured()) throw new ApiError(503, "configuration");
    if (route === "destinations") return Response.json(await destinations(identity));
    let input;
    try {
      input = JSON.parse(await limitedBody(request));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "invalid");
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "invalid");
    if (route === "mcp-token") return Response.json(await issueMcpToken(identity, input.permission));
    if (route === "mcp-revoke") {
      await revokeMcpToken(identity, input.id);
      return Response.json({ ok: true });
    }
    if (route === "schedule-propose" || route === "schedule-book") {
      await integrationLimit(identity);
      return Response.json(route === "schedule-propose" ? await proposeSchedule(identity, input) : await bookSlot(identity, input.proposalId));
    }
    if (route === "code") return Response.json(await issueCode(identity, input.kind));
    if (route === "destination") {
      await changeDestination(identity, input.id, input.action);
      return Response.json({ ok: true });
    }
    if (route === "notify") return Response.json(await notify(identity, input));
    throw new ApiError(404, "missing");
  } catch (error) {
    if (request.method === "GET" && ["page", "admin-page", "start", "callback"].includes(route) && !(error instanceof ApiError && error.status < 500)) {
      const admin = route === "admin-page" || route === "start" && url.searchParams.get("destination") === "admin";
      const ready = configured() && (!admin || administratorIssues().length === 0);
      const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Retry-After": "30" });
      if (route === "callback") headers.set("Set-Cookie", cookie(oauthCookie, "", 0));
      return new Response(loginPage(locale, ready ? "unavailable" : "setup", admin), { status: 503, headers });
    }
    return Response.json({ error: error instanceof ApiError ? error.code : error instanceof ZodError || error instanceof RangeError ? "invalid" : "unavailable" }, { status: error instanceof ApiError ? error.status : error instanceof ZodError || error instanceof RangeError ? 400 : 503 });
  }
}
async function limitedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks = [];
  for (; ; ) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      throw new ApiError(413, "size");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
var handler_default = { async fetch(request) {
  const response = await handle(request);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("CDN-Cache-Control", "no-store");
  response.headers.set("Vercel-CDN-Cache-Control", "no-store");
  response.headers.set("Vary", "Cookie");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return response;
} };
export {
  handler_default as default,
  handle,
  limitedBody
};
