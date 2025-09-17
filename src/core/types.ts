/**
 * Snappjack SDK - Type Definitions
 * 
 * Centralized type definitions for the Snappjack SDK client.
 * This file contains all interfaces, types, and enums used throughout the SDK.
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface SnappjackConfig {
  snappId: string;
  userId: string;
  tokenProvider: () => Promise<string>;  // Function to get fresh JWT tokens

  tools?: Tool[];
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  logger?: Logger;
  requireAuthHeader?: boolean;  // Default auth requirement for MCP connections
}

export interface Logger {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

// Internal config type with all required fields
export type InternalConfig = Required<SnappjackConfig> & { 
  serverUrl: string; 
};

// ============================================================================
// Tool Types
// ============================================================================

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

// Type for tool registration without handlers
export type ToolDefinition = Omit<Tool, 'handler'>;

// ============================================================================
// Response Types
// ============================================================================

export interface CallToolResult {
  _meta?: { [key: string]: unknown };
  content: ContentBlock[];
  isError?: boolean;
  structuredContent?: { [key: string]: unknown };
  [key: string]: unknown;
}

export type ToolResponse = CallToolResult;

// ============================================================================
// Content Block Types
// ============================================================================

export type ContentBlock =
  | TextContent
  | ImageContent
  | AudioContent
  | ResourceLink;

export type TextContent = {
  _meta?: { [key: string]: unknown };
  annotations?: Annotations;
  text: string;
  type: "text";
}

export interface ImageContent {
  _meta?: { [key: string]: unknown };
  annotations?: Annotations;
  data: string;
  mimeType: string;
  type: "image";
}

export interface AudioContent {
  _meta?: { [key: string]: unknown };
  annotations?: Annotations;
  data: string;
  mimeType: string;
  type: "audio";
}

export interface ResourceLink {
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

export interface Annotations {
  audience?: Role[];
  lastModified?: string;
  priority?: number;
}

export type Role = "user" | "assistant";

// ============================================================================
// Connection Types
// ============================================================================

export interface ConnectionData {
  userApiKey: string;
  snappId: string;
  userId: string;
  mcpEndpoint: string;
  requireAuthHeader?: boolean;
}

export type SnappjackStatus = 'disconnected' | 'connected' | 'bridged' | 'error';

export interface SnappjackError {
  type: 'auth_failed' | 'server_unreachable' | 'connection_failed' | 'unknown';
  message: string;
  canRetry: boolean;
  canResetCredentials: boolean;
}

export type CredentialValidationResult = 'valid' | 'invalid' | 'unreachable';

// ============================================================================
// Message Types
// ============================================================================

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

export interface ErrorResponse {
  code: number;
  message: string;
  data?: string;
}

export interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number;
  result?: ToolResponse;
  error?: ErrorResponse;
  agentSessionId?: string;
}

export interface ToolRegistrationMessage {
  type: 'tools-registration';
  tools: ToolDefinition[];
}

export interface ForceDisconnectAgentMessage {
  type: 'force-disconnect-agent';
}

export interface UpdateAuthRequirementMessage {
  type: 'update-auth-requirement';
  requireAuthHeader: boolean;
}

export interface AgentMessage {
  type: 'agent-connected' | 'agent-disconnected';
  agentSessionId: string;
}

export interface ConnectionInfoMessage {
  type: 'connection-info';
  userApiKey?: string;
  [key: string]: unknown;
}

// Union type for all WebSocket messages
export type WebSocketMessage = JsonRpcResponse | ToolRegistrationMessage | ForceDisconnectAgentMessage | UpdateAuthRequirementMessage;

// Union type for all incoming messages
export type IncomingMessage = ToolCallMessage | AgentMessage | ConnectionInfoMessage | { type: string; [key: string]: unknown };

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationResult {
  isValid: boolean;
  errors?: Array<{
    instancePath: string;
    message?: string;
  }>;
}

// ============================================================================
// ConnectionManager Types
// ============================================================================

export interface ConnectionConfig {
  snappId: string;
  userId: string;
  tokenProvider: () => Promise<string>;
  serverUrl: string;
  autoReconnect: boolean;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  testMode?: boolean; // For fast test execution - uses 1ms reconnect delays
}