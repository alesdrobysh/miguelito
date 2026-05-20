import type { VocabRepository, ErrorRepository, ProfileRepository, InterestRepository, CompetencyRepository, SessionRepository } from "../repositories/interfaces.js";
import type { LLMProvider } from "../providers/interfaces.js";
import { createVocabTools } from "./vocab.js";
import { createErrorTools } from "./errors.js";
import { createProfileTools } from "./profile.js";
import { createReadingTools } from "./reading.js";
import { createInterestTools } from "./interests.js";
import { createProgressTools } from "./progress.js";
import { createAnnotateTools } from "./annotate.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";

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
  langProfile: ProfileRepository;
  interests: InterestRepository;
  competency: CompetencyRepository;
  session: SessionRepository;
  provider: LLMProvider | null;
}

export function createTools(ctx: ToolContext, lang: LanguageConfig): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();

  for (const t of [
    ...createVocabTools(ctx),
    ...createErrorTools(ctx, lang),
    ...createProfileTools(ctx),
    ...createReadingTools(ctx, lang),
    ...createInterestTools(ctx),
    ...createProgressTools(ctx, lang),
    ...createAnnotateTools(ctx, lang),
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
