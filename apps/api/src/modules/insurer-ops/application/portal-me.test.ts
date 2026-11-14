import { describe, expect, it } from "vitest";
import { NotFoundError } from "../../../platform/errors/index.js";
import type { OpsActor, OpsRole } from "../domain/access.js";
import { createGetPortalMeUseCase } from "./portal-me.js";
import type { OpsDeps } from "./ports.js";

type Settings = { name: string; operationalModuleEnabled: boolean; currency: string; status: "ACTIVE" | "SUSPENDED" } | null;
const depsFor = (settings: Settings) =>
  ({ insurers: { get: () => Promise.resolve(settings) }, withTransaction: <T>(fn: (trx: null) => Promise<T>) => fn(null) }) as unknown as OpsDeps<null>;
const actor = (role: OpsRole): OpsActor => ({ insuranceAccountId: "acc", insurerId: "ins", role });

describe("getPortalMe (P-SEG-3)", () => {
  it.each<OpsRole>(["INSURANCE_ADMIN", "INSURANCE_AGENT", "BENEFICIARY_MANAGER", "AUTHORIZATION_ANALYST", "CLAIMS_MANAGER", "FINANCE_MANAGER"])("%s: devolve só os cinco campos, mesmo com o módulo desativado", async (role) => {
    const me = await createGetPortalMeUseCase(depsFor({ name: "Seg", operationalModuleEnabled: false, currency: "AOA", status: "SUSPENDED" }))(actor(role));
    expect(me).toEqual({ insurerId: "ins", name: "Seg", currency: "AOA", operationalModuleEnabled: false, role });
  });

  it("seguradora inexistente ⇒ NOT_FOUND", async () => {
    await expect(createGetPortalMeUseCase(depsFor(null))(actor("INSURANCE_ADMIN"))).rejects.toBeInstanceOf(NotFoundError);
  });
});
