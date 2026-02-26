import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ── Types ──────────────────────────────────────────────────────────

interface FieldInfo {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
  default?: unknown;
}

interface ToolMeta {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}

// ── Schema Introspection ───────────────────────────────────────────

function unwrap(schema: z.ZodType): { inner: z.ZodType; optional: boolean; defaultValue?: unknown } {
  let optional = false;
  let defaultValue: unknown = undefined;
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional) {
      optional = true;
      current = current.unwrap();
    } else if (current instanceof z.ZodDefault) {
      optional = true;
      defaultValue = current._def.defaultValue();
      current = current.removeDefault();
    } else if (current instanceof z.ZodNullable) {
      optional = true;
      current = current.unwrap();
    } else {
      break;
    }
  }
  return { inner: current, optional, defaultValue };
}

function detectType(schema: z.ZodType): { type: string; enumValues?: string[] } {
  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodArray) return { type: 'array' };
  if (schema instanceof z.ZodObject) return { type: 'object' };
  if (schema instanceof z.ZodEnum) return { type: 'enum', enumValues: schema.options as string[] };
  return { type: 'unknown' };
}

function extractSchemaInfo(schema: z.ZodType): { fields: FieldInfo[]; example: Record<string, unknown> } {
  if (!(schema instanceof z.ZodObject)) return { fields: [], example: {} };
  const shape = schema.shape as Record<string, z.ZodType>;
  const fields: FieldInfo[] = [];
  const example: Record<string, unknown> = {};

  for (const [name, fieldSchema] of Object.entries(shape)) {
    const { inner, optional, defaultValue } = unwrap(fieldSchema);
    const { type, enumValues } = detectType(inner);
    const description = fieldSchema.description ?? inner.description;

    fields.push({
      name,
      type,
      required: !optional,
      ...(description ? { description } : {}),
      ...(enumValues ? { enumValues } : {}),
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    });

    // Example value
    const ev =
      defaultValue !== undefined
        ? defaultValue
        : type === 'string'
          ? 'example'
          : type === 'number'
            ? 1
            : type === 'boolean'
              ? true
              : type === 'enum'
                ? (enumValues?.[0] ?? 'example')
                : null;
    example[name] = ev;
  }

  return { fields, example };
}

function formatFieldDocs(fields: FieldInfo[]): string {
  if (fields.length === 0) return '(none)';

  const lines = fields.map((f) => {
    const parts = [`  - ${f.name} (${f.type}, ${f.required ? 'required' : 'optional'})`];
    if (f.description) parts.push(`: ${f.description}`);
    const suffixes: string[] = [];
    if (f.enumValues?.length) suffixes.push(`[enum: ${f.enumValues.join(', ')}]`);
    if (f.default !== undefined) suffixes.push(`[default: ${JSON.stringify(f.default)}]`);
    if (suffixes.length) parts.push(` ${suffixes.join(' ')}`);
    return parts.join('');
  });

  return lines.join('\n');
}

// ── Help Text Builder ──────────────────────────────────────────────

function buildToolHelpText(tool: ToolMeta, errorContext?: string): string {
  const sections: string[] = [];
  sections.push(`# ${tool.name}`);
  sections.push('\n## Description\n');
  sections.push(tool.description);

  let fields: FieldInfo[] = [];
  let example: Record<string, unknown> = {};
  try {
    ({ fields, example } = extractSchemaInfo(tool.inputSchema));
  } catch (err) {
    console.error(`Schema introspection failed for tool "${tool.name}":`, err);
  }

  sections.push('\n## Parameters\n');
  sections.push(formatFieldDocs(fields));

  if (Object.keys(example).length > 0) {
    sections.push('\n## Example\n');
    sections.push('```json');
    sections.push(JSON.stringify(example, null, 2));
    sections.push('```');
  }

  if (errorContext) {
    sections.push('\n## Error Guidance\n');
    sections.push(buildErrorGuidance(errorContext));
  }

  return sections.join('\n');
}

function suggestSimilarTools(
  query: string,
  availableNames: string[],
  maxSuggestions = 5,
): { message: string; suggestions: string[] } {
  const sorted = [...availableNames].sort();
  const suggestions = sorted
    .filter((n) => n.includes(query) || query.includes(n))
    .slice(0, maxSuggestions);

  const parts = [`Tool "${query}" not found.`];
  if (suggestions.length > 0) parts.push(`\nDid you mean: ${suggestions.join(', ')}?`);
  parts.push(`\nTotal available tools: ${sorted.length}`);

  return { message: parts.join(''), suggestions };
}

function buildErrorGuidance(errorContext: string): string {
  const lower = errorContext.toLowerCase();

  if (lower.includes('validation') || lower.includes('invalid') || lower.includes('required'))
    return 'This appears to be a validation error. Check the Parameters section above for required fields and valid types/values.';

  if (lower.includes('pool') || lower.includes('connection') || lower.includes('database'))
    return 'This is a database connection error. Verify the database alias exists by calling available_databases first.';

  if (lower.includes('not found') || lower.includes('no rows'))
    return 'The requested resource was not found. Check available aliases with available_databases.';

  if (lower.includes('timeout'))
    return 'The operation timed out. Try again or consider reducing the scope of the request.';

  if (lower.includes('permission') || lower.includes('denied'))
    return 'Permission denied. Check that the PostgreSQL user has the necessary privileges.';

  return `Error message: "${errorContext}"\nCheck the parameters and ensure all required fields are provided correctly.`;
}

// ── Tool Tracking & Registration ───────────────────────────────────

const toolRegistry = new Map<string, ToolMeta>();

export function withToolTracking(server: McpServer): McpServer {
  const originalTool = server.tool.bind(server);

  (server as any).tool = function (...args: any[]) {
    if (args.length >= 3 && typeof args[0] === 'string' && typeof args[1] === 'string') {
      const name: string = args[0];
      const description: string = args[1];
      const schemaShape = args[2];

      let inputSchema: z.ZodType;
      if (schemaShape && typeof schemaShape === 'object' && !(schemaShape instanceof z.ZodType)) {
        try {
          inputSchema = z.object(schemaShape);
        } catch (err) {
          console.error(`Failed to construct Zod schema for tool "${name}":`, err);
          inputSchema = z.object({});
        }
      } else if (schemaShape instanceof z.ZodType) {
        inputSchema = schemaShape;
      } else {
        inputSchema = z.object({});
      }

      toolRegistry.set(name, { name, description, inputSchema });
    }

    return (originalTool as (...a: any[]) => any)(...args);
  };

  return server;
}

export function registerToolHelp(server: McpServer): void {
  const schema = {
    tool_name: z.string().describe('Name of the tool to get help for'),
    error_context: z
      .string()
      .optional()
      .describe('Paste an error message for targeted guidance'),
  };

  toolRegistry.set('tool_help', {
    name: 'tool_help',
    description:
      'Get detailed usage help for any tool. Returns description, parameters, examples, and error guidance.',
    inputSchema: z.object(schema),
  });

  server.tool(
    'tool_help',
    'Get detailed usage help for any tool. Returns description, parameters, examples, and error guidance.',
    schema,
    async (args) => {
      const toolName = args.tool_name as string;
      const errorContext = args.error_context as string | undefined;

      const meta = toolRegistry.get(toolName);
      if (!meta) {
        const notFound = suggestSimilarTools(toolName, [...toolRegistry.keys()]);
        return {
          content: [{ type: 'text' as const, text: notFound.message }],
          isError: true,
        };
      }

      const helpText = buildToolHelpText(
        { name: meta.name, description: meta.description, inputSchema: meta.inputSchema },
        errorContext,
      );

      return {
        content: [{ type: 'text' as const, text: helpText }],
        isError: false,
      };
    },
  );
}
