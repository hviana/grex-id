export interface QueueEvent {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  availableAt: string;
  createdAt: string;
}
