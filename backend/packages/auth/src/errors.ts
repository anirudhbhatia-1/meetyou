/**
 * Authentication failures. `code` is safe to return to clients and to log; messages never carry
 * token values (AGENTS §7).
 */
export type AuthErrorCode =
  | 'missing_token'
  | 'invalid_token'
  | 'expired_token'
  | 'google_exchange_failed'
  | 'google_token_invalid'
  | 'email_not_verified'
  | 'redirect_uri_not_allowed'
  | 'refresh_invalid'
  | 'refresh_expired'
  | 'refresh_revoked'
  | 'refresh_reused'
  | 'no_workspace';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  /** HTTP status for the API layer: 401 for credentials, 403 for a refused sign-in. */
  readonly status: 401 | 403;

  constructor(code: AuthErrorCode, status: 401 | 403 = 401) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}
