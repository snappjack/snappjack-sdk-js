/**
 * Snappjack SDK - Connection Manager
 * 
 * Manages WebSocket connection lifecycle, reconnection logic,
 * and low-level connection state.
 */

import { EventEmitter } from '../core/event-emitter';
import { createWebSocket, WebSocket, ReadyState } from '../core/websocket-wrapper';
import {
  ConnectionConfig,
  SnappjackStatus,
  SnappjackError,
  Logger,
  CredentialValidationResult,
  WebSocketMessage
} from '../core/types';

export class ConnectionManager extends EventEmitter {
  private config: ConnectionConfig;
  private logger: Logger;
  private ws: WebSocket | null = null;
  private status: SnappjackStatus = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private receivedUserApiKey: string | null = null;

  constructor(config: ConnectionConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger;
  }

  /**
   * Establish WebSocket connection
   */
  async connect(): Promise<void> {
    this.logger.log('🔌 ConnectionManager: Starting connection...');
    
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      this.logger.log('🔌 ConnectionManager: Already connected, returning early');
      return;
    }

    try {
      // Fetch fresh token before connecting
      this.logger.log('🔑 ConnectionManager: Fetching fresh token...');
      const freshToken = await this.config.tokenProvider();
      this.logger.log('🔑 ConnectionManager: Token obtained successfully');
      
      const wsUrl = this.buildWebSocketUrl(freshToken);
      this.logger.log(`🔗 ConnectionManager: Connecting to WebSocket URL: ${wsUrl.replace(freshToken, '[REDACTED]')}`);
      
      return new Promise((resolve, reject) => {
        this.ws = createWebSocket(wsUrl);
        this.logger.log('✅ WebSocket created successfully');

        const connectTimeout = setTimeout(() => {
          if (this.ws) {
            this.ws.close();
          }
          reject(new Error('Connection timeout'));
        }, 10000);

        this.ws.onopen = () => {
          this.logger.log('✅ ConnectionManager: WebSocket connection opened');
          clearTimeout(connectTimeout);
          this.reconnectAttempts = 0;
          this.updateStatus('connected');
          this.emit('open');
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.logger.log(`📨 ConnectionManager: Received message: ${event.data}`);
          try {
            const message = JSON.parse(event.data);
            
            // Special handling for connection-info messages
            if (message.type === 'connection-info' && message.userApiKey) {
              this.receivedUserApiKey = message.userApiKey;
            }
            
            this.emit('message', message);
          } catch (error) {
            this.logger.warn(`❌ ConnectionManager: Failed to parse message: ${error}`);
          }
        };

        this.ws.onclose = async (event) => {
          this.logger.log(`❌ ConnectionManager: WebSocket closed - Code: ${event.code}, Reason: ${event.reason}`);
          clearTimeout(connectTimeout);
          await this.handleClose(event.code, event.reason);
        };

        this.ws.onerror = (event) => {
          if (event.message) {
            this.logger.error(`❌ ConnectionManager: WebSocket error: ${event.message}`);
          } else {
            this.logger.error(`❌ ConnectionManager: WebSocket error: ${event}`);
          }
          clearTimeout(connectTimeout);
          this.handleError(event);
          reject(event);
        };
      });
    } catch (error) {
      this.logger.error(`❌ ConnectionManager: Failed to connect: ${error}`);
      
      // If this is an initial connection attempt (not from reconnection), 
      // and auto-reconnect is enabled, schedule reconnection
      if (this.config.autoReconnect && this.reconnectAttempts === 0) {
        this.logger.log('🔄 ConnectionManager: Initial connection failed, scheduling reconnection');
        this.scheduleReconnect();
      }
      
      throw error;
    }
  }

  /**
   * Close WebSocket connection
   */
  async disconnect(): Promise<void> {
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

  /**
   * Send message through WebSocket
   */
  send(message: WebSocketMessage): void {
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      const messageStr = JSON.stringify(message);
      this.logger.log(`📤 ConnectionManager: Sending message: ${messageStr}`);
      this.ws.send(messageStr);
    } else {
      throw new Error('WebSocket is not connected');
    }
  }

  /**
   * Get current connection status
   */
  getStatus(): SnappjackStatus {
    return this.status;
  }

  /**
   * Update connection status for external status changes (like 'bridged')
   */
  updateStatus(newStatus: SnappjackStatus): void {
    if (this.status !== newStatus) {
      this.logger.log(`📊 ConnectionManager: Status change: ${this.status} → ${newStatus}`);
      this.status = newStatus;
      this.emit('statusChange', newStatus);
    }
  }

  /**
   * Build WebSocket URL with authentication
   */
  private buildWebSocketUrl(token: string): string {
    this.logger.log('🏗️ ConnectionManager: Building WebSocket URL...');
    let baseUrl = this.config.serverUrl;
    
    if (baseUrl.startsWith('http://')) {
      baseUrl = baseUrl.replace('http://', 'ws://');
    } else if (baseUrl.startsWith('https://')) {
      baseUrl = baseUrl.replace('https://', 'wss://');
    }
    
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    
    const wsUrl = `${baseUrl}/ws/${this.config.snappId}/${this.config.userId}?token=${token}`;
    this.logger.log(`🏗️ ConnectionManager: Final WebSocket URL: ${wsUrl.replace(token, '[REDACTED]')}`);
    return wsUrl;
  }

  /**
   * Handle WebSocket close event
   */
  private async handleClose(code: number, reason?: string): Promise<void> {
    this.ws = null;
    
    let error: SnappjackError;
    
    // For ambiguous codes like 1006, use credential validation
    if (code === 1006 && this.receivedUserApiKey) {
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
      error = this.classifyConnectionError(code, reason || '');
    }
    
    if (error.type === 'auth_failed') {
      this.updateStatus('error');
      this.emit('error', error);
      return;
    } else {
      this.updateStatus('disconnected');
    }

    // Attempt reconnection if enabled and error allows retry
    if (this.config.autoReconnect && error.canRetry && this.shouldReconnect(code)) {
      this.scheduleReconnect();
    } else if (!error.canRetry) {
      this.emit('error', error);
    }
  }

  /**
   * Handle WebSocket error event
   */
  private async handleError(error: Event): Promise<void> {
    const connectionError = await this.classifyWebSocketError();
    this.updateStatus('error');
    this.emit('error', connectionError);
  }

  /**
   * Classify WebSocket errors
   */
  private async classifyWebSocketError(): Promise<SnappjackError> {
    if (this.receivedUserApiKey) {
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
    
    return {
      type: 'connection_failed',
      message: 'Failed to establish WebSocket connection',
      canRetry: true,
      canResetCredentials: false
    };
  }

  /**
   * Validate credentials with server
   */
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
        return 'invalid';
      }

      const result = await response.json();
      return result.valid === true ? 'valid' : 'invalid';
    } catch (error) {
      this.logger.warn(`Cannot reach server to validate credentials: ${error}`);
      return 'unreachable';
    }
  }

  /**
   * Classify connection errors by close code
   */
  private classifyConnectionError(code: number, reason: string): SnappjackError {
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
      
      case 1006: // Abnormal closure
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

  /**
   * Determine if reconnection should be attempted
   */
  private shouldReconnect(closeCode: number): boolean {
    return closeCode !== 1000 && closeCode !== 1008 && 
           this.reconnectAttempts < this.config.maxReconnectAttempts;
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    
    const delay = this.config.testMode 
      ? 1 // 1ms for fast test execution
      : Math.min(
          this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts),
          30000 // Max 30 seconds
        );

    this.logger.log(`⏰ ConnectionManager: Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      
      try {
        await this.connect();
      } catch (error) {
        // Handle different types of reconnection failures
        await this.handleReconnectionError(error);
      }
    }, delay);
  }

  /**
   * Handle reconnection errors with proper classification
   */
  private async handleReconnectionError(error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.warn(`❌ ConnectionManager: Reconnection attempt ${this.reconnectAttempts} failed: ${errorMessage}`);

    // Classify the error to determine if we should continue reconnecting
    const errorClassification = await this.classifyReconnectionError(error);
    
    if (errorClassification.shouldContinueReconnecting) {
      // Continue reconnection attempts if we haven't exceeded the limit
      if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
        this.logger.log(`🔄 ConnectionManager: ${errorClassification.reason}, continuing reconnection attempts`);
        this.scheduleReconnect();
      } else {
        this.logger.error(`❌ ConnectionManager: Max reconnection attempts (${this.config.maxReconnectAttempts}) reached`);
        this.clearReconnectTimer(); // Clear any pending reconnection timer
        this.updateStatus('error');
        this.emit('error', {
          type: 'connection_failed',
          message: `Failed to reconnect after ${this.config.maxReconnectAttempts} attempts`,
          canRetry: false,
          canResetCredentials: false
        });
      }
    } else {
      // Stop reconnecting for non-retryable errors
      this.logger.error(`❌ ConnectionManager: ${errorClassification.reason}, stopping reconnection attempts`);
      this.clearReconnectTimer(); // Clear any pending reconnection timer
      this.updateStatus('error');
      this.emit('error', errorClassification.error);
    }
  }

  /**
   * Classify reconnection errors to determine retry behavior
   */
  private async classifyReconnectionError(error: unknown): Promise<{
    shouldContinueReconnecting: boolean;
    reason: string;
    error?: SnappjackError;
  }> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if this is a token fetch failure (occurs before WebSocket creation)
    if (errorMessage.includes('fetch') || 
        errorMessage.includes('network') || 
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('timeout')) {
      
      return {
        shouldContinueReconnecting: true,
        reason: 'Token fetch failed due to server unavailability'
      };
    }

    // Check for authentication-related errors that should stop reconnection
    if (errorMessage.toLowerCase().includes('auth') ||
        errorMessage.toLowerCase().includes('unauthorized') ||
        (errorMessage.toLowerCase().includes('invalid') && errorMessage.toLowerCase().includes('token'))) {
      
      return {
        shouldContinueReconnecting: false,
        reason: 'Authentication error detected',
        error: {
          type: 'auth_failed',
          message: 'Authentication failed during reconnection',
          canRetry: false,
          canResetCredentials: true
        }
      };
    }

    // For ambiguous errors, try to validate credentials if we have a userApiKey
    if (this.receivedUserApiKey) {
      const validationResult = await this.validateCredentials();
      
      if (validationResult === 'invalid') {
        return {
          shouldContinueReconnecting: false,
          reason: 'Credential validation failed',
          error: {
            type: 'auth_failed',
            message: 'Invalid credentials detected during reconnection',
            canRetry: false,
            canResetCredentials: true
          }
        };
      }
      
      if (validationResult === 'unreachable') {
        return {
          shouldContinueReconnecting: true,
          reason: 'Server unreachable for credential validation'
        };
      }
    }

    // Default: treat as temporary connection issue and continue reconnecting
    return {
      shouldContinueReconnecting: true,
      reason: 'Treating as temporary connection issue'
    };
  }

  /**
   * Clear reconnection timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}