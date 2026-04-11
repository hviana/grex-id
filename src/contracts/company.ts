import type { Address } from "./address";

export interface Company {
  id: string;
  name: string;
  document: string;
  documentType: string;
  billingAddress?: Address;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}
