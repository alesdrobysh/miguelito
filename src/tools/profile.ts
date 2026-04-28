import { BuddyDb } from "../db.js";

export interface ToolContext {
  db: BuddyDb;
  apiKey: string | null;
}

function profileGet(ctx: ToolContext) {
  return {
    name: "miguelito_profile_get",
    description:
      "Read the user's onboarded profile (name, native_language, level, goal, correction_style, interests, setup_step). Returns ok=true with exists=false when no profile has been set yet.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async (_args: Record<string, string>) => {
      const profile = ctx.db.getProfile();
      if (!profile) {
        return { ok: true, exists: false, profile: null };
      }
      return {
        ok: true,
        exists: true,
        profile: {
          name: profile.name,
          native_language: profile.native_language,
          level: profile.level,
          goal: profile.goal,
          correction_style: profile.correction_style,
          interests: profile.interests,
          setup_step: profile.setup_step,
          started_at: profile.started_at,
          updated_at: profile.updated_at,
        },
      };
    },
  };
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
      const updatedFields = ctx.db.setProfile(fields);
      return { ok: true, updated_fields: updatedFields };
    },
  };
}

export function createProfileTools(ctx: ToolContext) {
  return [profileGet(ctx), profileSet(ctx)];
}