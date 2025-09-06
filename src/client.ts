/**
 * Snappjack SDK - Client-Side Entry Point
 * 
 * This module exports only the client-side components of the SDK.
 * For server-side functionality, import from '@snappjack/sdk-js/server'
 */

// Export all type definitions
export * from './core/types';

// Export the main Snappjack client class
export * from './client/snappjack-client';
export { default } from './client/snappjack-client';

// Export cross-platform utilities that are safe for client-side use
export * from './core/event-emitter';
export * from './core/websocket-wrapper';

// Note: Internal classes (ConnectionManager, ToolRegistry) are NOT exported
// to keep the public API surface clean and focused
// Note: Server-side exports (SnappjackServerHelper, etc.) are NOT included here
// to prevent accidental inclusion of sensitive server code in client bundles