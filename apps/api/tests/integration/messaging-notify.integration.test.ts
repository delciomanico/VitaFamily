/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- corpos JSON lidos de forma dinâmica nos testes */
// Integração (PostgreSQL real; `access`, `families`, `alerts` e `notifications` reais) dos avisos de MK2 S7 (TC-MKT-59/60, BR-MKT-41/46):
// alerta `message.received` (um por conversa até a família ler, marcador partilhado entre tutores), e-mail genérico ao profissional
// (≤ 1 cada 30 min, idempotente sob concorrência, retry) e canário de PII em e-mails, alertas e logs.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccessModule } from "../../src/modules/access/index.js";
import { createAlertsModule, type AlertsModule } from "../../src/modules/alerts/index.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createFamiliesModule } from "../../src/modules/families/index.js";
import { createMessagingModule } from "../../src/modules/messaging/index.js";
import { createNotifyProfessional } from "../../src/modules/messaging/application/notify-professional.js";
import { KyselyConversationRepository } from "../../src/modules/messaging/infrastructure/repo.js";
import { NEW_MESSAGE_SUBJECT, NEW_MESSAGE_TEXT } from "../../src/modules/messaging/infrastructure/mailer-smtp.js";
import { createNotificationsModule } from "../../src/modules/notifications/index.js";
import { createUsersModule } from "../../src/modules/users/index.js";
import { withTransaction } from "../../src/platform/db/index.js";
import { API, SIGNING_KEYS, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const TEXT_CANARY = "canario-texto-s7";
const LABEL_CANARY = "canario-rotulo-s7";
const MEMBER_CANARY = "Canario Membro S7";
const MIN = 60_000;

describe("integração: avisos de nova mensagem (MK2 S7)", () => {
  let h: ProfessionalsHarness;
  const logs: string[] = [];
  const queued: string[] = [];
  const sent: { to: string; subject?: string; text: string }[] = [];
  let failMail = false;
  let alerts: AlertsModule;
  const tokens = new Map<string, string>();
  const users: Record<string, string> = {};
  let fam: string;
  let tutorA: string;
  let tutorB: string;
  let dep: string;
  let pId: string;
  let pEmail: string;
  let conv: string;

  const call = (method: "get" | "post" | "put", u: string, path: string, body?: unknown) => {
    let r = request(h.app)[method](`${API}${path}`).set("Authorization", `Bearer ${tokens.get(u) ?? ""}`);
    if (body !== undefined) r = r.send(body as object);
    return r;
  };
  async function user(name: string): Promise<string> {
    const id = randomUUID();
    await h.pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x',$3,'1985-01-01','Africa/Luanda','ACTIVE','1',now())", [id, `${name}-${id}@exemplo.ao`, name]);
    users[name] = id;
    tokens.set(name, (await signAccessToken({ subject: { userId: id, sessionId: randomUUID() }, now: h.clock.now(), ttlSeconds: 172800, signingKeys: SIGNING_KEYS })).token);
    return id;
  }
  /** Mensagem do profissional (o lado profissional é a S8): por SQL + o alerta pela mesma porta de `alerts` que a S8 usará. */
  async function professionalWrites(): Promise<void> {
    const { rows } = await h.pool.query<{ last_seq: number; family_read_seq: number }>("SELECT last_seq, family_read_seq FROM conversations WHERE id = $1", [conv]);
    const row = rows[0];
    if (!row) throw new Error("sem conversa");
    const seq = row.last_seq + 1;
    await h.pool.query("INSERT INTO messages (conversation_id, seq, side, body, created_at) VALUES ($1,$2,'PROFESSIONAL','resposta',$3)", [conv, seq, h.clock.now()]);
    await h.pool.query("UPDATE conversations SET last_seq = $2, last_professional_seq = $2, last_message_at = $3 WHERE id = $1", [conv, seq, h.clock.now()]);
    await withTransaction(h.db, (trx) => alerts.raiseMessageEvent(trx, { conversationId: conv, familyId: fam, memberId: dep, familyReadSeq: row.family_read_seq }));
  }
  const alertsOf = async (name: string) => {
    const res = await call("get", name, "/alerts");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.items as { type: string }[]).filter((a) => a.type === "MESSAGE_RECEIVED") as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const notify = () => createNotifyProfessional({ conversations: new KyselyConversationRepository(), professionals: { getNotificationEmail: (id) => h.module.directory.getNotificationEmail(id) }, mailer: { sendNewMessageNotice: (to) => (failMail ? Promise.reject(new Error(`smtp falhou para ${to}`)) : (sent.push({ to, text: NEW_MESSAGE_TEXT, subject: NEW_MESSAGE_SUBJECT }), Promise.resolve())) }, withTransaction: (fn) => withTransaction(h.db, fn), clock: h.clock });

  beforeAll(async () => {
    h = await startProfessionalsHarness(
      {},
      ({ audit, db, clock, module }) => {
        const usersModule = createUsersModule({ db, audit, clock, currentTermsVersion: "1" });
        const families = createFamiliesModule({ db, audit, users: usersModule, clock, mailer: { send: () => Promise.resolve() }, appBaseUrl: "https://vitafamily.cassfrei.com", memberData: { purgeMemberFiles: () => Promise.resolve(), purgeFamilyFiles: () => Promise.resolve(), exportBeforeRemoval: () => Promise.reject(new Error("não usado")) } });
        const access = createAccessModule({ db, audit, families, clock });
        const notifications = createNotificationsModule({ db, users: usersModule, clock, mailer: { send: () => Promise.resolve() }, pushSender: { send: () => Promise.resolve({ ok: true } as never) } });
        alerts = createAlertsModule({ db, families, notifications, clock });
        const messaging = createMessagingModule({
          db,
          audit,
          clock,
          access: { assertCanMessage: async (trx, i) => ({ relation: (await access.policy.can(trx, { userId: i.userId, platformAdmin: i.platformAdmin, familyId: i.familyId, action: "MESSAGE_PROFESSIONALS", subjectMemberId: i.memberId })).relation === "TUTOR_OF" ? "TUTOR_OF" : "SELF" }) },
          professionals: { findIdentities: (ids) => module.directory.getConversationIdentities(ids), getNotificationEmail: (id) => module.directory.getNotificationEmail(id) },
          alerts: { raiseMessageReceived: async (trx, i) => {
            await alerts.raiseMessageEvent(trx, i);
          }, markConversationRead: async (trx, i) => {
            await alerts.markSourceRead(trx, { sourceType: "CONVERSATION", sourceId: i.conversationId });
          } },
          noticeQueue: { enqueue: (id) => (queued.push(id), Promise.resolve()) },
        });
        return [messaging.router, alerts.router];
      },
      { logStream: logs },
    );
    tutorA = await user("ta");
    tutorB = await user("tb");
    fam = randomUUID();
    await h.pool.query("INSERT INTO families (id, name) VALUES ($1,'F')", [fam]);
    const mk = async (name: string, o: { userId?: string; dependent?: boolean; role?: string; guardians?: string[] }) => {
      const id = randomUUID();
      await h.pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role, is_dependent) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, fam, o.userId ?? null, name, o.dependent ? "2018-01-01" : "1985-01-01", o.role ?? null, o.dependent ?? false]);
      for (const [i, g] of (o.guardians ?? []).entries()) await h.pool.query("INSERT INTO guardianships (family_id, dependent_id, guardian_id, is_primary) VALUES ($1,$2,$3,$4)", [fam, id, g, i === 0]);
      return id;
    };
    const ma = await mk("A", { userId: tutorA, role: "FAMILY_ADMIN" });
    const mb = await mk("B", { userId: tutorB, role: "FAMILY_MEMBER" });
    dep = await mk(MEMBER_CANARY, { dependent: true, guardians: [ma, mb] });
    const reg = await h.registerVerified();
    pId = reg.professionalId;
    pEmail = reg.email;
    await h.pool.query("UPDATE professionals SET validation_status = 'APPROVED', display_name = 'Dra. Nome Publico', city = 'Luanda', approved_at = now(), submitted_at = now() WHERE id = $1", [pId]);
    const res = await call("post", "ta", `/families/${fam}/members/${dep}/conversations`, { professionalId: pId, participantLabel: LABEL_CANARY, text: TEXT_CANARY });
    expect(res.status).toBe(201);
    conv = res.body.conversation.id as string;
  }, 240_000);

  afterAll(async () => {
    await h.stop();
  });

  it("TC-MKT-59: o envio da família enfileira o aviso (só o id da conversa); repetições idempotentes não enfileiram de novo", async () => {
    expect(queued).toEqual([conv]);
    const cid = randomUUID();
    await call("post", "ta", `/families/${fam}/members/${dep}/conversations/${conv}/messages`, { text: "outra", clientMessageId: cid }).expect(201);
    await call("post", "ta", `/families/${fam}/members/${dep}/conversations/${conv}/messages`, { text: "outra", clientMessageId: cid }).expect(200);
    expect(queued).toEqual([conv, conv]);
  });

  it("TC-MKT-60: e-mail genérico ao profissional: 1 por 30 min, idempotente sob concorrência, retry em falha, só se não leu; sem PII", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => notify()(conv)));
    expect(results.filter((r) => r === "SENT")).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(pEmail);
    h.clock.advance(10 * MIN);
    expect(await notify()(conv)).toBe("SKIPPED");
    h.clock.advance(21 * MIN);
    // falha do SMTP: o erro não leva o destinatário e a reserva é desfeita (o retry envia)
    failMail = true;
    const failure = await notify()(conv).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("professional_notice_failed");
    expect(JSON.stringify(failure) + String((failure as Error).stack)).not.toContain(pEmail);
    failMail = false;
    expect(await notify()(conv)).toBe("SENT");
    expect(sent).toHaveLength(2);
    // já lido pelo profissional ⇒ não avisa
    h.clock.advance(31 * MIN);
    await h.pool.query("UPDATE conversations SET professional_read_seq = last_seq WHERE id = $1", [conv]);
    expect(await notify()(conv)).toBe("SKIPPED");
    // canário: o e-mail é fixo
    const everything = JSON.stringify(sent) + logs.join("\n");
    for (const secret of [TEXT_CANARY, LABEL_CANARY, MEMBER_CANARY, "Nome Publico", fam, dep, conv, users.ta ?? ""]) expect(everything).not.toContain(secret);
    expect(sent.every((m) => m.text === NEW_MESSAGE_TEXT && m.subject === NEW_MESSAGE_SUBJECT)).toBe(true);
  });

  it("BR-MKT-41: alerta `message.received`: um por conversa até a família ler; ambos os tutores; texto genérico; ler limpa; novo alerta depois", async () => {
    await professionalWrites();
    await professionalWrites(); // mesma leitura (familyReadSeq) ⇒ sem alerta novo
    for (const t of ["ta", "tb"]) {
      const list = await alertsOf(t);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ sourceType: "CONVERSATION", sourceId: conv, readAt: null, message: "Tem uma nova mensagem de um profissional." });
      expect(JSON.stringify(list[0])).not.toContain("resposta");
      expect(JSON.stringify(list[0])).not.toContain("Nome Publico");
    }
    const notifications = await h.pool.query("SELECT count(*)::int AS n FROM notifications n JOIN alerts a ON a.id = n.alert_id WHERE a.source_id = $1", [conv]);
    expect(notifications.rows[0]?.n).toBeGreaterThan(0);
    // o outro tutor lê ⇒ ficam lidos para os dois
    await call("put", "tb", `/families/${fam}/members/${dep}/conversations/${conv}/read`, {}).expect(200);
    for (const t of ["ta", "tb"]) expect((await alertsOf(t))[0]?.readAt).toBeTruthy();
    const pending = await h.pool.query("SELECT count(*)::int AS n FROM notifications n JOIN alerts a ON a.id = n.alert_id WHERE a.source_id = $1 AND n.status = 'PENDING'", [conv]);
    expect(pending.rows[0]?.n).toBe(0);
    // nova mensagem depois de ler ⇒ novo alerta
    await professionalWrites();
    expect((await alertsOf("ta")).filter((a: { readAt: string | null }) => a.readAt === null)).toHaveLength(1);
    expect(logs.join("\n")).not.toContain(TEXT_CANARY);
  });
});
