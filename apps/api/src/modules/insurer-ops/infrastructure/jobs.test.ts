import type PgBoss from "pg-boss";
import { describe, expect, it, vi } from "vitest";
import { EXPIRE_POLICIES_QUEUE, registerExpirePoliciesWorker } from "./jobs.js";

describe("job insurer.expire-policies (BR-SEG-28)", () => {
  it("fila `insurer.expire-policies` agendada diariamente às 00:20 UTC (cron sem fuso ⇒ UTC) e o handler corre a expiração", async () => {
    const boss = { createQueue: vi.fn(), schedule: vi.fn(), work: vi.fn((_queue: string, fn: () => Promise<void>) => fn().then(() => "worker-id")) };
    const handler = vi.fn(() => Promise.resolve());
    await registerExpirePoliciesWorker(boss as unknown as PgBoss, handler);
    expect(EXPIRE_POLICIES_QUEUE).toBe("insurer.expire-policies");
    expect(boss.createQueue).toHaveBeenCalledWith("insurer.expire-policies");
    // 3.º argumento = dados; sem 4.º (opções): pg-boss usa `tz: "UTC"` por omissão
    expect(boss.schedule).toHaveBeenCalledWith("insurer.expire-policies", "20 0 * * *", {});
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
