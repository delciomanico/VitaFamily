// TC-AZ-PRC-01 (authorization.md §6.8): a matriz relação × origem × (lista, detalhe) é DADOS (`GOLDEN`), transcrita da tabela
// do documento, e corre sobre a `AccessPolicy` REAL (`createAccessPolicy` com fakes de `access`): lê / omitido / 404.
// Adicionar uma relação ou categoria sem atualizar esta tabela e §6.8 faz falhar a CI.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { NotFoundError } from "../../../platform/errors/index.js";
import { createAccessFixtures } from "../../access/application/fixtures.js";
import { createAccessPolicy } from "../../access/application/policy.js";
import type { DataCategory } from "../../access/index.js";
import { createGetProcessUseCase } from "./get-process.js";
import { createListProcessesUseCase } from "./list-processes.js";
import { createProcessesFixtures, type FakeTrx } from "./fixtures.js";

const NOW = new Date("2026-06-01T12:00:00Z");
const FAMILY = "family-1";
const OWNER = "owner";
const ACTOR = "actor";
const CTX = { requestId: "req" };

type Setup = "SELF_ADULT" | "TUTOR_OF" | "DEPENDENT_SELF" | "OTHER" | "OTHER_ADMIN_NO_GRANT" | "NOT_IN_FAMILY";
interface Row {
  name: string;
  setup: Setup;
  grants?: DataCategory[];
  platformAdmin?: boolean;
  /** Origem legível? (consulta, exame) */
  reads: [appointment: boolean, exam: boolean];
  /** `PROCESS_VIEW` auditado (leitura por quem não é o titular). */
  audited?: boolean;
  /** Falha total (NOT_FOUND) em vez de lista filtrada. */
  notFound?: boolean;
}

const GOLDEN: Row[] = [
  { name: "SELF (adulto)", setup: "SELF_ADULT", reads: [true, true] },
  { name: "TUTOR_OF", setup: "TUTOR_OF", reads: [true, true], audited: true },
  { name: "DEPENDENT_SELF (N2: só consultas)", setup: "DEPENDENT_SELF", reads: [true, false] },
  { name: "OTHER sem partilha", setup: "OTHER", reads: [false, false] },
  { name: "Family Admin como OTHER sem partilha", setup: "OTHER_ADMIN_NO_GRANT", reads: [false, false] },
  { name: "OTHER com partilha de APPOINTMENTS", setup: "OTHER", grants: ["APPOINTMENTS"], reads: [true, false], audited: true },
  { name: "OTHER com partilha de EXAMS", setup: "OTHER", grants: ["EXAMS"], reads: [false, true], audited: true },
  { name: "OTHER com APPOINTMENTS e EXAMS", setup: "OTHER", grants: ["APPOINTMENTS", "EXAMS"], reads: [true, true], audited: true },
  { name: "sem pertença à família", setup: "NOT_IN_FAMILY", reads: [false, false], notFound: true },
  { name: "PLATFORM_ADMIN", setup: "SELF_ADULT", platformAdmin: true, reads: [false, false], notFound: true },
];

function build(row: Row) {
  const access = createAccessFixtures(new FixedClock(NOW));
  const isDependentOwner = row.setup === "TUTOR_OF" || row.setup === "DEPENDENT_SELF";
  const subject = row.setup === "SELF_ADULT" || row.setup === "DEPENDENT_SELF" ? ACTOR : OWNER;
  access.familiesPort.seedMember({ id: OWNER, familyId: FAMILY, name: "Owner", isDependent: isDependentOwner, status: "ACTIVE", ...(row.setup === "SELF_ADULT" || row.setup === "DEPENDENT_SELF" ? {} : { userId: "owner-user" }) });
  if (row.setup !== "NOT_IN_FAMILY") {
    if (row.setup === "SELF_ADULT" || row.setup === "DEPENDENT_SELF") {
      access.familiesPort.seedMember({ id: ACTOR, familyId: FAMILY, name: "Actor", isDependent: row.setup === "DEPENDENT_SELF", status: "ACTIVE", userId: "actor-user" });
    } else {
      access.familiesPort.seedMember({ id: ACTOR, familyId: FAMILY, name: "Actor", isDependent: false, status: "ACTIVE", userId: "actor-user" });
    }
  }
  if (row.setup === "TUTOR_OF") access.familiesPort.seedGuardianship(OWNER, ACTOR);
  for (const category of row.grants ?? []) {
    access.sharingGrantsRepo.seed({ id: `g-${category}`, familyId: FAMILY, ownerMemberId: OWNER, granteeMemberId: ACTOR, category, grantedBy: OWNER, createdAt: NOW });
  }

  const fx = createProcessesFixtures(new FixedClock(NOW));
  const policy = createAccessPolicy<FakeTrx>({ familiesPort: access.familiesPort, sharingGrantsRepo: access.sharingGrantsRepo });
  const deps = { ...fx.deps, policy };
  fx.addProcess({ id: "p-appt", familyId: FAMILY, memberId: subject, originType: "APPOINTMENT", openedAt: NOW });
  fx.addProcess({ id: "p-exam", familyId: FAMILY, memberId: subject, originType: "EXAMINATION", openedAt: new Date(NOW.getTime() - 1000) });
  const actor = { userId: row.platformAdmin ? "platform-admin" : "actor-user", platformAdmin: row.platformAdmin ?? false };
  return { fx, deps, actor, subject };
}

describe("TC-AZ-PRC-01: leitura de processos por relação × origem (authorization.md §6.8)", () => {
  it.each(GOLDEN)("$name: lista", async (row) => {
    const { fx, deps, actor, subject } = build(row);
    const list = createListProcessesUseCase(deps)(actor, FAMILY, subject, {}, CTX);
    if (row.notFound) {
      await expect(list).rejects.toBeInstanceOf(NotFoundError);
      return;
    }
    const expected = [row.reads[0] ? "p-appt" : null, row.reads[1] ? "p-exam" : null].filter((id) => id !== null);
    expect((await list).items.map((i) => i.id)).toEqual(expected); // filtra, nunca anula
    expect(fx.audit.events.map((e) => e.action)).toEqual(row.audited && expected.length > 0 ? ["PROCESS_VIEW"] : []);
  });

  it.each(GOLDEN)("$name: detalhe (consulta e exame)", async (row) => {
    const { fx, deps, actor, subject } = build(row);
    const get = createGetProcessUseCase(deps);
    for (const [id, readable] of [["p-appt", row.reads[0]], ["p-exam", row.reads[1]]] as const) {
      const result = get(actor, FAMILY, subject, id, CTX);
      if (readable) {
        expect((await result).id).toBe(id);
      } else {
        await expect(result).rejects.toBeInstanceOf(NotFoundError); // 404, nunca 403
      }
    }
    const readable = row.reads.filter(Boolean).length;
    expect(fx.audit.events).toHaveLength(row.audited ? readable : 0);
  });
});
