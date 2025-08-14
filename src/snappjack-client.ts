/**
 * Snappjack SDK - TypeScript Version
 * Enable your app for agents. In a snap.
 * 
 * The zero-pain way to enable your app for the AI era, letting users put their 
 * personal assistants to work directly within their live app session.
 */

import { EventEmitter, EventListener } from './event-emitter';
import { createWebSocket, WebSocket, ReadyState } from './websocket-wrapper';

// Types and Interfaces
export interface SnappjackConfig {
  appId: string;
  userId: string;
  apiKey: string;
  serverUrl?: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  tools?: Tool[];
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
  appId: string;
  userId: string;
  mcpEndpoint: string;
}

export type SnappjackStatus = 'disconnected' | 'connected' | 'bridged';

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

// Default Snappjack server URL
const DEFAULT_SERVER_URL = 'https://bridge.snappjack.com';

export class Snappjack extends EventEmitter {
  private config: Required<SnappjackConfig>;
  private ws: WebSocket | null = null;
  private status: SnappjackStatus = 'disconnected';
  private tools: Map<string, Tool> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private currentAgentSessionId: string | null = null;
  private userApiKey: string | null = null;
  private lastToolCallAgentSessionId: string | undefined;
  private logger: Logger;

  constructor(config: SnappjackConfig) {
    super();
    
    // Set defaults - use provided serverUrl or fallback to default
    this.config = {
      ...config,
      serverUrl: config.serverUrl || DEFAULT_SERVER_URL,
      autoReconnect: config.autoReconnect ?? true,
      reconnectInterval: config.reconnectInterval ?? 5000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      tools: config.tools || [],
      logger: config.logger || this.defaultLogger
    };
    
    this.logger = this.config.logger;
    
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

  private validateConfig(): void {
    this.logger.log('🔧 Snappjack: Validating config...');
    this.logger.log(`🔧 Snappjack: Using server URL: ${this.config.serverUrl}`);
    
    if (!this.config.appId) {
      throw new Error('App ID is required');
    }
    if (!this.config.userId) {
      throw new Error('User ID is required');
    }
    if (!this.config.apiKey) {
      throw new Error('API key is required');
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

    // If we don't have a user API key, get one first using webapp API key
    if (!this.userApiKey) {
      this.logger.log('🔑 Snappjack: No user API key, generating one...');
      await this.generateUserApiKey();
      
      // Wait for the key to be generated
      if (!this.userApiKey) {
        throw new Error('Failed to authenticate: User API key generation failed');
      }
      this.logger.log(`🔑 Snappjack: User API key generated: ${this.userApiKey}`);
    } else {
      this.logger.log(`🔑 Snappjack: Using existing user API key: ${this.userApiKey}`);
    }

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
          this.logger.error(`❌ Snappjack: WebSocket error: ${event}`);
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
    
    // Use user API key if available, otherwise fall back to webapp API key
    const apiKey = this.userApiKey || this.config.apiKey;
    this.logger.log(`🏗️ Snappjack: Using API key: ${apiKey ? apiKey.substring(0, 8) + '...' : 'none'} (${this.userApiKey ? 'user' : 'webapp'} key)`);
    
    const wsUrl = `${baseUrl}/ws/${this.config.appId}/${this.config.userId}?apiKey=${apiKey}`;
    this.logger.log(`🏗️ Snappjack: Final WebSocket URL: ${wsUrl}`);
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
    
    // Emit user API key event if we have one
    if (this.userApiKey) {
      this.logger.log('🔑 Snappjack: Emitting user-api-key-generated event');
      // Build MCP endpoint URL using the configured server URL
      const baseUrl = this.config.serverUrl
        .replace(/^ws:/, 'http:')
        .replace(/^wss:/, 'https:');
      const mcpEndpoint = `${baseUrl}/mcp/${this.config.appId}/${this.config.userId}`;
      
      const eventData: ConnectionData = {
        userApiKey: this.userApiKey,
        appId: this.config.appId,
        userId: this.config.userId,
        mcpEndpoint: mcpEndpoint
      };
      this.logger.log(`🔑 Snappjack: Event data: ${JSON.stringify(eventData)}`);
      this.emit('user-api-key-generated', eventData);
    } else {
      this.logger.log('⚠️ Snappjack: No user API key available for event');
    }
    this.logger.log('✅ Snappjack: Connection handling complete');
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
      if (message.type === 'agent-connected') {
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

  private handleClose(code: number): void {
    this.ws = null;
    this.currentAgentSessionId = null;
    this.updateStatus('disconnected');

    // Attempt reconnection if enabled
    if (this.config.autoReconnect && this.shouldReconnect(code)) {
      this.scheduleReconnect();
    }
  }

  private handleError(error: Event): void {
    this.emit('error', error);
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

  private async handleToolCall(message: ToolCallMessage): Promise<void> {
    // Store the agentSessionId for use in responses
    this.lastToolCallAgentSessionId = message.agentSessionId;
    
    // Find and call the registered tool handler directly
    const toolName = message.params.name;
    const tool = this.tools.get(toolName);

    if (tool && tool.handler) {
      try {
        const result = await tool.handler(message.params.arguments, message);
        this.sendToolResponse(message.id, result);
      } catch (error) {
        const errorResponse: ErrorResponse = {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal error",
          data: error instanceof Error ? error.message : String(error)
        };
        this.sendToolError(message.id, errorResponse);
      }
    } else {
      // Tool not found or no handler
      const errorResponse: ErrorResponse = {
        code: -32601,
        message: 'Method not found',
        data: `Tool '${toolName}' not found or no handler registered`
      };
      this.sendToolError(message.id, errorResponse);
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
      this.ws.send(JSON.stringify(message));
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

      this.sendMessage(errorResponse);
    } catch (error) {
      this.emit('error', error);
    }
  }

  // Private method to generate user API key for agent connections
  private async generateUserApiKey(): Promise<void> {
    try {
      this.logger.log('🔑 Snappjack: Starting user API key generation...');
      let httpUrl = this.config.serverUrl;
      this.logger.log(`🔑 Snappjack: Original URL: ${httpUrl}`);
      
      if (httpUrl.startsWith('ws://')) {
        httpUrl = httpUrl.replace('ws://', 'http://');
        this.logger.log(`🔑 Snappjack: Converted to HTTP: ${httpUrl}`);
      } else if (httpUrl.startsWith('wss://')) {
        httpUrl = httpUrl.replace('wss://', 'https://');
        this.logger.log(`🔑 Snappjack: Converted to HTTPS: ${httpUrl}`);
      }
      
      // Build API endpoint URL
      const apiUrl = `${httpUrl}/api/user-key/${this.config.appId}/${this.config.userId}`;
      this.logger.log(`🔑 Snappjack: API URL: ${apiUrl}`);
      this.logger.log(`🔑 Snappjack: Using webapp API key: ${this.config.apiKey}`);
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      this.logger.log(`🔑 Snappjack: API response status: ${response.status}`);
      
      if (!response.ok) {
        const responseText = await response.text();
        this.logger.error(`🔑 Snappjack: API error response: ${responseText}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${responseText}`);
      }
      
      const data = await response.json();
      this.logger.log(`🔑 Snappjack: API response data: ${JSON.stringify(data)}`);
      this.userApiKey = (data as any).userApiKey;
      this.logger.log(`🔑 Snappjack: User API key stored: ${this.userApiKey}`);
      
      // Emit event with connection data
      this.emit('user-api-key-generated', data);
    } catch (error) {
      this.logger.error(`❌ Snappjack: Failed to generate user API key: ${error instanceof Error ? error.message : String(error)}`);
      this.emit('error', new Error('Failed to generate user API key: ' + (error as Error).message));
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