/**
 * Cross-platform WebSocket wrapper that works in both Node.js and browser environments
 */

// Type definitions for WebSocket events and states
export interface WebSocketWrapper {
  readyState: number;
  CONNECTING: number;
  OPEN: number;
  CLOSING: number;
  CLOSED: number;
  
  onopen: ((event: any) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: any) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

// WebSocket ready states
export const ReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
} as const;

/**
 * Creates a WebSocket instance that works in both environments
 */
export function createWebSocket(url: string): WebSocketWrapper {
  // In browser environment, use native WebSocket
  if (typeof window !== 'undefined' && typeof window.WebSocket !== 'undefined') {
    console.log('creating web socket in browser');
    return new window.WebSocket(url) as WebSocketWrapper;
  }
  
  // In Node.js environment, use ws package
  if (typeof global !== 'undefined' && typeof require !== 'undefined') {
    try {
      const WS = require('ws');
      console.log('creating web socket in node');
      return new WS(url) as WebSocketWrapper;
    } catch (error) {
      throw new Error('WebSocket not available. In Node.js, install the "ws" package.');
    }
  }
  
  throw new Error('WebSocket not available in this environment');
}

// Re-export WebSocket type for convenience
export type { WebSocketWrapper as WebSocket };