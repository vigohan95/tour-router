import { beforeEach, describe, expect, it } from "vitest";
import { clientIp, resetQuota, takeLlmRun } from "@/lib/llm/quota";

beforeEach(() => resetQuota());

describe("LLM quota", () => {
  it("caps per ip and globally, resets at UTC midnight", () => {
    const cfg = { perIpPerDay: 2, perDay: 3 };
    const t = new Date("2026-10-10T10:00:00Z");
    expect(takeLlmRun("a", t, cfg).allowed).toBe(true);
    expect(takeLlmRun("a", t, cfg)).toMatchObject({ allowed: true, remaining: { ip: 0, total: 1 } });
    expect(takeLlmRun("a", t, cfg)).toMatchObject({ allowed: false, reason: expect.stringContaining("your daily") });
    expect(takeLlmRun("b", t, cfg).allowed).toBe(true);
    expect(takeLlmRun("c", t, cfg)).toMatchObject({ allowed: false, reason: expect.stringContaining("across all") });
    expect(takeLlmRun("c", new Date("2026-10-11T00:00:01Z"), cfg)).toMatchObject({ allowed: true, resetsAt: "2026-10-12T00:00:00.000Z" });
  });
  it("reads the client ip behind proxies", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } }))).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe("9.9.9.9");
    expect(clientIp(new Request("http://x"))).toBe("local");
  });
});
