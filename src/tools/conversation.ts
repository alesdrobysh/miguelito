import { BuddyDb } from "../db.js";

export interface ToolContext {
  db: BuddyDb;
  apiKey: string | null;
}

function conversationState(ctx: ToolContext) {
  return {
    name: "miguelito_conversation_state",
    description: "Read current conversation session state. Call on EVERY user turn before composing reply.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async (_args: Record<string, string>) => {
      const result = ctx.db.getConversationState();
      const session = result.session;
      const state = {
        session_id: session.session_id,
        turn_count: session.turn_count,
        corrections_this_session: session.corrections_this_session,
        last_mode: session.last_mode,
        last_two_modes: JSON.parse(session.last_two_modes),
        topics_touched: JSON.parse(session.topics_touched),
        mood_hint: session.mood_hint,
        started_at: session.started_at,
        updated_at: session.updated_at,
      };

      if (result.isNew) {
        return {
          ok: true,
          is_new_session: true,
          state,
          previous_session: null,
        };
      }
      return {
        ok: true,
        is_new_session: false,
        state,
        previous_session: null,
      };
    },
  };
}

function conversationStateUpdate(ctx: ToolContext) {
  return {
    name: "miguelito_conversation_state_update",
    description: "Record the current turn's result. Call AFTER composing your reply.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "REACT, DIG, OFFER, TEACH, or PLAY",
        },
        topic: {
          type: "string",
          description: "Brief topic of this turn",
        },
        mood: {
          type: "string",
          description: "User's mood this turn",
        },
      },
      required: ["mode"],
    },
    execute: async (args: Record<string, string>) => {
      const mode = (args.mode ?? "REACT").trim().toUpperCase();
      const topic = (args.topic ?? "").trim() || undefined;
      const mood = (args.mood ?? "").trim() || undefined;

      const result = ctx.db.updateConversationState(mode, topic, mood);
      return {
        ok: true,
        turn_count: result.turn_count,
        mode,
      };
    },
  };
}

export function createConversationTools(ctx: ToolContext) {
  return [conversationState(ctx), conversationStateUpdate(ctx)];
}
