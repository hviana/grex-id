export interface LoginRequest {
  email: string;
  password: string;
  twoFactorCode?: string;
  stayLoggedIn?: boolean;
  botToken: string;
}

export interface LoginResponse {
  systemToken: string;
  surrealToken: string;
  user: {
    id: string;
    email: string;
    profile: { name: string; avatarUri?: string };
    roles: string[];
  };
}

export interface RegisterRequest {
  email: string;
  password: string;
  confirmPassword: string;
  phone?: string;
  name: string;
  botToken: string;
}

export interface VerifyRequest {
  token: string;
}

export interface ForgotPasswordRequest {
  email: string;
  botToken: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
  confirmPassword: string;
}

export interface RefreshRequest {
  systemToken: string;
}

export interface RefreshResponse {
  systemToken: string;
  surrealToken: string;
}

export interface RequestContext {
  userId: string;
  companyId: string;
  systemId: string;
  roles: string[];
  permissions: string[];
}
