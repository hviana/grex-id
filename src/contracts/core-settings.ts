export interface CoreSetting {
  id: string;
  key: string;
  value: string;
  description: string;
  tenantIds: string[]; // references system-only tenant rows
  createdAt: string;
  updatedAt: string;
}

export interface FrontCoreSetting {
  id: string;
  key: string;
  value: string;
  description: string;
  tenantIds: string[]; // references system-only tenant rows
  createdAt: string;
  updatedAt: string;
}
