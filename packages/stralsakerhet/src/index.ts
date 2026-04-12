import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  openDatabase,
  TOOL_DEFINITIONS,
  createToolHandlers,
} from '@ansvar/swe-fleet-core';
import { CONFIG } from './config.js';

const dbPath =
  process.env.SSM_DB_PATH ??
  process.env.DB_PATH ??
  'data/database.db';

const { instance: db } = openDatabase(dbPath);
const handlers = createToolHandlers(db, CONFIG);

const server = new Server(
  { name: CONFIG.serverName, version: CONFIG.version },
  { capabilities: { tools: {} } },
);

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
          text: JSON.stringify({
            error: 'unknown_tool',
            message: `Tool "${name}" not found.`,
          }),
        },
      ],
      isError: true,
    };
  }

  const result = handler(args ?? {});
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
