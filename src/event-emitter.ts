/**
 * Cross-platform EventEmitter that works in both Node.js and browser environments
 */

export type EventListener = (data?: any) => void;

export class EventEmitter {
  private events: Map<string, Set<EventListener>> = new Map();

  on(event: string, listener: EventListener): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: EventListener): this {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.events.delete(event);
      }
    }
    return this;
  }

  emit(event: string, data?: any): void {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  once(event: string, listener: EventListener): this {
    const onceListener = (data?: any) => {
      this.off(event, onceListener);
      listener(data);
    };
    return this.on(event, onceListener);
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }

  listenerCount(event: string): number {
    const listeners = this.events.get(event);
    return listeners ? listeners.size : 0;
  }

  // Compatibility methods for browser-like API
  addEventListener(event: string, listener: EventListener): void {
    this.on(event, listener);
  }

  removeEventListener(event: string, listener: EventListener): void {
    this.off(event, listener);
  }

  dispatchEvent(event: { type: string; detail?: any }): boolean {
    this.emit(event.type, event.detail);
    return true;
  }
}