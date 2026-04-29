import type {
  FileAccessSection,
  FileAccessUploadSection,
} from "./high-level/file-access";

export interface FileAccess {
  id: string;
  name: string;
  categoryPattern: string;
  download: FileAccessSection;
  upload: FileAccessUploadSection;
  createdAt: string;
}
