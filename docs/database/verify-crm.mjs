// Design verification only: synthetic data, in-memory PostgreSQL, no external connection.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const pg = new PGlite();
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const insert = async (table, values) => {
 const columns = Object.keys(values);
 return pg.query(`INSERT INTO relay_crm.${table} (${columns.join(',')}) VALUES (${columns.map((_, index) => '$' + (index + 1)).join(',')})`, Object.values(values));
};
const reject = async (work, code) => assert.rejects(work, error => error.code === code);
try {
 for (const file of ['../../migrations/001_identity_line.sql','../../migrations/002_calendar_mcp.sql','./crm-draft.sql']) {
  await pg.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
 }
 const {rows: privateTables} = await pg.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='relay_private'");
 assert.equal(privateTables[0].n, 11);
 for (const n of [1, 2]) {
  await insert('workspaces', {id:id(n),name:`Synthetic workspace ${n}`});
  await insert('principals', {id:id(n+10),issuer:'https://accounts.google.com',subject:`synthetic-${n}`,display_name:`User ${n}`,verified_email:`user${n}@example.invalid`});
  await insert('memberships', {workspace_id:id(n),principal_id:id(n+10),role:'editor',status:'active'});
  await insert('customers', {id:id(n+20),workspace_id:id(n),kind:'organization',display_name:'Synthetic customer',name_search:'synthetic customer',status:'prospect',owner_id:id(n+10)});
  await insert('pipelines', {id:id(n+30),workspace_id:id(n),name:'Sales'});
  await insert('stages', {id:id(n+40),workspace_id:id(n),pipeline_id:id(n+30),name:'Open',kind:'open',position:1});
 }
 await reject(() => insert('customers', {id:id(23),workspace_id:id(1),kind:'individual',display_name:'Wrong owner',name_search:'wrong',status:'prospect',owner_id:id(12)}), '23503');
 const opportunity = {id:id(51),workspace_id:id(1),customer_id:id(21),title:'Synthetic proposal',pipeline_id:id(31),stage_id:id(41),owner_id:id(11)};
 await insert('opportunities', opportunity);
 await reject(() => insert('opportunities', {...opportunity,id:id(52),customer_id:id(22)}), '23503');
 await reject(() => insert('opportunities', {...opportunity,id:id(52),stage_id:id(42)}), '23503');
 await insert('customers', {id:id(23),workspace_id:id(1),kind:'household',display_name:'Another customer',name_search:'another',status:'prospect'});
 for (const n of [61,62]) await insert('contacts', {id:id(n),workspace_id:id(1),display_name:'Shared address',email:'shared@example.invalid'});
 await insert('customer_contacts', {workspace_id:id(1),customer_id:id(21),contact_id:id(61),relationship:'billing',is_primary:true});
 await reject(() => insert('customer_contacts', {workspace_id:id(1),customer_id:id(21),contact_id:id(62),relationship:'sales',is_primary:true}), '23505');
 const activity = {id:id(71),workspace_id:id(1),customer_id:id(21),opportunity_id:id(51),kind:'task_completion',summary:'Explicit completion report',evidence_kind:'self_report',occurred_at:'2026-09-14T00:00:00Z',actor_id:id(11)};
 await insert('activities', activity);
 await reject(() => insert('activities', {...activity,id:id(72),customer_id:id(23)}), '23503');
 await reject(() => insert('activities', {...activity,id:id(72),evidence_kind:'source_reference'}), '23514');
 await insert('activities', {...activity,id:id(72),summary:'Corrected report',supersedes_id:id(71)});
 await reject(() => pg.query('UPDATE relay_crm.activities SET summary=$1 WHERE id=$2',['Overwrite',id(71)]), '55000');
 await reject(() => pg.query('DELETE FROM relay_crm.activities WHERE id=$1',[id(71)]), '55000');
 const task = {id:id(81),workspace_id:id(1),customer_id:id(21),opportunity_id:id(51),title:'Follow up',status:'todo',assignee_id:id(11),due_on:'2026-09-15'};
 await insert('tasks', task);
 await reject(() => insert('tasks', {...task,id:id(82),status:'done'}), '23514');
 await reject(() => insert('tasks', {...task,id:id(82),due_at:'2026-09-15T00:00:00Z'}), '23514');
 await insert('tasks', {...task,id:id(82),status:'done',completed_at:'2026-09-14T00:00:00Z',completion_activity_id:id(71)});
 await reject(() => insert('tasks', {...task,id:id(83),customer_id:id(23),opportunity_id:null,status:'done',completed_at:'2026-09-14T00:00:00Z',completion_activity_id:id(71)}), '23503');
 // A stale editor cannot overwrite a newer version.
 const update = () => pg.query('UPDATE relay_crm.customers SET region=$1,version=version+1,updated_at=now() WHERE workspace_id=$2 AND id=$3 AND version=1 RETURNING version',['Synthetic region',id(1),id(21)]);
 assert.equal((await update()).rows.length,1);
 assert.equal((await update()).rows.length,0);
 const proposal = {id:id(91),workspace_id:id(1),customer_id:id(21),opportunity_id:id(51),revision:1,actor_id:id(11),engine_version:'fixed-cost-jpy/1.0.0',profile_id:'fixed-cost',profile_version:'1.0.0',currency:'JPY',current_monthly:'20000',proposed_monthly:'8000',upfront:'100000',installment_monthly:'5000',installment_months:60,horizon_months:12,current_total:'240000',proposed_total:'256000',remaining_installments:'240000',customer_snapshot:{displayName:'Synthetic customer'},source_snapshot:{schemaVersion:1,kind:'quotation',date:'2026-09-14'}};
 await insert('proposal_snapshots', proposal);
 await reject(() => insert('proposal_snapshots', {...proposal,id:id(92),revision:2,proposed_total:'255999'}), '23514');
 await reject(() => insert('proposal_snapshots', {...proposal,id:id(92),revision:2,remaining_installments:'0'}), '23514');
 await reject(() => insert('proposal_snapshots', {...proposal,id:id(92),revision:2,engine_version:'unverified/2'}), '23514');
 await reject(() => insert('proposal_snapshots', {...proposal,id:id(92)}), '23505');
 await reject(() => pg.query('DELETE FROM relay_crm.proposal_snapshots WHERE id=$1',[id(91)]), '55000');
 const audit = {id:id(101),workspace_id:id(1),actor_id:id(11),request_id:id(111),entity_type:'customer',entity_id:id(21),action:'create',changes:{fields:['display_name']}};
 await insert('audit_events', audit);
 await reject(() => pg.query('UPDATE relay_crm.audit_events SET action=$1 WHERE id=$2',['forged',id(101)]), '55000');
 const request = {workspace_id:id(1),actor_id:id(11),operation:'customer.create',key:id(121),payload_hash:'a'.repeat(64),response_status:201,result_id:id(21),expires_at:'2100-01-01T00:00:00Z'};
 await insert('request_dedup', request);
 await reject(() => insert('request_dedup', request), '23505');
 await reject(() => pg.query('DELETE FROM relay_crm.customers WHERE id=$1',[id(21)]), '23503');
 await pg.query("UPDATE relay_crm.memberships SET status='suspended' WHERE principal_id=$1",[id(11)]);
 assert.equal((await pg.query('SELECT count(*)::int AS n FROM relay_crm.activities WHERE actor_id=$1',[id(11)])).rows[0].n,2);
 const {rows: tables} = await pg.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class JOIN pg_namespace ON pg_namespace.oid=relnamespace WHERE nspname='relay_crm' AND relkind='r'");
 assert.equal(tables.length,14);
 assert(tables.every(table => table.relrowsecurity && table.relforcerowsecurity));
 await pg.exec('CREATE ROLE crm_design_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA relay_crm TO crm_design_runtime; GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA relay_crm TO crm_design_runtime; SET ROLE crm_design_runtime');
 assert.equal((await pg.query('SELECT count(*)::int AS n FROM relay_crm.customers')).rows[0].n,0);
 await reject(() => insert('customers', {id:id(24),workspace_id:id(1),kind:'individual',display_name:'Not authorized',name_search:'not authorized',status:'prospect'}), '42501');
 await pg.exec('RESET ROLE');
 console.log('CRM design: existing schemas coexist; 14 tables; tenant/customer/pipeline FKs, primary contact, optimistic version, completion evidence, append-only history, pricing totals/revisions, dedup and default-deny RLS verified. Synthetic in-memory draft only; implemented runtime policies and APIs are checked separately by tests/crm.mjs.');
} finally {
 await pg.close();
}
