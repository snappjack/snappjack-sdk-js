/**
 * Snappjack SDK - Server-Side Helper
 * For snapp servers to securely generate user API keys
 */

import { DEFAULT_SNAPPJACK_SERVER_URL } from './constants';

export interface ServerConfig {
  snappApiKey: string;
  snappId: string;
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

export interface EphemeralTokenResponse {
  token: string;
  expiresAt: number;
  snappId: string;
  userId: string;
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
  private config: Required<ServerConfig> & { snappjackServerUrl: string };

  constructor(config: ServerConfig) {
    if (!config.snappApiKey) {
      throw new Error('snappApiKey is required');
    }

    if (!config.snappId) {
      throw new Error('snappId is required');
    }

    if (!config.snappApiKey.match(/^wak_[a-f0-9]{16}$/)) {
      throw new Error('Invalid snappApiKey format. Expected: wak_[16 hex chars]');
    }

    // Get server URL from environment or use default
    const serverUrl = (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_SNAPPJACK_SERVER_URL) 
      ? process.env.NEXT_PUBLIC_SNAPPJACK_SERVER_URL 
      : DEFAULT_SNAPPJACK_SERVER_URL;

    this.config = {
      ...config,
      snappjackServerUrl: serverUrl
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
        'Authorization': `Bearer ${this.config.snappApiKey}`,
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
   * Generate an ephemeral JWT token for WebSocket authentication
   * This token expires in 10 seconds and should be used immediately
   */
  async generateEphemeralToken(userId: string): Promise<EphemeralTokenResponse> {
    if (!userId || typeof userId !== 'string') {
      throw new Error('userId must be a non-empty string');
    }

    const url = `${this.config.snappjackServerUrl}/api/snapp/${encodeURIComponent(this.config.snappId)}/ephemeral-token`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.snappApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SnappjackSDK-Server/1.0'
      },
      body: JSON.stringify({ userId })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to generate ephemeral token: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const data = await response.json() as EphemeralTokenResponse;
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
        'Authorization': `Bearer ${this.config.snappApiKey}`,
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
export function createUserHandler(config: ServerConfig) {
  const helper = new SnappjackServerHelper(config);

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

// Simplified handler for generating ephemeral tokens via API route
export function createEphemeralTokenHandler(config: ServerConfig) {
  const helper = new SnappjackServerHelper(config);

  return {
    POST: async (request: Request): Promise<Response> => {
      try {
        const body = await request.json();
        const { userId } = body;

        if (!userId || typeof userId !== 'string') {
          return new Response(JSON.stringify({ 
            error: 'userId is required in request body' 
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const result = await helper.generateEphemeralToken(userId);
        
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        });
      } catch (error) {
        console.error('Snappjack ephemeral token error:', error);
        
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