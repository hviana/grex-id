import type { Profile } from "./profile.ts";

export interface Lead {
  id: string;
  name: string;
  profile: Profile;
  companyIds: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LeadCompanySystem {
  id: string;
  leadId: string;
  companyId: string;
  systemId: string;
  ownerId?: string;
  createdAt: string;
}
