/**
 * Snappjack SDK - TypeScript Version
 * Enable your app for agents. In a snap.
 * 
 * The zero-pain way to enable your app for the AI era, letting users put their 
 * personal assistants to work directly within their live app session.
 * 
 * Supports ephemeral JWT token authentication:
 * Your app server generates ephemeral tokens using SnappjackServerHelper and passes them to the client
 */

import { EventEmitter, EventListener } from '../core/event-emitter';
import { DEFAULT_SNAPPJACK_SERVER_URL } from '../core/constants';
import { ConnectionManager } from './connection-manager';
import { ToolRegistry } from './tool-registry';
import {
  SnappjackConfig,
  Logger,
  Tool,
  ToolHandler,
  ToolDefinition,
  SnappjackStatus,
  InternalConfig,
  ConnectionConfig,
  ConnectionData,
  ToolCallMessage,
  ToolResponse,
  AgentMessage,
  ErrorResponse,
  JsonRpcResponse,
  ToolRegistrationMessage,
  IncomingMessage,
  SnappjackError
} from '../core/types';

/**
 * Snappjack SDK Client
 * 
 * Authentication flow:
 * 
 * 1. Your app server uses SnappjackServerHelper to generate ephemeral JWT tokens
 * 2. Pass the token to the client constructor:
 * 
 * ```typescript
 * const client = new Snappjack({
 *   snappId: 'your-snapp-id',
 *   userId: 'user-123', 
 *   tokenProvider: async () => await getTokenFromServer(),
 *   tools: [...]
 * });
 * ```
 */
export class Snappjack extends EventEmitter {
  private config: InternalConfig;
  private connectionManager: ConnectionManager;
  private toolRegistry: ToolRegistry;
  private logger: Logger;
  
  // Agent session tracking
  private currentAgentSessionId: string | null = null;
  private lastToolCallAgentSessionId: string | undefined;
  private currentRequireAuthHeader: boolean;
  private requireAuthHeaderExplicitlySet: boolean;

  /**
   * Static method to create a new user via the snapp's API endpoint
   * This should be called before instantiating the Snappjack client
   */
  static async createUser(createUserEndpoint: string): Promise<{ userId: string; userApiKey: string; snappId: string; mcpEndpoint: string }> {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    const url = new URL(createUserEndpoint, baseUrl);
    
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to create user: ${response.status} ${response.statusText}. ${errorText}`);
    }
    
    const data = await response.json();
    return data;
  }

  constructor(config: SnappjackConfig) {
    super();

    // Use provided server URL or fall back to compile-time configured default
    const serverUrl = config.serverUrl || DEFAULT_SNAPPJACK_SERVER_URL;

    // Define all defaults in one place
    const defaultConfig = {
      serverUrl: serverUrl,
      autoReconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      tools: [],
      logger: this.defaultLogger,
      requireAuthHeader: true,  // Default to secure behavior
    };

    // Track whether requireAuthHeader was explicitly provided by the user
    this.requireAuthHeaderExplicitlySet = config.hasOwnProperty('requireAuthHeader') && config.requireAuthHeader !== undefined;

    // Create a clean config object by removing any keys with an `undefined` value from the user's input
    const definedUserConfig = Object.fromEntries(
      Object.entries(config).filter(([_, value]) => value !== undefined)
    ) as SnappjackConfig;

    // Merge the cleaned user config over the defaults
    this.config = {
      ...defaultConfig,
      ...definedUserConfig,
    };

    // Validate required fields from the final, merged config
    if (!this.config.snappId) {
      throw new Error('App ID is required');
    }

    // Validate authentication configuration: tokenProvider is required
    if (!this.config.tokenProvider || typeof this.config.tokenProvider !== 'function') {
      throw new Error('tokenProvider function is required for WebSocket authentication');
    }

    // Perform any necessary transformations on the final config values
    if (!this.config.serverUrl.match(/^https?:\/\//)) {
      throw new Error('Server URL must start with http:// or https://');
    }
    this.config.serverUrl = this.config.serverUrl.replace(/^http/, 'ws');

    this.logger = this.config.logger;
    this.currentRequireAuthHeader = this.config.requireAuthHeader;

    // Initialize components
    this.toolRegistry = new ToolRegistry(this.logger);
    this.connectionManager = new ConnectionManager(this.createConnectionConfig(), this.logger);
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Validate config and initialize tools
    this.validateConfig();
    this.initializeTools();
  }

  /**
   * Default logger implementation using console
   */
  private defaultLogger: Logger = {
    log: (message: string) => {
      if (typeof console !== 'undefined' && console.log) {
        console.log(message);
      }
    },
    warn: (message: string) => {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(message);
      }
    },
    error: (message: string) => {
      if (typeof console !== 'undefined' && console.error) {
        console.error(message);
      }
    }
  };

  /**
   * Create connection configuration from main config
   */
  private createConnectionConfig(): ConnectionConfig {
    return {
      snappId: this.config.snappId,
      userId: this.config.userId,
      tokenProvider: this.config.tokenProvider,
      serverUrl: this.config.serverUrl,
      autoReconnect: this.config.autoReconnect,
      reconnectInterval: this.config.reconnectInterval,
      maxReconnectAttempts: this.config.maxReconnectAttempts
    };
  }

  /**
   * Setup event listeners for connection manager
   */
  private setupEventListeners(): void {
    this.connectionManager.on('statusChange', (status: SnappjackStatus) => {
      this.emit('status', status);
    });

    this.connectionManager.on('message', (message: IncomingMessage) => {
      this.handleMessage(message);
    });

    this.connectionManager.on('error', (error: SnappjackError) => {
      this.emit('connection-error', error);
      this.emit('error', error);
    });

    this.connectionManager.on('open', () => {
      this.sendToolsRegistration();
    });
  }

  /**
   * Validate configuration
   */
  private validateConfig(): void {
    this.logger.log('🔧 Snappjack: Validating config...');
    this.logger.log(`🔧 Snappjack: Using app ID: ${this.config.snappId}`);
    this.logger.log(`🔧 Snappjack: Using server URL: ${this.config.serverUrl}`);
    
    if (!this.config.snappId) {
      throw new Error('App ID is required');
    }
    if (!this.config.serverUrl) {
      throw new Error('Server URL is required');
    }
  }

  /**
   * Initialize tools from config
   */
  private initializeTools(): void {
    if (this.config.tools) {
      this.config.tools.forEach(tool => {
        this.registerTool(tool);
      });
    }
  }

  /**
   * Register a tool that your app exposes to AI agents
   */
  public registerTool(tool: Tool): void {
    this.toolRegistry.register(tool);
    
    // Auto-register tool handler if provided
    if (tool.handler && typeof tool.handler === 'function') {
      this.onToolCall(tool.name, tool.handler);
    }
  }

  /**
   * Connect to Snappjack server
   */
  public async connect(): Promise<void> {
    return this.connectionManager.connect();
  }

  /**
   * Disconnect from Snappjack server
   */
  public async disconnect(): Promise<void> {
    return this.connectionManager.disconnect();
  }

  /**
   * Get current connection status
   */
  public getStatus(): SnappjackStatus {
    return this.connectionManager.getStatus();
  }

  /**
   * Get all registered tools (without handlers)
   */
  public getTools(): ToolDefinition[] {
    return this.toolRegistry.getAll();
  }

  /**
   * Override to maintain compatibility with existing code
   */
  public on(event: string, listener: EventListener): this {
    super.on(event, listener);
    return this;
  }

  /**
   * Send tools registration message to server
   */
  private sendToolsRegistration(): void {
    try {
      const tools = this.getTools();
      this.logger.log(`🛠️ Snappjack: Registering ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`);

      const message: ToolRegistrationMessage = {
        type: 'tools-registration',
        tools: tools
      };

      this.logger.log(`🛠️ Snappjack: Tools registration message: ${JSON.stringify(message)}`);
      this.connectionManager.send(message);
      this.logger.log('✅ Snappjack: Tools registration sent successfully');
    } catch (error) {
      this.logger.error(`❌ Snappjack: Error sending tools registration: ${error instanceof Error ? error.message : String(error)}`);
      this.emit('error', error);
    }
  }

  /**
   * Send initial auth requirement if explicitly specified by user and different from server value
   */
  private sendInitialAuthRequirementIfNeeded(serverCurrentValue: boolean): void {
    try {
      // Only send the auth requirement if the user explicitly specified it in the constructor
      // If not specified, let the server use its existing stored value or default
      if (this.requireAuthHeaderExplicitlySet) {
        // Check if our desired value is different from what the server currently has
        if (this.currentRequireAuthHeader !== serverCurrentValue) {
          this.logger.log(`🔒 Snappjack: Server has auth requirement: ${serverCurrentValue}, user wants: ${this.currentRequireAuthHeader}, sending update`);
          this.connectionManager.send({
            type: 'update-auth-requirement',
            requireAuthHeader: this.currentRequireAuthHeader
          });
        } else {
          this.logger.log(`🔒 Snappjack: Server auth requirement (${serverCurrentValue}) matches user preference (${this.currentRequireAuthHeader}), no update needed`);
        }
      } else {
        this.logger.log(`🔒 Snappjack: Auth requirement not specified by user, using server value: ${serverCurrentValue}`);
      }
    } catch (error) {
      this.logger.error(`❌ Snappjack: Error sending initial auth requirement: ${error instanceof Error ? error.message : String(error)}`);
      // Don't emit error event here as it's not critical - the user can still call updateAuthRequirement later
    }
  }

  /**
   * Handle incoming messages from connection manager
   */
  private handleMessage(message: IncomingMessage): void {
    try {
      this.logger.log(`📨 Snappjack: Handling message: ${JSON.stringify(message)}`);
      
      // Handle different message types
      if ('type' in message) {
        if (message.type === 'connection-info') {
          this.handleConnectionInfo(message);
        } else if (message.type === 'agent-connected') {
          this.handleAgentConnected(message as AgentMessage);
        } else if (message.type === 'agent-disconnected') {
          this.handleAgentDisconnected(message as AgentMessage);
        } else {
          this.logger.log('💬 Snappjack: Handling generic message with type');
          this.emit('message', message);
        }
      } else if (this.isToolCallRequest(message)) {
        this.handleToolCall(message as ToolCallMessage);
      } else {
        this.logger.log('💬 Snappjack: Handling generic message');
        // Emit generic message event
        this.emit('message', message);
      }
    } catch (error) {
      this.logger.warn(`❌ Snappjack: Error handling message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle connection info message
   */
  private handleConnectionInfo(message: any): void {
    this.logger.log(`🔗 Snappjack: Received connection info with userApiKey: ${message.userApiKey ? 'present' : 'missing'}`);

    if (message.userApiKey) {
      // Get the server's current auth requirement value
      const serverAuthRequirement = message.requireAuthHeader ?? true;

      // Check if we need to update the auth requirement based on user preference vs server value
      this.sendInitialAuthRequirementIfNeeded(serverAuthRequirement);

      this.logger.log('🔑 Snappjack: Emitting connection-info-updated event');

      // Build MCP endpoint URL using the configured server URL
      const baseUrl = this.config.serverUrl
        .replace(/^ws:/, 'http:')
        .replace(/^wss:/, 'https:');
      const mcpEndpoint = `${baseUrl}/mcp/${this.config.snappId}/${this.config.userId}`;

      const eventData: ConnectionData = {
        userApiKey: message.userApiKey,
        snappId: this.config.snappId,
        userId: this.config.userId,
        mcpEndpoint: mcpEndpoint,
        requireAuthHeader: serverAuthRequirement
      };

      this.logger.log(`🔑 Snappjack: Event data: ${JSON.stringify(eventData)}`);
      this.emit('connection-info-updated', eventData);
      // Keep backward compatibility
      this.emit('user-api-key-generated', eventData);
    } else {
      this.logger.warn('⚠️ Snappjack: Connection info message missing userApiKey');
    }
  }

  /**
   * Handle agent connected message
   */
  private handleAgentConnected(message: AgentMessage): void {
    this.logger.log(`🤖 Snappjack: Agent connected with session ID: ${message.agentSessionId}`);
    this.currentAgentSessionId = message.agentSessionId;
    this.connectionManager.updateStatus('bridged');
    this.logger.log('📊 Snappjack: Status updated to bridged');
    this.emit('agent-connected', { agentSessionId: message.agentSessionId });
  }

  /**
   * Handle agent disconnected message
   */
  private handleAgentDisconnected(message: AgentMessage): void {
    this.logger.log(`🤖 Snappjack: Agent disconnected with session ID: ${message.agentSessionId}`);
    
    if (this.currentAgentSessionId === message.agentSessionId) {
      this.logger.log('🤖 Snappjack: Current agent disconnected, updating status');
      this.currentAgentSessionId = null;
      this.connectionManager.updateStatus('connected');
      this.logger.log('📊 Snappjack: Status updated to connected');
    } else {
      this.logger.log('🤖 Snappjack: Different agent disconnected, keeping current status');
    }
    
    this.emit('agent-disconnected', { agentSessionId: message.agentSessionId });
  }

  /**
   * Handle tool call message
   */
  private async handleToolCall(message: ToolCallMessage): Promise<void> {
    // Store the agentSessionId for use in responses
    this.lastToolCallAgentSessionId = message.agentSessionId;
    
    const toolName = message.params.name;
    const handler = this.toolRegistry.getHandler(toolName);

    if (!handler || !this.toolRegistry.has(toolName)) {
      // Tool not found - this is a protocol error
      const errorResponse: ErrorResponse = {
        code: -32601,
        message: 'Method not found',
        data: `Tool '${toolName}' not found or no handler registered`
      };
      this.sendToolError(message.id, errorResponse);
      return;
    }

    try {
      // Validate tool arguments against schema
      const validationResult = this.toolRegistry.validate(toolName, message.params.arguments);

      if (!validationResult.isValid) {
        // Validation failed - return tool execution error
        const errorDetails = validationResult.errors?.map(err => {
          const path = err.instancePath || 'root';
          return `${path}: ${err.message}`;
        }).join(', ') || 'Unknown validation error';
        
        const errorResult: ToolResponse = {
          content: [{
            type: 'text',
            text: `Invalid arguments for tool '${toolName}': ${errorDetails}`
          }],
          isError: true
        };
        
        this.logger.warn(`❌ Snappjack: Tool '${toolName}' validation failed: ${errorDetails}`);
        this.sendToolResponse(message.id, errorResult);
        return;
      }
      
      // Call handler with validated (and potentially coerced) arguments
      const result = await handler(message.params.arguments, message);
      
      // Ensure result has proper format
      if (!result || typeof result !== 'object' || !Array.isArray(result.content)) {
        // Invalid result format - return as tool execution error
        const errorResult: ToolResponse = {
          content: [{
            type: 'text',
            text: `Tool handler for '${toolName}' returned invalid result format`
          }],
          isError: true
        };
        this.sendToolResponse(message.id, errorResult);
        return;
      }
      
      this.sendToolResponse(message.id, result);
    } catch (error) {
      // Handler threw an exception - this is a tool execution error
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorResult: ToolResponse = {
        content: [{
          type: 'text',
          text: `Tool execution failed: ${errorMessage}`
        }],
        isError: true
      };
      
      this.logger.warn(`❌ Snappjack: Tool '${toolName}' execution error: ${errorMessage}`);
      this.sendToolResponse(message.id, errorResult);
    }
  }

  /**
   * Check if message is a tool call request
   */
  private isToolCallRequest(message: unknown): message is ToolCallMessage {
    return !!(
      message &&
      typeof message === 'object' &&
      'jsonrpc' in message &&
      'method' in message &&
      'params' in message &&
      'agentSessionId' in message &&
      (message as ToolCallMessage).jsonrpc === '2.0' &&
      (message as ToolCallMessage).method === 'tools/call' &&
      (message as ToolCallMessage).params &&
      (message as ToolCallMessage).params.name &&
      (message as ToolCallMessage).agentSessionId
    );
  }

  /**
   * Send tool response
   */
  private sendToolResponse(requestId: string | number, result: ToolResponse): void {
    try {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: requestId,
        result,
        agentSessionId: this.lastToolCallAgentSessionId
      };

      this.connectionManager.send(response);
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Send tool error
   */
  private sendToolError(requestId: string | number, error: ErrorResponse): void {
    try {
      const errorResponse: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: requestId,
        error,
        agentSessionId: this.lastToolCallAgentSessionId
      };

      this.logger.log(`🚨 Snappjack: Sending protocol error response: ${JSON.stringify(errorResponse, null, 2)}`);
      this.connectionManager.send(errorResponse);
      this.logger.log(`✅ Protocol error response sent successfully`);
    } catch (error) {
      this.logger.error(`❌ Failed to send error response: ${error instanceof Error ? error.message : String(error)}`);
      this.emit('error', error);
    }
  }

  /**
   * Force disconnect the currently connected agent
   * This allows the snapp to terminate an agent session when needed
   */
  public forceDisconnectAgent(): void {
    try {
      this.connectionManager.send({
        type: 'force-disconnect-agent'
      });
      this.logger.log('🔌 Snappjack: Sent force disconnect agent message');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ Snappjack: Failed to force disconnect agent: ${errorMessage}`);
      throw new Error(`Failed to force disconnect agent: ${errorMessage}`);
    }
  }

  /**
   * Update the authentication requirement for this user's MCP endpoint
   * @param requireAuthHeader - Whether to require Bearer token authentication
   * @returns Promise that resolves when the change is confirmed via connection-info-updated event
   */
  public async updateAuthRequirement(requireAuthHeader: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Validate input
        if (typeof requireAuthHeader !== 'boolean') {
          reject(new Error('requireAuthHeader must be a boolean'));
          return;
        }

        // Set up one-time listener for the connection-info-updated event
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for auth requirement update confirmation'));
        }, 10000); // 10 second timeout

        const onConnectionInfoUpdated = (data: ConnectionData) => {
          // Check if this update is for our auth requirement change
          if (data.requireAuthHeader === requireAuthHeader) {
            clearTimeout(timeout);
            this.currentRequireAuthHeader = requireAuthHeader;
            this.off('connection-info-updated', onConnectionInfoUpdated);
            this.logger.log(`🔒 Snappjack: Auth requirement updated to: ${requireAuthHeader}`);
            resolve();
          }
        };

        // Listen for the confirmation event
        this.on('connection-info-updated', onConnectionInfoUpdated);

        // Send the update message
        this.connectionManager.send({
          type: 'update-auth-requirement',
          requireAuthHeader
        });

        this.logger.log(`🔄 Snappjack: Requesting auth requirement change to: ${requireAuthHeader}`);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`❌ Snappjack: Failed to update auth requirement: ${errorMessage}`);
        reject(new Error(`Failed to update auth requirement: ${errorMessage}`));
      }
    });
  }

  /**
   * Utility method for registering tool handlers
   */
  private onToolCall(toolName: string, handler: ToolHandler): void {
    this.toolRegistry.setHandler(toolName, handler);
  }
}

// Export for use in Next.js
export default Snappjack;