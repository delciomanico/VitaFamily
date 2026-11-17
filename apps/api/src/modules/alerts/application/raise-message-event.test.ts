// Alerta `message.received` (BR-MKT-41): criação idempotente por (regra, conversa, destinatário, familyReadSeq) e marcação de leitura por origem.
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { buildMessageDedupeKey } from "../domain/rule.js";
import { createAlertsFixtures, type AlertsFixtures } from "./fixtures.js";
import { createMarkSourceReadUseCase, createRaiseMessageEventUseCase } from "./raise-message-event.js";

const NOW = new Date("2026-11-10T08:00:00Z");
const TRX = {};
const INPUT = { conversationId: "conv-1", familyId: "fam-1", memberId: "member-1", familyReadSeq: 0 };

describe("buildMessageDedupeKey", () => {
  it("devolve message.received:<conversa>:<utilizador>:<familyReadSeq>", () => {
    expect(buildMessageDedupeKey("conv-1", "user-1", 3)).toBe("message.received:conv-1:user-1:3");
  });
});

describe("raiseMessageEvent", () => {
  let clock: FixedClock;
  let fx: AlertsFixtures;

  beforeEach(() => {
    clock = new FixedClock(NOW);
    fx = createAlertsFixtures(clock);
    fx.families.seedMember({ id: "member-1", familyId: "fam-1", userId: "user-1", name: "Titular", birthDate: "1990-01-01", isDependent: false, status: "ACTIVE", createdAt: NOW });
  });

  it("cria MESSAGE_RECEIVED (message.received, origem CONVERSATION) para o titular e pede a notificação", async () => {
    expect(await createRaiseMessageEventUseCase(fx.deps)(TRX, INPUT)).toBe(1);
    const [alert] = [...fx.alertsRepo.byId.values()];
    expect(alert).toMatchObject({ type: "MESSAGE_RECEIVED", ruleKey: "message.received", sourceType: "CONVERSATION", sourceId: "conv-1", recipientUserId: "user-1", familyId: "fam-1", memberId: "member-1" });
    expect(fx.notifications.enqueued).toEqual([{ alertId: alert?.id, recipientUserId: "user-1" }]);
  });

  it("dependente com conta: só os tutores recebem, sem repetir tutores e nunca o dependente", async () => {
    fx.families.members.set("member-1", { id: "member-1", familyId: "fam-1", userId: "dep-user", name: "Dependente", birthDate: "2015-01-01", isDependent: true, status: "ACTIVE", createdAt: NOW });
    fx.families.guardianUserIdsByDependent.set("member-1", ["tutor-1", "tutor-2", "tutor-1"]);
    expect(await createRaiseMessageEventUseCase(fx.deps)(TRX, INPUT)).toBe(2);
    expect([...fx.alertsRepo.byId.values()].map((a) => a.recipientUserId).sort()).toEqual(["tutor-1", "tutor-2"]);
  });

  it("dedupeKey: mesmo familyReadSeq não cria segundo alerta (mesmo noutro instante); novo familyReadSeq cria novo", async () => {
    const raise = createRaiseMessageEventUseCase(fx.deps);
    expect(await raise(TRX, INPUT)).toBe(1);
    clock.advance(60 * 60 * 1000);
    expect(await raise(TRX, INPUT)).toBe(0);
    expect(fx.alertsRepo.byId.size).toBe(1);
    expect(await raise(TRX, { ...INPUT, familyReadSeq: 1 })).toBe(1);
    expect(fx.alertsRepo.byId.size).toBe(2);
    expect([...fx.alertsRepo.byDedupeKey.keys()].sort()).toEqual([
      "message.received:conv-1:user-1:0",
      "message.received:conv-1:user-1:1",
    ]);
  });

  it("membro inexistente não cria nada", async () => {
    expect(await createRaiseMessageEventUseCase(fx.deps)(TRX, { ...INPUT, memberId: "nope" })).toBe(0);
    expect(fx.alertsRepo.byId.size).toBe(0);
    expect(fx.notifications.enqueued).toEqual([]);
  });
});

describe("markSourceRead", () => {
  let fx: AlertsFixtures;

  beforeEach(() => {
    fx = createAlertsFixtures(new FixedClock(NOW));
    fx.families.seedMember({ id: "member-1", familyId: "fam-1", userId: "dep-user", name: "Dependente", birthDate: "2015-01-01", isDependent: true, status: "ACTIVE", createdAt: NOW });
    fx.families.guardianUserIdsByDependent.set("member-1", ["tutor-1", "tutor-2"]);
  });

  it("marca como lidos os alertas da conversa de todos os destinatários, cancela envios e não toca outras origens", async () => {
    const raise = createRaiseMessageEventUseCase(fx.deps);
    await raise(TRX, INPUT);
    await raise(TRX, { ...INPUT, conversationId: "conv-2" });
    await fx.alertsRepo.insertIfNew(TRX, {
      id: "appt-alert",
      recipientUserId: "tutor-1",
      familyId: "fam-1",
      memberId: "member-1",
      type: "EXAM_ORDER_ADDED",
      sourceType: "APPOINTMENT",
      sourceId: "conv-1",
      ruleKey: "exam_order.added",
      dedupeKey: "exam_order.added:conv-1:tutor-1",
      triggerAt: NOW,
      createdAt: NOW,
    });
    const conv1Ids = [...fx.alertsRepo.byId.values()].filter((a) => a.sourceType === "CONVERSATION" && a.sourceId === "conv-1").map((a) => a.id);
    expect(conv1Ids).toHaveLength(2);

    expect(await createMarkSourceReadUseCase(fx.deps)(TRX, { sourceType: "CONVERSATION", sourceId: "conv-1" })).toBe(2);

    expect(fx.notifications.skipped.sort()).toEqual([...conv1Ids].sort());
    for (const id of conv1Ids) {
      expect(fx.alertsRepo.byId.get(id)?.readAt).toBeDefined();
    }
    const others = [...fx.alertsRepo.byId.values()].filter((a) => !conv1Ids.includes(a.id));
    expect(others).toHaveLength(3);
    expect(others.every((a) => a.readAt === undefined)).toBe(true);
  });

  it("segunda chamada devolve 0 e não cancela de novo", async () => {
    const raise = createRaiseMessageEventUseCase(fx.deps);
    const markRead = createMarkSourceReadUseCase(fx.deps);
    await raise(TRX, INPUT);
    expect(await markRead(TRX, { sourceType: "CONVERSATION", sourceId: "conv-1" })).toBe(2);
    expect(await markRead(TRX, { sourceType: "CONVERSATION", sourceId: "conv-1" })).toBe(0);
    expect(fx.notifications.skipped).toHaveLength(2);
  });
});
