/**
 * @deprecated This unified entry point is deprecated.
 * 
 * Please use the explicit entry points instead:
 * - Client-side: import from '@snappjack/sdk-js/client'
 * - Server-side: import from '@snappjack/sdk-js/server'
 * 
 * This file now defaults to client-only exports for minimal backward compatibility,
 * but will be removed in a future version.
 */

// Default to client exports for backward compatibility
export * from './client';