export interface Company {
  id: string;
  name: string;
  document: string;
  documentType: string;
  billingAddressId?: string; // option<record<address>>
  createdAt: string;
  updatedAt: string;
}
