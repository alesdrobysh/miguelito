import { BuddyDb } from "../db.js";
import { createVocabTools } from "./vocab.js";
import { createErrorTools } from "./errors.js";
import { createProfileTools } from "./profile.js";
import { createConversationTools } from "./conversation.js";
import { createAssessmentTools } from "./assessment.js";
import { createReadingTools } from "./reading.js";
import { createInterestTools } from "./interests.js";
import { createProgressTools } from "./progress.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, string>) => Promise<Record<string, unknown>>;
}

export interface ToolContext {
  db: BuddyDb;
  apiKey: string | null;
}

export function createTools(db: BuddyDb, openrouterApiKey: string): Map<string, ToolDefinition> {
  const ctx: ToolContext = { db, apiKey: openrouterApiKey };
  const tools = new Map<string, ToolDefinition>();

  for (const t of [
    ...createConversationTools(ctx),
    ...createVocabTools(ctx),
    ...createErrorTools(ctx),
    ...createProfileTools(ctx),
    ...createAssessmentTools(ctx),
    ...createReadingTools(ctx),
    ...createInterestTools(ctx),
    ...createProgressTools(ctx),
  ]) {
    tools.set(t.name, t);
  }

  return tools;
}

export function toolsToOpenAI(tools: Map<string, ToolDefinition>): object[] {
  return Array.from(tools.values()).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
