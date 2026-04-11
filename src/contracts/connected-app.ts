export interface ConnectedApp {
  id: string;
  name: string;
  companyId: string;
  systemId: string;
  permissions: string[];
  monthlySpendLimit?: number;
  createdAt: string;
}
