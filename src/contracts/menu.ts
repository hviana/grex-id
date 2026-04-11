export interface MenuItem {
  id: string;
  systemId: string;
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
