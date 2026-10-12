import { describe, expect, it } from "vitest";
import { getActor, getClinicActor, runWithActor, runWithClinicActor, type ActorInfo, type ClinicActorInfo } from "./index.js";

describe("actor (AsyncLocalStorage)", () => {
  it("getActor() devolve undefined fora de runWithActor", () => {
    expect(getActor()).toBeUndefined();
  });

  it("getActor() devolve o ator dentro de runWithActor, mesmo após awaits", async () => {
    const actor: ActorInfo = { userId: "u1", platformAdmin: false };
    await runWithActor(actor, async () => {
      expect(getActor()).toEqual(actor);
      await Promise.resolve();
      expect(getActor()).toEqual(actor);
    });
  });

  it("cada execução concorrente mantém o seu próprio ator (isolamento)", async () => {
    const a: ActorInfo = { userId: "a", platformAdmin: false };
    const b: ActorInfo = { userId: "b", platformAdmin: true };

    const resultA = runWithActor(a, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return getActor()?.userId;
    });
    const resultB = runWithActor(b, () => Promise.resolve(getActor()?.userId));

    await expect(resultA).resolves.toBe("a");
    await expect(resultB).resolves.toBe("b");
  });

  it("getActor() volta a undefined depois de runWithActor terminar", () => {
    runWithActor({ userId: "u1", platformAdmin: false }, () => undefined);
    expect(getActor()).toBeUndefined();
  });
});

describe("clinic actor (ADR-020: segundo AsyncLocalStorage, nunca o de User)", () => {
  it("getClinicActor() devolve undefined fora de runWithClinicActor", () => {
    expect(getClinicActor()).toBeUndefined();
  });

  it("getClinicActor() devolve o ator do portal dentro de runWithClinicActor, mesmo após awaits", async () => {
    const actor: ClinicActorInfo = { clinicAccountId: "ca1", clinicId: "c1", role: "CLINIC_ADMIN", sessionId: "s1" };
    await runWithClinicActor(actor, async () => {
      expect(getClinicActor()).toEqual(actor);
      await Promise.resolve();
      expect(getClinicActor()).toEqual(actor);
    });
  });

  it("os dois storages são independentes: runWithActor nunca preenche getClinicActor() e vice-versa", () => {
    const userActor: ActorInfo = { userId: "u1", platformAdmin: false };
    const clinicActor: ClinicActorInfo = { clinicAccountId: "ca1", clinicId: "c1", role: "CLINIC_MANAGER", sessionId: "s1" };

    runWithActor(userActor, () => {
      expect(getClinicActor()).toBeUndefined();
      runWithClinicActor(clinicActor, () => {
        expect(getActor()).toEqual(userActor);
        expect(getClinicActor()).toEqual(clinicActor);
      });
      expect(getClinicActor()).toBeUndefined();
    });
  });
});
