export interface MenuItem {
  id: string;
  tenantIds: string[];
  parentId?: string;
  name: string;
  emoji?: string;
  componentName: string;
  sortOrder: number;
  roleIds: string[];
  hiddenInPlanIds: string[];
  createdAt: string;
}
