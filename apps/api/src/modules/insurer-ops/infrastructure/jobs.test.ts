import type PgBoss from "pg-boss";
import { describe, expect, it, vi } from "vitest";
import { EXPIRE_POLICIES_QUEUE, FLAG_SLA_BREACHES_QUEUE, registerExpirePoliciesWorker, registerFlagSlaBreachesWorker } from "./jobs.js";

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

describe("job insurer.flag-sla-breaches (BR-AUT-20)", () => {
  it("fila `insurer.flag-sla-breaches` agendada a cada 15 minutos (UTC) e o handler corre a marcação", async () => {
    const boss = { createQueue: vi.fn(), schedule: vi.fn(), work: vi.fn((_queue: string, fn: () => Promise<void>) => fn().then(() => "worker-id")) };
    const handler = vi.fn(() => Promise.resolve());
    await registerFlagSlaBreachesWorker(boss as unknown as PgBoss, handler);
    expect(FLAG_SLA_BREACHES_QUEUE).toBe("insurer.flag-sla-breaches");
    expect(boss.createQueue).toHaveBeenCalledWith("insurer.flag-sla-breaches");
    expect(boss.schedule).toHaveBeenCalledWith("insurer.flag-sla-breaches", "*/15 * * * *", {});
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
