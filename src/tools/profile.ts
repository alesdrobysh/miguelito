import type { ToolContext } from "./index.js";

function profileSet(ctx: ToolContext) {
  return {
    name: "miguelito_profile_set",
    description: "Create or update the user profile. Pass only the fields you want to change.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "User's preferred name." },
        goal: { type: "string", description: "Main learning goal." },
        correction_style: { type: "string", description: "inline, soft, or direct." },
      },
    },
    execute: async (args: Record<string, string>) => {
      const sharedFields: Record<string, string> = {};
      const langFields: Record<string, string> = {};
      for (const key of ["name", "correction_style"]) {
        const val = (args[key] ?? "").trim();
        if (val) sharedFields[key] = val;
      }
      const goalVal = (args["goal"] ?? "").trim();
      if (goalVal) langFields["goal"] = goalVal;

      if (Object.keys(sharedFields).length === 0 && Object.keys(langFields).length === 0) {
        return { success: false, output: "", error: "no_fields_provided" };
      }
      const updated: string[] = [];
      if (Object.keys(sharedFields).length > 0) updated.push(...await ctx.profile.setProfile(sharedFields));
      if (Object.keys(langFields).length > 0) updated.push(...await ctx.langProfile.setProfile(langFields));
      return { ok: true, updated_fields: updated };
    },
  };
}

export function createProfileTools(ctx: ToolContext) {
  return [profileSet(ctx)];
}
