import fs from "fs";
import { ChatMessage, LLMConfig, ToolCall, llmChat } from "./llm.js";
import { BuddyDb } from "./db.js";
import { createTools, ToolDefinition, toolsToOpenAI } from "./tools/index.js";
import { buildProfileInjection } from "./profile-injector.js";

const MAX_TOOL_ITERATIONS = 10;
const CONV_STATE_PARSE_RE = /\[CONV_STATE:\s*(REACT|DIG|OFFER|TEACH|PLAY)(?:,\s*([^,\]]+))?(?:,\s*([^,\]]+))?\]/;
const CONV_STATE_STRIP_RE = /\s*\[CONV_STATE:[^\]]*\]\s*$/;

export interface AgentResult {
  text: string;
  toolCallsMade: number;
}

export async function runAgentLoop(
  config: LLMConfig,
  db: BuddyDb,
  userMessage: string,
  chatHistory: ChatMessage[],
  systemPromptPath: string,
): Promise<AgentResult> {
  const soulContent = fs.readFileSync(systemPromptPath, "utf-8");

  const { basicProfile, learnerProfile, userInterests, nativeLanguage } = await buildProfileInjection(db);

  let fullSystem = soulContent + basicProfile;
  if (learnerProfile) {
    fullSystem += learnerProfile;
  }
  if (userInterests) {
    fullSystem += userInterests;
  }

  const convState = await db.getConversationState();
  fullSystem += `\n\n## Conversation State
Turn count: ${convState.session.turn_count}
Last modes: ${convState.session.last_two_modes}
Mood hint: ${convState.session.mood_hint ?? "neutral"}
Topics touched: ${convState.session.topics_touched}
`;

  const messages: ChatMessage[] = [
    { role: "system", content: fullSystem },
    ...chatHistory,
    { role: "user", content: userMessage },
  ];

  const tools = createTools(db, config.apiKey, nativeLanguage);
  const openaiTools = toolsToOpenAI(tools);

  let totalText = "";
  let toolCallsMade = 0;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const result = await llmChat(config, messages, openaiTools, 0.7, 4096);

    if (result.content) {
      totalText += result.content;
    }

    if (result.toolCalls.length === 0) {
      const match = totalText.match(CONV_STATE_PARSE_RE);
      if (match) {
        const mode = match[1];
        const topic = match[2]?.trim() || undefined;
        const mood = match[3]?.trim() || undefined;
        await db.updateConversationState(mode, topic, mood);
      }
      totalText = totalText.replace(CONV_STATE_STRIP_RE, "").trim();
      break;
    }

    messages.push({
      role: "assistant",
      content: result.content ?? "",
      tool_calls: result.toolCalls,
    });

    const toolCalls = result.toolCalls.map((tc) => callTool(tc, tools));
    const toolResults = await Promise.all(toolCalls);
    messages.push(...toolResults);
    toolCallsMade += toolResults.filter((tr) => tr.toolCalled).length;
  }

  return { text: totalText, toolCallsMade };
};

async function callTool(tc: ToolCall, tools: Map<string, ToolDefinition>): Promise<ChatMessage & { toolCalled: boolean }> {
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
