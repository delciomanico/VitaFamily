// AC-CLN-29 / TC-CLN-20 (aplicação): auditoria da própria clínica — só Admin, janela ≤ 366 dias dentro da retenção,
// cursor, 30 pedidos/min; a projeção devolvida não tem PII (a query real é testada em integração).
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { InMemoryRateLimiter } from "../../../platform/rate-limit/index.js";
import { createListClinicAuditUseCase } from "./list-clinic-audit.js";
import type { ClinicAuditEntry, ClinicAuditFilter } from "./ports.js";

const NOW = new Date("2026-11-08T10:00:00Z");
const ADMIN = { clinicAccountId: "a", clinicId: "clinic-a", role: "CLINIC_ADMIN" };

function setup(count = 5) {
  const clock = new FixedClock(NOW);
  const calls: { filter: ClinicAuditFilter; limit: number }[] = [];
  const entries: ClinicAuditEntry[] = Array.from({ length: count }, (_, i) => ({
    id: String(100 - i),
    occurredAt: new Date(NOW.getTime() - i * 1000),
    action: "CLINIC_RECEIPT_ISSUE",
    resourceType: "ClinicReceipt",
    resourceId: null,
    result: "SUCCESS" as const,
    actorAccountId: "a",
  }));
  const list = createListClinicAuditUseCase({
    reader: {
      list: async (_trx, filter, limit) => {
        calls.push({ filter, limit });
        return Promise.resolve(entries.slice(0, limit));
      },
    },
    withTransaction: (fn) => fn(undefined),
    limiter: new InMemoryRateLimiter(clock),
    clock,
  });
  return { list, calls };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("listClinicAudit (BR-CLN-40)", () => {
  it("só o Admin; Gestor e Médico => FORBIDDEN", async () => {
    const { list } = setup();
    expect(await codeOf(list({ ...ADMIN, role: "CLINIC_MANAGER" }, {}))).toBe("FORBIDDEN");
    expect(await codeOf(list({ ...ADMIN, role: "CLINIC_DOCTOR" }, {}))).toBe("FORBIDDEN");
    expect((await list(ADMIN, {})).items).toHaveLength(5);
  });

  it("consulta sempre a clínica do token; omissões => últimos 366 dias; pede limit+1 e devolve cursor", async () => {
    const { list, calls } = setup(5);
    const page = await list(ADMIN, { limit: "2" });
    expect(calls[0]?.filter.clinicId).toBe("clinic-a");
    expect(calls[0]?.limit).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    expect(calls[0]?.filter.to.getTime() - (calls[0]?.filter.from.getTime() ?? 0)).toBeLessThanOrEqual(366 * 86_400_000);
    await list(ADMIN, { limit: "2", ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });
    expect(calls[1]?.filter.after?.id).toBe("99");
  });

  it.each([
    [{ from: "2025-01-01T00:00:00Z", to: "2026-11-08T00:00:00Z" }, "janela > 366 dias"],
    [{ from: "2026-02-01T00:00:00Z", to: "2026-01-01T00:00:00Z" }, "to < from"],
    [{ from: "2024-01-01T00:00:00Z", to: "2024-02-01T00:00:00Z" }, "fora da retenção de 24 meses"],
    [{ from: "ontem" }, "instante inválido"],
    [{ limit: "0" }, "limit 0"],
    [{ limit: "101" }, "limit 101"],
    [{ cursor: "lixo" }, "cursor inválido"],
    [{ action: "x".repeat(65) }, "action > 64"],
  ])("%j (%s) => VALIDATION_ERROR", async (query) => {
    const { list } = setup();
    expect(await codeOf(list(ADMIN, query))).toBe("VALIDATION_ERROR");
  });

  it("31.º pedido no minuto => RATE_LIMITED", async () => {
    const { list } = setup();
    let last: string | undefined;
    for (let i = 0; i < 31; i++) last = await codeOf(list(ADMIN, {}));
    expect(last).toBe("RATE_LIMITED");
  });

  it("as entradas devolvidas só têm os campos do contrato (sem ip, userAgent, requestId, metadata, família, e-mails)", async () => {
    const { list } = setup(1);
    const [entry] = (await list(ADMIN, {})).items;
    expect(Object.keys(entry ?? {}).sort()).toEqual(["action", "actorAccountId", "id", "occurredAt", "resourceId", "resourceType", "result"]);
  });
});
