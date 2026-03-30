/**
 * Authentication Manager
 * Handles session management and token refresh for the MCP server
 */

import type { AuthSession } from '../types';
import { MCPError, ErrorCode } from '../types';
import { logger } from '../utils/logger';

export class AuthManager {
  private session: AuthSession | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Detect authentication type based on token format
   */
  static detectAuthType(token: string): 'api-token' | 'jwt' {
    // API tokens start with tk_
    if (token.startsWith('tk_')) {
      return 'api-token';
    }
    
    // JWTs have 3 parts separated by dots and start with eyJ (base64 for {"alg":)
    if (token.startsWith('eyJ') && token.split('.').length === 3) {
      return 'jwt';
    }
    
    // Default to API token for backward compatibility
    return 'api-token';
  }

  /**
   * Initialize a new auth session
   */
  connect(apiUrl: string, apiToken: string, authType?: 'api-token' | 'jwt'): void {
    // Auto-detect auth type if not provided
    const detectedAuthType = authType || AuthManager.detectAuthType(apiToken);
    logger.debug('AuthManager.connect - Creating session with authType: %s', detectedAuthType);
    this.session = {
      apiUrl,
      apiToken,
      authType: detectedAuthType,
      // tokenExpiry and userId are optional
    };
    logger.debug('AuthManager.connect - Session created successfully');

    // Auto-refresh JWT tokens before they expire
    if (detectedAuthType === 'jwt') {
      this.startTokenRefresh();
    }
  }

  /**
   * Start automatic JWT token refresh (every 5 minutes)
   */
  private startTokenRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.refreshTimer = setInterval(async () => {
      if (!this.session || this.session.authType !== 'jwt') return;
      try {
        const response = await fetch(`${this.session.apiUrl}/user/token/refresh`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.session.apiToken}`,
            'Content-Type': 'application/json',
          },
        });
        if (response.ok) {
          const data = await response.json() as { token?: string };
          if (data.token) {
            this.session.apiToken = data.token;
            logger.debug('JWT token refreshed successfully');
          }
        } else {
          logger.warn('JWT token refresh failed: %d', response.status);
        }
      } catch (error) {
        logger.warn('JWT token refresh error:', error);
      }
    }, 5 * 60 * 1000); // Refresh every 5 minutes
  }

  /**
   * Get current session
   * @throws MCPError if not authenticated
   */
  getSession(): AuthSession {
    if (!this.session) {
      throw new MCPError(
        ErrorCode.AUTH_REQUIRED,
        'Authentication required. Please use vikunja_auth.connect first.',
      );
    }
    return this.session;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.session !== null;
  }

  /**
   * Clear session
   */
  disconnect(): void {
    this.session = null;
  }

  /**
   * Get auth status
   */
  getStatus(): { authenticated: boolean; apiUrl?: string; userId?: string; authType?: 'api-token' | 'jwt' } {
    if (!this.session) {
      return { authenticated: false };
    }
    const status: { authenticated: boolean; apiUrl?: string; userId?: string; authType?: 'api-token' | 'jwt' } = {
      authenticated: true,
      apiUrl: this.session.apiUrl,
      authType: this.session.authType,
    };
    if (this.session.userId !== undefined) {
      status.userId = this.session.userId;
    }
    return status;
  }

  /**
   * Get authentication type
   * @throws MCPError if not authenticated
   */
  getAuthType(): 'api-token' | 'jwt' {
    if (!this.session) {
      throw new MCPError(
        ErrorCode.AUTH_REQUIRED,
        'Authentication required. Please use vikunja_auth.connect first.',
      );
    }
    return this.session.authType;
  }

  /**
   * Save session with auth type
   */
  saveSession(session: AuthSession): void {
    this.session = session;
  }

  // ==========================================
  // TEST-ONLY METHODS - Protected by environment checks
  // These methods are only available in test environments
  // ==========================================

  /**
   * Test-only method to set user ID
   * @throws Error if used in production
   */
  setTestUserId(userId: string): void {
    this.validateTestEnvironment();
    if (!this.session) {
      throw new MCPError(
        ErrorCode.AUTH_REQUIRED,
        'Authentication required. Please use vikunja_auth.connect first.',
      );
    }
    this.session.userId = userId;
  }

  /**
   * Test-only method to set token expiry
   * @throws Error if used in production
   */
  setTestTokenExpiry(expiry: Date): void {
    this.validateTestEnvironment();
    if (!this.session) {
      throw new MCPError(
        ErrorCode.AUTH_REQUIRED,
        'Authentication required. Please use vikunja_auth.connect first.',
      );
    }
    this.session.tokenExpiry = expiry;
  }

  /**
   * Validate test environment - prevents test methods from being used in production
   * @throws Error if not in test environment
   */
  private validateTestEnvironment(): void {
    const nodeEnv = process.env.NODE_ENV;
    const jestRunning = process.env.JEST_WORKER_ID !== undefined || nodeEnv === 'test';

    if (!jestRunning && nodeEnv !== 'test') {
      throw new Error(
        'AuthManager test methods can only be used in test environments. ' +
        'This is a security measure to prevent testing methods from being accessible in production.'
      );
    }
  }

}
