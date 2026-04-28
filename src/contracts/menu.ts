export interface MenuItem {
  id: string;
  tenantIds: string[];
  parentId?: string;
  label: string;
  emoji?: string;
  componentName: string;
  sortOrder: number;
  requiredRoles: string[];
  hiddenInPlanIds: string[];
  createdAt: string;
}
