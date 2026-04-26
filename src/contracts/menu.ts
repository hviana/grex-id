export interface MenuItem {
  id: string;
  tenantIds: string[]; // references system-only tenant rows
  parentId?: string;
  label: string;
  emoji?: string;
  componentName: string;
  sortOrder: number;
  requiredRoles: string[];
  hiddenInPlanIds: string[];
  children?: MenuItem[];
  createdAt: string;
}
