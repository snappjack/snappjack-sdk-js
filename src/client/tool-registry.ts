/**
 * Snappjack SDK - Tool Registry
 * 
 * Manages tool registration, validation, and schema enforcement.
 */

import Ajv, { ValidateFunction } from 'ajv';
import {
  Tool,
  ToolHandler,
  ToolDefinition,
  ValidationResult,
  Logger
} from '../core/types';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private validators: Map<string, ValidateFunction> = new Map();
  private ajv: Ajv;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
    this.ajv = new Ajv({
      coerceTypes: true,
      useDefaults: true,
      allErrors: true,
      strict: false,
    });
  }

  /**
   * Register a tool with the registry
   */
  register(tool: Tool): void {
    // Store the tool
    this.tools.set(tool.name, {
      ...tool,
      handler: tool.handler || undefined
    });
    
    // Compile and cache validator for the tool's input schema
    try {
      // Enforce strict validation by recursively adding additionalProperties: false
      const strictSchema = this.enforceStrictSchema(tool.inputSchema);
      
      this.logger.log(`🔧 ToolRegistry: Compiling validator for tool '${tool.name}' with strict schema: ${JSON.stringify(strictSchema, null, 2)}`);
      const validator = this.ajv.compile(strictSchema);
      this.validators.set(tool.name, validator);
      this.logger.log(`✅ ToolRegistry: Compiled validator for tool '${tool.name}'`);
      
      // Test the validator with a simple invalid case to ensure it's working
      const testResult = validator({ invalidTest: 'should fail' });
      this.logger.log(`🧪 ToolRegistry: Validator test: ${testResult ? 'PASSED' : 'FAILED'} (expected: FAILED)`);
    } catch (error) {
      this.logger.warn(`⚠️ ToolRegistry: Failed to compile validator for tool '${tool.name}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get a tool handler by name
   */
  getHandler(name: string): ToolHandler | undefined {
    const tool = this.tools.get(name);
    return tool?.handler;
  }

  /**
   * Get a tool definition by name (without handler)
   */
  getDefinition(name: string): ToolDefinition | undefined {
    const tool = this.tools.get(name);
    if (!tool) return undefined;
    
    // Return tool without handler
    const { handler, ...definition } = tool;
    return definition;
  }

  /**
   * Get all tool definitions (without handlers)
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => {
      const { handler, ...definition } = tool;
      return definition;
    });
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Validate tool arguments against schema
   */
  validate(name: string, args: unknown): ValidationResult {
    const validator = this.validators.get(name);
    
    if (!validator) {
      this.logger.warn(`⚠️ ToolRegistry: No validator found for tool '${name}'`);
      return { isValid: true }; // Allow execution without validation
    }
    
    this.logger.log(`🔍 ToolRegistry: BEFORE validation - tool: '${name}', arguments: ${JSON.stringify(args, null, 2)}`);
    
    const isValid = validator(args);
    
    this.logger.log(`🔍 ToolRegistry: AFTER validation - isValid: ${isValid}`);
    this.logger.log(`🔍 ToolRegistry: AFTER validation - arguments (potentially coerced): ${JSON.stringify(args, null, 2)}`);
    
    if (!isValid) {
      const errors = validator.errors || [];
      this.logger.log(`🔍 ToolRegistry: Validation errors: ${JSON.stringify(errors, null, 2)}`);
      
      return {
        isValid: false,
        errors: errors.map(err => ({
          instancePath: err.instancePath || 'root',
          message: err.message
        }))
      };
    }
    
    this.logger.log(`✅ ToolRegistry: Tool '${name}' arguments validated successfully`);
    return { isValid: true };
  }

  /**
   * Set a tool handler (for backward compatibility)
   */
  setHandler(toolName: string, handler: ToolHandler): void {
    const existingTool = this.tools.get(toolName);
    if (existingTool) {
      existingTool.handler = handler;
    } else {
      // Create a basic tool definition (mainly for backward compatibility)
      this.tools.set(toolName, {
        name: toolName,
        description: `Handler for ${toolName}`,
        inputSchema: { type: 'object' },
        handler: handler
      });
    }
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
    this.validators.clear();
  }

  /**
   * Get the count of registered tools
   */
  size(): number {
    return this.tools.size;
  }

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
}