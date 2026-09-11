import {ZodError} from 'zod';
import {calendarStatus,startCalendar,finishCalendar,disconnectCalendar,proposeSchedule,bookSlot,integrationLimit} from './calendar';
import {handleMcp,listMcpTokens,issueMcpToken,revokeMcpToken} from './mcp';
import {readFile} from 'node:fs/promises';
import {configured, lineConfigured, sameOrigin, origin} from './config';
import {session, startLogin, finishLogin, logout} from './auth';
import {loginPage} from './page';
import {ApiError, destinations, issueCode, changeDestination, webhook, notify} from './line';

const readRoutes = new Set(['page','app','session','destinations','start','callback','calendar-status','calendar-callback','mcp-tokens']);
export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url), route = url.searchParams.get('route') ?? '';
  const locale = url.searchParams.get('lang') === 'en' ? 'en' : 'ja';
  try {
    if (!['page','app','session','destinations','start','callback','logout','code','destination','notify','webhook','calendar-status','calendar-callback','calendar-connect','calendar-disconnect','schedule-propose','schedule-book','mcp','mcp-tokens','mcp-token','mcp-revoke'].includes(route)) throw new ApiError(404, 'missing');
    if (request.method !== (readRoutes.has(route) ? 'GET' : 'POST')) throw new ApiError(405, 'method');
    if (configured() && url.origin !== origin()) {
      if (route === 'page') return new Response(null, {status: 303, headers: {Location: origin() + '/'}});
      throw new ApiError(403, 'origin');
    }
    if (route === 'page') {
      const ready = configured();
      if (ready && await session(request)) return new Response(await readFile('prototype/index.html', 'utf8'), {headers: {'Content-Type': 'text/html; charset=utf-8'}});
      return new Response(loginPage(locale, ready, url.searchParams.get('auth') === 'denied'), {headers: {'Content-Type': 'text/html; charset=utf-8'}});
    }
    if (!configured()) throw new ApiError(503, 'configuration');
    if (route === 'start') return await startLogin();
    if (route === 'callback') return await finishLogin(request);
    if (route === 'webhook') {
      if (!lineConfigured()) throw new ApiError(503, 'configuration');
      await webhook(await limitedBody(request), request.headers.get('x-line-signature'));
      return Response.json({ok: true});
    }
    if (route === 'mcp') return await handleMcp(request,await limitedBody(request));
    const identity = await session(request);
    if (!identity) throw new ApiError(401, 'unauthorized');
    if (request.method === 'POST' && !sameOrigin(request)) throw new ApiError(403, 'origin');
    if (route === 'app') return new Response(await readFile('prototype/assets/app.js', 'utf8'), {headers: {'Content-Type': 'text/javascript; charset=utf-8'}});
    if (route === 'session') return Response.json({email: identity.email, subject: identity.subject, lineReady: lineConfigured()});
    if (route === 'logout') return await logout(request);
    if (route === 'calendar-status') return Response.json(await calendarStatus(identity));
    if (route === 'calendar-callback') return await finishCalendar(request,identity);
    if (route === 'calendar-connect') {
      const started=await startCalendar(identity);
      return Response.json({url:started.headers.get('location')},{headers:{'Set-Cookie':started.headers.get('set-cookie')!}});
    }
    if (route === 'calendar-disconnect') { await disconnectCalendar(identity); return Response.json({ok:true}); }
    if (route === 'mcp-tokens') return Response.json(await listMcpTokens(identity));
    if (['destinations','code','destination','notify'].includes(route) && !lineConfigured()) throw new ApiError(503, 'configuration');
    if (route === 'destinations') return Response.json(await destinations(identity));
    let input: Record<string, unknown>;
    try { input = JSON.parse(await limitedBody(request)); } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'invalid'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'invalid');
    if (route === 'mcp-token') return Response.json(await issueMcpToken(identity,input.permission));
    if (route === 'mcp-revoke') { await revokeMcpToken(identity,input.id); return Response.json({ok:true}); }
    if (route === 'schedule-propose' || route === 'schedule-book') {
      await integrationLimit(identity);
      return Response.json(route === 'schedule-propose' ? await proposeSchedule(identity,input) : await bookSlot(identity,input.proposalId));
    }
    if (route === 'code') return Response.json(await issueCode(identity, input.kind));
    if (route === 'destination') { await changeDestination(identity, input.id, input.action); return Response.json({ok: true}); }
    if (route === 'notify') return Response.json(await notify(identity, input));
    throw new ApiError(404, 'missing');
  } catch (error) {
    return Response.json({error: error instanceof ApiError ? error.code : error instanceof ZodError || error instanceof RangeError ? 'invalid' : 'unavailable'}, {status: error instanceof ApiError ? error.status : error instanceof ZodError || error instanceof RangeError ? 400 : 503});
  }
}
export async function limitedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); throw new ApiError(413, 'size'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export default {async fetch(request: Request) {
  const response = await handle(request);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('CDN-Cache-Control', 'no-store');
  response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  response.headers.set('Vary', 'Cookie');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return response;
}};
