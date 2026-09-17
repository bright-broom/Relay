import {z} from 'zod';

export const customerInput = z.object({
  displayName: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/u),
  kind: z.enum(['individual', 'organization', 'household']),
}).strict();
export const crmId = z.uuid().transform(value => value.toLowerCase());
export const createCustomerInput = z.object({
  workspaceId: crmId, key: crmId, customer: customerInput,
}).strict();
const version = z.string().regex(/^[1-9][0-9]{0,18}$/).pipe(z.string().refine(value => BigInt(value) < 9223372036854775807n));
const mutation = {workspaceId: crmId, key: crmId, version};
export const changeCustomerInput = z.discriminatedUnion('action', [
  z.object({...mutation, action: z.literal('edit'), customer: customerInput}).strict(),
  z.object({...mutation, action: z.literal('archive')}).strict(),
  z.object({...mutation, action: z.literal('restore')}).strict(),
]);
export type CustomerChange = z.infer<typeof changeCustomerInput>;
export type CustomerInput = z.infer<typeof customerInput>;
export type CrmWorkspace = {id: string; name: string; role: 'viewer' | 'editor' | 'admin'};
export type Customer = {
  id: string; displayName: string; kind: CustomerInput['kind'];
  status: 'prospect' | 'active' | 'inactive'; version: string; updatedAt: string; archivedAt: string | null;
};
export type CustomerPage = {customers: Customer[]; nextCursor: string | null};
export type CustomerCreated = {customer: Customer; replayed: boolean};
// A replay returns the current record, which may have changed since this operation.
export type CustomerChanged = CustomerCreated & {appliedVersion: string};
