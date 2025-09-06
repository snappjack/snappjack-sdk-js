/**
 * Snappjack SDK - Server-Side Helper
 * For snapp servers to securely generate user API keys
 */

import { DEFAULT_SNAPPJACK_SERVER_URL } from '../core/constants';

// HTTP-first error for simpler error handling
export class SnappjackHttpError extends Error {
  public status: number;
  public body: any;

  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = 'SnappjackHttpError';
    this.status = status;
    this.body = body;
  }
}

export interface ServerConfig {
  snappApiKey: string;
  snappId: string;
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
   * Private method to centralize all API request logic
   */
  private async _makeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: any
  ): Promise<T> {
    const url = `${this.config.snappjackServerUrl}${path}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.config.snappApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SnappjackSDK-Server/1.0'
      },
      ...(body !== undefined && { body: JSON.stringify(body) })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      
      // Try to parse JSON, but always include HTTP context
      let errorBody;
      try {
        errorBody = JSON.parse(errorText);
      } catch (parseError) {
        // If JSON parsing fails, create simple error body
        errorBody = { error: `API request failed: ${response.status} ${response.statusText}` };
      }
      
      throw new SnappjackHttpError(
        errorBody.error || `API request failed: ${response.status} ${response.statusText}`,
        response.status,
        errorBody
      );
    }

    const data = await response.json() as T;
    return data;
  }

  /**
   * Create a new user with a generated UUID and API key
   * This is the primary method for user creation in the new flow
   */
  async createUser(): Promise<CreateUserResponse> {
    const path = `/api/snapp/${encodeURIComponent(this.config.snappId)}/users`;
    return this._makeRequest<CreateUserResponse>('POST', path);
  }

  /**
   * Generate an ephemeral JWT token for WebSocket authentication
   * This token expires in 10 seconds and should be used immediately
   */
  async generateEphemeralToken(userId: string): Promise<EphemeralTokenResponse> {
    if (!userId || typeof userId !== 'string') {
      throw new Error('userId must be a non-empty string');
    }

    const path = `/api/snapp/${encodeURIComponent(this.config.snappId)}/ephemeral-token`;
    return this._makeRequest<EphemeralTokenResponse>('POST', path, { userId });
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