import type { ChatMessage, ToolCall } from "../llm.js";
import type { ToolDefinition } from "../tools/index.js";
import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: 'tool' });

export async function callTool(tc: ToolCall, tools: Map<string, ToolDefinition>): Promise<ChatMessage & { toolCalled: boolean }> {
  const tool = tools.get(tc.function.name);
  if (!tool) {
    log.warn({ name: tc.function.name }, 'unknown tool called');
    return {
      role: "tool",
      content: `Error: tool "${tc.function.name}" not found`,
      tool_call_id: tc.id,
      name: tc.function.name,
      toolCalled: false,
    };
  }

  let args: Record<string, string>;
  try {
    const parsed = JSON.parse(tc.function.arguments) as Record<string, unknown>;
    args = {};
    for (const [k, v] of Object.entries(parsed)) {
      args[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  } catch {
    args = {};
  }

  const start = Date.now();
  log.debug({ name: tc.function.name, args: JSON.stringify(args).slice(0, 200) }, 'tool dispatched');

  try {
    const toolResult = await tool.execute(args);
    log.debug({ name: tc.function.name, durationMs: Date.now() - start, success: true }, 'tool result');
    return {
      role: "tool",
      content: JSON.stringify(toolResult),
      tool_call_id: tc.id,
      name: tc.function.name,
      toolCalled: true,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.debug({ name: tc.function.name, durationMs: Date.now() - start, success: false, error: message }, 'tool result');
    return {
      role: "tool",
      content: `Error: ${message}`,
      tool_call_id: tc.id,
      name: tc.function.name,
      toolCalled: false,
    };
  }
}
