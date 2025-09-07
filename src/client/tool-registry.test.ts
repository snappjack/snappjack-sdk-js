/**
 * Unit tests for ToolRegistry
 */

import { ToolRegistry } from './tool-registry';
import { Tool, Logger } from '../core/types';

// Mock logger for testing
const mockLogger: Logger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('ToolRegistry', () => {
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    toolRegistry = new ToolRegistry(mockLogger);
    jest.clearAllMocks();
  });

  describe('register()', () => {
    it('should correctly add a tool to the internal map', () => {
      const testTool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message']
        }
      };

      toolRegistry.register(testTool);

      expect(toolRegistry.has('test_tool')).toBe(true);
      expect(toolRegistry.size()).toBe(1);
    });

    it('should store tool with handler when provided', () => {
      const mockHandler = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'test response' }]
      });

      const testTool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } }
        },
        handler: mockHandler
      };

      toolRegistry.register(testTool);

      expect(toolRegistry.getHandler('test_tool')).toBe(mockHandler);
    });

    it('should compile and cache validators for tool schemas', () => {
      const testTool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: { 
            message: { type: 'string' },
            count: { type: 'number' }
          },
          required: ['message']
        }
      };

      toolRegistry.register(testTool);

      // Verify validator was created by testing validation
      const validResult = toolRegistry.validate('test_tool', { message: 'hello', count: 5 });
      expect(validResult.isValid).toBe(true);
    });

    it('should log compilation process', () => {
      const testTool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } }
        }
      };

      toolRegistry.register(testTool);

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining("Compiling validator for tool 'test_tool'")
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining("Compiled validator for tool 'test_tool'")
      );
    });
  });

  describe('getHandler()', () => {
    it('should retrieve the correct handler function', () => {
      const mockHandler = jest.fn();
      const testTool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object' },
        handler: mockHandler
      };

      toolRegistry.register(testTool);

      expect(toolRegistry.getHandler('test_tool')).toBe(mockHandler);
    });

    it('should return undefined for non-existent tools', () => {
      expect(toolRegistry.getHandler('non_existent')).toBeUndefined();
    });

    it('should return undefined for tools without handlers', () => {
      const testTool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object' }
        // No handler provided
      };

      toolRegistry.register(testTool);

      expect(toolRegistry.getHandler('test_tool')).toBeUndefined();
    });
  });

  describe('getAll()', () => {
    it('should return tool definitions with handler property omitted', () => {
      const mockHandler = jest.fn();
      const testTool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } }
        },
        handler: mockHandler
      };

      toolRegistry.register(testTool);

      const tools = toolRegistry.getAll();
      
      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } }
        }
        // handler should be omitted
      });
      expect('handler' in tools[0]).toBe(false);
    });

    it('should return empty array when no tools registered', () => {
      const tools = toolRegistry.getAll();
      expect(tools).toEqual([]);
    });

    it('should return multiple tools correctly', () => {
      const tool1: Tool = {
        name: 'tool_1',
        description: 'First tool',
        inputSchema: { type: 'object' }
      };
      const tool2: Tool = {
        name: 'tool_2', 
        description: 'Second tool',
        inputSchema: { type: 'object' }
      };

      toolRegistry.register(tool1);
      toolRegistry.register(tool2);

      const tools = toolRegistry.getAll();
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toContain('tool_1');
      expect(tools.map(t => t.name)).toContain('tool_2');
    });
  });

  describe('validate()', () => {
    beforeEach(() => {
      const testTool: Tool = {
        name: 'test_tool',
        description: 'A test tool for validation testing',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            count: { type: 'number' },
            optional: { type: 'string' }
          },
          required: ['message', 'count']
        }
      };
      
      toolRegistry.register(testTool);
    });

    it('should return valid result for correct arguments', () => {
      const args = { message: 'hello', count: 5 };
      const result = toolRegistry.validate('test_tool', args);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return invalid result with detailed errors for incorrect arguments', () => {
      const args = { message: 'hello' }; // missing required 'count'
      const result = toolRegistry.validate('test_tool', args);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].instancePath).toBe('root');
      expect(result.errors![0].message).toContain("required property 'count'");
    });

    it('should handle type coercion correctly', () => {
      const args = { message: 'hello', count: '5' }; // count as string should be coerced to number
      const result = toolRegistry.validate('test_tool', args);
      
      expect(result.isValid).toBe(true);
      // The args object should be modified by AJV's coercion
      expect(args.count).toBe(5); // Should be coerced to number
    });

    it('should enforce strict schema with additionalProperties: false', () => {
      const args = { message: 'hello', count: 5, extra: 'not allowed' };
      const result = toolRegistry.validate('test_tool', args);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.some(e => e.message?.includes('additional'))).toBe(true);
    });

    it('should return valid for tools without validators', () => {
      const result = toolRegistry.validate('non_existent_tool', { anything: 'goes' });
      
      expect(result.isValid).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("No validator found for tool 'non_existent_tool'")
      );
    });

    it('should handle complex nested object validation', () => {
      const complexTool: Tool = {
        name: 'complex_tool',
        description: 'Complex tool with nested schema',
        inputSchema: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                age: { type: 'number' }
              },
              required: ['name']
            },
            tags: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['user']
        }
      };
      
      toolRegistry.register(complexTool);
      
      // Valid nested structure
      const validArgs = {
        user: { name: 'John', age: 30 },
        tags: ['tag1', 'tag2']
      };
      const validResult = toolRegistry.validate('complex_tool', validArgs);
      expect(validResult.isValid).toBe(true);
      
      // Invalid nested structure - missing required name
      const invalidArgs = {
        user: { age: 30 }, // missing required name
        tags: ['tag1']
      };
      const invalidResult = toolRegistry.validate('complex_tool', invalidArgs);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors!.some(e => 
        e.instancePath.includes('user') && e.message?.includes('name')
      )).toBe(true);
    });
  });

  describe('setHandler()', () => {
    it('should set handler for existing tool', () => {
      const testTool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object' }
      };
      
      toolRegistry.register(testTool);
      
      const mockHandler = jest.fn();
      toolRegistry.setHandler('test_tool', mockHandler);
      
      expect(toolRegistry.getHandler('test_tool')).toBe(mockHandler);
    });

    it('should create basic tool definition for non-existent tool', () => {
      const mockHandler = jest.fn();
      toolRegistry.setHandler('new_tool', mockHandler);
      
      expect(toolRegistry.has('new_tool')).toBe(true);
      expect(toolRegistry.getHandler('new_tool')).toBe(mockHandler);
      
      const toolDef = toolRegistry.getDefinition('new_tool');
      expect(toolDef).toEqual({
        name: 'new_tool',
        description: 'Handler for new_tool',
        inputSchema: { type: 'object' }
      });
    });
  });

  describe('utility methods', () => {
    it('should correctly report tool existence with has()', () => {
      expect(toolRegistry.has('non_existent')).toBe(false);
      
      const testTool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object' }
      };
      
      toolRegistry.register(testTool);
      expect(toolRegistry.has('test_tool')).toBe(true);
    });

    it('should correctly report size', () => {
      expect(toolRegistry.size()).toBe(0);
      
      const tool1: Tool = { name: 'tool1', inputSchema: { type: 'object' } };
      const tool2: Tool = { name: 'tool2', inputSchema: { type: 'object' } };
      
      toolRegistry.register(tool1);
      expect(toolRegistry.size()).toBe(1);
      
      toolRegistry.register(tool2);
      expect(toolRegistry.size()).toBe(2);
    });

    it('should clear all tools with clear()', () => {
      const tool1: Tool = { name: 'tool1', inputSchema: { type: 'object' } };
      const tool2: Tool = { name: 'tool2', inputSchema: { type: 'object' } };
      
      toolRegistry.register(tool1);
      toolRegistry.register(tool2);
      expect(toolRegistry.size()).toBe(2);
      
      toolRegistry.clear();
      expect(toolRegistry.size()).toBe(0);
      expect(toolRegistry.has('tool1')).toBe(false);
      expect(toolRegistry.has('tool2')).toBe(false);
    });
  });
});