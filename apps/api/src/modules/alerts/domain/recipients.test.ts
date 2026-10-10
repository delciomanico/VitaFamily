import { describe, expect, it } from "vitest";
import { resolveRecipients } from "./recipients.js";

describe("resolveRecipients (FR-ALR-08/BR-PRV-06/TC-ALR-03)", () => {
  it("titular com conta, não dependente: só o próprio", () => {
    const recipients = resolveRecipients({ userId: "user-1", isDependent: false }, []);
    expect(recipients).toEqual(["user-1"]);
  });

  it("dependente sem conta: só os tutores", () => {
    const recipients = resolveRecipients({ isDependent: true }, ["tutor-1", "tutor-2"]);
    expect(recipients.sort()).toEqual(["tutor-1", "tutor-2"]);
  });

  it("dependente com conta: o próprio e os tutores", () => {
    const recipients = resolveRecipients({ userId: "dep-1", isDependent: true }, ["tutor-1"]);
    expect(recipients.sort()).toEqual(["dep-1", "tutor-1"]);
  });

  it("nunca duplica se o tutor coincidir com o próprio (defensivo)", () => {
    const recipients = resolveRecipients({ userId: "same-1", isDependent: true }, ["same-1"]);
    expect(recipients).toEqual(["same-1"]);
  });

  it("membro sem conta e não dependente: nenhum destinatário", () => {
    const recipients = resolveRecipients({ isDependent: false }, []);
    expect(recipients).toEqual([]);
  });
});
