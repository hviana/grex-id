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

/** Raw detection row shape returned by SurrealDB queries in listDetections. */
export interface RawDetectionRow {
  id: unknown;
  detectedAt: string;
  score: number;
  locationId:
    & Record<string, unknown>
    & { id: unknown; name: string };
  faceId?:
    | (Record<string, unknown> & { id: unknown })
    | null;
  leadId?:
    | (Record<string, unknown> & {
      id: unknown;
      name?: string;
      email?: string;
      phone?: string;
      profileId?: { avatarUri?: string };
    })
    | null;
}

/** Aggregated face row returned by SurrealDB GROUP BY in getDetectionStats. */
export interface AggregatedFaceRow {
  faceId: Record<string, unknown> & { id: unknown };
  leadId:
    | (Record<string, unknown> & {
      id: unknown;
      name?: string;
      email?: string;
      phone?: string;
      profileId?: { avatarUri?: string };
    })
    | null;
  locationId: Record<string, unknown> & {
    id: unknown;
    name: string;
  };
  detectionCount: number;
  lastDetectedAt: string;
  bestScore: number;
}
