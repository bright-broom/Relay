import {z} from 'zod';

export const customerInput = z.object({
  displayName: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/u),
  kind: z.enum(['individual', 'organization', 'household']),
}).strict();
export const crmId = z.uuid().transform(value => value.toLowerCase());
export const createCustomerInput = z.object({
  workspaceId: crmId, key: crmId, customer: customerInput,
}).strict();
export type CustomerInput = z.infer<typeof customerInput>;
export type CrmWorkspace = {id: string; name: string; role: 'viewer' | 'editor' | 'admin'};
export type Customer = {
  id: string; displayName: string; kind: CustomerInput['kind'];
  status: 'prospect' | 'active' | 'inactive'; version: string; updatedAt: string;
};
export type CustomerPage = {customers: Customer[]; nextCursor: string | null};
export type CustomerCreated = {customer: Customer; replayed: boolean};
