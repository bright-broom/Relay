// Generated from src/server/handler.ts. Do not edit.

// src/server/handler.ts
import { readFile } from "node:fs/promises";

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
async function startLogin(db = database(), configuration) {
  const config = configuration ?? await google();
  const token = randomToken(), state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier();
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
  const failure = () => {
    headers.set("Location", "/?auth=denied");
    return new Response(null, { status: 303, headers });
  };
  if (!token) return failure();
  const [attempt] = await db.query("DELETE FROM relay_private.oauth_attempts WHERE token_hash=$1 AND expires_at > now() RETURNING state,nonce,verifier", [hash(token)]);
  if (!attempt) return failure();
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
    if (!identity) return failure();
    const newToken = randomToken();
    await db.query("DELETE FROM relay_private.sessions WHERE expires_at < now() OR token_hash=$1", [hash(readCookie(request, sessionCookie))]);
    await db.query("INSERT INTO relay_private.sessions(token_hash,subject,email,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')", [hash(newToken), identity.subject, identity.email]);
    headers.append("Set-Cookie", cookie(sessionCookie, newToken, 28800));
    headers.set("Location", "/");
    return new Response(null, { status: 303, headers });
  } catch {
    return failure();
  }
}
async function logout(request, db = database()) {
  await db.query("DELETE FROM relay_private.sessions WHERE token_hash=$1", [hash(readCookie(request, sessionCookie))]);
  const headers = new Headers({ "Set-Cookie": cookie(sessionCookie, "", 0) });
  headers.append("Set-Cookie", cookie(oauthCookie, "", 0));
  return Response.json({ ok: true }, { headers });
}

// src/i18n/messages.ts
var brand = "Relay";
var localeNames = { ja: "\u65E5\u672C\u8A9E", en: "English" };
var ja = {
  account: "\u30A2\u30AB\u30A6\u30F3\u30C8\u30FBLINE\u9023\u643A",
  googleSignIn: "Google\u3067\u30ED\u30B0\u30A4\u30F3",
  loginHint: "\u767B\u9332\u6E08\u307F\u306EGoogle\u30A2\u30AB\u30A6\u30F3\u30C8\u3067\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  authSetup: "\u63A5\u7D9A\u8A2D\u5B9A\u3092\u6E96\u5099\u3057\u3066\u3044\u307E\u3059\u3002\u8A2D\u5B9A\u304C\u5B8C\u4E86\u3059\u308B\u3068\u30ED\u30B0\u30A4\u30F3\u3067\u304D\u307E\u3059\u3002",
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
  installTitle: "\u30A2\u30D7\u30EA\u3092\u8FFD\u52A0",
  installNow: "\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB",
  iosLabel: "iPhone\u30FBiPad",
  androidLabel: "Android",
  installIos: "Safari\u3067\u958B\u304D\u3001\u5171\u6709 \u2192\u300C\u30DB\u30FC\u30E0\u753B\u9762\u306B\u8FFD\u52A0\u300D\u2192\u300C\u8FFD\u52A0\u300D\u3002\u8868\u793A\u3055\u308C\u308B\u5834\u5408\u306F\u300CWeb\u30A2\u30D7\u30EA\u3068\u3057\u3066\u958B\u304F\u300D\u3092\u30AA\u30F3\u306B\u3057\u307E\u3059\u3002",
  installAndroid: "Chrome\u3067\u958B\u304D\u3001\u30E1\u30CB\u30E5\u30FC \u2192\u300C\u30A2\u30D7\u30EA\u3092\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB\u300D\u307E\u305F\u306F\u300C\u30DB\u30FC\u30E0\u753B\u9762\u306B\u8FFD\u52A0\u300D\u3002",
  installHttps: "\u516C\u958BURL\u3092Safari\u307E\u305F\u306FChrome\u3067\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002\u3053\u306E\u30ED\u30FC\u30AB\u30EB\u30D5\u30A1\u30A4\u30EB\u304B\u3089\u306F\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB\u3067\u304D\u307E\u305B\u3093\u3002",
  installAccepted: "\u7AEF\u672B\u306E\u6848\u5185\u306B\u6CBF\u3063\u3066\u8FFD\u52A0\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
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
  designSection: "\u8868\u793A\u3059\u308B\u9805\u76EE",
  designColors: "\u30AB\u30E9\u30FC",
  designType: "\u6587\u5B57",
  designSpace: "\u4F59\u767D\u30FB\u5F62",
  designStack: "\u958B\u767A\u69CB\u6210",
  importMethod: "\u53D6\u8FBC\u5143",
  sampleSource: "\u67B6\u7A7A\u306E\u4F1A\u8A71\u30B5\u30F3\u30D7\u30EB",
  noteRequired: "\u88DC\u8DB3\uFF08\u305D\u306E\u4ED6\u306E\u5185\u5BB9\uFF09",
  activity: "\u5BFE\u5FDC\u8A18\u9332",
  previewShort: "\u30D7\u30EC\u30D3\u30E5\u30FC",
  app: "Relay \xB7 \u6848\u4EF6\u30EF\u30FC\u30AF\u30B9\u30DA\u30FC\u30B9",
  today: "\u4ECA\u65E5\u306E\u5BFE\u5FDC",
  cases: "\u6848\u4EF6\u4E00\u89A7",
  reviews: "\u66F4\u65B0\u6848\u306E\u78BA\u8A8D",
  imports: "\u60C5\u5831\u306E\u53D6\u8FBC",
  system: "\u30C7\u30B6\u30A4\u30F3\u3068\u69CB\u6210",
  demoNote: "\u67B6\u7A7A\u30C7\u30FC\u30BF \xB7 \u5916\u90E8\u63A5\u7D9A\u306A\u3057",
  language: "\u8868\u793A\u8A00\u8A9E",
  menu: "\u30E1\u30CB\u30E5\u30FC",
  skip: "\u672C\u6587\u3078\u79FB\u52D5",
  add: "\u60C5\u5831\u3092\u53D6\u308A\u8FBC\u3080",
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
  imported: "\u30B5\u30F3\u30D7\u30EB\u306E\u53D6\u8FBC\u7D50\u679C",
  file: "\u5C65\u6B74\u30D5\u30A1\u30A4\u30EB",
  duplicates: "\u91CD\u8907\u3057\u305F\u6295\u7A3F",
  newMessages: "\u65B0\u3057\u3044\u6295\u7A3F",
  two: "2\u4EF6\u3092\u9664\u5916",
  one: "1\u4EF6 \u2192 \u66F4\u65B0\u6848\u3092\u4F5C\u6210",
  importNote: "\u30D5\u30A1\u30A4\u30EB\u306E\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3084AI\u89E3\u6790\u306F\u884C\u3063\u3066\u3044\u307E\u305B\u3093\u3002",
  overdueDeadline: "\u671F\u9650\u8D85\u904E \xB7 {date}",
  mainColor: "\u30E1\u30A4\u30F3 \xB7 \u58A8\u9ED2",
  subColor: "\u30B5\u30D6 \xB7 \u767D",
  accentColor: "\u30A2\u30AF\u30BB\u30F3\u30C8 \xB7 \u9752",
  derivedColors: "\u30B0\u30EC\u30FC\u306F\u58A8\u9ED2\u3068\u767D\u306E\u6DF7\u8272\u306E\u307F\u3002\u9752\u306E\u6FC3\u6DE1\u306F\u64CD\u4F5C\u6642\u306B\u3060\u3051\u4F7F\u3044\u3001\u72EC\u7ACB\u3057\u305F\u72B6\u614B\u8272\u306F\u5897\u3084\u3057\u307E\u305B\u3093\u3002",
  pageType: "\u753B\u9762\u30BF\u30A4\u30C8\u30EB",
  sectionType: "\u9818\u57DF\u898B\u51FA\u3057",
  bodyType: "\u672C\u6587\u30FB\u5165\u529B",
  labelType: "\u30E9\u30D9\u30EB",
  typeSample: "\u6B21\u306E\u4ED5\u4E8B\u3092\u3001\u660E\u78BA\u306B\u3002",
  tokenSize: "{size}px",
  spaceTitle: "\u60C5\u5831\u306E\u8DDD\u96E2\u3068\u5F62",
  relatedGap: "\u95A2\u9023\u3059\u308B\u8981\u7D20",
  groupGap: "\u540C\u3058\u30B0\u30EB\u30FC\u30D7",
  sectionGap: "\u72EC\u7ACB\u3057\u305F\u9818\u57DF",
  shapeSpecs: "\u89D2\u4E38\u306F\u30E1\u30C7\u30A3\u30A2\u30FB\u5165\u529B {media}\u3001\u30AB\u30FC\u30C9 {card}\u3001\u88DC\u52A9\u30D1\u30CD\u30EB {panel}\u3002\u30DC\u30BF\u30F3\u306F\u30D4\u30EB\u578B\u3067\u9AD8\u3055 {action}\u3001\u64CD\u4F5C\u9818\u57DF\u306F {touch} \u4EE5\u4E0A\u3002",
  paletteBody: "\u30E1\u30A4\u30F3\u306F\u58A8\u9ED2\u3001\u30B5\u30D6\u306F\u767D\u3001\u30A2\u30AF\u30BB\u30F3\u30C8\u306F\u9752\u3002\u60C5\u5831\u3092\u8AAD\u3080\u9762\u306F\u767D\u3001\u6587\u5B57\u3068\u69CB\u9020\u306F\u58A8\u9ED2\u3001\u6B21\u3078\u9032\u3080\u4E3B\u8981\u64CD\u4F5C\u306F\u9752\u3067\u63C3\u3048\u307E\u3059\u3002",
  platform: "\u672C\u756A\u30B9\u30BF\u30C3\u30AF\u306E\u63A8\u5968\u6848",
  platformBody: "TypeScript\u30FBReact\u30FBNext.js\u30FBTailwind CSS\u30FBshadcn/ui\u3002\u8A8D\u8A3C\u3068\u30D5\u30A1\u30A4\u30EB\u4FDD\u5B58\u3082\u542B\u3081\u3001Supabase\u3092\u7B2C\u4E00\u5019\u88DC\u3068\u3057\u307E\u3059\u3002",
  sequencing: "\u52B9\u7387\u306E\u3088\u3044\u5B9F\u88C5\u9806\u5E8F",
  sequencingBody: "\u30C7\u30B6\u30A4\u30F3\u4ED5\u69D8 \u2192 \u65B0\u30B9\u30BF\u30C3\u30AF\u306E\u57FA\u76E4 \u2192 \u5171\u901A\u90E8\u54C1 \u2192 \u5168\u753B\u9762 \u2192 DB\u3068AI\u306E\u63A5\u7D9A\u3002\u4ECA\u56DE\u306E\u753B\u9762\u306F\u30C7\u30B6\u30A4\u30F3\u691C\u8A0E\u7528\u3067\u3059\u3002",
  reusable: "\u79FB\u884C\u6642\u306B\u5F15\u304D\u7D99\u3050\u3082\u306E",
  reusableBody: "\u578B\u4ED8\u304D\u306E\u30C8\u30FC\u30AF\u30F3\u3001\u7FFB\u8A33\u30AD\u30FC\u3001\u6848\u4EF6\u306E\u578B\u3001\u753B\u9762\u306E\u69CB\u6210\u3092\u5206\u96E2\u3057\u3066\u3044\u307E\u3059\u3002DOM\u3092\u63CF\u753B\u3059\u308B\u30B3\u30FC\u30C9\u306FReact\u3067\u7F6E\u304D\u63DB\u3048\u307E\u3059\u3002",
  guide: "\u30C7\u30B6\u30A4\u30F3\u30AC\u30A4\u30C9",
  architecture: "\u30B9\u30BF\u30C3\u30AF\u306E\u6BD4\u8F03\u3068\u63D0\u6848",
  emptyToday: "\u4ECA\u65E5\u307E\u3067\u306E\u5BFE\u5FDC\u306F\u5B8C\u4E86\u3057\u307E\u3057\u305F",
  previewFooter: "\u8A18\u9332\u306F\u3053\u306E\u7AEF\u672B\u306E\u30D6\u30E9\u30A6\u30B6\u30FC\u306B\u4FDD\u5B58\u3055\u308C\u307E\u3059\u3002\u7AEF\u672B\u9593\u306E\u540C\u671F\u306F\u3042\u308A\u307E\u305B\u3093\u3002\u30D6\u30E9\u30A6\u30B6\u30FC\u30C7\u30FC\u30BF\u306E\u524A\u9664\u3067\u8A18\u9332\u3082\u6D88\u3048\u307E\u3059\u3002"
};
var en = {
  account: "Account & LINE",
  googleSignIn: "Sign in with Google",
  loginHint: "Sign in with an approved Google account.",
  authSetup: "Connection setup is in progress. Sign-in will be available once it is complete.",
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
  installTitle: "Add app",
  installNow: "Install",
  iosLabel: "iPhone and iPad",
  androidLabel: "Android",
  installIos: "Open in Safari, then Share \u2192 Add to Home Screen \u2192 Add. Enable Open as Web App if shown.",
  installAndroid: "Open in Chrome, then menu \u2192 Install app or Add to Home screen.",
  installHttps: "Open the published URL in Safari or Chrome. Installation is unavailable from this local file.",
  installAccepted: "Follow the instructions on your device to finish adding the app.",
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
  designSection: "Show section",
  designColors: "Colors",
  designType: "Typography",
  designSpace: "Space and shape",
  designStack: "Architecture",
  importMethod: "Import source",
  sampleSource: "Fictional conversation sample",
  noteRequired: "Note (describe other)",
  activity: "Activity",
  previewShort: "Preview",
  app: "Relay \xB7 Case workspace",
  today: "Today",
  cases: "Cases",
  reviews: "Review updates",
  imports: "Import conversations",
  system: "Design & architecture",
  demoNote: "Sample data \xB7 No connections",
  language: "Display language",
  menu: "Menu",
  skip: "Skip to content",
  add: "Import information",
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
  imported: "Sample import result",
  file: "History file",
  duplicates: "Duplicate messages",
  newMessages: "New messages",
  two: "2 excluded",
  one: "1 message \u2192 update proposal",
  importNote: "No file has been uploaded and no AI processing has run.",
  overdueDeadline: "Past due \xB7 {date}",
  mainColor: "Main \xB7 Near-black",
  subColor: "Supporting \xB7 White",
  accentColor: "Accent \xB7 Blue",
  derivedColors: "Grays blend near-black and white. Blue shades are reserved for interaction. Statuses introduce no additional colors.",
  pageType: "Page title",
  sectionType: "Section title",
  bodyType: "Body and input",
  labelType: "Label",
  typeSample: "Make the next step clear.",
  tokenSize: "{size}px",
  spaceTitle: "Space and shape",
  relatedGap: "Related elements",
  groupGap: "Within a group",
  sectionGap: "Between sections",
  shapeSpecs: "Corner radii: media and inputs {media}, cards {card}, supporting panels {panel}. Pill buttons are {action} high; touch targets are at least {touch}.",
  paletteBody: "Near-black is the main color, white is the supporting color, and blue is the accent. White holds the content; near-black defines its structure; blue highlights the primary action.",
  platform: "Recommended production stack",
  platformBody: "TypeScript, React, Next.js, Tailwind CSS, and shadcn/ui. Supabase is the first choice for database, authentication, and file storage.",
  sequencing: "An efficient build sequence",
  sequencingBody: "Design specification \u2192 framework foundation \u2192 shared components \u2192 all screens \u2192 database and AI. This remains a design preview.",
  reusable: "Built to inform the next step",
  reusableBody: "Typed tokens, translation keys, case types, and page structure are separate. React will replace the DOM rendering code.",
  guide: "Design guidelines",
  architecture: "Stack comparison and recommendation",
  emptyToday: "All work due today is complete",
  previewFooter: "Records are stored in this browser on this device. There is no device sync. Clearing browser data removes the records."
};
function translate(locale, key, params = {}) {
  const text = (locale === "en" ? en : ja)[key];
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
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
  "gap-related": primitives["space-3"],
  "gap-group": primitives["space-5"],
  "gap-section": primitives["space-7"],
  "panel-padding": primitives["space-5"],
  "swatch-height": primitives["space-9"],
  "rail-padding": primitives["space-4"],
  "tooltip-max": "14rem",
  "notification-dot": primitives["space-2"],
  "narrow-gutter": primitives["space-4"],
  "tablet-gutter": primitives["space-6"],
  "viewport-block": "100dvh",
  "viewport-offset": "0px",
  "mobile-header-height": "4.25rem"
};
var tokens = { ...colorTokens, ...primitives, ...componentTokens };

// src/server/page.ts
function loginPage(locale, ready, denied) {
  const t = (key) => translate(locale, key);
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><meta name="theme-color" content="${palette.sub}"><title>${brand}</title><link rel="stylesheet" href="/assets/styles.css"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/icon-180.png"><script defer src="/assets/session.js"></script></head><body><main class="auth-page"><div class="stack"><h1>${brand}</h1><p role="status">${t(denied ? "authDenied" : ready ? "loginHint" : "authSetup")}</p>${ready ? `<a class="button primary" href="/api/auth/start">${t("googleSignIn")}</a>` : ""}<a href="/?lang=${locale === "ja" ? "en" : "ja"}" lang="${locale === "ja" ? "en" : "ja"}">${localeNames[locale === "ja" ? "en" : "ja"]}</a></div></main></body></html>`;
}

// src/server/line.ts
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
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

// src/server/handler.ts
var readRoutes = /* @__PURE__ */ new Set(["page", "app", "session", "destinations", "start", "callback"]);
async function handle(request) {
  const url = new URL(request.url), route = url.searchParams.get("route") ?? "";
  const locale = url.searchParams.get("lang") === "en" ? "en" : "ja";
  try {
    if (!["page", "app", "session", "destinations", "start", "callback", "logout", "code", "destination", "notify", "webhook"].includes(route)) throw new ApiError(404, "missing");
    if (request.method !== (readRoutes.has(route) ? "GET" : "POST")) throw new ApiError(405, "method");
    if (configured() && url.origin !== origin()) {
      if (route === "page") return new Response(null, { status: 303, headers: { Location: origin() + "/" } });
      throw new ApiError(403, "origin");
    }
    if (route === "page") {
      const ready = configured();
      if (ready && await session(request)) return new Response(await readFile("prototype/index.html", "utf8"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return new Response(loginPage(locale, ready, url.searchParams.get("auth") === "denied"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (!configured()) throw new ApiError(503, "configuration");
    if (route === "start") return await startLogin();
    if (route === "callback") return await finishLogin(request);
    if (route === "webhook") {
      if (!lineConfigured()) throw new ApiError(503, "configuration");
      await webhook(await limitedBody(request), request.headers.get("x-line-signature"));
      return Response.json({ ok: true });
    }
    const identity = await session(request);
    if (!identity) throw new ApiError(401, "unauthorized");
    if (request.method === "POST" && !sameOrigin(request)) throw new ApiError(403, "origin");
    if (route === "app") return new Response(await readFile("prototype/assets/app.js", "utf8"), { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
    if (route === "session") return Response.json({ email: identity.email, subject: identity.subject, lineReady: lineConfigured() });
    if (route === "logout") return await logout(request);
    if (!lineConfigured()) throw new ApiError(503, "configuration");
    if (route === "destinations") return Response.json(await destinations(identity));
    let input;
    try {
      input = JSON.parse(await limitedBody(request));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "invalid");
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "invalid");
    if (route === "code") return Response.json(await issueCode(identity, input.kind));
    if (route === "destination") {
      await changeDestination(identity, input.id, input.action);
      return Response.json({ ok: true });
    }
    if (route === "notify") return Response.json(await notify(identity, input));
    throw new ApiError(404, "missing");
  } catch (error) {
    return Response.json({ error: error instanceof ApiError ? error.code : "unavailable" }, { status: error instanceof ApiError ? error.status : 503 });
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
