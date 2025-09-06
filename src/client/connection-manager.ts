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

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.buildWebSocketUrl();
        this.logger.log(`🔗 ConnectionManager: Connecting to WebSocket URL: ${wsUrl}`);
        this.ws = createWebSocket(wsUrl);

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
      } catch (error) {
        reject(error);
      }
    });
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
  private buildWebSocketUrl(): string {
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
    
    const wsUrl = `${baseUrl}/ws/${this.config.snappId}/${this.config.userId}?token=${this.config.ephemeralToken}`;
    this.logger.log(`🏗️ ConnectionManager: Final WebSocket URL: ${wsUrl.replace(this.config.ephemeralToken, '[REDACTED]')}`);
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
    
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    this.logger.log(`⏰ ConnectionManager: Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(() => {
        // Reconnection failed, will be handled by handleError
      });
    }, delay);
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