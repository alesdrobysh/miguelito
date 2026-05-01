import fs from "fs";
import { ChatMessage, LLMConfig, llmChat } from "./llm.js";
import { BuddyDb } from "./db.js";
import { createTools, toolsToOpenAI } from "./tools/index.js";
import { buildProfileInjection } from "./profile-injector.js";

const MAX_TOOL_ITERATIONS = 10;

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

  const { learnerProfile, userInterests } = await buildProfileInjection(db);
  const profile = await db.getProfile();
  const nativeLanguage = profile?.native_language ?? "the user's native language";

  let fullSystem = soulContent;
  if (learnerProfile) {
    fullSystem += learnerProfile;
  }
  if (userInterests) {
    fullSystem += userInterests;
  }

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
      break;
    }

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: result.content ?? "",
      tool_calls: result.toolCalls,
    };
    messages.push(assistantMsg);

    for (const tc of result.toolCalls) {
      const tool = tools.get(tc.function.name);
      if (!tool) {
        messages.push({
          role: "tool",
          content: `Error: tool "${tc.function.name}" not found`,
          tool_call_id: tc.id,
          name: tc.function.name,
        });
        continue;
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
      toolCallsMade++;

      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult),
        tool_call_id: tc.id,
        name: tc.function.name,
      });
    }
  }

  return { text: totalText, toolCallsMade };
}
