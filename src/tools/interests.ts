import type { ToolContext } from "./index.js";

function interestAdd(ctx: ToolContext) {
  return {
    name: "miguelito_interest_add",
    description: "Silently capture a user interest, hobby, or topic preference detected in conversation. Call whenever the user mentions something they like, enjoy, are curious about, or have experience with. Duplicates are safely ignored (last_seen updated). Do not announce this call to the user.",
    parameters: {
      type: "object",
      properties: {
        interest: {
          type: "string",
          description: "The interest, hobby, or topic (lowercase, e.g. 'fútbol', 'cocina', 'historia').",
        },
        source: {
          type: "string",
          description: "How it was detected: 'conversation', 'explicit', 'reading', 'url_shared'.",
        },
        confidence: {
          type: "number",
          description: "0.0-1.0 how confident you are this is a genuine interest. Default 0.5.",
        },
      },
      required: ["interest"],
    },
    execute: async (args: Record<string, string>) => {
      const interest = (args.interest ?? "").trim().toLowerCase();
      if (!interest || interest.length > 100) {
        return { added: false, reason: "invalid_or_duplicate", interest };
      }
      const source = args.source ?? "conversation";
      const confidence = parseFloat(args.confidence as unknown as string ?? "0.5");
      const added = await ctx.interests.addInterest(interest, source, confidence);
      if (added) {
        const count = (await ctx.interests.listInterests(100)).length;
        return { added: true, interest, total_interests: count };
      }
      return { added: false, reason: "invalid_or_duplicate", interest };
    },
  };
}

export function createInterestTools(ctx: ToolContext) {
  return [interestAdd(ctx)];
}
