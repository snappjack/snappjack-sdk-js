# Snappjack SDK

[![npm version](https://badge.fury.io/js/%40snappjack%2Fsdk-js.svg)](https://badge.fury.io/js/%40snappjack%2Fsdk-js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Expose your application's functionality as tools for AI agents through a real-time, stateful connection.

## Overview

The Snappjack SDK enables you to turn your web application into a **Snapp** - an application that AI agents can control on behalf of users. Unlike traditional APIs, the SDK creates a persistent, real-time bridge between your front-end application and AI agents, allowing agents to interact with the same live application instance that users are viewing.

When you integrate the Snappjack SDK, your application becomes controllable by AI while remaining unchanged for your users. Users can connect their preferred AI assistant (Claude, ChatGPT, or any MCP-compatible agent) to perform actions in your app through natural language requests.

### Architecture Overview

```text
┌─────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   Your App      │────▶│   Snappjack     │────▶│ User's Assistant │
│   (Client)      │◀────│    Bridge       │◀────│    (Claude,      │
│                 │     │                 │     │     GPT, etc)    │
└─────────────────┘     └─────────────────┘     └──────────────────┘
       ↑                                                   ↑
       └────────────── Real-time sync ─────────────────────┘
                      Same app instance
```

## Prerequisites

Before you begin, you need:

1. **Snappjack Account**: Sign up at [snappjack.com](https://snappjack.com)
2. **Snapp ID**: A unique identifier for your application that you get from your snappjack dashboard
3. **Snapp API Key**: Your secret API key starting with `wak_` (keep this secure on your server)

## Installation

### Using npm (Recommended)

Install the Snappjack SDK via npm:

```bash
npm install @snappjack/sdk-js
```

```typescript
// Client-side usage
import { Snappjack } from '@snappjack/sdk-js';

// Server-side usage
import { SnappjackServerHelper } from '@snappjack/sdk-js/server';
```

### Using CDN (Browser)

For browser-only usage, you can serve the built browser version from your own server or use a CDN that hosts npm packages:

```html
<!-- Option 1: Serve from your own server -->
<script src="/path/to/snappjack-sdk.min.js"></script>

<!-- Option 2: Use a CDN like unpkg -->
<script src="https://unpkg.com/@snappjack/sdk-js@latest/dist/snappjack-sdk.min.js"></script>
```

## Quick Start

Get started with Snappjack in just a few lines of code:

```javascript
// 1. Initialize the SDK
const snappjack = new Snappjack({
  snappId: 'your-app-id',
  userId: 'user-123',
  tokenProvider: () => fetch('/api/token').then(r => r.json()).then(d => d.token),

  tools: [{
    name: 'get_message',
    description: 'Get the current message displayed to the user',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({
      content: [{ type: 'text', text: document.getElementById('message').textContent }]
    })
  }, {
    name: 'set_message',
    description: 'Update the message displayed to the user',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    },
    handler: async (args) => {
      document.getElementById('message').textContent = args.text;
      return { content: [{ type: 'text', text: 'Message updated successfully' }] };
    }
  }]
});

// 2. Connect and handle events
snappjack.on('connection-info-updated', (data) => {
  console.log('MCP Endpoint:', data.mcpEndpoint);
  console.log('User API Key:', data.userApiKey);
});

await snappjack.connect();
```

**That's it!** Your app is now controllable by AI agents. See the [Complete Integration Example](#complete-integration-example) below for a full working application.

## Complete Integration Example

This comprehensive example demonstrates all four components of the Snappjack ecosystem working together. You'll build a complete web application that AI agents can control. Complete code is available at [https://github.com/snappjack/snappjack-demo-nodejs-hello-world](https://github.com/snappjack/snappjack-demo-nodejs-hello-world)


### Step 1: The Secure Backend

Create a server that handles user management, authentication tokens, and serves the SDK. The secret `snappApiKey` must never be exposed client-side.

```javascript
// server.js (Express.js example)
const express = require('express');
const { SnappjackServerHelper } = require('@snappjack/sdk-js/server');
const app = express();

app.use(express.json());
app.use(express.static('.'));

// Serve the Snappjack SDK from the installed npm package
app.use('/sdk', express.static('node_modules/@snappjack/sdk-js/dist'));

// Initialize server helper with your API credentials
const serverHelper = new SnappjackServerHelper({
  snappId: process.env.SNAPP_ID,
  snappApiKey: process.env.SNAPP_API_KEY // wak_...
});

// Unified user session endpoint
app.post('/api/user/session', async (req, res) => {
  try {
    const { existingUserId, forceNew = false } = req.body;

    if (forceNew) {
      const result = await serverHelper.createUser();
      return res.json({ ...result, isNew: true });
    }

    if (existingUserId) {
      try {
        await serverHelper.generateEphemeralToken(existingUserId);
        return res.json({ userId: existingUserId, isNew: false });
      } catch (error) {
        // User invalid, create new one
      }
    }

    const result = await serverHelper.createUser();
    res.json({ ...result, isNew: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to manage user session' });
  }
});

// Secure token endpoint
app.post('/api/token', async (req, res) => {
  try {
    const { userId } = req.body;
    const tokenData = await serverHelper.generateEphemeralToken(userId);
    res.json({ token: tokenData.token });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// App configuration endpoint
app.get('/api/config', (req, res) => {
  res.json({
    snappId: process.env.SNAPP_ID,
    appName: 'Hello World Snapp'
  });
});

app.listen(3001);
```

**Concept Demonstrated**: The secure server architecture handles user lifecycle management, serves the SDK locally, and provides configuration as a single source of truth.

### Step 2: The Client-Side Snapp

Create an HTML page with a shared textarea and JavaScript that initializes the SDK with collaborative tools.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Hello World Snapp</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>Hello, World!</h1>

        <div class="shared-textarea-section">
            <label for="shared-textarea">Shared Text Area (User & Agent):</label>
            <textarea id="shared-textarea" placeholder="Type here... AI agents can also read and write to this area."></textarea>
        </div>

        <div class="connection-status">
            <h3>🔗 Connection Status: <span id="status" class="status-indicator disconnected">Disconnected</span></h3>
        </div>

        <div id="connection-info" class="connection-info">
            <h3>🤖 Agent Connection Details</h3>
            <p>Use this configuration to connect your AI assistant:</p>
            <pre id="mcp-config"></pre>
            <p><strong>Test prompts:</strong></p>
            <ul>
                <li>"Write 'Hello from AI!' in the shared textarea"</li>
                <li>"What's currently in the shared text area?"</li>
                <li>"Add your message to whatever is in the textarea"</li>
            </ul>
        </div>

        <div class="logs-section">
            <div class="logs-header">
                <h3>📝 Logs</h3>
                <button onclick="clearLogs()" class="clear-logs-btn">Clear Logs</button>
            </div>
            <div id="logs" class="logs">
                <div class="log-entry info">Initializing Hello World Snapp...</div>
            </div>
        </div>
    </div>

    <script src="/sdk/snappjack-sdk.min.js"></script>
    <script src="script.js"></script>
</body>
</html>
```

The JavaScript (script.js) handles the SDK integration:

```javascript
// Application configuration and user management
let appConfig = null;
let userId = null;

// Load configuration from server
async function loadAppConfig() {
    const response = await fetch('/api/config');
    appConfig = await response.json();
    return appConfig;
}

// Get or create user session with automatic fallback
async function getUserSession(forceNew = false) {
    const existingUserId = forceNew ? null : localStorage.getItem('hello-world-user-id');

    const response = await fetch('/api/user/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ existingUserId, forceNew })
    });

    const userData = await response.json();
    userId = userData.userId;
    localStorage.setItem('hello-world-user-id', userId);
    return userData;
}

// Token provider calls your secure backend
async function getToken() {
    const response = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    const { token } = await response.json();
    return token;
}

// Initialize the Snapp with collaborative tools
async function initializeSnappjack() {
    await loadAppConfig();
    await getUserSession();

    const snappjack = new Snappjack({
        snappId: appConfig.snappId,
        userId: userId,
        tokenProvider: getToken,

        tools: [{
            name: 'update_textarea',
            description: 'Update the shared textarea content. Use this when the user wants to change or add text to the shared text area that both user and agent can see.',
            inputSchema: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description: 'The new text content for the shared textarea',
                        maxLength: 2000
                    }
                },
                required: ['text']
            },
            handler: async (args) => {
                try {
                    document.getElementById('shared-textarea').value = args.text;
                    return {
                        content: [{ type: 'text', text: 'Update successful.' }],
                        isError: false
                    };
                } catch (error) {
                    return {
                        content: [{ type: 'text', text: `Error: ${error.message}` }],
                        isError: true
                    };
                }
            }
        }, {
            name: 'get_textarea',
            description: 'Get the current content of the shared textarea. Use this to see what the user has typed or what is currently in the shared text area.',
            inputSchema: { type: 'object', properties: {} },
            handler: async (args) => {
                try {
                    const currentText = document.getElementById('shared-textarea').value;
                    return {
                        content: [{ type: 'text', text: currentText || '(textarea is empty)' }],
                        isError: false
                    };
                } catch (error) {
                    return {
                        content: [{ type: 'text', text: `Error: ${error.message}` }],
                        isError: true
                    };
                }
            }
        }]
    });

    // Event-driven connection lifecycle
    snappjack.on('status', (status) => {
        const statusEl = document.getElementById('status');
        statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        statusEl.className = `status-indicator ${status}`;
    });

    snappjack.on('connection-info-updated', (connectionData) => {
        // Build MCP configuration without headers if auth not required
        const connection = {
            type: 'streamableHttp',
            url: connectionData.mcpEndpoint
        };

        if (connectionData.requireAuthHeader) {
            connection.headers = {
                Authorization: `Bearer ${connectionData.userApiKey}`
            };
        }

        const config = { "hello-world": connection };
        document.getElementById('mcp-config').textContent = JSON.stringify(config, null, 2);
        document.getElementById('connection-info').classList.add('visible');
    });

    await snappjack.connect();
}

initializeSnappjack();
```

**Concepts Demonstrated**:
- **Collaborative Tools**: The `update_textarea` and `get_textarea` tools enable bidirectional communication between users and agents in a shared workspace
- **Centralized Configuration**: App config and user management are handled server-side with client automatically fetching configuration
- **MCP-Compliant Responses**: Tools return proper JSON objects with `content` arrays and `isError` flags for robust error handling
- **Real-Time Bridge Connection**: DOM manipulation in tool handlers shows how agent actions immediately affect the live user interface
- **Event-Driven Architecture**: Status listeners and connection info updates demonstrate the connection lifecycle
- **User Persistence**: LocalStorage maintains user identity across sessions with automatic fallback when user IDs become invalid

### Step 3: Connecting the AI Agent

When your Snapp connects, the SDK automatically displays connection details in the Agent Connection Details section. Your users can copy this MCP configuration to their AI assistant:

```json
{
  "hello-world": {
    "type": "streamableHttp",
    "url": "https://bridge.snappjack.com/mcp/hello-world-app/user-abc123",
    "headers": {
      "Authorization": "Bearer uak_xyz789..."
    }
  }
}
```

Note: The `headers` field is only included when authentication is enabled. The demo includes an auth toggle button to switch between authenticated and non-authenticated modes for testing.

Users can then give their AI assistant commands like:

> "Write 'Hello from AI!' in the shared textarea"
> "What's currently in the shared text area?"
> "Add your message to whatever is in the textarea"

**Final Result**: The shared textarea updates in real-time as the agent writes to it, and the agent can also read what the user has typed, creating a collaborative workspace between human and AI.

**Concept Demonstrated**: The Snappjack Bridge acts as the intermediary, routing agent requests to your application and responses back to the agent, all while maintaining real-time state synchronization.

**Note**: This complete example is available in the `snappjack-demo-nodejs-hello-world/` directory. It demonstrates serving the SDK from the installed npm package at `node_modules/@snappjack/sdk-js/dist` via the `/sdk` route, which is the recommended approach for Node.js applications.

## Core Concepts

This section explains the technical architecture that makes Snapps possible.

### The Components of the Snappjack Ecosystem

There are four key players in every Snappjack integration:

1. **The Snapp (Your Client App)**: Your web application with integrated Snappjack SDK
2. **Your Secure Backend**: Server-side code that manages authentication and user identity
3. **The Snappjack Bridge**: Snappjack's service that routes messages between your app and agents
4. **The AI Agent**: User's AI assistant (Claude, ChatGPT, etc.) that connects via MCP

### The Secure Authentication Flow

Security is managed through a client-server pattern that keeps your credentials safe:

- **Secret API Key**: Your `snappApiKey` (starting with `wak_`) is a secret that must never be exposed client-side. Store it securely in environment variables on your server.

- **Ephemeral Token Pattern**: Your client requests a short-lived JWT token from your secure backend. This token expires in 10 seconds and is used solely to initiate the WebSocket connection to the Snappjack Bridge.

- **User Identity Management**: User accounts are created and managed server-side using the `SnappjackServerHelper.createUser()` method. This ensures each user is isolated and secure.

- **Per-User Isolation**: Each user gets their own API key and isolated workspace, preventing any cross-user data access.

### The Real-Time Bridge Connection

The SDK establishes a persistent, stateful WebSocket connection between your application and the Snappjack Bridge:

- **Persistent Connection**: Unlike REST APIs, this connection remains open, allowing for real-time bidirectional communication.

- **Same Instance Interaction**: Agents interact with the exact same application instance that users are viewing, enabling true collaborative experiences.

- **Connection Lifecycle**: Applications move through connection states:
  - `disconnected`: Not connected to Snappjack
  - `connected`: Connected to bridge, waiting for agent
  - `bridged`: Agent connected and ready to interact

- **Event-Driven Architecture**: All state changes are communicated through events rather than polling, ensuring efficient real-time updates.

### The Tool as an API Contract

Tools define the interface between your application and AI agents:

- **Structured Definition**: Each tool has a `name`, `description`, `inputSchema`, and `handler` - creating a complete function signature that AI can understand and use.

- **Semantic Context**: The `description` field provides the contextual information that Large Language Models need to reason about when and how to use the tool.

- **Type Safety**: The `inputSchema` uses JSON Schema to enforce strict data contracts, ensuring agents provide properly formatted inputs.

- **Execution Handler**: The `handler` function contains your business logic and returns structured responses that both agents and your application can process.

- **MCP Compliance**: Tools follow the Model Context Protocol specification, making them compatible with any MCP-enabled AI agent.

## Client SDK Reference

The client SDK runs in your web application and handles the real-time connection to AI agents.

### Initialization

Create a new Snappjack instance with your configuration:

```typescript
const snappjack = new Snappjack({
  // Required parameters
  snappId: 'your-app-id',
  userId: 'unique-user-id',
  tokenProvider: () => getEphemeralToken(),

  // Optional parameters
  tools: [/* tool definitions */],
  requireAuthHeader: true,        // Default: true. Require Bearer token for agents
  autoReconnect: true,           // Default: true. Auto-reconnect on disconnect
  reconnectInterval: 5000,       // Default: 5000ms. Time between reconnect attempts
  maxReconnectAttempts: 10,     // Default: 10. Max reconnection attempts before giving up
  logger: customLogger          // Optional: Custom logger for debugging
});
```

### Defining Tools

Tools expose your app's functionality to AI agents:

```typescript
const tool = {
  name: 'update_budget',
  description: 'Update budget category amounts when user wants to adjust spending limits',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['food', 'transport', 'entertainment']
      },
      amount: {
        type: 'number',
        minimum: 0
      }
    },
    required: ['category', 'amount']
  },
  handler: async (args) => {
    // Your business logic
    await updateBudgetCategory(args.category, args.amount);

    // Return MCP-compliant response
    return {
      content: [{
        type: 'text',
        text: `Updated ${args.category} budget to $${args.amount}`
      }]
    };
  }
};

// Register the tool
snappjack.registerTool(tool);
```

### Connection Management

#### Connection Lifecycle

Your Snapp goes through three connection states:

```text
disconnected → connected → bridged
     ↑             ↓           ↓
     └─────────────┴───────────┘
           (auto-reconnection)
```

- **`disconnected`**: Not connected to Snappjack Bridge
- **`connected`**: Connected to Bridge, waiting for AI agent
- **`bridged`**: AI agent connected and ready to interact

#### Basic Connection Management

```typescript
// Connect to Snappjack Bridge
await snappjack.connect();

// Disconnect when needed
await snappjack.disconnect();

// Check current status
console.log(snappjack.status); // 'disconnected' | 'connected' | 'bridged'
```

#### Auto-Reconnection

The SDK automatically handles connection failures:

```typescript
const snappjack = new Snappjack({
  snappId: 'your-app-id',
  userId: 'user-123',
  tokenProvider: getToken,

  // Auto-reconnection configuration
  autoReconnect: true,           // Enable auto-reconnection (default: true)
  reconnectInterval: 3000,       // Wait 3s between attempts (default: 5000ms)
  maxReconnectAttempts: 5        // Try max 5 times (default: 10)
});

// Listen for reconnection events
snappjack.on('status', (status) => {
  if (status === 'disconnected') {
    console.log('Connection lost, attempting to reconnect...');
  } else if (status === 'connected') {
    console.log('Reconnected successfully!');
  }
});
```

**Auto-reconnection triggers:**
- Network connectivity issues
- Server restarts or maintenance
- WebSocket connection drops
- Authentication token expiration

### Handling Events

The SDK uses an event-driven architecture for all communication:

```typescript
// Connection status changes
snappjack.on('status', (status) => {
  console.log('Connection status:', status);
});

// Connection information for agent setup
snappjack.on('connection-info-updated', (connectionData) => {
  // connectionData contains MCP endpoint URL, user API key, etc.
  showAgentConnectionInstructions(connectionData);
});

// Agent connection events
snappjack.on('agent-connected', (data) => {
  console.log('Agent connected:', data.agentSessionId);
});

snappjack.on('agent-disconnected', (data) => {
  console.log('Agent disconnected:', data.agentSessionId);
});

// Error handling
snappjack.on('error', (error) => {
  console.error('Snappjack error:', error);
});
```

### Tool Management

#### Tool Registration Lifecycle

Tools can be registered before or after connecting:

```typescript
// Option 1: Register tools during initialization
const snappjack = new Snappjack({
  snappId: 'your-app-id',
  userId: 'user-123',
  tokenProvider: getToken,
  tools: [tool1, tool2, tool3]  // Tools available immediately on connection
});

// Option 2: Register tools dynamically
snappjack.registerTool(newTool);  // Available to agents within seconds

// Get all registered tools (without handlers for security)
const toolDefinitions = snappjack.getTools();
console.log(toolDefinitions); // [{ name: 'tool1', description: '...', inputSchema: {...} }]
```

#### Tool Handler Best Practices

```typescript
const tool = {
  name: 'update_user_profile',
  description: 'Update user profile information like name, email, or preferences',
  inputSchema: {
    type: 'object',
    properties: {
      field: { type: 'string', enum: ['name', 'email', 'theme'] },
      value: { type: 'string' }
    },
    required: ['field', 'value']
  },
  handler: async (args) => {
    try {
      // 1. Validate permissions
      if (!userCanEdit(getCurrentUserId(), args.field)) {
        return {
          content: [{ type: 'text', text: 'Permission denied: Cannot edit this field' }],
          isError: true
        };
      }

      // 2. Sanitize input (even with schema validation)
      const sanitizedValue = sanitizeInput(args.value);

      // 3. Perform business logic
      await updateUserField(args.field, sanitizedValue);

      // 4. Update UI immediately for real-time sync
      refreshProfileUI();

      // 5. Return structured success response
      return {
        content: [{
          type: 'text',
          text: `Successfully updated ${args.field} to "${sanitizedValue}"`
        }],
        isError: false
      };

    } catch (error) {
      // Always handle errors gracefully
      console.error('Tool execution failed:', error);
      return {
        content: [{ type: 'text', text: `Failed to update profile: ${error.message}` }],
        isError: true
      };
    }
  }
};
```

#### Tool Availability

- **Registration Timing**: Tools registered before `connect()` are immediately available
- **Dynamic Updates**: Tools registered after connection become available within 2-3 seconds
- **Agent Discovery**: Connected agents automatically discover new tools
- **Error Handling**: Invalid tools are rejected with descriptive error messages

## Server SDK Reference

The server-side SDK handles user management and authentication.

### Setup

```typescript
import { SnappjackServerHelper } from '@snappjack/sdk-js/server';

const serverHelper = new SnappjackServerHelper({
  snappId: 'your-app-id',              // Your app identifier from dashboard
  snappApiKey: process.env.SNAPP_API_KEY // Secret key starting with 'wak_'
});
```

### User Management

#### Create User with Auto-Generated ID

```typescript
const result = await serverHelper.createUser();
// Returns: { userId, userApiKey, snappId, mcpEndpoint, createdAt }
```

#### Register User with Custom ID

```typescript
const result = await serverHelper.registerUser('custom-user-123');
// Returns: { userId, userApiKey, snappId, mcpEndpoint, createdAt }
```

#### Generate Ephemeral Tokens

```typescript
const tokenData = await serverHelper.generateEphemeralToken('user-123');
// Returns: { token, expiresAt, snappId, userId }

// Use in your API endpoint:
app.post('/api/token', async (req, res) => {
  const { userId } = req.body;
  const tokenData = await serverHelper.generateEphemeralToken(userId);
  res.json({ token: tokenData.token });
});
```

### Authentication Requirement Management

Control whether agents need Bearer tokens to connect:

```typescript
// Set default auth requirement during initialization
const snappjack = new Snappjack({
  snappId: 'your-app-id',
  userId: 'user-123',
  tokenProvider: getToken,
  requireAuthHeader: false // Default: true
});

// Change auth requirement at runtime
await snappjack.updateAuthRequirement(false);

// Re-enable authentication requirement
await snappjack.updateAuthRequirement(true);
```

Use cases for disabling authentication:
- Development and testing environments
- Demo applications
- Power user features for faster connections

## Advanced Guide & Best Practices

### Real-Time State Synchronization

Ensure both human users and AI agents operate on the same application state:

```typescript
// Use a centralized state store
class AppState {
  private state = { budget: 1000, categories: {} };
  private listeners = [];

  updateBudget(category, amount) {
    this.state.categories[category] = amount;

    // Notify all listeners (UI components, tool handlers)
    this.listeners.forEach(listener => listener(this.state));
  }

  subscribe(callback) {
    this.listeners.push(callback);
  }
}

const appState = new AppState();

// Tool handler updates shared state
handler: async (args) => {
  appState.updateBudget(args.category, args.amount);
  return { content: [{ type: 'text', text: 'Budget updated' }] };
}

// UI components react to state changes
appState.subscribe((newState) => {
  updateBudgetUI(newState);
});
```

### Framework-Specific Integration Patterns

#### React Integration

```typescript
// Context Provider pattern
const SnappjackContext = createContext();

function SnappjackProvider({ children }) {
  const [snappjack] = useState(() => new Snappjack({
    snappId: 'my-app',
    userId: getCurrentUserId(),
    tokenProvider: getToken,
    tools: createTools()
  }));

  useEffect(() => {
    snappjack.connect();
    return () => snappjack.disconnect(); // Cleanup on unmount
  }, [snappjack]);

  return (
    <SnappjackContext.Provider value={snappjack}>
      {children}
    </SnappjackContext.Provider>
  );
}

// Hook for accessing Snappjack instance
function useSnappjack() {
  return useContext(SnappjackContext);
}
```

#### Vue.js Integration

```typescript
// Vue plugin
const SnappjackPlugin = {
  install(app, options) {
    const snappjack = new Snappjack(options);

    app.config.globalProperties.$snappjack = snappjack;
    app.provide('snappjack', snappjack);

    // Connect on app mount
    snappjack.connect();

    // Cleanup on app unmount
    app._context.app._container.addEventListener('beforeunmount', () => {
      snappjack.disconnect();
    });
  }
};

// Usage
app.use(SnappjackPlugin, {
  snappId: 'my-vue-app',
  userId: 'user-123',
  tokenProvider: getToken,
  tools: myTools
});
```

### Security Best Practices

#### Permission Validation

Always validate user permissions in tool handlers:

```typescript
handler: async (args) => {
  // Get current user context
  const user = await getCurrentUser();

  // Validate permissions before executing
  if (!user.canEditBudget(args.budgetId)) {
    throw new Error('You do not have permission to edit this budget');
  }

  // Validate data ownership
  const budget = await getBudget(args.budgetId);
  if (budget.userId !== user.id) {
    throw new Error('Budget not found');
  }

  // Execute the operation
  await updateBudget(args);

  return { content: [{ type: 'text', text: 'Budget updated successfully' }] };
}
```

#### Input Sanitization

Sanitize inputs even with schema validation:

```typescript
handler: async (args) => {
  // Schema validation happens automatically, but add extra sanitization
  const sanitizedText = args.message
    .trim()
    .substring(0, 500) // Limit length
    .replace(/<script>/gi, ''); // Remove dangerous content

  await updateMessage(sanitizedText);
}
```

#### Audit Trails

Log agent actions for security and debugging:

```typescript
handler: async (args) => {
  // Log the action
  await auditLog.record({
    userId: getCurrentUserId(),
    action: 'budget_update',
    parameters: args,
    timestamp: new Date(),
    source: 'agent'
  });

  // Execute the operation
  const result = await updateBudget(args);

  // Log the result
  await auditLog.record({
    userId: getCurrentUserId(),
    action: 'budget_update_complete',
    result: result,
    timestamp: new Date()
  });

  return result;
}
```

### Implementation Checklist

Before deploying your Snapp, ensure you have:

#### Server Setup
- [ ] Created secure API endpoints for user management and token generation
- [ ] Stored `SNAPP_API_KEY` securely in environment variables
- [ ] Implemented proper error handling for token generation
- [ ] Added rate limiting to prevent abuse

#### Client Integration
- [ ] Initialized SDK with proper configuration and event listeners
- [ ] Implemented token provider that calls your secure backend
- [ ] Added connection status UI for user feedback
- [ ] Handled connection errors and reconnection gracefully

#### Tool Development
- [ ] Defined tools that expose your app's core functionality
- [ ] Written clear, AI-friendly descriptions for each tool
- [ ] Implemented proper JSON Schema validation
- [ ] Added permission validation in all tool handlers

#### State Management
- [ ] Ensured shared state between human and agent interactions
- [ ] Implemented immediate UI updates for agent actions
- [ ] Added proper cleanup on component unmount
- [ ] Tested real-time synchronization thoroughly

#### Security & Validation
- [ ] Added authentication and permission checks
- [ ] Implemented input sanitization beyond schema validation
- [ ] Added audit trails for agent actions
- [ ] Tested with malicious inputs

#### User Experience
- [ ] Provided clear instructions for connecting AI agents
- [ ] Added connection status indicators
- [ ] Implemented error handling with user-friendly messages
- [ ] Tested the complete user-to-agent workflow

## API Reference

### Snappjack (Client SDK)

#### Constructor

```typescript
new Snappjack(config: {
  // Required parameters
  snappId: string;                          // Your unique app identifier
  userId: string;                           // Unique user identifier
  tokenProvider: () => Promise<string>;     // Function that returns ephemeral token

  // Optional parameters
  tools?: Tool[];                           // Initial tools to register
  requireAuthHeader?: boolean;              // Default: true. Require Bearer token for agents
  autoReconnect?: boolean;                  // Default: true. Auto-reconnect on disconnect
  reconnectInterval?: number;               // Default: 5000. Milliseconds between reconnect attempts
  maxReconnectAttempts?: number;           // Default: 10. Max reconnection attempts
  logger?: Logger;                         // Custom logger for debugging
})
```

#### Methods

**Connection Management:**
- `connect(): Promise<void>` - Establish connection to Snappjack Bridge
- `disconnect(): Promise<void>` - Close connection and stop auto-reconnection
- `status: string` - Current connection status (`disconnected` | `connected` | `bridged`)

**Tool Management:**
- `registerTool(tool: Tool): void` - Register a new tool (available to agents within seconds)
- `getTools(): ToolDefinition[]` - Get all registered tool definitions (excludes handlers)

**Authentication:**
- `updateAuthRequirement(requireAuthHeader: boolean): Promise<void>` - Update auth requirement in real-time

**Event Handling:**
- `on(event: string, listener: Function): Snappjack` - Add event listener
- `off(event: string, listener: Function): Snappjack` - Remove event listener

#### Events

**Connection Events:**
- `status` - Connection status changed
  ```typescript
  snappjack.on('status', (status: 'disconnected' | 'connected' | 'bridged') => {
    console.log('Status:', status);
  });
  ```

- `connection-info-updated` - Connection information available for agent setup
  ```typescript
  snappjack.on('connection-info-updated', (data: {
    mcpEndpoint: string;      // MCP endpoint URL for agents
    userApiKey: string;       // User API key for agents
    requireAuthHeader: boolean; // Whether auth is currently required
  }) => {
    showAgentInstructions(data);
  });
  ```

**Agent Events:**
- `agent-connected` - AI agent connected
  ```typescript
  snappjack.on('agent-connected', (data: { agentSessionId: string }) => {
    console.log('Agent connected:', data.agentSessionId);
  });
  ```

- `agent-disconnected` - AI agent disconnected
  ```typescript
  snappjack.on('agent-disconnected', (data: { agentSessionId: string }) => {
    console.log('Agent disconnected:', data.agentSessionId);
  });
  ```

**Error Events:**
- `error` - Error occurred
  ```typescript
  snappjack.on('error', (error: Error) => {
    console.error('Snappjack error:', error);
  });
  ```

### SnappjackServerHelper (Server SDK)

#### Constructor

```typescript
new SnappjackServerHelper(config: {
  snappId: string;      // Your app identifier from dashboard
  snappApiKey: string;  // Secret key starting with 'wak_' (never expose client-side)
})
```

#### Methods

**User Management:**
- `createUser(): Promise<UserResult>` - Create new user with auto-generated UUID
- `registerUser(userId: string): Promise<UserResult>` - Register user with custom ID
- `generateEphemeralToken(userId: string): Promise<TokenResult>` - Generate short-lived token (expires in 10 seconds)

**Connection Testing:**
- `testConnection(): Promise<{ success: boolean; error?: string }>` - Test connection to Snappjack servers

#### Response Types

```typescript
interface UserResult {
  userId: string;        // The user's unique identifier
  userApiKey: string;    // User's API key (starts with 'uak_')
  snappId: string;       // Your app identifier
  mcpEndpoint: string;   // MCP endpoint URL for agents
  createdAt: string;     // ISO timestamp of user creation
}

interface TokenResult {
  token: string;         // JWT token for WebSocket authentication
  expiresAt: number;     // Unix timestamp when token expires
  snappId: string;       // Your app identifier
  userId: string;        // User identifier this token is for
}
```

#### Error Handling

```typescript
import { SnappjackHttpError } from '@snappjack/sdk-js/server';

try {
  const user = await serverHelper.createUser();
} catch (error) {
  if (error instanceof SnappjackHttpError) {
    console.error('HTTP Error:', error.status, error.body);
  } else {
    console.error('Other error:', error.message);
  }
}
```

## Resources

- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [MCP Tool Documentation](https://modelcontextprotocol.io/docs/concepts/tools)
- [JSON Schema Documentation](https://json-schema.org/)
- [Snappjack Support](mailto:developers@snappjack.com)

## License

MIT License - See LICENSE file for details