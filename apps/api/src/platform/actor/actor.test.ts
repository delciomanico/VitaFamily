import { describe, expect, it } from "vitest";
import { getActor, runWithActor, type ActorInfo } from "./index.js";

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
