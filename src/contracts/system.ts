export interface System {
  id: string;
  name: string;
  slug: string;
  logoUri: string;
  defaultLocale?: string;
  termsOfService?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicSystemInfo {
  name: string;
  slug: string;
  logoUri: string;
  defaultLocale?: string;
  termsOfService?: string;
}
