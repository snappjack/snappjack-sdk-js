/**
 * Comprehensive unit tests for ConnectionManager
 * Testing WebSocket lifecycle, reconnection logic, and error handling
 */

import { ConnectionManager } from './connection-manager';
import { createWebSocket } from '../core/websocket-wrapper';
import { Logger, ConnectionConfig, SnappjackError } from '../core/types';

// Mock the WebSocket creation function
jest.mock('../core/websocket-wrapper', () => ({
  createWebSocket: jest.fn(),
  ReadyState: {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3
  }
}));

// Mock global fetch for credential validation
const mockFetch = jest.fn();
Object.defineProperty(global, 'fetch', {
  value: mockFetch,
  writable: true
});

// Mock logger for testing
const mockLogger: Logger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('ConnectionManager', () => {
  let connectionManager: ConnectionManager;
  let mockWebSocket: {
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    send: jest.Mock;
    close: jest.Mock;
    readyState: number;
  };
  let mockCreateWebSocket: jest.MockedFunction<typeof createWebSocket>;

  // Helper to flush the promise queue and let async operations complete
  const flushPromiseQueue = () => new Promise(jest.requireActual('timers').setImmediate);

  const validConfig: ConnectionConfig = {
    snappId: 'test-snapp',
    userId: 'test-user', 
    tokenProvider: () => Promise.resolve('test-jwt-token'),
    serverUrl: 'ws://localhost:3000',
    autoReconnect: true,
    reconnectInterval: 1000,
    maxReconnectAttempts: 5,
    testMode: true // Enable fast test execution
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock WebSocket
    mockWebSocket = {
      onopen: null,
      onmessage: null, 
      onclose: null,
      onerror: null,
      send: jest.fn(),
      close: jest.fn(),
      readyState: 0 // CONNECTING
    };

    // Mock the createWebSocket function
    mockCreateWebSocket = createWebSocket as jest.MockedFunction<typeof createWebSocket>;
    mockCreateWebSocket.mockReturnValue(mockWebSocket as any);

    connectionManager = new ConnectionManager(validConfig, mockLogger);
  });


  describe('constructor and basic properties', () => {
    it('should initialize with disconnected status', () => {
      expect(connectionManager.getStatus()).toBe('disconnected');
    });

    it('should accept valid config without validation errors', () => {
      const customConfig: ConnectionConfig = {
        ...validConfig,
        snappId: 'custom-snapp'
      };

      expect(() => {
        new ConnectionManager(customConfig, mockLogger);
      }).not.toThrow();
    });
  });

  describe('1. Successful Connection Lifecycle', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    afterEach(() => {
      jest.useFakeTimers();
    });

    describe('connect() successful flow', () => {
      it('should call tokenProvider before connecting', async () => {
        // jest.useRealTimers();
        const tokenProvider = jest.fn().mockResolvedValue('fresh-token');
        const customConfig: ConnectionConfig = {
          ...validConfig,
          tokenProvider
        };
        const customConnectionManager = new ConnectionManager(customConfig, mockLogger);

        // Start connection
        const connectPromise = customConnectionManager.connect();
        
        // Let tokenProvider resolve
        await flushPromiseQueue();
        
        // Verify tokenProvider was called
        expect(tokenProvider).toHaveBeenCalledTimes(1);
        
        // Complete the connection to avoid hanging promises
        if (mockWebSocket.onopen) {
          mockWebSocket.onopen(new Event('open'));
        }
        
        // Wait for connection to complete
        await connectPromise;
      });

      it('should complete full state transition: disconnected → connected', async () => {
        const statusChanges: string[] = [];
        connectionManager.on('statusChange', (status) => statusChanges.push(status));

        // Verify initial state
        expect(connectionManager.getStatus()).toBe('disconnected');

        // Start connection and wait for WebSocket creation
        const connectPromise = connectionManager.connect();

        // Let tokenProvider resolve
        await flushPromiseQueue();

        // Verify WebSocket was created
        expect(mockCreateWebSocket).toHaveBeenCalledTimes(1);

        // Simulate successful WebSocket open
        mockWebSocket.readyState = 1; // OPEN
        if (mockWebSocket.onopen) {
          mockWebSocket.onopen(new Event('open'));
        }

        await connectPromise;

        // Verify final state and events
        expect(connectionManager.getStatus()).toBe('connected');
        expect(statusChanges).toContain('connected');
      });

      it('should resolve connect() promise upon successful open event', async () => {
        const connectPromise = connectionManager.connect();

        // Let tokenProvider resolve
        await flushPromiseQueue();

        // Simulate WebSocket opening
        if (mockWebSocket.onopen) {
          mockWebSocket.onopen(new Event('open'));
        }

        await expect(connectPromise).resolves.toBeUndefined();
      });

      it('should emit open event correctly', async () => {
        const openListener = jest.fn();
        connectionManager.on('open', openListener);

        const connectPromise = connectionManager.connect();

        // Let tokenProvider resolve
        await flushPromiseQueue();

        // Simulate WebSocket opening
        if (mockWebSocket.onopen) {
          mockWebSocket.onopen(new Event('open'));
        }

        await connectPromise;
        expect(openListener).toHaveBeenCalledTimes(1);
      });

      it('should reset reconnectAttempts on successful connection', async () => {
        // Simulate previous failed attempts
        connectionManager['reconnectAttempts'] = 3;

        const connectPromise = connectionManager.connect();

        // Let tokenProvider resolve
        await flushPromiseQueue();

        if (mockWebSocket.onopen) {
          mockWebSocket.onopen(new Event('open'));
        }

        await connectPromise;

        // Verify counter reset
        expect(connectionManager['reconnectAttempts']).toBe(0);
      });

      it('should not create new connection if already connected', async () => {
        // First connection
        mockWebSocket.readyState = 1; // OPEN
        const connectPromise1 = connectionManager.connect();

        // Let tokenProvider resolve
        await flushPromiseQueue();

        if (mockWebSocket.onopen) {
          mockWebSocket.onopen(new Event('open'));
        }
        await connectPromise1;

        mockCreateWebSocket.mockClear();

        // Second connection attempt
        await connectionManager.connect();
        expect(mockCreateWebSocket).not.toHaveBeenCalled();
      });
    });

    describe('disconnect() successful flow', () => {
      it('should resolve disconnect() promise', async () => {
        // First connect
        const connectPromise = connectionManager.connect();

        // Let tokenProvider resolve
        await flushPromiseQueue();

        mockWebSocket.readyState = 1; // OPEN
        if (mockWebSocket.onopen) {
          mockWebSocket.onopen(new Event('open'));
        }
        await connectPromise;

        // Mock close behavior - disconnect() sets its own onclose handler
        mockWebSocket.close.mockImplementation(() => {
          if (mockWebSocket.onclose) {
            mockWebSocket.onclose({
              code: 1000,
              reason: 'Client disconnect'
            } as CloseEvent);
          }
        });

        await expect(connectionManager.disconnect()).resolves.toBeUndefined();
      });

      it('should handle disconnect when not connected gracefully', async () => {
        await expect(connectionManager.disconnect()).resolves.toBeUndefined();
        expect(connectionManager.getStatus()).toBe('disconnected');
      });
    });

    describe('WebSocket URL construction', () => {
      it('should build correct WebSocket URL with all parameters', async () => {
        connectionManager.connect().catch(() => {
          // Error expected in this test
        });  
        await flushPromiseQueue();
        expect(mockCreateWebSocket).toHaveBeenCalledWith(
          'ws://localhost:3000/ws/test-snapp/test-user?token=test-jwt-token'
        );
      });

      it('should convert HTTP to WS protocol', async () => {
        const httpConfig = { 
          ...validConfig, 
          serverUrl: 'http://localhost:3000',
          tokenProvider: () => Promise.resolve('test-jwt-token')
        };
        const httpManager = new ConnectionManager(httpConfig, mockLogger);

        httpManager.connect().catch(() => {});
        await flushPromiseQueue();

        expect(mockCreateWebSocket).toHaveBeenCalledWith(
          'ws://localhost:3000/ws/test-snapp/test-user?token=test-jwt-token'
        );
      });

      it('should convert HTTPS to WSS protocol', async () => {
        const httpsConfig = { 
          ...validConfig, 
          serverUrl: 'https://example.com',
          tokenProvider: () => Promise.resolve('test-jwt-token')
        };
        const httpsManager = new ConnectionManager(httpsConfig, mockLogger);

        httpsManager.connect().catch(() => {});
        await flushPromiseQueue();

        expect(mockCreateWebSocket).toHaveBeenCalledWith(
          'wss://example.com/ws/test-snapp/test-user?token=test-jwt-token'
        );
      });

      it('should handle trailing slash in serverUrl', async () => {
        const trailingSlashConfig = { 
          ...validConfig, 
          serverUrl: 'ws://localhost:3000/',
          tokenProvider: () => Promise.resolve('test-jwt-token')
        };
        const trailingSlashManager = new ConnectionManager(trailingSlashConfig, mockLogger);

        trailingSlashManager.connect().catch(() => {});
        await flushPromiseQueue();

        expect(mockCreateWebSocket).toHaveBeenCalledWith(
          'ws://localhost:3000/ws/test-snapp/test-user?token=test-jwt-token'
        );
      });
    });
  });

  describe('2. Connection Failure Scenarios', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });
    it('should reject connect() promise when error occurs before open', async () => {
      // Use synchronous tokenProvider for fake timer tests
      const syncConfig = { 
        ...validConfig, 
        tokenProvider: () => Promise.resolve('sync-token')
      };
      const syncManager = new ConnectionManager(syncConfig, mockLogger);
      
      const connectPromise = syncManager.connect();

      // Wait for async tokenProvider to resolve first
      await Promise.resolve();

      // Simulate WebSocket error before open
      if (mockWebSocket.onerror) {
        const errorEvent = new Event('error');
        mockWebSocket.onerror(errorEvent);
      }

      await expect(connectPromise).rejects.toBeDefined();
    });

    it('should handle connection timeout', async () => {
      // Use synchronous tokenProvider for fake timer tests
      const syncConfig = { 
        ...validConfig, 
        tokenProvider: () => Promise.resolve('sync-token')
      };
      const syncManager = new ConnectionManager(syncConfig, mockLogger);
      
      const connectPromise = syncManager.connect();

      // Wait for async tokenProvider to resolve first
      await Promise.resolve();
      
      // Now advance timers to trigger timeout (10000ms)
      jest.advanceTimersByTime(10000);

      await expect(connectPromise).rejects.toThrow('Connection timeout');
    });

    it('should handle WebSocket creation failure', async () => {
      mockCreateWebSocket.mockImplementation(() => {
        throw new Error('WebSocket creation failed');
      });

      await expect(connectionManager.connect()).rejects.toThrow('WebSocket creation failed');
    });
  });

  describe('3. Reconnection Logic with Exponential Backoff', () => {
    let syncConnectionManager: ConnectionManager;

    beforeEach(async () => {
      jest.useFakeTimers();
      
      // Use synchronous tokenProvider for fake timer tests
      const syncConfig = { 
        ...validConfig, 
        tokenProvider: () => Promise.resolve('sync-token')
      };
      syncConnectionManager = new ConnectionManager(syncConfig, mockLogger);
      
      // Start with a connected state
      const connectPromise = syncConnectionManager.connect();
      await Promise.resolve(); // Let tokenProvider resolve
      if (mockWebSocket.onopen) {
        mockWebSocket.onopen(new Event('open'));
      }
      await connectPromise;
      
      // Clear the initial createWebSocket call
      mockCreateWebSocket.mockClear();
    });

    afterEach(async () => {
      // Clean up any timers and connections
      if (syncConnectionManager) {
        await syncConnectionManager.disconnect();
      }
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it('should schedule reconnection on retryable close code (1006)', async () => {
      // Simulate connection close with retryable code - MUST await the async handler
      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1006,
          reason: 'Connection lost'
        } as CloseEvent);
      }

      // Verify reconnection is scheduled (private timer property exists)
      expect(syncConnectionManager['reconnectTimer']).not.toBeNull();
      
      // Advance by the testMode delay (1ms) to trigger reconnection
      await jest.advanceTimersByTimeAsync(1);
      
      expect(mockCreateWebSocket).toHaveBeenCalledTimes(1);
      expect(syncConnectionManager['reconnectAttempts']).toBe(1);
    });

    it('should implement exponential backoff correctly in production mode', async () => {
      // Create a production mode manager (no testMode) with sync token provider
      const prodConfig = { 
        ...validConfig, 
        testMode: false,
        tokenProvider: () => Promise.resolve('sync-token')
      };
      const prodManager = new ConnectionManager(prodConfig, mockLogger);
      
      // Connect first
      const connectPromise = prodManager.connect();
      await Promise.resolve(); // Let tokenProvider resolve
      if (mockWebSocket.onopen) {
        mockWebSocket.onopen(new Event('open'));
      }
      await connectPromise;
      mockCreateWebSocket.mockClear();

      // Simulate connection close to trigger first reconnection
      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1006,
          reason: 'Connection lost'
        } as CloseEvent);
      }

      // First reconnection attempt - should be after 1000ms
      expect(prodManager['reconnectTimer']).not.toBeNull();
      
      jest.advanceTimersByTime(999);
      expect(mockCreateWebSocket).not.toHaveBeenCalled();
      
      jest.advanceTimersByTime(1);
      await flushPromiseQueue(); // Let reconnection attempt execute
      expect(mockCreateWebSocket).toHaveBeenCalledTimes(1);
      expect(prodManager['reconnectAttempts']).toBe(1);

      // Simulate second connection close to trigger second reconnection
      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1006,
          reason: 'Connection lost'
        } as CloseEvent);
      }

      // Second reconnection attempt - should be after 2000ms (exponential backoff)
      jest.advanceTimersByTime(1999);
      expect(mockCreateWebSocket).toHaveBeenCalledTimes(1);
      
      jest.advanceTimersByTime(1);
      await flushPromiseQueue(); // Let second reconnection attempt execute
      expect(mockCreateWebSocket).toHaveBeenCalledTimes(2);
      expect(prodManager['reconnectAttempts']).toBe(2);
      
      // Clean up
      await prodManager.disconnect();
    });

    it('should clear reconnect timer on successful connection', async () => {
      // Simulate failed attempt that schedules reconnection
      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1006,
          reason: 'Connection lost'
        } as CloseEvent);
      }
      
      // Verify timer is scheduled
      expect(syncConnectionManager['reconnectTimer']).not.toBeNull();

      // Advance timer and simulate successful connection
      await jest.advanceTimersByTimeAsync(1);
      if (mockWebSocket.onopen) {
        mockWebSocket.onopen(new Event('open'));
      }

      // Verify timer was cleared and attempts reset
      expect(syncConnectionManager['reconnectAttempts']).toBe(0);
    });
  });

  describe('4. Reconnection Failure Scenarios', () => {
    let syncConnectionManager: ConnectionManager;

    beforeEach(async () => {
      jest.useFakeTimers();
      
      // Use synchronous tokenProvider for fake timer tests
      const syncConfig = { 
        ...validConfig, 
        tokenProvider: () => Promise.resolve('sync-token')
      };
      syncConnectionManager = new ConnectionManager(syncConfig, mockLogger);
      
      // Start with a connected state
      const connectPromise = syncConnectionManager.connect();
      await Promise.resolve(); // Let tokenProvider resolve
      if (mockWebSocket.onopen) {
        mockWebSocket.onopen(new Event('open'));
      }
      await connectPromise;
      
      mockCreateWebSocket.mockClear();
    });

    afterEach(async () => {
      // Clean up any timers and connections
      if (syncConnectionManager) {
        await syncConnectionManager.disconnect();
      }
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it('should not reconnect on non-retryable close code 1008 (auth failure)', async () => {
      const errorListener = jest.fn();
      syncConnectionManager.on('error', errorListener);

      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1008,
          reason: 'Authentication failed'
        } as CloseEvent);
      }

      expect(syncConnectionManager.getStatus()).toBe('error');
      expect(errorListener).toHaveBeenCalled();

      // Verify no reconnection timer
      expect(syncConnectionManager['reconnectTimer']).toBeNull();
      
      // Advance time to make sure no reconnection happens
      await jest.advanceTimersByTimeAsync(100);
      expect(mockCreateWebSocket).not.toHaveBeenCalled();
    });

    it('should not reconnect on normal close code 1000', async () => {
      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1000,
          reason: 'Normal closure'
        } as CloseEvent);
      }

      expect(syncConnectionManager.getStatus()).toBe('disconnected');
      
      // Verify no reconnection timer
      expect(syncConnectionManager['reconnectTimer']).toBeNull();
      
      // Advance time to make sure no reconnection happens
      await jest.advanceTimersByTimeAsync(100);
      expect(mockCreateWebSocket).not.toHaveBeenCalled();
    });

    it('should stop reconnection on manual disconnect', async () => {
      // Simulate close that would trigger reconnection
      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1006,
          reason: 'Connection lost'
        } as CloseEvent);
      }

      // Verify reconnection is scheduled
      expect(syncConnectionManager['reconnectTimer']).not.toBeNull();

      // Disconnect should stop reconnection
      await syncConnectionManager.disconnect();

      expect(syncConnectionManager['reconnectTimer']).toBeNull();
    });

    it('should not reconnect when autoReconnect is disabled', async () => {
      const noReconnectConfig = { 
        ...validConfig, 
        autoReconnect: false,
        tokenProvider: () => Promise.resolve('sync-token')
      };
      const noReconnectManager = new ConnectionManager(noReconnectConfig, mockLogger);

      // Connect first
      const connectPromise = noReconnectManager.connect();
      await Promise.resolve(); // Let tokenProvider resolve
      if (mockWebSocket.onopen) {
        mockWebSocket.onopen(new Event('open'));
      }
      await connectPromise;

      // Simulate connection close
      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1006,
          reason: 'Connection lost'
        } as CloseEvent);
      }

      // Verify no reconnection timer
      expect(noReconnectManager['reconnectTimer']).toBeNull();
      
      // Advance time to make sure no reconnection happens
      await jest.advanceTimersByTimeAsync(100);
      expect(mockCreateWebSocket).toHaveBeenCalledTimes(1); // Only initial connect
      
      // Clean up
      await noReconnectManager.disconnect();
    });

    it('should stop reconnecting after maxReconnectAttempts', async () => {
      const errorListener = jest.fn();
      syncConnectionManager.on('error', errorListener);

      // Simulate connection close to trigger reconnection attempts
      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1006,
          reason: 'Connection lost'
        } as CloseEvent);
      }
      
      mockCreateWebSocket.mockClear();

      // Simulate 5 failed reconnection attempts (max attempts)
      for (let i = 1; i <= 5; i++) {
        jest.advanceTimersByTime(1); // testMode uses 1ms delay
        await flushPromiseQueue(); // Let reconnection attempt execute
        expect(mockCreateWebSocket).toHaveBeenCalledTimes(i);
        expect(syncConnectionManager['reconnectAttempts']).toBe(i);
        
        // Simulate failed connection by triggering close event
        if (mockWebSocket.onclose) {
          await mockWebSocket.onclose({
            code: 1006,
            reason: 'Connection lost'
          } as CloseEvent);
        }
      }

      // After 5 failed attempts, should stop reconnecting and remain disconnected
      expect(syncConnectionManager.getStatus()).toBe('disconnected');
      expect(syncConnectionManager['reconnectAttempts']).toBe(5);

      // Should not attempt further reconnections
      jest.advanceTimersByTime(100);
      expect(mockCreateWebSocket).toHaveBeenCalledTimes(5); // Only 5 reconnection attempts, no more
    });

    it('should respect maxReconnectAttempts limit', () => {
      // Set attempts at max
      syncConnectionManager['reconnectAttempts'] = 5;
      
      // Test shouldReconnect logic
      const shouldReconnect = syncConnectionManager['shouldReconnect'](1006);
      expect(shouldReconnect).toBe(false);
    });
  });

  describe('5. Credential Validation on Disconnect', () => {
    beforeEach(async () => {
      jest.useFakeTimers();
      
      // Start with connected state and simulate receiving userApiKey
      const connectPromise = connectionManager.connect();
      await flushPromiseQueue(); // Let tokenProvider resolve and handlers get attached
      
      if (mockWebSocket.onopen) {
        mockWebSocket.onopen(new Event('open'));
      }
      
      // Simulate connection-info message
      if (mockWebSocket.onmessage) {
        mockWebSocket.onmessage({
          data: JSON.stringify({
            type: 'connection-info',
            userApiKey: 'uak_testkey12345678'
          })
        } as MessageEvent);
      }
      
      await connectPromise;
      mockCreateWebSocket.mockClear();
      mockFetch.mockClear();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should validate credentials on 1006 disconnect when userApiKey received', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ valid: true })
      });

      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1006,
          reason: 'Connection lost'
        } as CloseEvent);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/validate-credentials',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userApiKey: 'uak_testkey12345678',
            snappId: 'test-snapp',
            userId: 'test-user'
          })
        })
      );
    });

    it('should handle "valid" credential validation result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ valid: true })
      });

      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1006,
          reason: 'Connection lost'
        } as CloseEvent);
      }

      // Should schedule reconnection since credentials are valid
      expect(connectionManager.getStatus()).toBe('disconnected');
      expect(connectionManager['reconnectTimer']).not.toBeNull();
      
      // Advance time to trigger reconnection
      await jest.advanceTimersByTimeAsync(1);
      expect(mockCreateWebSocket).toHaveBeenCalledTimes(1);
    });

    it('should handle "invalid" credential validation result', async () => {
      const errorListener = jest.fn();
      connectionManager.on('error', errorListener);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401
      });

      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1006,
          reason: 'Connection lost'
        } as CloseEvent);
      }

      expect(connectionManager.getStatus()).toBe('error');
      expect(errorListener).toHaveBeenCalled();
      
      const emittedError: SnappjackError = errorListener.mock.calls[0][0];
      expect(emittedError.type).toBe('auth_failed');
      expect(emittedError.canRetry).toBe(false);
      expect(emittedError.canResetCredentials).toBe(true);

      // Should not schedule reconnection
      expect(connectionManager['reconnectTimer']).toBeNull();
    });

    it('should handle "unreachable" credential validation result', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1006,
          reason: 'Connection lost'
        } as CloseEvent);
      }

      // Should schedule reconnection since server is unreachable
      expect(connectionManager.getStatus()).toBe('disconnected');
      expect(connectionManager['reconnectTimer']).not.toBeNull();
      
      // Advance time to trigger reconnection
      await jest.advanceTimersByTimeAsync(1);
      expect(mockCreateWebSocket).toHaveBeenCalledTimes(1);
    });

    it('should skip credential validation on 1006 if no userApiKey received', async () => {
      // Create new manager without connection-info message
      const newManager = new ConnectionManager(validConfig, mockLogger);
      const connectPromise = newManager.connect();
      await flushPromiseQueue(); // Let tokenProvider resolve and handlers get attached
      if (mockWebSocket.onopen) {
        mockWebSocket.onopen(new Event('open'));
      }
      await connectPromise;

      if (mockWebSocket.onclose) {
        await mockWebSocket.onclose({
          code: 1006,
          reason: 'Connection lost'
        } as CloseEvent);
      }

      // Should not call fetch for validation
      expect(mockFetch).not.toHaveBeenCalled();
      
      // Should still schedule reconnection based on error classification
      expect(newManager['reconnectTimer']).not.toBeNull();
    });
  });

  describe('Additional scenarios for comprehensive coverage', () => {
    describe('Message handling', () => {
      beforeEach(async () => {
        const connectPromise = connectionManager.connect();
        await flushPromiseQueue();
        if (mockWebSocket.onopen) {
          mockWebSocket.onopen(new Event('open'));
        }
        await connectPromise;
      });

      it('should emit message events for valid JSON messages', () => {
        const messageListener = jest.fn();
        connectionManager.on('message', messageListener);

        const testMessage = {
          jsonrpc: '2.0',
          method: 'test',
          id: 1
        };

        if (mockWebSocket.onmessage) {
          mockWebSocket.onmessage({
            data: JSON.stringify(testMessage)
          } as MessageEvent);
        }

        expect(messageListener).toHaveBeenCalledWith(testMessage);
      });

      it('should handle connection-info messages and store userApiKey', () => {
        if (mockWebSocket.onmessage) {
          mockWebSocket.onmessage({
            data: JSON.stringify({
              type: 'connection-info',
              userApiKey: 'uak_newkey123456789'
            })
          } as MessageEvent);
        }

        // Verify userApiKey is stored
        expect(connectionManager['receivedUserApiKey']).toBe('uak_newkey123456789');
      });

      it('should handle malformed JSON gracefully', () => {
        if (mockWebSocket.onmessage) {
          mockWebSocket.onmessage({
            data: 'invalid json'
          } as MessageEvent);
        }

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to parse message')
        );
      });
    });

    describe('send() method', () => {
      it('should send message when connected', async () => {
        // Connect first
        const connectPromise = connectionManager.connect();
        await flushPromiseQueue();
        mockWebSocket.readyState = 1; // OPEN
        if (mockWebSocket.onopen) {
          mockWebSocket.onopen(new Event('open'));
        }
        await connectPromise;

        const message = {
          jsonrpc: '2.0' as const,
          method: 'tools/list',
          id: 1
        };

        connectionManager.send(message);

        expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
      });

      it('should throw error when not connected', () => {
        const message = {
          jsonrpc: '2.0' as const,
          method: 'tools/list', 
          id: 1
        };

        expect(() => connectionManager.send(message)).toThrow('WebSocket is not connected');
      });
    });

    describe('Status management', () => {
      it('should update status correctly', () => {
        connectionManager.updateStatus('connected');
        expect(connectionManager.getStatus()).toBe('connected');
      });

      it('should emit status change events', () => {
        const statusListener = jest.fn();
        connectionManager.on('statusChange', statusListener);

        connectionManager.updateStatus('connected');
        expect(statusListener).toHaveBeenCalledWith('connected');
      });

      it('should not emit event if status unchanged', () => {
        const statusListener = jest.fn();
        connectionManager.on('statusChange', statusListener);

        connectionManager.updateStatus('disconnected'); // Already disconnected
        expect(statusListener).not.toHaveBeenCalled();
      });
    });

    describe('Error classification', () => {
      it('should classify auth-related error codes correctly (1002)', () => {
        const error = connectionManager['classifyConnectionError'](1002, 'Protocol error');
        expect(error.type).toBe('auth_failed');
        expect(error.canRetry).toBe(false);
        expect(error.canResetCredentials).toBe(true);
      });

      it('should classify reason-based auth errors', () => {
        const error = connectionManager['classifyConnectionError'](4000, 'Unauthorized access');
        expect(error.type).toBe('auth_failed');
        expect(error.message).toContain('Unauthorized access');
      });

      it('should handle unknown error codes', () => {
        const error = connectionManager['classifyConnectionError'](9999, 'Unknown error');
        expect(error.type).toBe('unknown');
        expect(error.canRetry).toBe(true);
      });

      it('should classify server errors (1011)', () => {
        const error = connectionManager['classifyConnectionError'](1011, 'Server error');
        expect(error.type).toBe('connection_failed');
        expect(error.canRetry).toBe(true);
      });

      it('should classify normal closure (1000)', () => {
        const error = connectionManager['classifyConnectionError'](1000, 'Normal closure');
        expect(error.type).toBe('connection_failed');
        expect(error.canRetry).toBe(true);
      });
    });

    describe('Private helper methods', () => {
      it('should determine reconnect eligibility correctly', () => {
        // Test shouldReconnect logic
        expect(connectionManager['shouldReconnect'](1000)).toBe(false); // Normal close
        expect(connectionManager['shouldReconnect'](1008)).toBe(false); // Auth failure
        expect(connectionManager['shouldReconnect'](1006)).toBe(true);  // Abnormal close
        
        // Test max attempts limit
        connectionManager['reconnectAttempts'] = 5;
        expect(connectionManager['shouldReconnect'](1006)).toBe(false); // At limit
      });
    });
    
    describe('Reconnection error handling', () => {
      let tokenFailureConnectionManager: ConnectionManager;
      
      beforeEach(() => {
        jest.useFakeTimers();
      });
      
      afterEach(async () => {
        if (tokenFailureConnectionManager) {
          await tokenFailureConnectionManager.disconnect();
        }
        jest.clearAllTimers();
        jest.useRealTimers();
      });
      
      it('should continue reconnecting when token fetch fails due to network error', async () => {
        let tokenAttempt = 0;
        const failingTokenProvider = jest.fn().mockImplementation(() => {
          tokenAttempt++;
          if (tokenAttempt <= 2) {
            // First two attempts fail with network error
            return Promise.reject(new Error('fetch failed: ECONNREFUSED'));
          }
          // Third attempt succeeds
          return Promise.resolve('valid-token');
        });
        
        const tokenFailConfig = {
          ...validConfig,
          tokenProvider: failingTokenProvider,
          testMode: true, // Use 1ms delays for tests
          maxReconnectAttempts: 5
        };
        
        tokenFailureConnectionManager = new ConnectionManager(tokenFailConfig, mockLogger);
        
        // First connect attempt fails
        const connectPromise = tokenFailureConnectionManager.connect();
        await expect(connectPromise).rejects.toThrow('fetch failed: ECONNREFUSED');
        expect(failingTokenProvider).toHaveBeenCalledTimes(1);
        
        // Should schedule reconnection
        expect(tokenFailureConnectionManager['reconnectTimer']).not.toBeNull();
        
        // Advance timer for first reconnect attempt
        await jest.advanceTimersByTimeAsync(1);
        await flushPromiseQueue();
        expect(failingTokenProvider).toHaveBeenCalledTimes(2);
        
        // Should schedule another reconnection after second failure
        expect(tokenFailureConnectionManager['reconnectTimer']).not.toBeNull();
        
        // Advance timer for second reconnect attempt - this one should succeed
        await jest.advanceTimersByTimeAsync(1);
        await flushPromiseQueue();
        expect(failingTokenProvider).toHaveBeenCalledTimes(3);
        
        // Simulate successful connection
        if (mockWebSocket.onopen) {
          mockWebSocket.onopen(new Event('open'));
        }
        
        // Should be connected now
        expect(tokenFailureConnectionManager.getStatus()).toBe('connected');
        expect(tokenFailureConnectionManager['reconnectAttempts']).toBe(0);
      });
      
      it('should stop reconnecting on authentication errors during token fetch', async () => {
        const authErrorProvider = jest.fn().mockRejectedValue(
          new Error('Invalid token: unauthorized')
        );
        
        const authFailConfig = {
          ...validConfig,
          tokenProvider: authErrorProvider,
          testMode: true
        };
        
        const authFailManager = new ConnectionManager(authFailConfig, mockLogger);
        const errorListener = jest.fn();
        authFailManager.on('error', errorListener);
        
        // First connect attempt fails with auth error
        const connectPromise = authFailManager.connect();
        await expect(connectPromise).rejects.toThrow('Invalid token: unauthorized');
        
        // Should schedule initial reconnection (we don't know it's auth error yet)
        expect(authFailManager['reconnectTimer']).not.toBeNull();
        
        // Advance timer for reconnect attempt
        await jest.advanceTimersByTimeAsync(1);
        await flushPromiseQueue();
        
        // Should have emitted auth error and stopped reconnecting
        expect(errorListener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'auth_failed',
            canResetCredentials: true
          })
        );
        
        // Should have cleared the timer after detecting auth error
        // Note: Since the error is detected async, we need to wait a bit more
        await jest.advanceTimersByTimeAsync(1);
        await flushPromiseQueue();
        
        // Should not schedule further reconnections
        expect(authFailManager['reconnectTimer']).toBeNull();
        expect(authFailManager.getStatus()).toBe('error');
        
        // Clean up
        await authFailManager.disconnect();
      });
      
      it('should handle mixed error scenarios correctly', async () => {
        let callCount = 0;
        const mixedErrorProvider = jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error('network timeout'));
          } else if (callCount === 2) {
            return Promise.reject(new Error('ENOTFOUND'));
          } else {
            return Promise.resolve('valid-token');
          }
        });
        
        const mixedConfig = {
          ...validConfig,
          tokenProvider: mixedErrorProvider,
          testMode: true
        };
        
        const mixedManager = new ConnectionManager(mixedConfig, mockLogger);
        
        // First attempt - network timeout
        await expect(mixedManager.connect()).rejects.toThrow('network timeout');
        expect(mixedManager['reconnectTimer']).not.toBeNull();
        
        // Second attempt - ENOTFOUND (DNS error)
        await jest.advanceTimersByTimeAsync(1);
        await flushPromiseQueue();
        expect(mixedErrorProvider).toHaveBeenCalledTimes(2);
        expect(mixedManager['reconnectTimer']).not.toBeNull();
        
        // Third attempt - success
        await jest.advanceTimersByTimeAsync(1);
        await flushPromiseQueue();
        expect(mixedErrorProvider).toHaveBeenCalledTimes(3);
        
        // Simulate successful connection
        if (mockWebSocket.onopen) {
          mockWebSocket.onopen(new Event('open'));
        }
        
        expect(mixedManager.getStatus()).toBe('connected');
        
        // Clean up
        await mixedManager.disconnect();
      });
      
      it('should respect max reconnection attempts for token fetch failures', async () => {
        const alwaysFailProvider = jest.fn().mockRejectedValue(
          new Error('fetch error: ECONNREFUSED')
        );
        
        const maxAttemptsConfig = {
          ...validConfig,
          tokenProvider: alwaysFailProvider,
          testMode: true,
          maxReconnectAttempts: 3
        };
        
        const maxAttemptsManager = new ConnectionManager(maxAttemptsConfig, mockLogger);
        const errorListener = jest.fn();
        maxAttemptsManager.on('error', errorListener);
        
        // Initial failure
        await expect(maxAttemptsManager.connect()).rejects.toThrow('fetch error: ECONNREFUSED');
        
        // Advance through all reconnection attempts
        for (let i = 1; i <= 3; i++) {
          await jest.advanceTimersByTimeAsync(1);
          await flushPromiseQueue();
          expect(alwaysFailProvider).toHaveBeenCalledTimes(i + 1);
        }
        
        // Should have emitted error after max attempts
        expect(errorListener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'connection_failed',
            message: expect.stringContaining('Failed to reconnect after 3 attempts')
          })
        );
        
        // Wait for async error handling to complete
        await jest.advanceTimersByTimeAsync(1);
        await flushPromiseQueue();
        
        // Should be in error state with no more reconnections
        expect(maxAttemptsManager.getStatus()).toBe('error');
        expect(maxAttemptsManager['reconnectTimer']).toBeNull();
        
        // Clean up
        await maxAttemptsManager.disconnect();
      });
    });
  });
});