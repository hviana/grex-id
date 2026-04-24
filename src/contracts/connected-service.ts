export interface ConnectedService {
  id: string;
  userId: string;
  companyId: string;
  systemId: string;
  name: string;
  data?: Record<string, unknown>;
  createdAt: string;
  userName?: string;
}
