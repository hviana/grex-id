export interface ConnectedService {
  id: string;
  tenantId: string; // references user actor + company + system tenant row
  name: string;
  data?: Record<string, unknown>;
  createdAt: string;
  userName?: string;
}
