import http from 'node:http';
import type Database from 'better-sqlite3';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AgencyConfig } from './types.js';
import { TOOL_DEFINITIONS, createToolHandlers } from './tools.js';

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

interface Session {
  transport: StreamableHTTPServerTransport;
  server: Server;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

function registerTools(
  server: Server,
  db: Database.Database,
  config: AgencyConfig,
): void {
  const handlers = createToolHandlers(db, config);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];

    if (!handler) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: 'unknown_tool', message: `Tool "${name}" not found.` }),
          },
        ],
        isError: true,
      };
    }

    const result = handler(args ?? {});
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result),
        },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const startTime = Date.now();

/**
 * Start an HTTP server that speaks the MCP Streamable HTTP protocol.
 *
 * - GET /health  — lightweight health check
 * - POST /mcp    — create session / send requests
 * - GET /mcp     — SSE stream for existing sessions
 * - DELETE /mcp  — terminate a session
 * - OPTIONS      — CORS preflight
 */
export function startHttpServer(
  db: Database.Database,
  config: AgencyConfig,
): http.Server {
  const sessions = new Map<string, Session>();
  const port = parseInt(process.env.PORT ?? '3000', 10);

  function setCorsHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, mcp-session-id',
    );
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  }

  function sendJson(
    res: http.ServerResponse,
    status: number,
    body: unknown,
  ): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(payload);
  }

  async function handleHealth(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    // A degraded check could inspect db connectivity; for now keep it simple.
    const healthy = db.open;
    sendJson(res, 200, {
      status: healthy ? 'ok' : 'degraded',
      server: config.serverName,
      version: config.version,
      uptime_seconds: uptimeSeconds,
    });
  }

  async function handlePostMcp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // Existing session — forward the request
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      return;
    }

    // New session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, { transport, server: mcpServer });
      },
    });

    const mcpServer = new Server(
      { name: config.serverName, version: config.version },
      { capabilities: { tools: {} } },
    );

    registerTools(mcpServer, db, config);

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  }

  async function handleGetMcp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      return;
    }

    // No session — return server metadata
    sendJson(res, 200, {
      server: config.serverName,
      version: config.version,
      protocol: 'mcp-streamable-http',
    });
  }

  async function handleDeleteMcp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.server.close();
      sessions.delete(sessionId);
      res.writeHead(204);
      res.end();
      return;
    }

    sendJson(res, 404, { error: 'session_not_found' });
  }

  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res);

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const method = req.method?.toUpperCase();

    try {
      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (path === '/health' && method === 'GET') {
        await handleHealth(req, res);
        return;
      }

      if (path === '/mcp') {
        if (method === 'POST') {
          await handlePostMcp(req, res);
          return;
        }
        if (method === 'GET') {
          await handleGetMcp(req, res);
          return;
        }
        if (method === 'DELETE') {
          await handleDeleteMcp(req, res);
          return;
        }
      }

      sendJson(res, 404, { error: 'not_found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: 'internal', message });
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    for (const [id, session] of sessions) {
      session.server.close().catch(() => {});
      sessions.delete(id);
    }
    server.close();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`${config.serverName} listening on port ${port}`);
  });

  return server;
}
