import { describe, expect, it, vi } from "vitest";
import { TuiImportSession } from "./TuiTransport.js";

describe("TuiImportSession", () => {
  it("buffers lines after bare /import until /done so pasted vocabulary is not sent as chat", async () => {
    const handler = vi.fn(async (_chatId: number, _userId: string, text: string) => `handled:${text}`);
    const replies: string[] = [];
    const session = new TuiImportSession(handler, (text) => replies.push(text));

    expect(await session.handleLine("/import")).toBe(true);
    expect(await session.handleLine("ola de calor = heat wave")).toBe(true);
    expect(await session.handleLine("llovía -> it was raining")).toBe(true);
    expect(handler).not.toHaveBeenCalled();

    expect(await session.handleLine("/done")).toBe(true);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(0, "tui-user", "/import\nola de calor = heat wave\nllovía -> it was raining");
    expect(replies.at(-1)).toContain("handled:/import\nola de calor");
  });
});
