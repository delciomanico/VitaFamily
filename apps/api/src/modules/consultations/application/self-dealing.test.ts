// `SelfDealingGuard` (BR-MKT-62, TC-MKT-81): mesma pessoa = e-mail normalizado igual; resultado só booleano; nunca revela o e-mail.
import { describe, expect, it } from "vitest";
import { createSelfDealingGuard } from "./self-dealing.js";

function guardWith(professionalEmail: string | null, userEmail: string | null) {
  const calls: { kind: "professional" | "user"; id: string }[] = [];
  const guard = createSelfDealingGuard({
    professionalEmail: (id) => {
      calls.push({ kind: "professional", id });
      return Promise.resolve(professionalEmail);
    },
    userEmail: (id) => {
      calls.push({ kind: "user", id });
      return Promise.resolve(userEmail);
    },
  });
  return { guard, calls };
}

const PRO = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("createSelfDealingGuard (BR-MKT-62)", () => {
  it.each([
    ["ana.silva@exemplo.ao", "ana.silva@exemplo.ao"],
    ["Ana.Silva@Exemplo.AO", "ana.silva@exemplo.ao"],
    ["  ana.silva@exemplo.ao  ", "ana.silva@exemplo.ao"],
    ["\tANA.SILVA@exemplo.ao\n", "  Ana.Silva@EXEMPLO.ao "],
  ])("profissional %j e utilizador %j são a mesma pessoa ⇒ true", async (professionalEmail, userEmail) => {
    const { guard } = guardWith(professionalEmail, userEmail);
    expect(await guard.isSamePerson(PRO, USER)).toBe(true);
  });

  it("'é' composto e decomposto contam como o mesmo e-mail (NFC) ⇒ true", async () => {
    const { guard } = guardWith("josé@exemplo.ao", "josé@exemplo.ao");
    expect(await guard.isSamePerson(PRO, USER)).toBe(true);
  });

  it("e-mails diferentes ⇒ false", async () => {
    const { guard } = guardWith("ana@exemplo.ao", "ana2@exemplo.ao");
    expect(await guard.isSamePerson(PRO, USER)).toBe(false);
  });

  it("e-mails que só diferem num carácter de domínio ⇒ false", async () => {
    const { guard } = guardWith("ana@exemplo.ao", "ana@exemplo.co");
    expect(await guard.isSamePerson(PRO, USER)).toBe(false);
  });

  it("profissional sem e-mail (null) ⇒ false, mesmo que o utilizador tenha e-mail", async () => {
    const { guard } = guardWith(null, "ana@exemplo.ao");
    expect(await guard.isSamePerson(PRO, USER)).toBe(false);
  });

  it("utilizador sem e-mail (null) ⇒ false, mesmo que o profissional tenha e-mail", async () => {
    const { guard } = guardWith("ana@exemplo.ao", null);
    expect(await guard.isSamePerson(PRO, USER)).toBe(false);
  });

  it("ambos null ⇒ false", async () => {
    const { guard } = guardWith(null, null);
    expect(await guard.isSamePerson(PRO, USER)).toBe(false);
  });

  it("o resultado é só um booleano (nunca o e-mail nem outro texto)", async () => {
    const same = guardWith("ana@exemplo.ao", "ANA@exemplo.ao").guard;
    const diff = guardWith("ana@exemplo.ao", "outra@exemplo.ao").guard;
    const missing = guardWith(null, "ana@exemplo.ao").guard;
    for (const result of [await same.isSamePerson(PRO, USER), await diff.isSamePerson(PRO, USER), await missing.isSamePerson(PRO, USER)]) {
      expect(typeof result).toBe("boolean");
      expect(JSON.stringify(result)).not.toMatch(/@|exemplo/);
    }
  });

  it("lê as duas fontes com os ids recebidos (profissional e utilizador)", async () => {
    const { guard, calls } = guardWith("ana@exemplo.ao", "ana@exemplo.ao");
    await guard.isSamePerson(PRO, USER);
    expect(calls).toEqual(
      expect.arrayContaining([
        { kind: "professional", id: PRO },
        { kind: "user", id: USER },
      ]),
    );
    expect(calls).toHaveLength(2);
  });
});
