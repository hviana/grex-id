export interface FileAccessSection {
  isolateSystem: boolean;
  isolateCompany: boolean;
  isolateUser: boolean;
  permissions: string[];
}

export interface FileAccessUploadSection extends FileAccessSection {
  maxFileSizeMB?: number;
  allowedExtensions: string[];
}

export interface FileAccess {
  id: string;
  name: string;
  categoryPattern: string;
  download: FileAccessSection;
  upload: FileAccessUploadSection;
  createdAt: string;
}
