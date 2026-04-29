export interface FileAccessSection {
  isolateSystem: boolean;
  isolateCompany: boolean;
  isolateUser: boolean;
  roles: string[];
}

export interface FileAccessUploadSection extends FileAccessSection {
  maxFileSizeMB?: number;
  allowedExtensions: string[];
}
