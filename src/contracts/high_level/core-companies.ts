// ============================================================================
// Core admin company listing types (from server/db/queries/core-companies.ts)
// ============================================================================

export interface CoreCompanySystem {
  systemId: string;
  systemName: string;
  systemSlug: string;
  subscriptionId: string | null;
  planName: string | null;
  planPrice: number;
  status: "active" | "past_due" | "cancelled" | null;
}

export interface CoreCompany {
  id: string;
  name: string;
  document: string;
  createdAt: string;
  systems: CoreCompanySystem[];
}

export interface RevenueChart {
  canceled: number;
  paid: number;
  projected: number;
  errors: number;
}
