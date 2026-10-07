import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { extractApiKey } from "../../src/sse/services/auth.js";

async function run(input) {
  const enc = new TextEncoder();
  const src = new ReadableStream({ start(c) { c.enqueue(enc.encode(input)); c.close(); } });
  const out = src.pipeThrough(createSSETransformStreamWithLogger(
    FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, "codex", null, null, "gpt-5.5",
  ));
  return new Response(out).text();
}

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n`).join("\n") + "\n";

describe("Codex Responses tool-call streaming pass-through", () => {
  it("forwards custom, namespaced function, tool_search and unknown events unchanged", async () => {
    const events = [
      { type: "response.created", response: { id: "resp_1", status: "in_progress" } },
      { type: "response.output_item.added", output_index: 0, item: { type: "tool_search_call", id: "ts_1", call_id: "call_ts", execution: "client", arguments: { query: "node_repl" } } },
      { type: "response.output_item.done", output_index: 0, item: { type: "tool_search_call", id: "ts_1", call_id: "call_ts", execution: "client", arguments: { query: "node_repl" } } },
      { type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc_1", call_id: "call_js", name: "js", namespace: "mcp__node_repl", arguments: "" } },
      { type: "response.function_call_arguments.delta", output_index: 1, item_id: "fc_1", delta: "{\"code\":\"1\"}" },
      { type: "response.function_call_arguments.done", output_index: 1, item_id: "fc_1", arguments: "{\"code\":\"1\"}" },
      { type: "response.output_item.added", output_index: 2, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_x", name: "exec", input: "" } },
      { type: "response.custom_tool_call_input.delta", output_index: 2, item_id: "ctc_1", delta: "await 1" },
      { type: "response.custom_tool_call_input.done", output_index: 2, item_id: "ctc_1", input: "await 1" },
      { type: "response.output_item.done", output_index: 2, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_x", name: "exec", input: "await 1" } },
      { type: "response.future_event.delta", item_id: "z", payload: { keep: true } },
      { type: "response.completed", response: { id: "resp_1", status: "completed" } },
    ];
    const out = await run(sse(events));
    for (const e of events) {
      expect(out).toContain(`event: ${e.type}\n`);
      expect(out).toContain(`data: ${JSON.stringify(e)}`);
    }
    expect(out).not.toContain("response.failed");
  });
});

describe("extractApiKey with Codex requires_openai_auth", () => {
  it("prefers x-api-key over a ChatGPT bearer token", () => {
    const req = new Request("http://x/v1/responses", { headers: { authorization: "Bearer eyJchatgpt", "x-api-key": "sk-9router" } });
    expect(extractApiKey(req)).toBe("sk-9router");
  });
  it("still accepts a plain bearer key", () => {
    const req = new Request("http://x/v1/responses", { headers: { authorization: "Bearer sk-9router" } });
    expect(extractApiKey(req)).toBe("sk-9router");
  });
});
