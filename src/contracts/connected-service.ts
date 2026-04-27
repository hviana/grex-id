export interface ConnectedService {
  id: string;
  tenantIds: string[]; // references user actor + company + system tenant rows
  name: string;
  data?: Record<string, unknown>;
  createdAt: string;
}
