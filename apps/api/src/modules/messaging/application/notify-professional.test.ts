// Job `messaging.notify-professional` (BR-MKT-41, UC-MKT-21): aviso genérico, no máximo 1 a cada 30 min por conversa, idempotente e com retry.
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createNotifyProfessional } from "./notify-professional.js";
import type { ConversationRecord, ProfessionalMailer } from "./ports.js";

type FakeTrx = Record<string, never>;
const TRX: FakeTrx = {};
const NOW = new Date("2026-11-10T08:00:00Z");
const MINUTE = 60 * 1000;
const COOLDOWN_MS = 30 * MINUTE;

class FakeConversations {
  readonly rows = new Map<string, ConversationRecord>();

  async claimProfessionalNotice(_trx: FakeTrx, conversationId: string, now: Date): Promise<{ professionalId: string; previous: Date | null } | null> {
    const row = this.rows.get(conversationId);
    if (!row) return Promise.resolve(null);
    if (row.lastSeq <= row.lastProfessionalSeq) return Promise.resolve(null);
    if (row.lastSeq <= row.professionalReadSeq) return Promise.resolve(null);
    if (row.professionalNotifiedAt && now.getTime() - row.professionalNotifiedAt.getTime() < COOLDOWN_MS) return Promise.resolve(null);
    const previous = row.professionalNotifiedAt;
    this.rows.set(conversationId, { ...row, professionalNotifiedAt: now });
    return Promise.resolve({ professionalId: row.professionalId, previous });
  }

  async releaseProfessionalNotice(_trx: FakeTrx, conversationId: string, claimedAt: Date, previous: Date | null): Promise<void> {
    const row = this.rows.get(conversationId);
    if (row?.professionalNotifiedAt?.getTime() === claimedAt.getTime()) {
      this.rows.set(conversationId, { ...row, professionalNotifiedAt: previous });
    }
    return Promise.resolve();
  }
}

class FakeProfessionals {
  readonly emails = new Map<string, string>();

  async getNotificationEmail(professionalId: string): Promise<string | null> {
    return Promise.resolve(this.emails.get(professionalId) ?? null);
  }
}

class FakeMailer implements ProfessionalMailer {
  readonly sentTo: string[] = [];
  fail = false;

  async sendNewMessageNotice(to: string): Promise<void> {
    if (this.fail) {
      throw new Error(`smtp recusou ${to}`);
    }
    this.sentTo.push(to);
    return Promise.resolve();
  }
}

function conversation(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: "conv-1",
    familyId: "fam-1",
    memberId: "member-1",
    professionalId: "prof-1",
    openedByUserId: "user-1",
    participantLabel: "Família",
    status: "OPEN",
    closedBy: null,
    closedAt: null,
    lastSeq: 3,
    lastProfessionalSeq: 2,
    lastMessageAt: NOW,
    familyReadSeq: 2,
    professionalReadSeq: 2,
    professionalNotifiedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

describe("notifyProfessional", () => {
  let clock: FixedClock;
  let conversations: FakeConversations;
  let professionals: FakeProfessionals;
  let mailer: FakeMailer;

  const build = () =>
    createNotifyProfessional<FakeTrx>({
      conversations,
      professionals,
      mailer,
      withTransaction: (fn) => fn(TRX),
      clock,
    });

  beforeEach(() => {
    clock = new FixedClock(NOW);
    conversations = new FakeConversations();
    professionals = new FakeProfessionals();
    mailer = new FakeMailer();
    professionals.emails.set("prof-1", "prof@example.test");
    conversations.rows.set("conv-1", conversation());
  });

  it("envia 1 e-mail ao profissional (SENT) e grava o carimbo", async () => {
    expect(await build()("conv-1")).toBe("SENT");
    expect(mailer.sentTo).toEqual(["prof@example.test"]);
    expect(conversations.rows.get("conv-1")?.professionalNotifiedAt).toEqual(NOW);
  });

  it("segunda chamada imediata => SKIPPED sem novo e-mail", async () => {
    const notify = build();
    await notify("conv-1");
    expect(await notify("conv-1")).toBe("SKIPPED");
    expect(mailer.sentTo).toHaveLength(1);
  });

  it("passados 30 min => SENT outra vez", async () => {
    const notify = build();
    await notify("conv-1");
    clock.advance(COOLDOWN_MS);
    expect(await notify("conv-1")).toBe("SENT");
    expect(mailer.sentTo).toHaveLength(2);
  });

  it("passados 29 min => SKIPPED", async () => {
    const notify = build();
    await notify("conv-1");
    clock.advance(29 * MINUTE);
    expect(await notify("conv-1")).toBe("SKIPPED");
    expect(mailer.sentTo).toHaveLength(1);
  });

  it("profissional já leu (professionalReadSeq = lastSeq) => SKIPPED", async () => {
    conversations.rows.set("conv-1", conversation({ professionalReadSeq: 3 }));
    expect(await build()("conv-1")).toBe("SKIPPED");
    expect(mailer.sentTo).toEqual([]);
  });

  it("última mensagem é do profissional (lastProfessionalSeq = lastSeq) => SKIPPED", async () => {
    conversations.rows.set("conv-1", conversation({ lastProfessionalSeq: 3 }));
    expect(await build()("conv-1")).toBe("SKIPPED");
    expect(mailer.sentTo).toEqual([]);
  });

  it("sem e-mail do profissional => SKIPPED e o carimbo anterior é reposto", async () => {
    const previous = new Date(NOW.getTime() - 2 * 60 * MINUTE);
    conversations.rows.set("conv-1", conversation({ professionalNotifiedAt: previous }));
    professionals.emails.delete("prof-1");
    expect(await build()("conv-1")).toBe("SKIPPED");
    expect(mailer.sentTo).toEqual([]);
    expect(conversations.rows.get("conv-1")?.professionalNotifiedAt).toEqual(previous);
  });

  it("falha do mailer => erro 'professional_notice_failed' sem e-mail nem causa, carimbo reposto e nova tentativa envia", async () => {
    const notify = build();
    mailer.fail = true;
    let caught: unknown;
    try {
      await notify("conv-1");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error;
    expect(error.message).toBe("professional_notice_failed");
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify({ message: error.message, cause: error.cause })).not.toContain("prof@example.test");
    expect(conversations.rows.get("conv-1")?.professionalNotifiedAt).toBeNull();

    mailer.fail = false;
    expect(await notify("conv-1")).toBe("SENT");
    expect(mailer.sentTo).toEqual(["prof@example.test"]);
  });

  it("conversa inexistente => SKIPPED", async () => {
    expect(await build()("nao-existe")).toBe("SKIPPED");
    expect(mailer.sentTo).toEqual([]);
  });

  it("5 chamadas em paralelo sobre a mesma conversa => exatamente 1 e-mail", async () => {
    const notify = build();
    const results = await Promise.all([notify("conv-1"), notify("conv-1"), notify("conv-1"), notify("conv-1"), notify("conv-1")]);
    expect(results.filter((r) => r === "SENT")).toHaveLength(1);
    expect(mailer.sentTo).toHaveLength(1);
  });
});
