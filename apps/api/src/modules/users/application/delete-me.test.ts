import { describe, expect, it } from "vitest";
import { ServiceUnavailableError } from "../../../platform/errors/index.js";
import { createDeleteMeUseCase } from "./delete-me.js";

describe("deleteMe (AC-ACC-05 — fora do âmbito de M1, ver plan.md M9)", () => {
  it("devolve SERVICE_UNAVAILABLE em vez de fingir sucesso", async () => {
    const deleteMe = createDeleteMeUseCase();
    await expect(deleteMe("u1", "palavra-passe")).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
