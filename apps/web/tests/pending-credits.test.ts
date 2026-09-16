import { beforeEach, describe, expect, it } from "vitest";
import { HttpWorkspaceGateway } from "@/gateways/http-workspace-gateway";
import {
  retainCreditRequest,
  completeCreditRequest,
  rejectCreditRequest,
} from "@/gateways/pending-credit-request";
beforeEach(() => sessionStorage.clear());
describe("durable billing request recovery", () => {
  it("retains the confirmed price and ID through a reload-like new request", () => {
    const body = {
      requestId: crypto.randomUUID(),
      sessionId: "session",
      message: "hello",
      billing: { version: "v1", totalMinor: 2 },
    };
    const first = retainCreditRequest("/api/chat", JSON.stringify(body));
    const retry = retainCreditRequest(
      "/api/chat",
      JSON.stringify({
        ...body,
        requestId: crypto.randomUUID(),
        billing: { version: "v2", totalMinor: 3 },
      }),
    );
    expect(retry).toEqual(first);
    rejectCreditRequest(first, { code: "billing_pending" });
    expect(retainCreditRequest("/api/chat", JSON.stringify(body))).toEqual(
      first,
    );
    completeCreditRequest(first);
    expect(
      retainCreditRequest(
        "/api/chat",
        JSON.stringify({ ...body, requestId: "new" }),
      )?.requestId,
    ).toBe("new");
  });
  it("permits a fresh confirmation after an authoritative price rejection", () => {
    const body = {
      message: "hello",
      billing: { version: "v1", totalMinor: 2 },
    };
    const pending = retainCreditRequest("/api/chat", JSON.stringify(body));
    rejectCreditRequest(pending, { code: "price_changed" });
    expect(
      JSON.parse(
        retainCreditRequest(
          "/api/chat",
          JSON.stringify({
            ...body,
            billing: { version: "v2", totalMinor: 3 },
          }),
        )!.body,
      ).billing.version,
    ).toBe("v2");
  });
  it("does not recall a completed stream when its consumer stops at the terminal event", async () => {
    const firstId = crypto.randomUUID();
    const first = {
      imageToolEnabled: false,
      requestId: firstId,
      sessionId: crypto.randomUUID(),
      message: "hello",
      billing: { version: "v1", totalMinor: 2 },
    };
    const bodies: string[] = [];
    const gateway = new HttpWorkspaceGateway({
      fetcher: async (_url, init) => {
        bodies.push(String(init?.body));
        return new Response(
          `data: ${JSON.stringify({ type: "message.completed", messageId: crypto.randomUUID(), content: "done" })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    for await (const event of gateway.streamChat(first)) {
      if (event.type === "message.completed") break;
    }
    for await (const event of gateway.streamChat({
      ...first,
      requestId: "new-request",
    })) {
      if (event.type === "message.completed") break;
    }
    expect(JSON.parse(bodies[1]!).requestId).toBe("new-request");
  });
});
