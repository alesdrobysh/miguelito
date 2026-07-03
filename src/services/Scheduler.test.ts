import { describe, it, expect } from "vitest";
import { selectCronPrompt } from "./Scheduler.js";

describe("selectCronPrompt", () => {
  it("uses normal prompt before a pause and reactivation prompts after pauses", () => {
    const args = {
      normalPrompt: "normal",
      shortReactivationPrompt: "short",
      longReactivationPrompt: "long",
    };

    expect(selectCronPrompt({ ...args, daysSinceLastUserMessage: null })).toBe("normal");
    expect(selectCronPrompt({ ...args, daysSinceLastUserMessage: 0 })).toBe("normal");
    expect(selectCronPrompt({ ...args, daysSinceLastUserMessage: 2 })).toBe("normal");
    expect(selectCronPrompt({ ...args, daysSinceLastUserMessage: 3 })).toBe("short");
    expect(selectCronPrompt({ ...args, daysSinceLastUserMessage: 7 })).toBe("short");
    expect(selectCronPrompt({ ...args, daysSinceLastUserMessage: 8 })).toBe("long");
  });
});
