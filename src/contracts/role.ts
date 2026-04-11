export interface Role {
  id: string;
  name: string;
  systemId: string;
  permissions: string[];
  isBuiltIn: boolean;
  createdAt: string;
}
