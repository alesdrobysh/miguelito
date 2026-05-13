import type { VocabRepository, ErrorRepository, ProfileRepository, InterestRepository, CompetencyRepository } from "../repositories/interfaces.js";
import type { LLMProvider } from "../providers/interfaces.js";
import { createVocabTools } from "./vocab.js";
import { createErrorTools } from "./errors.js";
import { createProfileTools } from "./profile.js";
import { createReadingTools } from "./reading.js";
import { createInterestTools } from "./interests.js";
import { createProgressTools } from "./progress.js";
import { createAnnotateTools } from "./annotate.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, string>) => Promise<Record<string, unknown>>;
}

export interface ToolContext {
  vocab: VocabRepository;
  errors: ErrorRepository;
  profile: ProfileRepository;
  interests: InterestRepository;
  competency: CompetencyRepository;
  provider: LLMProvider | null;
}

export function createTools(ctx: ToolContext): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();

  for (const t of [
    ...createVocabTools(ctx),
    ...createErrorTools(ctx),
    ...createProfileTools(ctx),
    ...createReadingTools(ctx),
    ...createInterestTools(ctx),
    ...createProgressTools(ctx),
    ...createAnnotateTools(ctx),
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
