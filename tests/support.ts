import assert from 'node:assert/strict';
import type {PGlite, Transaction} from '@electric-sql/pglite';
import type {Database, Row} from '../src/server/database';

// Test adapters preserve the production database contract around synthetic SQL.
export function pgliteDatabase(client: PGlite | Transaction): Database {
  return {
    async query<T extends Row>(text: string, values: (string | number | boolean | null)[] = []) {
      return (await client.query<T>(text, values)).rows;
    },
    async transaction<T>(work: (db: Database) => Promise<T>): Promise<T> {
      return 'transaction' in client ? client.transaction(tx => work(pgliteDatabase(tx))) : work(pgliteDatabase(client));
    },
  };
}
export function errorFields(error: unknown): {code?: string; status?: number} {
  assert.ok(error !== null && typeof error === 'object', 'Expected a structured error');
  return {code: 'code' in error && typeof error.code === 'string' ? error.code : undefined, status: 'status' in error && typeof error.status === 'number' ? error.status : undefined};
}
export type FixtureFetch = (path: string, options: RequestInit & {body?: string}) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
export function fixtureFetch(handler: FixtureFetch): typeof fetch {
  return async (input, init = {}) => {
    assert.equal(typeof input, 'string', 'UI fixture expects a URL string');
    assert.ok(init.body === undefined || typeof init.body === 'string', 'UI fixture expects a JSON string body');
    const response = await handler(input as string, {...init, body: init.body as string | undefined});
    if (response instanceof Response) return response;
    assert.equal(response.ok, response.status >= 200 && response.status < 300);
    return Object.assign(new Response(null, {status: response.status}), {json: response.json});
  };
}

type CrmApi = typeof import('../src/server/crm') & typeof import('../src/server/crm-contacts') & typeof import('../src/server/auth') & Pick<typeof import('../src/server/handler'),'handle'>;
export type CrmContext = {
  api: CrmApi; pg: PGlite; db: Database; failing: Database; failedDedup: Database;
  id: (n: number) => string;
  identity: (n: number) => {subject:string;email:string};
  reject: (work:()=>Promise<unknown>,status:number,code?:string)=>Promise<void>;
  sqlReject: (work:()=>Promise<unknown>)=>Promise<void>;
  scoped: <T>(person:number,workspace:number,work:(db:Database)=>Promise<T>)=>Promise<T>;
  call: (request:Request)=>Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
  request: (route:string,method?:string,body?:unknown,extra?:Record<string,string>)=>Request;
};
export type CrmPostgresContext = {
  api: Pick<CrmApi,keyof typeof import('../src/server/crm') | keyof typeof import('../src/server/crm-contacts')>;
  admin: import('postgres').Sql; db: Database; identity: {subject:string;email:string};
  workspace:string;person:string;customerId:string;contactId:string;pause:(ms:number)=>Promise<void>;
};
export type CrmUiContext = {
  mount:()=>import('@testing-library/react').RenderResult;
  screen:typeof import('@testing-library/react').screen;
  user:import('@testing-library/user-event').UserEvent;
  waitFor:typeof import('@testing-library/react').waitFor;
  cleanup:typeof import('@testing-library/react').cleanup;
  act:typeof import('@testing-library/react').act;
  t:import('../src/i18n/context').UiContext['t'];
  workspace:{id:string;name:string;role:string};
  customer:{id:string;displayName:string;kind:string;status:string;version:string;updatedAt:string};
};
