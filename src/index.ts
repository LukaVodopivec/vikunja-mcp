#!/usr/bin/env node

/**
 * Vikunja MCP Server
 * Main entry point for the Model Context Protocol server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

import { AuthManager } from './auth/AuthManager';
import { registerTools } from './tools';
import { logger } from './utils/logger';
import { createSecureConnectionMessage, createSecureLogConfig } from './utils/security';
import { createVikunjaClientFactory, setGlobalClientFactory, type VikunjaClientFactory } from './client';

dotenv.config({ quiet: true });

const server = new McpServer({
  name: 'vikunja-mcp',
  version: '0.2.0',
});

const authManager = new AuthManager();
type TransportMode = 'stdio' | 'http';

function getTransportMode(argv: string[] = process.argv): TransportMode {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }

    if (arg === '--transport' && argv[i + 1]) {
      return argv[i + 1]?.toLowerCase() === 'http' ? 'http' : 'stdio';
    }
    if (arg.startsWith('--transport=')) {
      const value = arg.slice('--transport='.length).toLowerCase();
      return value === 'http' ? 'http' : 'stdio';
    }
  }

  return process.env.MCP_TRANSPORT?.toLowerCase() === 'http' ? 'http' : 'stdio';
}

const transportMode = getTransportMode();

function tryAutoAuthenticate(): void {
  if (!(process.env.VIKUNJA_URL && process.env.VIKUNJA_API_TOKEN)) {
    return;
  }

  const connectionMessage = createSecureConnectionMessage(
    process.env.VIKUNJA_URL,
    process.env.VIKUNJA_API_TOKEN
  );
  logger.info(`Auto-authenticating: ${connectionMessage}`);
  authManager.connect(process.env.VIKUNJA_URL, process.env.VIKUNJA_API_TOKEN);
  const detectedAuthType = authManager.getAuthType();
  logger.info(`Using detected auth type: ${detectedAuthType}`);
}

tryAutoAuthenticate();

let clientFactory: VikunjaClientFactory | null = null;

async function initializeFactory(): Promise<void> {
  try {
    clientFactory = await createVikunjaClientFactory(authManager);
    if (clientFactory) {
      await setGlobalClientFactory(clientFactory);
    }
  } catch (error) {
    logger.warn('Failed to initialize client factory during startup:', error);
    // Factory will be initialized on first authentication
  }
}

// Initialize factory during module load for both production and test environments
// This ensures the factory is available for tests
export const factoryInitializationPromise = initializeFactory()
  .then(() => {
    try {
      if (clientFactory) {
        if (transportMode === 'http') {
          registerTools(server, authManager, clientFactory, { enableAuthTool: false });
        } else {
          registerTools(server, authManager, clientFactory);
        }
      } else {
        if (transportMode === 'http') {
          registerTools(server, authManager, undefined, { enableAuthTool: false });
        } else {
          registerTools(server, authManager, undefined);
        }
      }
    } catch (error) {
      logger.error('Failed to initialize:', error);
      // Fall back to legacy registration for backwards compatibility
      if (transportMode === 'http') {
        registerTools(server, authManager, undefined, { enableAuthTool: false });
      } else {
        registerTools(server, authManager, undefined);
      }
    }
  })
  .catch((error) => {
    logger.warn('Failed to initialize client factory during module load:', error);
    if (transportMode === 'http') {
      registerTools(server, authManager, undefined, { enableAuthTool: false });
    } else {
      registerTools(server, authManager, undefined);
    }
  });

async function main(): Promise<void> {
  await factoryInitializationPromise;

  if (transportMode === 'http') {
    if (!(process.env.VIKUNJA_URL && process.env.VIKUNJA_API_TOKEN)) {
      throw new Error(
        'HTTP transport requires VIKUNJA_URL and VIKUNJA_API_TOKEN to be configured.'
      );
    }

    const host = process.env.MCP_HOST ?? '127.0.0.1';
    const rawPort = process.env.MCP_PORT ?? '9718';
    const port = Number.parseInt(rawPort, 10);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`Invalid MCP_PORT: ${rawPort}`);
    }

    type SessionContext = {
      server: McpServer;
      transport: StreamableHTTPServerTransport;
    };

    const sessionContexts = new Map<string, SessionContext>();

    const createSessionContext = async (): Promise<SessionContext> => {
      const sessionServer = new McpServer({
        name: 'vikunja-mcp',
        version: '0.2.0',
      });

      registerTools(
        sessionServer,
        authManager,
        clientFactory ?? undefined,
        { enableAuthTool: false }
      );

      let contextRef!: SessionContext;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          sessionContexts.set(sessionId, contextRef);
        },
        onsessionclosed: async (sessionId) => {
          const existingContext = sessionContexts.get(sessionId);
          if (!existingContext) {
            return;
          }

          sessionContexts.delete(sessionId);
          await existingContext.server.close().catch((error: unknown) => {
            logger.warn(`Failed to close MCP session server ${sessionId}:`, error);
          });
        },
      });

      contextRef = { server: sessionServer, transport };
      await sessionServer.connect(
        transport as unknown as Parameters<typeof sessionServer.connect>[0]
      );
      return contextRef;
    };

    const parseRequestBody = async (req: IncomingMessage): Promise<unknown> => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }

      if (chunks.length === 0) {
        return undefined;
      }

      const payload = Buffer.concat(chunks).toString('utf8').trim();
      if (!payload) {
        return undefined;
      }

      return JSON.parse(payload) as unknown;
    };

    const httpServer = createServer(async (req, res) => {
      try {
        const requestUrl = new URL(req.url ?? '/', `http://${host}:${port}`);

        if (requestUrl.pathname === '/healthz' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        if (requestUrl.pathname === '/mcp') {
          let parsedBody: unknown;
          if (req.method === 'POST') {
            try {
              parsedBody = await parseRequestBody(req);
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32700, message: 'Parse error: Invalid JSON' },
                id: null,
              }));
              return;
            }
          }

          const rawSessionId = req.headers['mcp-session-id'];
          const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

          let sessionContext = sessionId ? sessionContexts.get(sessionId) : undefined;
          if (!sessionContext && req.method === 'POST') {
            sessionContext = await createSessionContext();
          }

          if (!sessionContext) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32001, message: 'Session not found' },
              id: null,
            }));
            return;
          }

          await sessionContext.transport.handleRequest(req, res, parsedBody);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (error) {
        logger.error('HTTP request handler failed:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => resolve());
    });

    logger.info(`Vikunja MCP server started (http) on http://${host}:${port}/mcp`);
    logger.info(`Health check endpoint: http://${host}:${port}/healthz`);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('Vikunja MCP server started (stdio)');
  }
  
  const config = createSecureLogConfig({
    mode: process.env.MCP_MODE ?? transportMode,
    debug: process.env.DEBUG,
    hasAuth: !!process.env.VIKUNJA_URL && !!process.env.VIKUNJA_API_TOKEN,
    url: process.env.VIKUNJA_URL,
    token: process.env.VIKUNJA_API_TOKEN,
  });
  
  logger.debug('Configuration loaded', config);
}

// Only start the server if not in test environment
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  main().catch((error) => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });
}

// Essential exports only - eliminated 80+ lines of unnecessary barrel exports
// Use direct imports instead of centralized re-exports for better tree-shaking

// Core types that are commonly imported by external code
export { MCPError, ErrorCode } from './types/errors';
export type { TaskResponseData, FilterExpression, Task } from './types';
export type { ParseResult } from './types/filters';
export type { AorpBuilderConfig, AorpFactoryResult } from './types';

// Core utilities that are widely used across the codebase
export { logger } from './utils/logger';
export { isAuthenticationError } from './utils/auth-error-handler';
export { withRetry, RETRY_CONFIG } from './utils/retry';
export { transformApiError, handleFetchError, handleStatusCodeError } from './utils/error-handler';
export { parseFilterString } from './utils/filters';
export { validateTaskCountLimit } from './utils/memory';
export { createStandardResponse, createAorpErrorResponse as createErrorResponse } from './utils/response-factory';

// Additional exports for task modules
export type { SimpleResponse } from './utils/simple-response';

// Client utilities for external usage
export { getClientFromContext, clearGlobalClientFactory } from './client';
