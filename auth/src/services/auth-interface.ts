/**
 * Abstract Auth Interface
 * 
 * This interface defines the contract for any authentication provider.
 * Implementations: Cognito (current), Keycloak (future), Auth0, etc.
 * 
 * Cloud Agnostic: ✅
 */

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  name?: string;
  emailVerified: boolean;
  groups?: string[];
  customAttributes?: Record<string, string>;
}

export interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SignUpParams {
  email: string;
  password: string;
  name?: string;
  customAttributes?: Record<string, string>;
}

export interface SignInParams {
  email: string;
  password: string;
}

export interface FederatedSignInParams {
  provider: 'Google' | 'Facebook' | 'GitHub';
}

export interface ConfirmSignUpParams {
  email: string;
  code: string;
}

export interface ResetPasswordParams {
  email: string;
}

export interface ConfirmResetPasswordParams {
  email: string;
  code: string;
  newPassword: string;
}

/**
 * IAuthService - Provider-agnostic authentication interface
 * 
 * Any auth provider (Cognito, Keycloak, Auth0) must implement this interface.
 */
export interface IAuthService {
  // User Management
  signUp(params: SignUpParams): Promise<{ userConfirmed: boolean; userId: string }>;
  confirmSignUp(params: ConfirmSignUpParams): Promise<void>;
  signIn(params: SignInParams): Promise<AuthTokens>;
  signInWithProvider(params: FederatedSignInParams): Promise<AuthTokens>;
  signOut(): Promise<void>;
  
  // Password Management
  resetPassword(params: ResetPasswordParams): Promise<void>;
  confirmResetPassword(params: ConfirmResetPasswordParams): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  
  // User Info
  getCurrentUser(): Promise<AuthUser>;
  getUserAttributes(): Promise<Record<string, string>>;
  updateUserAttributes(attributes: Record<string, string>): Promise<void>;
  
  // Token Management
  getTokens(): Promise<AuthTokens>;
  refreshTokens(): Promise<AuthTokens>;
  
  // Session Management
  isAuthenticated(): Promise<boolean>;
  
  // Admin Operations (optional - for user management)
  adminCreateUser?(email: string, temporaryPassword: string): Promise<string>;
  adminDeleteUser?(userId: string): Promise<void>;
  adminAddUserToGroup?(userId: string, groupName: string): Promise<void>;
  adminRemoveUserFromGroup?(userId: string, groupName: string): Promise<void>;
}

/**
 * Auth Provider Types
 */
export enum AuthProvider {
  COGNITO = 'cognito',
  KEYCLOAK = 'keycloak',
  AUTH0 = 'auth0',
  SUPABASE = 'supabase',
}

/**
 * Auth Service Factory
 * Returns the appropriate auth service implementation based on config
 */
export interface AuthServiceConfig {
  provider: AuthProvider;
  config: Record<string, any>;
}