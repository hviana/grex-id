export interface MenuItem {
  id: string;
  tenantId: string; // references system-only tenant row
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
