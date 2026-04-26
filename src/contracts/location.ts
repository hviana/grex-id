export interface Location {
  id: string;
  name: string;
  description?: string;
  tenantIds: string[]; // references company-system tenant rows
  address: {
    street: string;
    number: string;
    complement?: string;
    neighborhood?: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
  };
  createdAt: string;
  updatedAt: string;
}
