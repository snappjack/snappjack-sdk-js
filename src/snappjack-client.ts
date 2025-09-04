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

import { EventEmitter, EventListener } from './event-emitter';
import { createWebSocket, WebSocket, ReadyState } from './websocket-wrapper';
import { DEFAULT_SNAPPJACK_SERVER_URL } from './constants';
import Ajv, { ValidateFunction } from 'ajv';

// Types and Interfaces
export interface SnappjackConfig {
  snappId: string;
  userId: string;
  ephemeralToken: string;  // Required: JWT token for WebSocket authentication
  
  tools?: Tool[];
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  logger?: Logger;
}

export interface Logger {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export type Tool = {
  _meta?: { [key: string]: unknown };
  annotations?: {
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    readOnlyHint?: boolean;
    title?: string;
  };
  description?: string;
  inputSchema: {
    properties?: { [key: string]: object };
    required?: string[];
    type: "object";
  };
  name: string;
  outputSchema?: {
    properties?: { [key: string]: object };
    required?: string[];
    type: "object";
  };
  title?: string;
} & {
  handler?: ToolHandler;
};

export type ToolHandler = (args: unknown, message?: ToolCallMessage) => Promise<ToolResponse>;

interface CallToolResult {
  _meta?: { [key: string]: unknown };
  content: ContentBlock[];
  isError?: boolean;
  structuredContent?: { [key: string]: unknown };
  [key: string]: unknown;
}

type ContentBlock =
  | TextContent
  | ImageContent
  | AudioContent
  | ResourceLink
  // | EmbeddedResource


  type TextContent = {
    _meta?: { [key: string]: unknown };
    annotations?: Annotations;
    text: string;
    type: "text";
  }

  interface ImageContent {
    _meta?: { [key: string]: unknown };
    annotations?: Annotations;
    data: string;
    mimeType: string;
    type: "image";
  }

  interface AudioContent {
    _meta?: { [key: string]: unknown };
    annotations?: Annotations;
    data: string;
    mimeType: string;
    type: "audio";
  }

  interface ResourceLink {
    _meta?: { [key: string]: unknown };
    annotations?: Annotations;
    description?: string;
    mimeType?: string;
    name: string;
    size?: number;
    title?: string;
    type: "resource_link";
    uri: string;
  }

  interface Annotations {
    audience?: Role[];
    lastModified?: string;
    priority?: number;
  }

  type Role = "user" | "assistant"

export type ToolResponse = CallToolResult;
export interface ConnectionData {
  userApiKey: string;
  snappId: string;
  userId: string;
  mcpEndpoint: string;
}

export type SnappjackStatus = 'disconnected' | 'connected' | 'bridged' | 'error';

export interface SnappjackError {
  type: 'auth_failed' | 'server_unreachable' | 'connection_failed' | 'unknown';
  message: string;
  canRetry: boolean;
  canResetCredentials: boolean;
}

type CredentialValidationResult = 'valid' | 'invalid' | 'unreachable';

export interface ToolCallMessage {
  jsonrpc: '2.0';
  id: string | number;
  method: 'tools/call';
  params: {
    name: string;
    arguments: unknown;
  };
  agentSessionId: string;
}

// Type for tool registration without handlers
export type ToolDefinition = Omit<Tool, 'handler'>;

// Type for error responses
export interface ErrorResponse {
  code: number;
  message: string;
  data?: string;
}

// Type for JSON-RPC response messages
export interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number;
  result?: ToolResponse;
  error?: ErrorResponse;
  agentSessionId?: string;
}

// Type for tool registration messages
export interface ToolRegistrationMessage {
  type: 'tools-registration';
  tools: ToolDefinition[];
}

// Type for agent connection messages
export interface AgentMessage {
  type: 'agent-connected' | 'agent-disconnected';
  agentSessionId: string;
}

// Union type for all WebSocket messages
export type WebSocketMessage = JsonRpcResponse | ToolRegistrationMessage;

// Union type for all incoming messages
export type IncomingMessage = ToolCallMessage | AgentMessage | { type: string; [key: string]: unknown };



// Internal config type
type InternalConfig = Required<SnappjackConfig> & { 
  serverUrl: string; 
};

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
 *   ephemeralToken: 'jwt-token-from-your-server',
 *   tools: [...]
 * });
 * ```
 * 
 * **Alternative: Direct userApiKey authentication:**
 * ```typescript
 * const client = new Snappjack({
 *   snappId: 'your-snapp-id',
 *   userId: 'user-123',
 *   userApiKey: 'uak_...', 
 *   tools: [...]
 * });
 * ```
 * Use when you have a persistent userApiKey (less secure than ephemeral tokens).
 */
export class Snappjack extends EventEmitter {
  private config: InternalConfig;
  private ws: WebSocket | null = null;
  private status: SnappjackStatus = 'disconnected';
  private tools: Map<string, Tool> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private currentAgentSessionId: string | null = null;
  private lastToolCallAgentSessionId: string | undefined;
  private receivedUserApiKey: string | null = null;
  private logger: Logger;
  private ajv: Ajv;
  private validators: Map<string, ValidateFunction> = new Map();

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

    // Get server URL from environment or use default
    const serverUrl = (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_SNAPPJACK_SERVER_URL) 
      ? process.env.NEXT_PUBLIC_SNAPPJACK_SERVER_URL 
      : DEFAULT_SNAPPJACK_SERVER_URL;

    // Define all defaults in one place.
    const defaultConfig = {
      serverUrl: serverUrl,
      autoReconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      tools: [],
      logger: this.defaultLogger,
    };

    // Create a clean config object by removing any keys with an `undefined` value from the user's input.
    const definedUserConfig = Object.fromEntries(
      Object.entries(config).filter(([_, value]) => value !== undefined)
    ) as SnappjackConfig;

    // Merge the cleaned user config over the defaults.
    this.config = {
      ...defaultConfig,
      ...definedUserConfig,
    };

    // Validate required fields from the final, merged config.
    if (!this.config.snappId) {
      throw new Error('App ID is required');
    }

    // Validate authentication configuration: ephemeralToken is required
    if (!this.config.ephemeralToken) {
      throw new Error('ephemeralToken is required for WebSocket authentication');
    }

    // Perform any necessary transformations on the final config values.
    // we expect the server url to be http or https so validate it first
    if (!this.config.serverUrl.match(/^https?:\/\//)) {
      throw new Error('Server URL must start with http:// or https://');
    }
    this.config.serverUrl = this.config.serverUrl.replace(/^http/, 'ws');

    this.logger = this.config.logger;
    
    this.ajv = new Ajv({
      coerceTypes: true,
      useDefaults: true,
      allErrors: true,
      strict: false,
    });

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
   * Recursively enforce strict schema validation by adding additionalProperties: false
   */
  private enforceStrictSchema(schema: any): any {
    if (typeof schema !== 'object' || schema === null) {
      return schema;
    }

    const strictSchema = { ...schema };

    // Add additionalProperties: false to object schemas
    if (strictSchema.type === 'object' && strictSchema.properties) {
      strictSchema.additionalProperties = false;
      
      // Recursively enforce on nested properties
      const strictProperties: any = {};
      for (const [key, prop] of Object.entries(strictSchema.properties)) {
        strictProperties[key] = this.enforceStrictSchema(prop);
      }
      strictSchema.properties = strictProperties;
    }

    // Handle array items
    if (strictSchema.type === 'array' && strictSchema.items) {
      strictSchema.items = this.enforceStrictSchema(strictSchema.items);
    }

    return strictSchema;
  }

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
    // Store both the tool definition and handler
    this.tools.set(tool.name, {
      ...tool,
      handler: tool.handler || undefined
    });
    
    // Compile and cache validator for the tool's input schema
    try {
      // Enforce strict validation by recursively adding additionalProperties: false
      const strictSchema = this.enforceStrictSchema(tool.inputSchema);
      
      this.logger.log(`🔧 Compiling validator for tool '${tool.name}' with strict schema: ${JSON.stringify(strictSchema, null, 2)}`);
      const validator = this.ajv.compile(strictSchema);
      this.validators.set(tool.name, validator);
      this.logger.log(`✅ Snappjack: Compiled validator for tool '${tool.name}'`);
      
      // Test the validator with a simple invalid case to ensure it's working
      const testResult = validator({ invalidTest: 'should fail' });
      this.logger.log(`🧪 Validator test: ${testResult ? 'PASSED' : 'FAILED'} (expected: FAILED)`);
    } catch (error) {
      this.logger.warn(`⚠️ Snappjack: Failed to compile validator for tool '${tool.name}': ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Auto-register tool handler if provided
    if (tool.handler && typeof tool.handler === 'function') {
      this.onToolCall(tool.name, tool.handler);
    }
  }


  public async connect(): Promise<void> {
    this.logger.log('🔌 Snappjack: Starting connection...');
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      this.logger.log('🔌 Snappjack: Already connected, returning early');
      return;
    }

    // Use provided ephemeral token
    this.logger.log('🔐 Snappjack: Using provided ephemeral token for WebSocket authentication');
    
    this.logger.log(`🔑 Snappjack: Using user ID: ${this.config.userId}`);

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.buildWebSocketUrl();
        this.logger.log(`🔗 Snappjack: Connecting to WebSocket URL: ${wsUrl}`);
        this.ws = createWebSocket(wsUrl);

        const connectTimeout = setTimeout(() => {
          if (this.ws) {
            this.ws.close();
          }
          reject(new Error('Connection timeout'));
        }, 10000);

        this.ws.onopen = async () => {
          this.logger.log('✅ Snappjack: WebSocket connection opened');
          clearTimeout(connectTimeout);
          await this.handleOpen();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.logger.log(`📨 Snappjack: Received message: ${event.data}`);
          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          this.logger.log(`❌ Snappjack: WebSocket closed - Code: ${event.code}, Reason: ${event.reason}`);
          clearTimeout(connectTimeout);
          this.handleClose(event.code);
        };

        this.ws.onerror = (event) => {
          if(event.message) {
            this.logger.error(`❌ Snappjack: WebSocket error: ${event.message}`);
          } else {
            this.logger.error(`❌ Snappjack: WebSocket error: ${event}`);
          }
          clearTimeout(connectTimeout);
          this.handleError(event);
          reject(event);
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  public async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    
    if (this.ws) {
      return new Promise((resolve) => {
        if (this.ws!.readyState === ReadyState.OPEN) {
          this.ws!.onclose = () => resolve();
          this.ws!.close(1000, 'Client disconnect');
        } else {
          resolve();
        }
      });
    }
  }

  private buildWebSocketUrl(): string {
    this.logger.log('🏗️ Snappjack: Building WebSocket URL...');
    let baseUrl = this.config.serverUrl;
    this.logger.log(`🏗️ Snappjack: Original server URL: ${baseUrl}`);
    
    if (baseUrl.startsWith('http://')) {
      baseUrl = baseUrl.replace('http://', 'ws://');
      this.logger.log(`🏗️ Snappjack: Converted http to ws: ${baseUrl}`);
    } else if (baseUrl.startsWith('https://')) {
      baseUrl = baseUrl.replace('https://', 'wss://');
      this.logger.log(`🏗️ Snappjack: Converted https to wss: ${baseUrl}`);
    }
    
    // Ensure the URL ends without trailing slash for proper path construction
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
      this.logger.log(`🏗️ Snappjack: Removed trailing slash: ${baseUrl}`);
    }
    
    // Use provided ephemeral JWT token for WebSocket authentication
    const authToken = this.config.ephemeralToken;
    this.logger.log(`🏗️ Snappjack: Using provided ephemeral JWT token`);
    
    const wsUrl = `${baseUrl}/ws/${this.config.snappId}/${this.config.userId}?token=${authToken}`;
    this.logger.log(`🏗️ Snappjack: Final WebSocket URL: ${wsUrl.replace(authToken, '[REDACTED]')}`);
    return wsUrl;
  }

  private async handleOpen(): Promise<void> {
    this.logger.log('🚀 Snappjack: Handling connection open...');
    this.reconnectAttempts = 0;
    this.updateStatus('connected');
    this.logger.log('📊 Snappjack: Status updated to connected');
    
    // Send tools registration message to Snappjack
    this.logger.log('🛠️ Snappjack: Sending tools registration...');
    this.sendToolsRegistration();
    
    this.logger.log('✅ Snappjack: Connection handling complete');
    this.logger.log('⏳ Snappjack: Waiting for connection info message from server...');
  }

  private sendToolsRegistration(): void {
    try {
      const tools = this.getTools();
      this.logger.log(`🛠️ Snappjack: Registering ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`);
      const message: ToolRegistrationMessage = {
        type: 'tools-registration',
        tools: tools
      };
      this.logger.log(`🛠️ Snappjack: Tools registration message: ${JSON.stringify(message)}`);
      this.sendMessage(message);
      this.logger.log('✅ Snappjack: Tools registration sent successfully');
    } catch (error) {
      this.logger.error(`❌ Snappjack: Error sending tools registration: ${error instanceof Error ? error.message : String(error)}`);
      this.emit('error', error);
    }
  }

  private handleMessage(data: string): void {
    try {
      this.logger.log(`📨 Snappjack: Parsing message: ${data}`);
      const message = JSON.parse(data);
      this.logger.log(`📨 Snappjack: Parsed message: ${JSON.stringify(message)}`);
      
      // Handle router messages
      if (message.type === 'connection-info') {
        this.logger.log('🔗 Snappjack: Handling connection-info message');
        this.handleConnectionInfo(message);
      } else if (message.type === 'agent-connected') {
        this.logger.log('🤖 Snappjack: Handling agent-connected message');
        this.handleAgentConnected(message);
      } else if (message.type === 'agent-disconnected') {
        this.logger.log('🤖 Snappjack: Handling agent-disconnected message');
        this.handleAgentDisconnected(message);
      } else if (this.isToolCallRequest(message)) {
        this.logger.log('🔧 Snappjack: Handling tool call request');
        this.handleToolCall(message as ToolCallMessage);
      } else {
        this.logger.log('💬 Snappjack: Handling generic message');
        // Emit generic message event
        this.emit('message', message);
      }
    } catch (error) {
      this.logger.warn(`❌ Snappjack: Received invalid JSON message: ${error instanceof Error ? error.message : String(error)} Raw data: ${data}`);
    }
  }

  private async handleClose(code: number, reason?: string): Promise<void> {
    this.ws = null;
    this.currentAgentSessionId = null;
    
    // For ambiguous codes like 1006, use credential validation to determine the real cause
    let error: SnappjackError;
    if (code === 1006 && this.config.userId && this.receivedUserApiKey) {
      // 1006 is ambiguous - could be auth failure or connection issue
      const validationResult = await this.validateCredentials();
      
      switch (validationResult) {
        case 'invalid':
          error = {
            type: 'auth_failed',
            message: 'Authentication failed - invalid credentials',
            canRetry: false,
            canResetCredentials: true
          };
          break;
        case 'valid':
          // Credentials are valid but WebSocket failed - likely a server issue
          error = {
            type: 'connection_failed',
            message: 'WebSocket connection failed despite valid credentials',
            canRetry: true,
            canResetCredentials: false
          };
          break;
        case 'unreachable':
          error = {
            type: 'server_unreachable',
            message: 'Cannot connect to server - please check your network connection and server URL',
            canRetry: true,
            canResetCredentials: false
          };
          break;
      }
    } else {
      // Use traditional close code classification for other codes
      error = this.classifyConnectionError(code, reason || '');
    }
    
    if (error.type === 'auth_failed') {
      this.updateStatus('error');
      this.emit('connection-error', error);
      // Don't auto-reconnect on auth failure
      return;
    } else {
      this.updateStatus('disconnected');
    }

    // Attempt reconnection if enabled and error allows retry
    if (this.config.autoReconnect && error.canRetry && this.shouldReconnect(code)) {
      this.scheduleReconnect();
    } else if (!error.canRetry) {
      this.emit('connection-error', error);
    }
  }

  private async handleError(error: Event): Promise<void> {
    // When WebSocket connection fails, check if it's due to invalid credentials
    const connectionError = await this.classifyWebSocketError();
    
    this.updateStatus('error');
    this.emit('connection-error', connectionError);
    this.emit('error', error);
  }

  private async classifyWebSocketError(): Promise<SnappjackError> {
    // If we have credentials, validate them to determine the error type
    if (this.config.userId && this.receivedUserApiKey) {
      const validationResult = await this.validateCredentials();
      
      switch (validationResult) {
        case 'invalid':
          return {
            type: 'auth_failed',
            message: 'Authentication failed - invalid credentials',
            canRetry: false,
            canResetCredentials: true
          };
        case 'valid':
          // Credentials are valid but WebSocket won't connect - likely a server/WebSocket issue
          return {
            type: 'connection_failed',
            message: 'WebSocket connection failed despite valid credentials',
            canRetry: true,
            canResetCredentials: false
          };
        case 'unreachable':
          return {
            type: 'server_unreachable',
            message: 'Cannot connect to server - please check your network connection and server URL',
            canRetry: true,
            canResetCredentials: false
          };
      }
    }
    
    // Default to connection issue if validation fails or credentials are missing
    return {
      type: 'connection_failed',
      message: 'Failed to establish WebSocket connection',
      canRetry: true,
      canResetCredentials: false
    };
  }

  private async validateCredentials(): Promise<CredentialValidationResult> {
    try {
      const serverUrl = this.config.serverUrl
        .replace(/^ws:/, 'http:')
        .replace(/^wss:/, 'https:');
      
      const response = await fetch(`${serverUrl}/api/validate-credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userApiKey: this.receivedUserApiKey,
          snappId: this.config.snappId,
          userId: this.config.userId
        })
      });

      if (!response.ok) {
        // Server responded but credentials are invalid
        return 'invalid';
      }

      const result = await response.json();
      return result.valid === true ? 'valid' : 'invalid';
    } catch (error) {
      // Network error - server is unreachable
      this.logger.warn(`Cannot reach server to validate credentials: ${error}`);
      return 'unreachable';
    }
  }

  private classifyConnectionError(code: number, reason: string): SnappjackError {
    // WebSocket close codes: https://tools.ietf.org/html/rfc6455#section-7.4.1
    switch (code) {
      case 1000: // Normal closure
        return {
          type: 'connection_failed',
          message: 'Connection closed normally',
          canRetry: true,
          canResetCredentials: false
        };
      
      case 1002: // Protocol error
      case 1008: // Policy violation (often auth-related)
        return {
          type: 'auth_failed',
          message: 'Authentication failed - invalid credentials',
          canRetry: false,
          canResetCredentials: true
        };
      
      case 1006: // Abnormal closure (no close frame)
        // This is handled by credential validation in handleClose, 
        // but include fallback for when not using validation
        return {
          type: 'server_unreachable',
          message: 'Connection lost - server may be unreachable',
          canRetry: true,
          canResetCredentials: false
        };
      
      case 1011: // Server error
        return {
          type: 'connection_failed',
          message: 'Server encountered an error',
          canRetry: true,
          canResetCredentials: false
        };
      
      default:
        // Check reason string for more context
        if (reason.toLowerCase().includes('auth') || reason.toLowerCase().includes('unauthorized')) {
          return {
            type: 'auth_failed',
            message: `Authentication failed: ${reason}`,
            canRetry: false,
            canResetCredentials: true
          };
        }
        
        return {
          type: 'unknown',
          message: `Connection failed (code: ${code}${reason ? `, reason: ${reason}` : ''})`,
          canRetry: true,
          canResetCredentials: false
        };
    }
  }

  private handleAgentConnected(message: AgentMessage): void {
    this.logger.log(`🤖 Snappjack: Agent connected with session ID: ${message.agentSessionId}`);
    this.currentAgentSessionId = message.agentSessionId;
    this.updateStatus('bridged');
    this.logger.log('📊 Snappjack: Status updated to bridged');
    this.emit('agent-connected', { agentSessionId: message.agentSessionId });
  }

  private handleAgentDisconnected(message: AgentMessage): void {
    this.logger.log(`🤖 Snappjack: Agent disconnected with session ID: ${message.agentSessionId}`);
    if (this.currentAgentSessionId === message.agentSessionId) {
      this.logger.log('🤖 Snappjack: Current agent disconnected, updating status');
      this.currentAgentSessionId = null;
      this.updateStatus('connected');
      this.logger.log('📊 Snappjack: Status updated to connected');
    } else {
      this.logger.log('🤖 Snappjack: Different agent disconnected, keeping current status');
    }
    this.emit('agent-disconnected', { agentSessionId: message.agentSessionId });
  }

  private handleConnectionInfo(message: any): void {
    this.logger.log(`🔗 Snappjack: Received connection info with userApiKey: ${message.userApiKey ? 'present' : 'missing'}`);
    
    if (message.userApiKey) {
      this.receivedUserApiKey = message.userApiKey;
      this.logger.log('🔑 Snappjack: Emitting user-api-key-generated event');
      
      // Build MCP endpoint URL using the configured server URL
      const baseUrl = this.config.serverUrl
        .replace(/^ws:/, 'http:')
        .replace(/^wss:/, 'https:');
      const mcpEndpoint = `${baseUrl}/mcp/${this.config.snappId}/${this.config.userId}`;
      
      const eventData: ConnectionData = {
        userApiKey: this.receivedUserApiKey!,
        snappId: this.config.snappId,
        userId: this.config.userId,
        mcpEndpoint: mcpEndpoint
      };
      
      this.logger.log(`🔑 Snappjack: Event data: ${JSON.stringify(eventData)}`);
      this.emit('user-api-key-generated', eventData);
    } else {
      this.logger.warn('⚠️ Snappjack: Connection info message missing userApiKey');
    }
  }

  private async handleToolCall(message: ToolCallMessage): Promise<void> {
    // Store the agentSessionId for use in responses
    this.lastToolCallAgentSessionId = message.agentSessionId;
    
    // Find and call the registered tool handler directly
    const toolName = message.params.name;
    const tool = this.tools.get(toolName);

    if (!tool || !tool.handler) {
      // Tool not found - this is a protocol error
      const errorResponse: ErrorResponse = {
        code: -32601,
        message: 'Method not found',
        data: `Tool '${toolName}' not found or no handler registered`
      };
      this.sendToolError(message.id, errorResponse);
      return;
    }

    this.logger.log(`tool: ${JSON.stringify(tool)}`);
    this.logger.log(`message.params.arguments: ${JSON.stringify(message.params.arguments)}`);

    try {
      // Validate tool arguments against schema before calling handler
      const validator = this.validators.get(toolName);
      this.logger.log(`validator: ${typeof validator}`);

      if (validator) {
        this.logger.log(`🔍 BEFORE validation - arguments: ${JSON.stringify(message.params.arguments, null, 2)}`);
        this.logger.log(`🔍 Input schema: ${JSON.stringify(tool.inputSchema, null, 2)}`);
        
        const isValid = validator(message.params.arguments);
        
        this.logger.log(`🔍 AFTER validation - isValid: ${isValid}`);
        this.logger.log(`🔍 AFTER validation - arguments (potentially coerced): ${JSON.stringify(message.params.arguments, null, 2)}`);
        this.logger.log(`🔍 Validation errors: ${JSON.stringify(validator.errors, null, 2)}`);

        if (!isValid) {
          // Validation failed - this is a tool execution error, not a protocol error
          const validationErrors = validator.errors || [];
          const errorDetails = validationErrors.map(err => {
            const path = err.instancePath || 'root';
            return `${path}: ${err.message}`;
          }).join(', ');
          
          // Return tool execution error with isError flag
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
        
        this.logger.log(`✅ Snappjack: Tool '${toolName}' arguments validated successfully`);
      } else {
        this.logger.warn(`⚠️ Snappjack: No validator found for tool '${toolName}', proceeding without validation`);
      }
      
      // Call handler with validated (and potentially coerced) arguments
      const result = await tool.handler(message.params.arguments, message);
      
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
      // Handler threw an exception - this is a tool execution error, not a protocol error
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

  private updateStatus(newStatus: SnappjackStatus): void {
    if (this.status !== newStatus) {
      this.logger.log(`📊 Snappjack: Status change: ${this.status} → ${newStatus}`);
      this.status = newStatus;
      this.emit('status', newStatus);
      this.logger.log(`📊 Snappjack: Status event emitted: ${newStatus}`);
    } else {
      this.logger.log(`📊 Snappjack: Status unchanged: ${newStatus}`);
    }
  }

  private shouldReconnect(closeCode: number): boolean {
    // Don't reconnect on normal closure or policy violations
    return closeCode !== 1000 && closeCode !== 1008 && 
           this.reconnectAttempts < this.config.maxReconnectAttempts;
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(() => {
        // Reconnection failed, will be handled by handleError
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private sendMessage(message: WebSocketMessage): void {
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      const messageStr = JSON.stringify(message);
      this.logger.log(`📤 Sending WebSocket message: ${messageStr}`);
      this.ws.send(messageStr);
    } else {
      throw new Error('WebSocket is not connected');
    }
  }

  // Override to maintain compatibility with existing code
  public on(event: string, listener: EventListener): this {
    super.on(event, listener);
    return this;
  }

  // Public API methods
  public getTools(): ToolDefinition[] {
    // Return tool definitions without handlers for registration
    return Array.from(this.tools.values()).map(tool => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { handler, ...toolDef } = tool;
      return toolDef;
    });
  }

  public getStatus(): SnappjackStatus {
    return this.status;
  }


  private sendToolResponse(requestId: string | number, result: ToolResponse): void {
    try {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: requestId,
        result,
        agentSessionId: this.lastToolCallAgentSessionId
      };

      this.sendMessage(response);
    } catch (error) {
      this.emit('error', error);
    }
  }

  private sendToolError(requestId: string | number, error: ErrorResponse): void {
    try {
      const errorResponse: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: requestId,
        error,
        agentSessionId: this.lastToolCallAgentSessionId
      };

      this.logger.log(`🚨 Sending protocol error response: ${JSON.stringify(errorResponse, null, 2)}`);
      this.sendMessage(errorResponse);
      this.logger.log(`✅ Protocol error response sent successfully`);
    } catch (error) {
      this.logger.error(`❌ Failed to send error response: ${error instanceof Error ? error.message : String(error)}`);
      this.emit('error', error);
    }
  }

  
  // Utility method for registering tool handlers
  private onToolCall(toolName: string, handler: ToolHandler): void {
    // Get existing tool or create a basic one
    const existingTool = this.tools.get(toolName);
    if (existingTool) {
      // Update existing tool with handler
      existingTool.handler = handler;
    } else {
      // Create a basic tool definition (this is mainly for backward compatibility)
      this.tools.set(toolName, {
        name: toolName,
        description: `Handler for ${toolName}`,
        inputSchema: { type: 'object' },
        handler: handler
      });
    }
  }
}

// Export for use in Next.js
export default Snappjack;