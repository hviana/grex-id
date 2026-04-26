export interface CoreSetting {
  id: string;
  key: string;
  value: string;
  description: string;
  tenantId: string; // references system-only tenant row
  createdAt: string;
  updatedAt: string;
}

export interface FrontCoreSetting {
  id: string;
  key: string;
  value: string;
  description: string;
  tenantId: string; // references system-only tenant row
  createdAt: string;
  updatedAt: string;
}
