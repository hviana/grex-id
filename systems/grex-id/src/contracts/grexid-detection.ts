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

// Classification rules (multi-tenant):
// - unknown: detection has no leadId (face did not match any registered lead)
// - member:  lead is associated with the CURRENT company + system
// - visitor: lead exists but is NOT associated with the current company + system

export interface DetectionReportItem {
  id: string;
  detectedAt: string;
  score: number;
  locationName: string;
  locationId: string;
  leadId?: string;
  faceId?: string;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;
  leadAvatarUri?: string;
  ownerId?: string;
  ownerName?: string;
  classification: "member" | "visitor" | "unknown";
}

export interface DetectionIndividual {
  faceId: string;
  leadId?: string;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;
  leadAvatarUri?: string;
  classification: "member" | "visitor" | "unknown";
  detectionCount: number;
  lastDetectedAt: string;
  bestScore: number;
  locationId: string;
  locationName: string;
  ownerId?: string;
  ownerName?: string;
  [key: string]: unknown;
}

export interface DetectionStats {
  uniqueMembers: number;
  uniqueVisitors: number;
  uniqueUnknowns: number;
  individuals: DetectionIndividual[];
  hourlyUnique: number[];
  dailyUnique: number[];
}

/** KNN vector-search result returned by searchMatchingFace. */
export interface FaceMatchResult {
  id: string;
  leadId: string;
  score: number;
}
