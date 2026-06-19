import { logger } from "../infrastructure/logger.js";

const log = logger.child({ ctx: "turn-graph" });

export interface TurnGraphStepSummary {
  iteration?: number;
  messages?: number;
  tools?: number;
  toolCallsMade?: number;
  responseLength?: number;
  toolCallCount?: number;
  next?: string;
}

export interface TurnGraphStepEvent<TNode extends string = string> {
  from: TNode | "start";
  to: TNode | "done";
  node: TNode;
  durationMs: number;
  reason: string;
  summary?: TurnGraphStepSummary;
}

export interface TurnGraphTrace<TNode extends string = string> {
  id: string;
  events: Array<TurnGraphStepEvent<TNode>>;
}

export type TurnGraphNode<TState, TNode extends string> = {
  name: TNode;
  run: (state: TState) => Promise<TState> | TState;
  route: (state: TState) => TNode | "done";
  reason?: (state: TState) => string;
  summarize?: (state: TState) => TurnGraphStepSummary;
};

export interface TurnGraphRunOptions {
  maxSteps?: number;
}

export class TurnGraph<TState, TNode extends string> {
  private readonly nodeMap: Map<TNode, TurnGraphNode<TState, TNode>>;

  constructor(private readonly start: TNode, nodes: Array<TurnGraphNode<TState, TNode>>) {
    this.nodeMap = new Map(nodes.map((node) => [node.name, node]));
    if (!this.nodeMap.has(start)) throw new Error(`Unknown start node: ${start}`);
  }

  async run(initialState: TState, traceId: string = `turn-${Date.now()}`, options: TurnGraphRunOptions = {}): Promise<{ state: TState; trace: TurnGraphTrace<TNode> }> {
    let state = initialState;
    let current: TNode | "done" = this.start;
    let previous: TNode | "start" = "start";
    const trace: TurnGraphTrace<TNode> = { id: traceId, events: [] };
    const maxSteps = options.maxSteps ?? 50;

    for (let step = 0; current !== "done"; step++) {
      if (step >= maxSteps) throw new Error(`TurnGraph exceeded maxSteps=${maxSteps}`);
      const node = this.nodeMap.get(current);
      if (!node) throw new Error(`Unknown graph node: ${current}`);

      const start = Date.now();
      log.debug({ traceId, node: node.name, from: previous }, "node start");
      state = await node.run(state);
      const next = node.route(state);
      if (next !== "done" && !this.nodeMap.has(next)) throw new Error(`Unknown next node: ${next}`);

      const event: TurnGraphStepEvent<TNode> = {
        from: previous,
        to: next,
        node: node.name,
        durationMs: Date.now() - start,
        reason: node.reason?.(state) ?? "completed",
        summary: node.summarize?.(state),
      };
      trace.events.push(event);
      log.info({ traceId, ...event }, "node complete");

      previous = node.name;
      current = next;
    }

    return { state, trace };
  }
}
