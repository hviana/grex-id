import type { Address } from "./address.ts";

export interface Company {
  id: string;
  name: string;
  document: string;
  documentType: string;
  billingAddressId?: Address;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}
