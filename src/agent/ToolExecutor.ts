import type { ChatMessage, ToolCall } from "../llm.js";
import type { ToolDefinition } from "../tools/index.js";

export async function callTool(tc: ToolCall, tools: Map<string, ToolDefinition>): Promise<ChatMessage & { toolCalled: boolean }> {
  const tool = tools.get(tc.function.name);
  if (!tool) {
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

  const toolResult = await tool.execute(args);

  return {
    role: "tool",
    content: JSON.stringify(toolResult),
    tool_call_id: tc.id,
    name: tc.function.name,
    toolCalled: true,
  };
}
