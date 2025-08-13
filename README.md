# Snappjack SDK Documentation

Transform your UI into a UAI. Enable your app for agents. In a snap.

## Introduction

Your app has a beautiful User Interface (UI) that your users love. But their new AI assistants can't use it. Snappjack transforms your existing UI into a **User & Agent Interface (UAI)** by adding a real-time connection layer that lets AI assistants operate your app on behalf of users.

### What Changes When You Add Snappjack?

**Nothing visible to your users.** Your app looks and works exactly the same. But now:

- Users can connect their AI assistants (Claude, GPT, or any MCP-compatible agent)
- Assistants can perform actions in your app based on natural language requests
- Users see results instantly in your existing UI
- You maintain complete control over what assistants can and cannot do

### Architecture Overview

```text
┌─────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   Your App UI   │────▶│   Snappjack     │────▶│ User's Assistant │
│  (unchanged)    │◀────│    Bridge       │◀────│    (Claude,      │
│                 │     │                 │     │     GPT, etc)    │
└─────────────────┘     └─────────────────┘     └──────────────────┘
       ↑                                                   ↑
       └────────────── User sees results ──────────────────┘
                      Assistant performs actions
```

## Core Concepts

### Tools: Your App's Agent Vocabulary

Tools are the actions your app exposes to AI assistants. Think of them as API endpoints, but designed for AI rather than developers. Each tool:

- Has a **name** that identifies the action
- Includes a **description** that helps AI understand when to use it
- Defines **input parameters** the AI must provide
- Returns **results** in a format AI can understand

Tools follow the [Model Context Protocol (MCP) specification](https://modelcontextprotocol.io/docs/concepts/tools).

### The Connection Lifecycle

1. **User Opens Your App** → Your app initializes Snappjack
2. **Snappjack Connects** → Establishes secure channel to the bridge
3. **User Connects Assistant** → Assistant can now see available tools
4. **Assistant Calls Tools** → Based on user's natural language requests
5. **Your App Responds** → Results appear in your UI instantly

### Security Model

- **User-Scoped**: Each user's assistant only accesses their own data
- **Permission-Based**: You control exactly what tools are available
- **Sandboxed**: Assistants can't access anything you don't explicitly expose
- **Authenticated**: Both your app and the user's assistant must authenticate

## Installation

### Loading the SDK

Load the Snappjack SDK from the official CDN:

```html
<script src="https://bridge.snappjack.com/sdk/snappjack.js"></script>
```

The SDK automatically detects the server URL from where it's loaded, enabling seamless cross-domain support.

## Quick Start

```javascript
// Transform your UI into a UAI
const snappjack = new Snappjack({
  appId: 'your-app-id',
  userId: currentUser.id,
  apiKey: 'wak_...', // Your WebApp API Key
  
  tools: [
    {
      name: 'update_budget',
      description: 'Update budget categories and amounts',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          amount: { type: 'number' }
        },
        required: ['category', 'amount']
      },
      handler: async (args) => {
        // Your existing app logic
        await updateBudgetCategory(args.category, args.amount);
        
        // Return result for the assistant
        return {
          content: [{
            type: 'text',
            text: `Updated ${args.category} to $${args.amount}`
          }]
        };
      }
    }
  ]
});

// Connect to enable your UAI
await snappjack.connect();
```

## Constructor Configuration

The Snappjack constructor accepts a configuration object with the following properties:

### Required Parameters

- **`appId`** (string): Unique identifier for your application
- **`userId`** (string): Unique identifier for the current user
- **`apiKey`** (string): WebApp API key starting with `wak_`

### Optional Parameters

- **`tools`** (array): Array of tool definitions to register immediately
- **`autoReconnect`** (boolean): Enable automatic reconnection (default: `true`)
- **`reconnectInterval`** (number): Base reconnection interval in ms (default: `5000`)
- **`maxReconnectAttempts`** (number): Maximum reconnection attempts (default: `10`)
- **`logger`** (object): Custom logger with `log`, `warn`, `error` methods

```javascript
const snappjack = new Snappjack({
  // Required
  appId: 'budget-tracker',
  userId: 'user-123',
  apiKey: 'wak_abc123def456',
  
  // Optional
  tools: [/* tool definitions */],
  autoReconnect: true,
  reconnectInterval: 5000,
  maxReconnectAttempts: 10,
  logger: customLogger
});
```

## Defining Tools

### Tool Structure

Tools follow the [MCP Tool Schema](https://modelcontextprotocol.io/docs/concepts/tools#tool-definition):

```javascript
{
  name: 'tool_name',              // Unique identifier
  description: 'What this does',  // Help AI understand usage
  inputSchema: {                  // JSON Schema for parameters
    type: 'object',
    properties: {
      // Define expected parameters
    },
    required: []                  // Required parameters
  },
  handler: async (args) => {      // Your implementation
    // Process the request
    // Return MCP-compliant response
  }
}
```

### Input Validation

Input schemas use [JSON Schema](https://json-schema.org/) format. Snappjack validates all inputs before calling your handler:

```javascript
inputSchema: {
  type: 'object',
  properties: {
    amount: { 
      type: 'number',
      minimum: 0,
      description: 'Amount in dollars'
    },
    category: {
      type: 'string',
      enum: ['food', 'transport', 'entertainment'],
      description: 'Budget category'
    },
    note: {
      type: 'string',
      maxLength: 500,
      description: 'Optional note'
    }
  },
  required: ['amount', 'category']
}
```

### Response Format

Handlers must return responses following the [MCP Response Schema](https://modelcontextprotocol.io/docs/concepts/tool-responses):

```javascript
// Simple text response
return {
  content: [{
    type: 'text',
    text: 'Operation completed successfully'
  }]
};

// Response with structured data
return {
  content: [{
    type: 'text',
    text: 'Budget updated'
  }],
  data: {
    newBalance: 1500.00,
    categories: ['food', 'transport']
  }
};
```

## Connection Management

### Status States

Your app moves through three connection states:

1. **`disconnected`** - Not connected to Snappjack
2. **`connected`** - Connected, waiting for user's assistant
3. **`bridged`** - Assistant connected and ready

```javascript
snappjack.on('status', (event) => {
  const status = event.detail; // string: 'disconnected', 'connected', or 'bridged'
  
  switch(status) {
    case 'disconnected':
      showOfflineIndicator();
      break;
    case 'connected':
      showWaitingForAgent();
      break;
    case 'bridged':
      showAgentActive();
      break;
  }
});
```

### Events Reference

The SDK uses a pure event-driven architecture. All state changes and data are communicated through events:

#### `status`
Emitted when connection status changes.

```javascript
snappjack.on('status', (event) => {
  const status = event.detail; // 'disconnected' | 'connected' | 'bridged'
});
```

#### `user-api-key-generated`
Emitted when user API key is generated and MCP connection data is available.

```javascript
snappjack.on('user-api-key-generated', (event) => {
  const data = event.detail;
  // data.userApiKey: string - The generated user API key
  // data.appId: string - Your app ID
  // data.userId: string - The user ID
  // data.mcpEndpoint: string - Full MCP endpoint URL for agent connections
});
```

#### `agent-connected`
Emitted when an AI assistant connects.

```javascript
snappjack.on('agent-connected', (event) => {
  const data = event.detail;
  // data.agentSessionId: string - Unique session ID for this agent connection
});
```

#### `agent-disconnected`
Emitted when an AI assistant disconnects.

```javascript
snappjack.on('agent-disconnected', (event) => {
  const data = event.detail;
  // data.agentSessionId: string - Session ID of the disconnected agent
});
```


#### `error`
Emitted when an error occurs.

```javascript
snappjack.on('error', (event) => {
  const error = event.detail; // Error object or string
});
```

#### `message`
Emitted for any unhandled messages (for debugging or custom handling).

```javascript
snappjack.on('message', (event) => {
  const message = event.detail; // Raw message object
});
```

## Enabling User Connections

When users want to connect their AI assistant, listen for the connection event:

```javascript
// Listen for connection configuration
snappjack.on('user-api-key-generated', (event) => {
  const connectionData = event.detail;
  
  // Build MCP configuration from the event data
  const config = {
    connections: [{
      name: `${connectionData.appId} (${connectionData.userId})`,
      type: 'streamableHttp',
      url: connectionData.mcpEndpoint,
      headers: {
        Authorization: `Bearer ${connectionData.userApiKey}`
      }
    }]
  };
  
  // Display to user (they add this to their assistant)
  showConnectionInstructions(config);
});
```

### Connection Data Structure

The `user-api-key-generated` event provides all data needed for MCP connections:

```javascript
{
  userApiKey: 'uak_abc123def456',     // User API key for agent authentication
  appId: 'budget-tracker',             // Your app ID
  userId: 'user-123',                  // Current user ID
  mcpEndpoint: 'https://bridge.snappjack.com/mcp/budget-tracker/user-123' // Full MCP endpoint
}
```

This generates an MCP configuration like:
```json
{
  "connections": [{
    "name": "Budget Tracker (john@example.com)",
    "type": "streamableHttp",
    "url": "https://bridge.snappjack.com/mcp/budget-tracker/user-123",
    "headers": {
      "Authorization": "Bearer uak_..."
    }
  }]
}
```

## Available Methods

The SDK provides these public methods:

### Connection Methods

#### `connect()`
Establishes connection to Snappjack bridge.

```javascript
await snappjack.connect();
// Returns: Promise<void>
// Throws: Error if connection fails
```

#### `disconnect()`
Closes connection to Snappjack bridge.

```javascript
await snappjack.disconnect();
// Returns: Promise<void>
```

### Tool Management

#### `registerTool(tool)`
Registers a new tool with your application.

```javascript
snappjack.registerTool({
  name: 'my_tool',
  description: 'Does something useful',
  inputSchema: { /* JSON Schema */ },
  handler: async (args) => { /* implementation */ }
});
// Returns: void
```


#### `getTools()`
Returns array of currently registered tool definitions (without handlers).

```javascript
const tools = snappjack.getTools();
// Returns: Array<{name, description, inputSchema}>
```


### Utility Methods

#### `on(event, listener)`
Standard event listener method.

```javascript
const handler = (event) => console.log(event.detail);
snappjack.on('status', handler);
// Returns: Snappjack instance (chainable)
```

## Best Practices

### Designing Effective Tools

**Think in User Actions, Not Database Operations**

```javascript
// ❌ Poor: Exposes implementation details
{
  name: 'update_category_record',
  description: 'Updates the category table row'
}

// ✅ Good: Describes user intent
{
  name: 'adjust_budget',
  description: 'Adjust spending limit for a budget category'
}
```

**Make Descriptions Assistant-Friendly**

```javascript
// ❌ Poor: Vague description
description: 'Process budget'

// ✅ Good: Clear context and usage
description: 'Update budget category amounts. Use when user wants to change spending limits, reallocate funds between categories, or set new budget targets.'
```

**Handle Partial Information Gracefully**

```javascript
handler: async (args) => {
  // Check if we need more context
  if (!args.category && args.amount > 1000) {
    throw new Error('Please specify which category to update for amounts over $1000');
  }
  
  // Provide intelligent defaults
  const category = args.category || await guessCategory(args.description);
  
  // Proceed with operation
  await updateBudget(category, args.amount);
}
```

### Security Considerations

**Validate Permissions in Every Handler**

```javascript
handler: async (args) => {
  // Always verify the user can perform this action
  const user = await getCurrentUser();
  if (!user.canEditBudget(args.budgetId)) {
    throw new Error('You don\'t have permission to edit this budget');
  }
  
  // Proceed with operation
  await performUpdate(args);
}
```

**Never Expose Sensitive Data**

```javascript
// ❌ Poor: Returns internal IDs and sensitive data
return {
  content: [{
    type: 'text',
    text: `Updated user ${user.internalId} with SSN ${user.ssn}`
  }]
};

// ✅ Good: Returns only what the user should see
return {
  content: [{
    type: 'text',
    text: `Updated your profile successfully`
  }]
};
```

### Performance Optimization

**Keep Handlers Fast**

```javascript
handler: async (args) => {
  // For long operations, return quickly with status
  const jobId = await startBudgetRecalculation(args);
  
  return {
    content: [{
      type: 'text',
      text: 'Started recalculating your budget. This may take a moment...'
    }],
    data: { jobId }
  };
}
```

**Batch Operations When Possible**

```javascript
{
  name: 'update_multiple_categories',
  description: 'Update several budget categories at once',
  inputSchema: {
    type: 'object',
    properties: {
      updates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            amount: { type: 'number' }
          }
        }
      }
    }
  },
  handler: async (args) => {
    // Process all updates in a single transaction
    const results = await batchUpdateCategories(args.updates);
    return {
      content: [{
        type: 'text',
        text: `Updated ${results.length} categories`
      }]
    };
  }
}
```

## Complete Example: Budget Tracker UAI

Here's how a budget tracking app transforms into a UAI:

```html
<!-- Load the SDK from CDN -->
<script src="https://bridge.snappjack.com/sdk/snappjack.js"></script>

<script>
// Initialize Snappjack when your app loads
const snappjack = new Snappjack({
  appId: 'budget-tracker',
  userId: currentUser.id,
  apiKey: 'wak_your_webapp_api_key',
  
  tools: [
    {
      name: 'analyze_spending',
      description: 'Analyze spending patterns and get insights. Use when user asks about their spending habits, trends, or wants recommendations.',
      inputSchema: {
        type: 'object',
        properties: {
          timeframe: {
            type: 'string',
            enum: ['week', 'month', 'quarter', 'year'],
            description: 'Time period to analyze'
          },
          category: {
            type: 'string',
            description: 'Optional: specific category to analyze'
          }
        },
        required: ['timeframe']
      },
      handler: async (args) => {
        const analysis = await analyzeSpending(args.timeframe, args.category);
        
        return {
          content: [{
            type: 'text',
            text: analysis.summary
          }],
          data: analysis.details
        };
      }
    },
    
    {
      name: 'adjust_budget',
      description: 'Adjust budget amounts for categories. Use when user wants to change spending limits, reallocate funds, or update their budget.',
      inputSchema: {
        type: 'object',
        properties: {
          adjustments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string' },
                amount: { type: 'number' },
                operation: {
                  type: 'string',
                  enum: ['set', 'increase', 'decrease']
                }
              },
              required: ['category', 'amount', 'operation']
            }
          },
          reason: {
            type: 'string',
            description: 'Why the adjustment is being made'
          }
        },
        required: ['adjustments']
      },
      handler: async (args) => {
        // Validate user permissions
        if (!currentUser.canEditBudget()) {
          throw new Error('Budget is locked for editing');
        }
        
        // Process adjustments
        const results = [];
        for (const adj of args.adjustments) {
          const newAmount = await adjustBudgetCategory(
            adj.category,
            adj.amount,
            adj.operation
          );
          results.push(`${adj.category}: $${newAmount}`);
        }
        
        // Log the reason if provided
        if (args.reason) {
          await logBudgetChange(args.reason);
        }
        
        return {
          content: [{
            type: 'text',
            text: `Budget updated:\n${results.join('\n')}`
          }]
        };
      }
    }
  ]
});

// Connect and handle status
await snappjack.connect();

// Update UI based on connection status
snappjack.on('status', (event) => {
  updateConnectionIndicator(event.detail);
});

// Show connection instructions when ready
snappjack.on('user-api-key-generated', (event) => {
  const connectionData = event.detail;
  
  // Build MCP configuration from the event data
  const config = {
    connections: [{
      name: `${connectionData.appId} (${connectionData.userId})`,
      type: 'streamableHttp',
      url: connectionData.mcpEndpoint,
      headers: {
        Authorization: `Bearer ${connectionData.userApiKey}`
      }
    }]
  };
  
  showAgentConnectionModal(config);
});
</script>
```

### Example User Interactions

With this UAI, users can now say things like:

- *"How much did I spend on coffee this month?"*
- *"Move $200 from entertainment to savings"*
- *"I'm planning a vacation. Analyze my discretionary spending and suggest where I can cut back"*
- *"Set up a new budget category for home gym equipment with $150/month"*

The assistant will use your tools to perform these actions, and users will see the results immediately in your app's UI.

## Important Notes

### Cross-Domain Support
The SDK automatically detects the server URL from where it's loaded, enabling seamless cross-domain deployments. When loaded from `https://bridge.snappjack.com/sdk/snappjack.js`, all API calls and WebSocket connections will automatically use the bridge.snappjack.com server.

### Event-Driven Architecture
The SDK uses a pure event-driven architecture. Do not poll methods for state changes - instead, listen to events:

- ✅ **Good**: `snappjack.on('status', handler)` 
- ❌ **Avoid**: Polling or checking connection status repeatedly

### Error Handling
All errors are emitted as `error` events. Always listen for these:

```javascript
snappjack.on('error', (event) => {
  console.error('Snappjack error:', event.detail);
  // Handle error appropriately
});
```

### Tool Handler Best Practices
- Validate all inputs even though SDK validates schema
- Keep handlers fast (< 2 seconds)
- Return meaningful error messages
- Use structured responses with proper MCP format

## Resources

- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [MCP Tool Documentation](https://modelcontextprotocol.io/docs/concepts/tools)
- [JSON Schema Documentation](https://json-schema.org/)
- [Snappjack Support](mailto:developers@snappjack.com)

## License

MIT License - See LICENSE file for details