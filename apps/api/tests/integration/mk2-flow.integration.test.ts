/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Fluxo ponta a ponta de MK2 (TC-MKT-65) com `access`/`families` reais, descoberta, conversas da família e do profissional e moderação
// do admin, mais o canário de PII transversal (TC-MKT-52/69; AC-MKT-26): texto, rótulo, nota e pesquisa ausentes de logs, auditoria e
// alertas; o profissional e o admin nunca recebem ids de família/membro/utilizador; enumeração indistinguível (TC-AZ-MKT-16).
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccessModule } from "../../src/modules/access/index.js";
import { createDiscoveryModule } from "../../src/modules/discovery/index.js";
import { createFamiliesModule } from "../../src/modules/families/index.js";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createMessagingModule } from "../../src/modules/messaging/index.js";
import { createUsersModule } from "../../src/modules/users/index.js";
import { API, SIGNING_KEYS, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const TEXT = "canario-fluxo-texto-xyz";
const REPLY = "canario-fluxo-resposta-xyz";
const LABEL = "canario-fluxo-rotulo-xyz";
const NOTE = "canario-fluxo-nota-xyz";
const SEARCH = "canario-fluxo-pesquisa-xyz";
const NAME = "Dra Fluxo Unica";

describe("MK2: fluxo ponta a ponta e canário de PII (TC-MKT-65)", () => {
  let h: ProfessionalsHarness;
  const logs: string[] = [];
  const alertInputs: unknown[] = [];
  let userToken: string;
  let otherToken: string;
  let adminToken: string;
  let familyId: string;
  let memberId: string;
  let otherFamilyId: string;
  let specialtyId: string;
  let p1: { professionalId: string; token: string };
  let p2: { professionalId: string; token: string };
  let draftId: string;

  const fam = (token: string, method: "get" | "post" | "put", path: string, body?: unknown) => {
    let r = request(h.app)[method](`${API}/families/${familyId}/members/${memberId}/conversations${path}`).set("Authorization", `Bearer ${token}`);
    if (body !== undefined) r = r.send(body as object);
    return r;
  };
  const pro = (token: string, method: "get" | "post" | "put", path: string, body?: unknown) => {
    let r = request(h.app)[method](`${API}/professional-portal/conversations${path}`).set("Authorization", `Bearer ${token}`);
    if (body !== undefined) r = r.send(body as object);
    return r;
  };
  const admin = (method: "get" | "post", path: string, body?: unknown) => {
    let r = request(h.app)[method](`${API}/admin/message-reports${path}`).set("Authorization", `Bearer ${adminToken}`);
    if (body !== undefined) r = r.send(body as object);
    return r;
  };
  const market = (path: string) => request(h.app).get(`${API}/marketplace${path}`).set("Authorization", `Bearer ${userToken}`);

  async function newUser(birth = "1985-01-01"): Promise<{ id: string; token: string }> {
    const id = randomUUID();
    await h.pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','U','" + birth + "','Africa/Luanda','ACTIVE','1',now())", [id, `u-${id}@exemplo.ao`]);
    const token = (await signAccessToken({ subject: { userId: id, sessionId: randomUUID() }, now: h.clock.now(), ttlSeconds: 900, signingKeys: SIGNING_KEYS })).token;
    return { id, token };
  }
  async function approve(p: { professionalId: string }, name: string, status = "APPROVED"): Promise<void> {
    await h.pool.query("UPDATE professionals SET validation_status = $2::professional_validation_status, display_name = $3, city = 'Luanda', bio = 'Bio publica do profissional', approved_at = now() - interval '100 days', submitted_at = now() WHERE id = $1", [p.professionalId, status, name]);
    await h.pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1,$2)", [p.professionalId, specialtyId]);
    await h.pool.query("INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz, active) VALUES ($1,$2,'VIDEO',30,$3,true)", [p.professionalId, specialtyId, status === "APPROVED" ? 5000 : 4000]);
  }
  const bodyOf = (res: { body: unknown }) => res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    h = await startProfessionalsHarness(
      {},
      ({ audit, db, clock, module }) => {
        const usersModule = createUsersModule({ db, audit, clock, currentTermsVersion: "1" });
        const families = createFamiliesModule({
          db,
          audit,
          users: usersModule,
          clock,
          mailer: { send: () => Promise.resolve() },
          appBaseUrl: "https://vitafamily.cassfrei.com",
          memberData: { purgeMemberFiles: () => Promise.resolve(), purgeFamilyFiles: () => Promise.resolve(), exportBeforeRemoval: () => Promise.reject(new Error("não usado")) },
        });
        const access = createAccessModule({ db, audit, families, clock });
        const discovery = createDiscoveryModule({ clock, catalog: { listApprovedFacts: (q) => module.directory.listApprovedFacts(q), getApprovedFacts: (ids) => module.directory.getApprovedFacts(ids) } });
        const messaging = createMessagingModule({
          db,
          audit,
          clock,
          access: {
            assertCanMessage: async (trx, input) => {
              const ctx = await access.policy.can(trx, { userId: input.userId, platformAdmin: input.platformAdmin, familyId: input.familyId, action: "MESSAGE_PROFESSIONALS", subjectMemberId: input.memberId });
              return { relation: ctx.relation === "TUTOR_OF" ? "TUTOR_OF" : "SELF" };
            },
          },
          professionals: { findIdentities: (ids) => module.directory.getConversationIdentities(ids), getNotificationEmail: () => Promise.resolve(null) },
          alerts: {
            raiseMessageReceived: (_trx, input) => {
              alertInputs.push(input);
              return Promise.resolve();
            },
            markConversationRead: () => Promise.resolve(),
          },
          noticeQueue: { enqueue: () => Promise.resolve() },
        });
        return [discovery.router, messaging.router, messaging.professionalRouter, messaging.adminRouter];
      },
      { logStream: logs },
    );
    const u = await newUser();
    userToken = u.token;
    otherToken = (await newUser()).token;
    adminToken = await h.adminToken();
    familyId = randomUUID();
    otherFamilyId = randomUUID();
    await h.pool.query("INSERT INTO families (id, name) VALUES ($1,'F'), ($2,'G')", [familyId, otherFamilyId]);
    memberId = randomUUID();
    await h.pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role, is_dependent, status) VALUES ($1,$2,$3,'M','1985-01-01','FAMILY_ADMIN',false,'ACTIVE')", [memberId, familyId, u.id]);
    const { rows } = await h.pool.query<{ id: string }>("INSERT INTO specialties (name, category, active) VALUES ($1,'HEALTH',true) RETURNING id", [`Flow ${randomUUID().slice(0, 6)}`]);
    specialtyId = rows[0]?.id ?? "";
    p1 = await h.newProfessional();
    p2 = await h.newProfessional();
    const draft = await h.newProfessional();
    draftId = draft.professionalId;
    await approve(p1, NAME);
    await approve(p2, "Dr Fluxo Segundo");
    await h.pool.query("UPDATE professionals SET display_name = 'Rascunho Fluxo' WHERE id = $1", [draftId]);
  }, 300_000);

  afterAll(async () => {
    await h.stop();
  });

  it("descoberta: pesquisa e comparação de 2 só veem APPROVED; o rascunho é indistinguível de inexistente", async () => {
    const found = await market(`/professionals?specialtyId=${specialtyId}&sort=RANKING`);
    expect(found.status).toBe(200);
    const ids = bodyOf(found).items.map((i: { id: string }) => i.id);
    expect(ids).toContain(p1.professionalId);
    expect(ids).toContain(p2.professionalId);
    expect(ids).not.toContain(draftId);
    const compare = await market(`/professionals/compare?specialtyId=${specialtyId}&ids=${p1.professionalId},${p2.professionalId}`);
    expect(compare.status).toBe(200);
    const draftProfile = await market(`/professionals/${draftId}`);
    const missingProfile = await market(`/professionals/${randomUUID()}`);
    expect(draftProfile.status).toBe(404);
    expect(draftProfile.status).toBe(missingProfile.status);
    expect({ ...bodyOf(draftProfile), requestId: 0, instance: 0 }).toEqual({ ...bodyOf(missingProfile), requestId: 0, instance: 0 });
    await market(`/professionals?q=${SEARCH}&city=${SEARCH}`).expect(200);
  });

  it("enumeração: abrir conversa com rascunho, suspenso e inexistente ⇒ 404 idêntico; família alheia ⇒ 404 igual à inexistente", async () => {
    const open = (professionalId: string) => fam(userToken, "post", "", { professionalId, participantLabel: LABEL, text: TEXT });
    const a = await open(draftId);
    const b = await open(randomUUID());
    expect([a.status, b.status]).toEqual([404, 404]);
    expect({ ...bodyOf(a), requestId: 0, instance: 0 }).toEqual({ ...bodyOf(b), requestId: 0, instance: 0 });
    const foreign = await request(h.app).get(`${API}/families/${otherFamilyId}/members/${memberId}/conversations`).set("Authorization", `Bearer ${userToken}`);
    const none = await request(h.app).get(`${API}/families/${randomUUID()}/members/${randomUUID()}/conversations`).set("Authorization", `Bearer ${userToken}`);
    expect(foreign.status).toBe(none.status);
    expect({ ...bodyOf(foreign), requestId: 0, instance: 0 }).toEqual({ ...bodyOf(none), requestId: 0, instance: 0 });
  });

  it("fluxo: família escreve, profissional responde, lê, denúncias cruzadas, moderação fecha, suspensão bloqueia o envio", async () => {
    // família abre (SELF) a conversa com p1
    const opened = await fam(userToken, "post", "", { professionalId: p1.professionalId, participantLabel: LABEL, text: TEXT });
    expect(opened.status).toBe(201);
    const cid: string = bodyOf(opened).conversation.id;
    // o profissional vê-a só com rótulo, sem ids da família
    const proList = await pro(p1.token, "get", "");
    expect(proList.status).toBe(200);
    expect(bodyOf(proList).items.find((c: { id: string }) => c.id === cid)).toMatchObject({ participantLabel: LABEL, unreadCount: 1 });
    // e responde; a família é alertada (stub) e depois lê
    const reply = await pro(p1.token, "post", `/${cid}/messages`, { text: REPLY });
    expect(reply.status).toBe(201);
    expect(alertInputs).toHaveLength(1);
    expect((await fam(userToken, "get", `/${cid}`)).body).toMatchObject({ unreadCount: 1 });
    await fam(userToken, "put", `/${cid}/read`, {}).expect(200);
    expect((await fam(userToken, "get", `/${cid}`)).body).toMatchObject({ unreadCount: 0 });
    // outra conta (sem relação com o membro) não lê esta conversa
    expect((await fam(otherToken, "get", `/${cid}/messages`)).status).toBeGreaterThanOrEqual(403);
    // denúncias dos dois lados (a mensagem do outro lado)
    const familyMessages = bodyOf(await fam(userToken, "get", `/${cid}/messages`)).items as { id: string; side: string }[];
    const replyId = familyMessages.find((m) => m.side === "PROFESSIONAL")?.id ?? "";
    const textId = familyMessages.find((m) => m.side === "FAMILY")?.id ?? "";
    await fam(userToken, "post", `/${cid}/messages/${replyId}/reports`, { reason: "ABUSE", note: NOTE }).expect(201);
    await pro(p1.token, "post", `/${cid}/messages/${textId}/reports`, { reason: "SPAM", note: NOTE }).expect(201);
    // moderação: a fila não tem texto; o detalhe sim, sem ids da família; decidir fecha por sistema
    const queue = await admin("get", "");
    expect(queue.status).toBe(200);
    expect(JSON.stringify(queue.body)).not.toMatch(new RegExp([TEXT, REPLY, NOTE, LABEL].join("|")));
    const reportId: string = bodyOf(queue).items.find((r: { reportedSide: string }) => r.reportedSide === "PROFESSIONAL")?.id;
    const detail = await admin("get", `/${reportId}`);
    expect(detail.status).toBe(200);
    expect(bodyOf(detail).message.text).toBe(REPLY);
    expect(bodyOf(detail).contextBefore.map((m: { text: string }) => m.text)).toEqual([TEXT]);
    const adminDump = JSON.stringify(detail.body);
    for (const forbidden of [familyId, memberId, cid, LABEL]) expect(adminDump).not.toContain(forbidden);
    const decided = await admin("post", `/${reportId}/decisions`, { decision: "HIDE_AND_CLOSE" });
    expect(decided.status).toBe(200);
    const closed = await fam(userToken, "post", `/${cid}/messages`, { text: "depois do fecho" });
    expect(closed.status).toBe(409);
    expect(bodyOf(closed).code).toBe("CONVERSATION_CLOSED");
    // o profissional vê a mensagem oculta sem texto, e nunca ids da família
    const proMessages = bodyOf(await pro(p1.token, "get", `/${cid}/messages`)).items as { hidden: boolean; text: string | null }[];
    expect(proMessages.some((m) => m.hidden && m.text === null)).toBe(true);
    const proDump = JSON.stringify([proList.body, reply.body, proMessages]);
    for (const forbidden of [familyId, memberId, "senderUserId", "openedByUserId"]) expect(proDump).not.toContain(forbidden);

    // suspensão do outro profissional bloqueia o envio nos dois lados e a abertura de novas conversas
    const second = await fam(userToken, "post", "", { professionalId: p2.professionalId, participantLabel: "Ana", text: "olá" });
    expect(second.status).toBe(201);
    const cid2: string = bodyOf(second).conversation.id;
    await h.pool.query("UPDATE professionals SET validation_status = 'SUSPENDED' WHERE id = $1", [p2.professionalId]);
    const famBlocked = await fam(userToken, "post", `/${cid2}/messages`, { text: "olá de novo" });
    expect(famBlocked.status).toBe(409);
    expect(bodyOf(famBlocked).code).toBe("CONVERSATION_CLOSED");
    const proBlocked = await pro(p2.token, "post", `/${cid2}/messages`, { text: "resposta" });
    expect(proBlocked.status).toBe(409);
    expect(bodyOf(proBlocked).code).toBe("PROFESSIONAL_LOCKED");
    expect((await fam(userToken, "get", `/${cid2}/messages`)).status).toBe(200); // leitura continua
    expect((await pro(p2.token, "get", `/${cid2}/messages`)).status).toBe(200);
    expect((await fam(userToken, "post", "", { professionalId: p2.professionalId, participantLabel: "Ana", text: "olá" })).status).toBe(404); // profissional não APPROVED: nova abertura/continuação ⇒ 404 (TC-MKT-57)
  });

  it("canário: texto, resposta, rótulo, nota e pesquisa ausentes de logs, auditoria e alertas do fluxo", async () => {
    const audit = await h.pool.query<{ t: string }>("SELECT row_to_json(a)::text AS t FROM audit_logs a");
    const dump = [audit.rows.map((r) => r.t).join("\n"), logs.join("\n"), JSON.stringify(alertInputs)].join("\n");
    for (const canary of [TEXT, REPLY, LABEL, NOTE, SEARCH]) expect(dump, canary).not.toContain(canary);
    const actions = (await h.pool.query<{ action: string }>("SELECT DISTINCT action FROM audit_logs")).rows.map((r) => r.action);
    for (const a of ["CONVERSATION_START", "MESSAGE_REPORT_CREATE", "PROFESSIONAL_MESSAGE_REPORT_CREATE", "ADMIN_MESSAGE_REPORT_VIEW", "ADMIN_MESSAGE_REPORT_DECIDE"]) expect(actions).toContain(a);
    expect(await h.pool.query("SELECT 1 FROM audit_logs WHERE action ILIKE '%SEARCH%' OR action ILIKE '%MARKETPLACE%'").then((r) => r.rowCount)).toBe(0);
  });
});
