export interface FileAccessSection {
  isolateSystem: boolean;
  isolateCompany: boolean;
  isolateUser: boolean;
  permissions: string[];
}

export interface FileAccess {
  id: string;
  name: string;
  categoryPattern: string;
  download: FileAccessSection;
  upload: FileAccessSection;
  createdAt: string;
}
