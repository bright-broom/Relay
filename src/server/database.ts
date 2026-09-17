import postgres from 'postgres';
export type Row = Record<string, unknown>;
export interface Database {
  query<T extends Row = Row>(text: string, values?: (string | number | boolean | null)[]): Promise<T[]>;
  transaction<T>(work: (db: Database) => Promise<T>): Promise<T>;
}
function wrap(sql: postgres.Sql | postgres.TransactionSql): Database {
  return {
    async query<T extends Row>(text: string, values: (string | number | boolean | null)[] = []) {
      return await sql.unsafe(text, values) as unknown as T[];
    },
    async transaction<T>(work: (db: Database) => Promise<T>): Promise<T> {
      if (!('begin' in sql)) return work(wrap(sql));
      return await sql.begin(tx => work(wrap(tx))) as T;
    },
  };
}
let connection: Database | undefined;
export function connectDatabase(url: string): Database {
  return wrap(postgres(url, {
    ssl: 'verify-full', max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10,
  }));
}
export function database(): Database {
  if (!process.env.DATABASE_URL) throw new Error('configuration');
  return connection ??= connectDatabase(process.env.DATABASE_URL);
}
