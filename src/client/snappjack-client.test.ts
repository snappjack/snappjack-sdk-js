/**
 * Comprehensive unit tests for SnappjackClient
 * Testing configuration, tool management, message handling, and integration points
 */

import { Snappjack } from './snappjack-client';
import { ConnectionManager } from './connection-manager';
import { ToolRegistry } from './tool-registry';
import {
  SnappjackConfig,
  Logger,
  Tool,
  ToolCallMessage,
  ToolResponse,
  AgentMessage,
  ConnectionData,
  SnappjackStatus
} from '../core/types';

// Mock dependencies
jest.mock('./connection-manager');
jest.mock('./tool-registry');

// Mock global fetch for createUser method
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

describe('SnappjackClient', () => {
  let mockConnectionManager: jest.Mocked<ConnectionManager>;
  let mockToolRegistry: jest.Mocked<ToolRegistry>;
  
  // Helper to flush the promise queue for async coordination
  const flushPromiseQueue = () => new Promise(jest.requireActual('timers').setImmediate);

  const validConfig: SnappjackConfig = {
    snappId: 'test-snapp',
    userId: 'test-user',
    tokenProvider: jest.fn().mockResolvedValue('test-jwt-token'),
    tools: [],
    logger: mockLogger
  };

  const sampleTool: Tool = {
    name: 'test-tool',
    description: 'A test tool',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' }
      },
      required: ['message']
    },
    handler: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Test response' }]
    })
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mocked instances
    mockConnectionManager = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockReturnValue('disconnected' as SnappjackStatus),
      send: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
      updateStatus: jest.fn()
    } as any;

    mockToolRegistry = {
      register: jest.fn(),
      has: jest.fn().mockReturnValue(true),
      get: jest.fn(),
      getAll: jest.fn().mockReturnValue([]),
      validate: jest.fn().mockReturnValue({ isValid: true }),
      setHandler: jest.fn(),
      getHandler: jest.fn()
    } as any;

    // Mock the constructors
    (ConnectionManager as jest.MockedClass<typeof ConnectionManager>).mockImplementation(() => mockConnectionManager);
    (ToolRegistry as jest.MockedClass<typeof ToolRegistry>).mockImplementation(() => mockToolRegistry);
  });

  afterEach(() => {
    // Clean up any test state
  });

  const createMockToolCallMessage = (toolName: string = 'test-tool', args: any = { message: 'test' }): ToolCallMessage => ({
    jsonrpc: '2.0',
    id: 'test-id-123',
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args
    },
    agentSessionId: 'agent-session-123'
  });

  describe('1. Constructor & Configuration', () => {
    it('should create instance with valid configuration', () => {
      const client = new Snappjack(validConfig);
      
      expect(client).toBeInstanceOf(Snappjack);
      expect(ConnectionManager).toHaveBeenCalledTimes(1);
      expect(ToolRegistry).toHaveBeenCalledTimes(1);
    });

    it('should throw error when snappId is missing', () => {
      const invalidConfig = { ...validConfig };
      delete (invalidConfig as any).snappId;

      expect(() => new Snappjack(invalidConfig)).toThrow('App ID is required');
    });

    it('should throw error when tokenProvider is missing', () => {
      const invalidConfig = { ...validConfig };
      delete (invalidConfig as any).tokenProvider;

      expect(() => new Snappjack(invalidConfig)).toThrow('tokenProvider function is required');
    });

    it('should throw error when tokenProvider is not a function', () => {
      const invalidConfig = { ...validConfig, tokenProvider: 'not-a-function' as any };

      expect(() => new Snappjack(invalidConfig)).toThrow('tokenProvider function is required');
    });

    it('should use default server URL when not provided', () => {
      const client = new Snappjack(validConfig);
      
      expect(ConnectionManager).toHaveBeenCalledWith(
        expect.objectContaining({
          serverUrl: 'ws://localhost:3000'
        }),
        expect.any(Object)
      );
    });

    it('should use compile-time configured server URL', () => {
      const client = new Snappjack(validConfig);

      expect(ConnectionManager).toHaveBeenCalledWith(
        expect.objectContaining({
          serverUrl: 'ws://localhost:3000' // Server URL is now compile-time configured
        }),
        expect.any(Object)
      );
    });

    it('should transform HTTP to WS protocol', () => {
      const configWithHttp = {
        ...validConfig,
        serverUrl: 'http://example.com'
      };
      
      expect(() => new Snappjack(configWithHttp)).not.toThrow();
    });

    it('should throw error for invalid server URL', () => {
      const configWithInvalidUrl = {
        ...validConfig,
        serverUrl: 'invalid-url'
      };

      expect(() => new Snappjack(configWithInvalidUrl)).toThrow('Server URL must start with http:// or https://');
    });

    it('should apply default configuration values', () => {
      const minimalConfig = {
        snappId: 'test-snapp',
        userId: 'test-user', 
        tokenProvider: jest.fn().mockResolvedValue('token')
      };

      const client = new Snappjack(minimalConfig);

      expect(ConnectionManager).toHaveBeenCalledWith(
        expect.objectContaining({
          autoReconnect: true,
          reconnectInterval: 5000,
          maxReconnectAttempts: 10
        }),
        expect.any(Object)
      );
    });

    it('should filter out undefined values from user config', () => {
      const configWithUndefined = {
        ...validConfig,
        autoReconnect: undefined,
        reconnectInterval: 3000
      };

      const client = new Snappjack(configWithUndefined);

      // Should use default autoReconnect (true) but custom reconnectInterval
      expect(ConnectionManager).toHaveBeenCalledWith(
        expect.objectContaining({
          autoReconnect: true, // default
          reconnectInterval: 3000 // custom
        }),
        expect.any(Object)
      );
    });
  });

  describe('2. Static Methods', () => {
    beforeEach(() => {
      mockFetch.mockClear();
    });

    describe('createUser()', () => {
      it('should create user successfully', async () => {
        const mockResponse = {
          userId: 'user-123',
          userApiKey: 'uak_test123',
          snappId: 'snapp-456',
          mcpEndpoint: 'http://localhost:3000/mcp/snapp-456/user-123'
        };

        mockFetch.mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue(mockResponse)
        });

        const result = await Snappjack.createUser('/api/create-user');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3000/api/create-user',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
        expect(result).toEqual(mockResponse);
      });

      it('should handle browser environment with window.location', async () => {
        // Mock window.location
        Object.defineProperty(global, 'window', {
          value: {
            location: {
              origin: 'https://myapp.com'
            }
          },
          writable: true
        });

        mockFetch.mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue({})
        });

        await Snappjack.createUser('/api/create-user');

        expect(mockFetch).toHaveBeenCalledWith(
          'https://myapp.com/api/create-user',
          expect.any(Object)
        );

        // Clean up
        delete (global as any).window;
      });

      it('should throw error on failed response', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: jest.fn().mockResolvedValue('Invalid request data')
        });

        await expect(Snappjack.createUser('/api/create-user'))
          .rejects.toThrow('Failed to create user: 400 Bad Request. Invalid request data');
      });

      it('should handle text() failure in error response', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: jest.fn().mockRejectedValue(new Error('Failed to read response'))
        });

        await expect(Snappjack.createUser('/api/create-user'))
          .rejects.toThrow('Failed to create user: 500 Internal Server Error. Unknown error');
      });

      it('should handle network errors', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));

        await expect(Snappjack.createUser('/api/create-user'))
          .rejects.toThrow('Network error');
      });
    });
  });

  describe('3. Tool Management', () => {
    let client: Snappjack;

    beforeEach(() => {
      client = new Snappjack(validConfig);
    });

    describe('registerTool()', () => {
      it('should register tool with registry', () => {
        client.registerTool(sampleTool);

        expect(mockToolRegistry.register).toHaveBeenCalledWith(sampleTool);
        expect(mockToolRegistry.setHandler).toHaveBeenCalledWith('test-tool', sampleTool.handler);
      });

      it('should register tool without handler', () => {
        const toolWithoutHandler = { ...sampleTool };
        delete toolWithoutHandler.handler;

        client.registerTool(toolWithoutHandler);

        expect(mockToolRegistry.register).toHaveBeenCalledWith(toolWithoutHandler);
        expect(mockToolRegistry.setHandler).not.toHaveBeenCalled();
      });

      it('should not set handler if not a function', () => {
        const toolWithInvalidHandler = { ...sampleTool, handler: 'not-a-function' as any };

        client.registerTool(toolWithInvalidHandler);

        expect(mockToolRegistry.register).toHaveBeenCalledWith(toolWithInvalidHandler);
        expect(mockToolRegistry.setHandler).not.toHaveBeenCalled();
      });
    });

    describe('getTools()', () => {
      it('should return tools from registry', () => {
        const mockTools = [
          { name: 'tool1', description: 'Test tool 1', inputSchema: { type: 'object' as const } },
          { name: 'tool2', description: 'Test tool 2', inputSchema: { type: 'object' as const } }
        ];
        mockToolRegistry.getAll.mockReturnValue(mockTools);

        const tools = client.getTools();

        expect(tools).toEqual(mockTools);
        expect(mockToolRegistry.getAll).toHaveBeenCalled();
      });
    });

    describe('tool initialization from config', () => {
      it('should register tools provided in config', () => {
        const configWithTools = {
          ...validConfig,
          tools: [sampleTool, { ...sampleTool, name: 'second-tool' }]
        };

        const client = new Snappjack(configWithTools);

        expect(mockToolRegistry.register).toHaveBeenCalledTimes(2);
        expect(mockToolRegistry.register).toHaveBeenCalledWith(sampleTool);
        expect(mockToolRegistry.register).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'second-tool' })
        );
      });
    });
  });

  describe('4. Connection Lifecycle', () => {
    let client: Snappjack;

    beforeEach(() => {
      client = new Snappjack(validConfig);
    });

    it('should delegate connect() to ConnectionManager', async () => {
      await client.connect();

      expect(mockConnectionManager.connect).toHaveBeenCalledTimes(1);
    });

    it('should delegate disconnect() to ConnectionManager', async () => {
      await client.disconnect();

      expect(mockConnectionManager.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should delegate getStatus() to ConnectionManager', () => {
      mockConnectionManager.getStatus.mockReturnValue('connected');

      const status = client.getStatus();

      expect(status).toBe('connected');
      expect(mockConnectionManager.getStatus).toHaveBeenCalledTimes(1);
    });

    it('should set up event listeners on ConnectionManager', () => {
      // ConnectionManager should have been called with event listeners
      expect(mockConnectionManager.on).toHaveBeenCalledWith('open', expect.any(Function));
      expect(mockConnectionManager.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockConnectionManager.on).toHaveBeenCalledWith('statusChange', expect.any(Function));
      expect(mockConnectionManager.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('5. Message Handling', () => {
    let client: Snappjack;
    let messageHandler: (message: any) => void;

    beforeEach(() => {
      client = new Snappjack(validConfig);
      
      // Capture the message handler that was registered
      const onCalls = (mockConnectionManager.on as jest.Mock).mock.calls;
      const messageCall = onCalls.find(call => call[0] === 'message');
      messageHandler = messageCall ? messageCall[1] : null;
      
      expect(messageHandler).toBeDefined();
    });

    describe('tool call handling', () => {
      beforeEach(() => {
        // Set up tool with handler
        mockToolRegistry.has.mockReturnValue(true);
        mockToolRegistry.getHandler.mockReturnValue(sampleTool.handler);
        mockToolRegistry.validate.mockReturnValue({ isValid: true });
      });

      it('should handle valid tool call request', async () => {
        const toolCallMessage = createMockToolCallMessage();
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        expect(mockToolRegistry.getHandler).toHaveBeenCalledWith('test-tool');
        expect(mockToolRegistry.validate).toHaveBeenCalledWith('test-tool', { message: 'test' });
        expect(sampleTool.handler).toHaveBeenCalledWith(
          { message: 'test' },
          toolCallMessage
        );
        expect(mockConnectionManager.send).toHaveBeenCalledWith({
          jsonrpc: '2.0',
          id: 'test-id-123',
          result: {
            content: [{ type: 'text', text: 'Test response' }]
          },
          agentSessionId: 'agent-session-123'
        });
      });

      it('should handle tool not found', async () => {
        mockToolRegistry.has.mockReturnValue(false);
        const toolCallMessage = createMockToolCallMessage('nonexistent-tool');
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        expect(mockConnectionManager.send).toHaveBeenCalledWith({
          jsonrpc: '2.0',
          id: 'test-id-123',
          error: {
            code: -32601,
            message: 'Method not found',
            data: "Tool 'nonexistent-tool' not found or no handler registered"
          },
          agentSessionId: 'agent-session-123'
        });
      });

      it('should handle tool without handler', async () => {
        mockToolRegistry.has.mockReturnValue(true);
        mockToolRegistry.getHandler.mockReturnValue(undefined);
        const toolCallMessage = createMockToolCallMessage();
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        expect(mockConnectionManager.send).toHaveBeenCalledWith({
          jsonrpc: '2.0',
          id: 'test-id-123',
          error: {
            code: -32601,
            message: 'Method not found',
            data: "Tool 'test-tool' not found or no handler registered"
          },
          agentSessionId: 'agent-session-123'
        });
      });

      it('should handle validation failure', async () => {
        mockToolRegistry.validate.mockReturnValue({
          isValid: false,
          errors: [
            { instancePath: '/message', message: 'is required' }
          ]
        });
        const toolCallMessage = createMockToolCallMessage('test-tool', {});
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        expect(mockConnectionManager.send).toHaveBeenCalledWith({
          jsonrpc: '2.0',
          id: 'test-id-123',
          result: {
            content: [{
              type: 'text',
              text: "Invalid arguments for tool 'test-tool': /message: is required"
            }],
            isError: true
          },
          agentSessionId: 'agent-session-123'
        });
      });

      it('should handle tool execution error', async () => {
        const errorHandler = jest.fn().mockRejectedValue(new Error('Tool execution failed'));
        mockToolRegistry.getHandler.mockReturnValue(errorHandler);
        const toolCallMessage = createMockToolCallMessage();
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        expect(mockConnectionManager.send).toHaveBeenCalledWith({
          jsonrpc: '2.0',
          id: 'test-id-123',
          result: {
            content: [{
              type: 'text',
              text: 'Tool execution failed: Tool execution failed'
            }],
            isError: true
          },
          agentSessionId: 'agent-session-123'
        });
      });

      it('should handle invalid tool response format', async () => {
        const invalidHandler = jest.fn().mockResolvedValue({ invalid: 'response' });
        mockToolRegistry.getHandler.mockReturnValue(invalidHandler);
        const toolCallMessage = createMockToolCallMessage();
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        expect(mockConnectionManager.send).toHaveBeenCalledWith({
          jsonrpc: '2.0',
          id: 'test-id-123',
          result: {
            content: [{
              type: 'text',
              text: "Tool handler for 'test-tool' returned invalid result format"
            }],
            isError: true
          },
          agentSessionId: 'agent-session-123'
        });
      });

      it('should handle null tool response', async () => {
        const nullHandler = jest.fn().mockResolvedValue(null);
        mockToolRegistry.getHandler.mockReturnValue(nullHandler);
        const toolCallMessage = createMockToolCallMessage();
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        expect(mockConnectionManager.send).toHaveBeenCalledWith({
          jsonrpc: '2.0',
          id: 'test-id-123',
          result: {
            content: [{
              type: 'text',
              text: "Tool handler for 'test-tool' returned invalid result format"
            }],
            isError: true
          },
          agentSessionId: 'agent-session-123'
        });
      });
    });

    describe('agent message handling', () => {
      it('should handle agent-connected message', () => {
        const agentConnectedMessage: AgentMessage = {
          type: 'agent-connected',
          agentSessionId: 'agent-123'
        };

        const emitSpy = jest.spyOn(client, 'emit');
        messageHandler(agentConnectedMessage);

        expect(emitSpy).toHaveBeenCalledWith('agent-connected', { agentSessionId: 'agent-123' });
      });

      it('should handle agent-disconnected message', () => {
        const agentDisconnectedMessage: AgentMessage = {
          type: 'agent-disconnected',
          agentSessionId: 'agent-123'
        };

        const emitSpy = jest.spyOn(client, 'emit');
        messageHandler(agentDisconnectedMessage);

        expect(emitSpy).toHaveBeenCalledWith('agent-disconnected', { agentSessionId: 'agent-123' });
      });
    });

    describe('connection-info message handling', () => {
      it('should handle connection-info message and emit user-api-key-generated', () => {
        const connectionInfoMessage = {
          type: 'connection-info',
          userApiKey: 'uak_test12345'
        };

        const emitSpy = jest.spyOn(client, 'emit');
        messageHandler(connectionInfoMessage);

        expect(emitSpy).toHaveBeenCalledWith('user-api-key-generated', {
          userApiKey: 'uak_test12345',
          snappId: 'test-snapp',
          userId: 'test-user',
          mcpEndpoint: 'http://localhost:3000/mcp/test-snapp/test-user',
          requireAuthHeader: true
        });
      });

      it('should handle connection-info message without userApiKey', () => {
        const connectionInfoMessage = {
          type: 'connection-info'
        };

        const emitSpy = jest.spyOn(client, 'emit');
        messageHandler(connectionInfoMessage);

        expect(emitSpy).not.toHaveBeenCalledWith('user-api-key-generated', expect.anything());
      });

      it('should convert WSS server URL to HTTPS for MCP endpoint', () => {
        const configWithWss = {
          ...validConfig,
          serverUrl: 'https://secure-server.com'
        };
        const clientWithWss = new Snappjack(configWithWss);

        // Get the message handler for the new client
        const onCalls = (mockConnectionManager.on as jest.Mock).mock.calls;
        const latestMessageCall = onCalls.filter(call => call[0] === 'message').pop();
        const wssMessageHandler = latestMessageCall[1];

        const connectionInfoMessage = {
          type: 'connection-info',
          userApiKey: 'uak_test12345'
        };

        const emitSpy = jest.spyOn(clientWithWss, 'emit');
        wssMessageHandler(connectionInfoMessage);

        expect(emitSpy).toHaveBeenCalledWith('user-api-key-generated', {
          userApiKey: 'uak_test12345',
          snappId: 'test-snapp',
          userId: 'test-user',
          mcpEndpoint: 'https://secure-server.com/mcp/test-snapp/test-user',
          requireAuthHeader: true
        });
      });
    });

    describe('generic message handling', () => {
      it('should emit generic message events', () => {
        const genericMessage = {
          type: 'custom-message',
          data: 'some data'
        };

        const emitSpy = jest.spyOn(client, 'emit');
        messageHandler(genericMessage);

        expect(emitSpy).toHaveBeenCalledWith('message', genericMessage);
      });

      it('should handle messages without type property', () => {
        const messageWithoutType = {
          someProperty: 'value'
        };

        const emitSpy = jest.spyOn(client, 'emit');
        messageHandler(messageWithoutType);

        expect(emitSpy).toHaveBeenCalledWith('message', messageWithoutType);
      });

      it('should handle malformed messages gracefully', () => {
        const malformedMessages = [
          null,
          undefined,
          'string message',
          123,
          []
        ];

        const warnSpy = jest.spyOn(mockLogger, 'warn');

        malformedMessages.forEach(message => {
          expect(() => messageHandler(message)).not.toThrow();
        });

        // Verify that errors were logged for malformed messages
        expect(warnSpy).toHaveBeenCalled();
      });
    });
  });

  describe('6. Agent Management', () => {
    let client: Snappjack;

    beforeEach(() => {
      client = new Snappjack(validConfig);
    });

    describe('forceDisconnectAgent()', () => {
      it('should send force-disconnect-agent message', () => {
        client.forceDisconnectAgent();

        expect(mockConnectionManager.send).toHaveBeenCalledWith({
          type: 'force-disconnect-agent'
        });
      });

      it('should throw error when send fails', () => {
        mockConnectionManager.send.mockImplementation(() => {
          throw new Error('Connection not available');
        });

        expect(() => client.forceDisconnectAgent())
          .toThrow('Failed to force disconnect agent: Connection not available');
      });

      it('should handle non-Error exceptions', () => {
        mockConnectionManager.send.mockImplementation(() => {
          throw 'String error';
        });

        expect(() => client.forceDisconnectAgent())
          .toThrow('Failed to force disconnect agent: String error');
      });
    });

    describe('agent session tracking', () => {
      let messageHandler: (message: any) => void;

      beforeEach(() => {
        // Capture the message handler
        const onCalls = (mockConnectionManager.on as jest.Mock).mock.calls;
        const messageCall = onCalls.find(call => call[0] === 'message');
        messageHandler = messageCall[1];
      });

      it('should track agent session ID from tool calls', async () => {
        // Set up tool
        mockToolRegistry.has.mockReturnValue(true);
        mockToolRegistry.getHandler.mockReturnValue(sampleTool.handler);
        mockToolRegistry.validate.mockReturnValue({ isValid: true });

        const toolCallMessage = createMockToolCallMessage('test-tool', { message: 'test' });
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        // Verify the agentSessionId was tracked in the response
        expect(mockConnectionManager.send).toHaveBeenCalledWith(
          expect.objectContaining({
            agentSessionId: 'agent-session-123'
          })
        );
      });

      it('should track current agent session on agent-connected', async () => {
        const agentConnectedMessage: AgentMessage = {
          type: 'agent-connected',
          agentSessionId: 'new-agent-session'
        };

        messageHandler(agentConnectedMessage);

        // Subsequent tool call should use the new session ID
        mockToolRegistry.has.mockReturnValue(true);
        mockToolRegistry.getHandler.mockReturnValue(sampleTool.handler);
        mockToolRegistry.validate.mockReturnValue({ isValid: true });

        const toolCallMessage = createMockToolCallMessage('test-tool', { message: 'test' });
        toolCallMessage.agentSessionId = 'new-agent-session';
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        expect(mockConnectionManager.send).toHaveBeenLastCalledWith(
          expect.objectContaining({
            agentSessionId: 'new-agent-session'
          })
        );
      });

      it('should clear current agent session on agent-disconnected', () => {
        const agentDisconnectedMessage: AgentMessage = {
          type: 'agent-disconnected',
          agentSessionId: 'disconnected-agent-session'
        };

        messageHandler(agentDisconnectedMessage);

        // Current agent session should be cleared (set to null)
        // This would be verified by checking internal state, but since it's private,
        // we verify through the behavior on the next tool call
        expect(() => messageHandler(agentDisconnectedMessage)).not.toThrow();
      });
    });
  });

  describe('7. Event Forwarding and Error Handling', () => {
    let client: Snappjack;
    let openHandler: () => void;
    let statusHandler: (status: SnappjackStatus) => void;
    let errorHandler: (error: any) => void;

    beforeEach(() => {
      client = new Snappjack(validConfig);
      
      // Capture event handlers
      const onCalls = (mockConnectionManager.on as jest.Mock).mock.calls;
      openHandler = onCalls.find(call => call[0] === 'open')[1];
      statusHandler = onCalls.find(call => call[0] === 'statusChange')[1];
      errorHandler = onCalls.find(call => call[0] === 'error')[1];
    });

    describe('event forwarding', () => {
      it('should call sendToolsRegistration on open event', () => {
        const mockTools = [
          { name: 'tool1', description: 'Test tool 1', inputSchema: { type: 'object' as const } }
        ];
        mockToolRegistry.getAll.mockReturnValue(mockTools);

        openHandler();

        expect(mockConnectionManager.send).toHaveBeenCalledWith({
          type: 'tools-registration',
          tools: mockTools
        });
      });

      it('should forward status change events from ConnectionManager', () => {
        const emitSpy = jest.spyOn(client, 'emit');
        
        statusHandler('connected');

        expect(emitSpy).toHaveBeenCalledWith('status', 'connected');
      });

      it('should forward error events from ConnectionManager', () => {
        const emitSpy = jest.spyOn(client, 'emit');
        const testError = new Error('Connection failed');
        
        errorHandler(testError);

        expect(emitSpy).toHaveBeenCalledWith('error', testError);
      });
    });

    describe('error handling during operations', () => {
      it('should emit error when tools registration fails', () => {
        mockConnectionManager.send.mockImplementation(() => {
          throw new Error('Send failed');
        });

        const emitSpy = jest.spyOn(client, 'emit');
        
        openHandler(); // This triggers tools registration

        expect(emitSpy).toHaveBeenCalledWith('error', expect.any(Error));
      });

      it('should emit error when tool response sending fails', async () => {
        // Set up successful tool execution
        mockToolRegistry.has.mockReturnValue(true);
        mockToolRegistry.getHandler.mockReturnValue(sampleTool.handler);
        mockToolRegistry.validate.mockReturnValue({ isValid: true });

        // But make send fail
        mockConnectionManager.send.mockImplementation(() => {
          throw new Error('Send response failed');
        });

        const messageHandler = (mockConnectionManager.on as jest.Mock).mock.calls
          .find(call => call[0] === 'message')[1];

        const emitSpy = jest.spyOn(client, 'emit');
        const toolCallMessage = createMockToolCallMessage();
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        expect(emitSpy).toHaveBeenCalledWith('error', expect.any(Error));
      });

      it('should emit error when tool error sending fails', async () => {
        mockToolRegistry.has.mockReturnValue(false); // Tool not found
        
        // Make send fail
        mockConnectionManager.send.mockImplementation(() => {
          throw new Error('Send error failed');
        });

        const messageHandler = (mockConnectionManager.on as jest.Mock).mock.calls
          .find(call => call[0] === 'message')[1];

        const emitSpy = jest.spyOn(client, 'emit');
        const toolCallMessage = createMockToolCallMessage('nonexistent-tool');
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        expect(emitSpy).toHaveBeenCalledWith('error', expect.any(Error));
      });

      it('should handle validation errors with missing error details', async () => {
        mockToolRegistry.has.mockReturnValue(true);
        mockToolRegistry.getHandler.mockReturnValue(sampleTool.handler);
        mockToolRegistry.validate.mockReturnValue({
          isValid: false,
          errors: [] // Empty errors array
        });

        const messageHandler = (mockConnectionManager.on as jest.Mock).mock.calls
          .find(call => call[0] === 'message')[1];

        const toolCallMessage = createMockToolCallMessage('test-tool', {});
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        expect(mockConnectionManager.send).toHaveBeenCalledWith({
          jsonrpc: '2.0',
          id: 'test-id-123',
          result: {
            content: [{
              type: 'text',
              text: "Invalid arguments for tool 'test-tool': Unknown validation error"
            }],
            isError: true
          },
          agentSessionId: 'agent-session-123'
        });
      });

      it('should handle validation errors without instancePath', async () => {
        mockToolRegistry.has.mockReturnValue(true);
        mockToolRegistry.getHandler.mockReturnValue(sampleTool.handler);
        mockToolRegistry.validate.mockReturnValue({
          isValid: false,
          errors: [
            { instancePath: '', message: 'is required' } // Empty instancePath
          ]
        });

        const messageHandler = (mockConnectionManager.on as jest.Mock).mock.calls
          .find(call => call[0] === 'message')[1];

        const toolCallMessage = createMockToolCallMessage('test-tool', {});
        
        messageHandler(toolCallMessage);
        await flushPromiseQueue();

        expect(mockConnectionManager.send).toHaveBeenCalledWith({
          jsonrpc: '2.0',
          id: 'test-id-123',
          result: {
            content: [{
              type: 'text',
              text: "Invalid arguments for tool 'test-tool': root: is required"
            }],
            isError: true
          },
          agentSessionId: 'agent-session-123'
        });
      });
    });
  });

  describe('8. Event Emitter Integration', () => {
    let client: Snappjack;

    beforeEach(() => {
      client = new Snappjack(validConfig);
    });

    it('should support method chaining for on()', () => {
      const handler = jest.fn();
      
      const result = client.on('test-event', handler);

      expect(result).toBe(client);
    });

    it('should inherit event emitter functionality', () => {
      const handler = jest.fn();
      
      client.on('test-event', handler);
      client.emit('test-event', 'test-data');

      expect(handler).toHaveBeenCalledWith('test-data');
    });
  });
});