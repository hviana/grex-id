import type { LeadViewData } from "@/src/contracts/high-level/lead";

export interface DetectionReportItem extends LeadViewData {
  detectedAt: string;
  score: number;
  locationName: string;
  locationId: string;
  leadId?: string;
  faceId?: string;
  classification: "member" | "visitor" | "unknown" | "suppressed";
}

export interface DetectionIndividual {
  faceId: string;
  leadId?: string;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;
  leadAvatarUri?: string;
  classification: "member" | "visitor" | "unknown" | "suppressed";
  detectionCount: number;
  lastDetectedAt: string;
  bestScore: number;
  locationId: string;
  locationName: string;
  ownerId?: string;
  ownerName?: string;
  [key: string]: unknown;
}

export interface HourlyBucket {
  hour:
    | "00:00"
    | "01:00"
    | "02:00"
    | "03:00"
    | "04:00"
    | "05:00"
    | "06:00"
    | "07:00"
    | "08:00"
    | "09:00"
    | "10:00"
    | "11:00"
    | "12:00"
    | "13:00"
    | "14:00"
    | "15:00"
    | "16:00"
    | "17:00"
    | "18:00"
    | "19:00"
    | "20:00"
    | "21:00"
    | "22:00"
    | "23:00";
  unknown: number;
  visitor: number;
  member: number;
  suppressed: number;
}

export interface DetectionStats {
  uniqueMembers: number;
  uniqueVisitors: number;
  uniqueUnknowns: number;
  uniqueSuppressed: number;
  individuals: DetectionIndividual[];
  hourlyBuckets: HourlyBucket[];
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
      profileId?: { name?: string; avatarUri?: string };
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
