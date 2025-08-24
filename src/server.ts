/**
 * Snappjack SDK - Server-Side Helper
 * For snapp servers to securely generate user API keys
 */

import { DEFAULT_SNAPPJACK_SERVER_URL } from './constants';

// Get default server URL, checking environment variable first
const DEFAULT_SERVER_URL = ((): string => {
  // Try to get from environment (for server-side usage)
  // Check both NEXT_PUBLIC_ version (for consistency) and non-prefixed version
  if (typeof process !== 'undefined' && process.env) {
    // Prefer NEXT_PUBLIC_ version for consistency with client SDK
    if (process.env.NEXT_PUBLIC_SNAPPJACK_SERVER_URL) {
      // Use HTTP URL directly - no conversion needed
      return process.env.NEXT_PUBLIC_SNAPPJACK_SERVER_URL;
    }
    // Fall back to non-prefixed version if available
    if (process.env.SNAPPJACK_SERVER_URL) {
      return process.env.SNAPPJACK_SERVER_URL;
    }
  }
  
  // Fall back to production server
  return DEFAULT_SNAPPJACK_SERVER_URL;
})();

const SNAPP_ID = ((): string => {
  if (process.env.NEXT_PUBLIC_SNAPPJACK_SNAPP_ID) {
    return process.env.NEXT_PUBLIC_SNAPPJACK_SNAPP_ID;
  }
  throw new Error('NEXT_PUBLIC_SNAPPJACK_SNAPP_ID environment variable is required');
})();

const SNAPP_API_KEY = ((): string => {
  if (process.env.SNAPPJACK_SNAPP_API_KEY) {
    return process.env.SNAPPJACK_SNAPP_API_KEY;
  }
  throw new Error('SNAPPJACK_SNAPP_API_KEY environment variable is required');
})();

export interface ServerConfig {
  snappjackAppApiKey: string;
  snappId: string;
  snappjackServerUrl?: string;
}

export interface UserApiKeyResponse {
  userApiKey: string;
  snappjackAppId: string;
  userId: string;
  mcpEndpoint: string;
  createdAt: string;
}

export interface CreateUserResponse {
  userId: string;
  userApiKey: string;
  snappId: string;
  mcpEndpoint: string;
  createdAt: string;
}

export interface ServerValidationOptions {
  validateSnappjackAppId?: (snappjackAppId: string) => boolean | Promise<boolean>;
  validateUserId?: (userId: string) => boolean | Promise<boolean>;
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
}
export class SnappjackServerHelper {
  private config: Required<ServerConfig>;

  constructor(config: ServerConfig) {
    if (!config.snappjackAppApiKey) {
      throw new Error('snappjackAppApiKey is required');
    }

    if (!config.snappId) {
      throw new Error('snappId is required');
    }

    if (!config.snappjackAppApiKey.match(/^wak_[a-f0-9]{16}$/)) {
      throw new Error('Invalid snappjackAppApiKey format. Expected: wak_[16 hex chars]');
    }

    this.config = {
      ...config,
      snappjackServerUrl: config.snappjackServerUrl || DEFAULT_SERVER_URL
    };
  }

  /**
   * Create a new user with a generated UUID and API key
   * This is the primary method for user creation in the new flow
   */
  async createUser(): Promise<CreateUserResponse> {
    const url = `${this.config.snappjackServerUrl}/api/snapp/${encodeURIComponent(this.config.snappId)}/users`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.snappjackAppApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SnappjackSDK-Server/1.0'
      }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to create user: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const data = await response.json() as CreateUserResponse;
    return data;
  }

  /**
   * Generate a user API key for the specified Snappjack app and user
   * This should be called from your snapp's API route
   * @deprecated Use createUser() instead for the new flow
   */
  async generateUserApiKey(snappjackAppId: string, userId: string): Promise<UserApiKeyResponse> {
    // Validate input parameters
    this.validateParameters(snappjackAppId, userId);

    const url = `${this.config.snappjackServerUrl}/api/user-key/${encodeURIComponent(snappjackAppId)}/${encodeURIComponent(userId)}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.snappjackAppApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SnappjackSDK-Server/1.0'
      }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to generate user API key: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const data = await response.json() as Omit<UserApiKeyResponse, 'mcpEndpoint'>;
    
    return {
      ...data,
      mcpEndpoint: `${this.config.snappjackServerUrl}/mcp/${encodeURIComponent(snappjackAppId)}/${encodeURIComponent(userId)}`
    };
  }

  /**
   * Utility method for snapp developers to create a simple API route handler
   * Usage in Next.js: export const GET = createTokenHandler(snappjackHelper, options);
   */
  createTokenHandler(options: ServerValidationOptions = {}) {
    return async (request: Request): Promise<Response> => {
      try {
        const { searchParams } = new URL(request.url);
        const snappjackAppId = searchParams.get('snappjackAppId');
        const userId = searchParams.get('userId');

        if (!snappjackAppId || !userId) {
          return new Response(JSON.stringify({ 
            error: 'snappjackAppId and userId query parameters are required' 
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Apply custom validation if provided
        if (options.validateSnappjackAppId) {
          const isValidApp = await options.validateSnappjackAppId(snappjackAppId);
          if (!isValidApp) {
            return new Response(JSON.stringify({ 
              error: 'Invalid snappjackAppId' 
            }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        if (options.validateUserId) {
          const isValidUser = await options.validateUserId(userId);
          if (!isValidUser) {
            return new Response(JSON.stringify({ 
              error: 'Invalid userId' 
            }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        const result = await this.generateUserApiKey(snappjackAppId, userId);
        
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        });

      } catch (error) {
        console.error('Snappjack token generation error:', error);
        
        return new Response(JSON.stringify({ 
          error: error instanceof Error ? error.message : 'Internal server error' 
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    };
  }

  private validateParameters(snappjackAppId: string, userId: string): void {
    if (!snappjackAppId || typeof snappjackAppId !== 'string') {
      throw new Error('snappjackAppId must be a non-empty string');
    }

    if (!userId || typeof userId !== 'string') {
      throw new Error('userId must be a non-empty string');
    }

    if (snappjackAppId.length > 100) {
      throw new Error('snappjackAppId must be 100 characters or less');
    }

    if (userId.length > 100) {
      throw new Error('userId must be 100 characters or less');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(snappjackAppId)) {
      throw new Error('snappjackAppId can only contain alphanumeric characters, hyphens, and underscores');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
      throw new Error('userId can only contain alphanumeric characters, hyphens, and underscores');
    }
  }

  /**
   * Test connection to Snappjack server with current configuration
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.config.snappjackServerUrl}/health`, {
        method: 'GET',
        headers: {
          'User-Agent': 'SnappjackSDK-Server/1.0'
        }
      });

      if (!response.ok) {
        return { 
          success: false, 
          error: `Server responded with ${response.status}: ${response.statusText}` 
        };
      }

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}

// Simplified handler for creating new users via API route
export function createUserHandler() {
  const helper = new SnappjackServerHelper({ 
    snappjackAppApiKey: SNAPP_API_KEY,
    snappId: SNAPP_ID
  });

  return {
    POST: async (request: Request): Promise<Response> => {
      try {
        const result = await helper.createUser();
        
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        });
      } catch (error) {
        console.error('Snappjack user creation error:', error);
        
        return new Response(JSON.stringify({ 
          error: error instanceof Error ? error.message : 'Internal server error' 
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  };
}