import { BuddyDb } from "../db.js";

export interface ToolContext {
  db: BuddyDb;
  apiKey: string | null;
}

function profileSet(ctx: ToolContext) {
  return {
    name: "miguelito_profile_set",
    description: "Create or update the user profile. Pass only the fields you want to change.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "User's preferred name." },
        native_language: { type: "string", description: "Language for explanations." },
        level: { type: "string", description: "Spanish level (A1, A2, B1, etc)." },
        goal: { type: "string", description: "Main learning goal." },
        correction_style: { type: "string", description: "inline, soft, or direct." },
      },
    },
    execute: async (args: Record<string, string>) => {
      const fields: Record<string, string> = {};
      for (const key of [
        "name", "native_language", "level", "goal", "correction_style", "interests", "setup_step",
      ]) {
        const val = (args[key] ?? "").trim();
        if (val) fields[key] = val;
      }
      if (Object.keys(fields).length === 0) {
        return { success: false, output: "", error: "no_fields_provided" };
      }
      const updatedFields = await ctx.db.setProfile(fields);
      return { ok: true, updated_fields: updatedFields };
    },
  };
}

export function createProfileTools(ctx: ToolContext) {
  return [profileSet(ctx)];
}
