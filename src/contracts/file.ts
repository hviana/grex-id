export interface FileMetadata {
  id: string;
  companyId: string;
  systemSlug: string;
  userId: string;
  category: string[];
  fileName: string;
  fileUuid: string;
  uri: string;
  sizeBytes: number;
  mimeType: string;
  description?: string;
  createdAt: string;
}
