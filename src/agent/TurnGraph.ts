import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: "turn-graph" });

export interface TurnGraphStepSummary {
  messages?: number;
  tools?: number;
  toolCallsMade?: number;
  responseLength?: number;
  next?: string;
}

export interface TurnGraphStepEvent {
  node: string;
  durationMs: number;
  summary?: TurnGraphStepSummary;
}

export interface TurnGraphTrace {
  id: string;
  events: TurnGraphStepEvent[];
}

export type TurnGraphNode<TState> = {
  name: string;
  run: (state: TState) => Promise<TState> | TState;
  summarize?: (state: TState) => TurnGraphStepSummary;
};

export class TurnGraph<TState> {
  constructor(private readonly nodes: Array<TurnGraphNode<TState>>) {}

  async run(initialState: TState, traceId: string = `turn-${Date.now()}`): Promise<{ state: TState; trace: TurnGraphTrace }> {
    let state = initialState;
    const trace: TurnGraphTrace = { id: traceId, events: [] };

    for (const node of this.nodes) {
      const start = Date.now();
      log.debug({ traceId, node: node.name }, "node start");
      state = await node.run(state);
      const event: TurnGraphStepEvent = {
        node: node.name,
        durationMs: Date.now() - start,
        summary: node.summarize?.(state),
      };
      trace.events.push(event);
      log.info({ traceId, ...event }, "node complete");
    }

    return { state, trace };
  }
}
