/**
 * Unit tests for SnappjackServerHelper
 */

import { SnappjackServerHelper, SnappjackHttpError, ServerConfig } from './server';

// Mock fetch globally
const mockFetch = jest.fn();
Object.defineProperty(global, 'fetch', {
  value: mockFetch,
  writable: true
});

// Mock console.error to avoid test output pollution
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

describe('SnappjackServerHelper', () => {
  let serverHelper: SnappjackServerHelper;
  const validConfig: ServerConfig = {
    snappApiKey: 'wak_0123456789abcdef',
    snappId: 'test-snapp'
  };

  beforeEach(() => {
    mockFetch.mockClear();
    mockConsoleError.mockClear();
    serverHelper = new SnappjackServerHelper(validConfig);
  });

  afterAll(() => {
    mockConsoleError.mockRestore();
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      expect(serverHelper).toBeInstanceOf(SnappjackServerHelper);
    });

    it('should throw error for missing snappApiKey', () => {
      expect(() => {
        new SnappjackServerHelper({ snappId: 'test', snappApiKey: '' });
      }).toThrow('snappApiKey is required');
    });

    it('should throw error for missing snappId', () => {
      expect(() => {
        new SnappjackServerHelper({ snappApiKey: 'wak_0123456789abcdef', snappId: '' });
      }).toThrow('snappId is required');
    });

    it('should throw error for invalid snappApiKey format', () => {
      expect(() => {
        new SnappjackServerHelper({ snappApiKey: 'invalid-key', snappId: 'test' });
      }).toThrow('Invalid snappApiKey format. Expected: wak_[16 hex chars]');
    });

    it('should use compile-time configured server URL', () => {
      const helper = new SnappjackServerHelper(validConfig);

      // Access private config to verify URL was set correctly (now uses compile-time constant)
      expect(helper['config'].snappjackServerUrl).toBe('http://localhost:3000'); // Test environment uses localhost
    });
  });

  describe('createUser()', () => {
    it('should make correct API call and return user data', async () => {
      const mockResponse = {
        userId: 'user-123',
        userApiKey: 'uak_abcdef1234567890',
        snappId: 'test-snapp',
        mcpEndpoint: 'https://bridge.snappjack.com/mcp/test-snapp/user-123',
        createdAt: '2023-01-01T00:00:00Z'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await serverHelper.createUser();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/snapp/test-snapp/users',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer wak_0123456789abcdef',
            'Content-Type': 'application/json',
            'User-Agent': 'SnappjackSDK-Server/1.0'
          }
        }
      );

      expect(result).toEqual(mockResponse);
    });

    it('should handle API errors with SnappjackHttpError', async () => {
      const errorResponse = { error: 'Invalid API key' };
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve(JSON.stringify(errorResponse))
      });

      await expect(serverHelper.createUser()).rejects.toThrow(SnappjackHttpError);
    });

    it('should handle non-JSON error responses correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Internal Server Error')
      });

      try {
        await serverHelper.createUser();
        fail('Expected SnappjackHttpError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SnappjackHttpError);
        const httpError = error as SnappjackHttpError;
        expect(httpError.message).toBe('API request failed: 500 Internal Server Error');
        expect(httpError.status).toBe(500);
        expect(httpError.body).toEqual({ error: 'API request failed: 500 Internal Server Error' });
      }
    });

    it('should handle text() failure in error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: () => Promise.reject(new Error('Failed to read response'))
      });

      try {
        await serverHelper.createUser();
        fail('Expected SnappjackHttpError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SnappjackHttpError);
        const httpError = error as SnappjackHttpError;
        expect(httpError.message).toBe('API request failed: 502 Bad Gateway');
        expect(httpError.body).toEqual({ error: 'API request failed: 502 Bad Gateway' });
      }
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(serverHelper.createUser()).rejects.toThrow('Network error');
    });
  });

  describe('generateEphemeralToken()', () => {
    it('should make correct API call and return token data', async () => {
      const userId = 'user-123';
      const mockResponse = {
        token: 'jwt-token-here',
        expiresAt: 1234567890,
        snappId: 'test-snapp',
        userId: 'user-123'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await serverHelper.generateEphemeralToken(userId);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/snapp/test-snapp/ephemeral-token',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer wak_0123456789abcdef',
            'Content-Type': 'application/json',
            'User-Agent': 'SnappjackSDK-Server/1.0'
          },
          body: JSON.stringify({ userId })
        }
      );

      expect(result).toEqual(mockResponse);
    });

    it('should validate userId parameter', async () => {
      await expect(serverHelper.generateEphemeralToken('')).rejects.toThrow(
        'userId must be a non-empty string'
      );
    });

    it('should validate userId parameter is not null', async () => {
      await expect(serverHelper.generateEphemeralToken(null as any)).rejects.toThrow(
        'userId must be a non-empty string'
      );
    });

    it('should validate userId parameter is not number', async () => {
      await expect(serverHelper.generateEphemeralToken(123 as any)).rejects.toThrow(
        'userId must be a non-empty string'
      );
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve(JSON.stringify({ error: 'Forbidden' }))
      });

      await expect(serverHelper.generateEphemeralToken('user-123')).rejects.toThrow(SnappjackHttpError);
    });
  });

  describe('testConnection()', () => {
    it('should return success for healthy server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200
      });

      const result = await serverHelper.testConnection();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/health',
        {
          method: 'GET',
          headers: {
            'User-Agent': 'SnappjackSDK-Server/1.0'
          }
        }
      );

      expect(result).toEqual({ success: true });
    });

    it('should return failure for unhealthy server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable'
      });

      const result = await serverHelper.testConnection();

      expect(result).toEqual({
        success: false,
        error: 'Server responded with 503: Service Unavailable'
      });
    });

    it('should return failure for network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await serverHelper.testConnection();

      expect(result).toEqual({
        success: false,
        error: 'Connection refused'
      });
    });
  });
});

describe('SnappjackHttpError', () => {
  it('should create error with correct properties', () => {
    const message = 'API error';
    const status = 400;
    const body = { error: 'Bad Request' };

    const error = new SnappjackHttpError(message, status, body);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SnappjackHttpError);
    expect(error.name).toBe('SnappjackHttpError');
    expect(error.message).toBe(message);
    expect(error.status).toBe(status);
    expect(error.body).toBe(body);
  });

  it('should have correct stack trace', () => {
    const error = new SnappjackHttpError('Test error', 500, {});
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('SnappjackHttpError');
  });
});