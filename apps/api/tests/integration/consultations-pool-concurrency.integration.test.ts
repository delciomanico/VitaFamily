// Concorrência com pool pequeno: vários casos de uso (listas da família, do profissional e disputas do administrador) leem por OUTRA
// ligação do pool (catálogo de profissionais/especialidades) com a transação aberta. Com o pool esgotado por transações, cada uma esperava
// por uma segunda ligação que nunca chegava (impasse). A porta `withTransaction` da plataforma limita as transações simultâneas a
// `max - 1`, deixando sempre uma ligação livre para essas leituras.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API, START } from "../support/professionals-harness.js";
import { startConsultationsHarness, type ConsultationsHarness } from "../support/consultations-harness.js";

const POOL_MAX = 3;
const CONCURRENCY = 24;
const DAY = 86_400_000;

let c: ConsultationsHarness;

describe("integração: pool pequeno sob concorrência (consultas por outra ligação com a transação aberta)", () => {
  beforeAll(async () => {
    c = await startConsultationsHarness({ poolMax: POOL_MAX });
  }, 300_000);

  afterAll(async () => {
    await c.stop();
  });

  it(`${String(CONCURRENCY)} pedidos simultâneos (família, profissional, administrador) com pool de ${String(POOL_MAX)} terminam todos em 200`, async () => {
    const pro = await c.professional({ name: "Dra. Pool" });
    const offer = await c.offer(pro, { method: "VIDEO", durationMinutes: 30, priceKz: 5000 });
    const user = await c.user("titular-pool");
    const fam = await c.family("Pool F");
    const member = await c.member(fam, { userId: user.id, role: "FAMILY_ADMIN", name: "Titular" });
    await c.seedBooking({ familyId: fam, memberId: member, offer, startsAt: new Date(START.getTime() + 3 * DAY) });
    const admin = await c.admin();

    const calls: Promise<number>[] = [];
    for (let i = 0; i < CONCURRENCY; i += 1) {
      calls.push(request(c.h.app).get(`${API}/families/${fam}/members/${member}/bookings`).set("Authorization", `Bearer ${user.token}`).then((r) => r.status));
      calls.push(request(c.h.app).get(`${API}/professional-portal/bookings`).set("Authorization", `Bearer ${pro.token}`).then((r) => r.status));
      calls.push(request(c.h.app).get(`${API}/admin/payment-disputes`).set("Authorization", `Bearer ${admin.token}`).then((r) => r.status));
    }
    const statuses = await Promise.all(calls);
    expect(statuses.every((s) => s === 200)).toBe(true);
  }, 120_000);
});
