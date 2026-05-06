export interface Address {
  id: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  createdAt: string;
  updatedAt: string;
}
