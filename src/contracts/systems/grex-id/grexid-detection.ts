export interface GrexidDetection {
  id: string;
  locationId: string;
  leadId?: string;
  faceId?: string;
  score: number;
  eventId?: string;
  detectedAt: string;
  createdAt: string;
}
