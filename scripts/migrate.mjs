import postgres from 'postgres';
import {readFile} from 'node:fs/promises';
const url=process.env.MIGRATION_DATABASE_URL;
if(!url)throw new Error('Set MIGRATION_DATABASE_URL in your secure environment before running db:migrate.');
const sql=postgres(url,{ssl:'verify-full',max:1,prepare:false});
try {
 await sql.begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(7211647)`;
  await tx`CREATE SCHEMA IF NOT EXISTS relay_private`;
  await tx`REVOKE ALL ON SCHEMA relay_private FROM PUBLIC`;
  await tx`CREATE TABLE IF NOT EXISTS relay_private.migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())`;
  const name='001_identity_line.sql';
  const [existing]=await tx`SELECT name FROM relay_private.migrations WHERE name=${name}`;
  if(!existing){await tx.unsafe(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));await tx`INSERT INTO relay_private.migrations(name) VALUES(${name})`;}
 });
 console.log('Relay identity/LINE migration is applied.');
} finally {await sql.end();}
