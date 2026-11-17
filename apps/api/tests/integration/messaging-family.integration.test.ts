/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Integração (PostgreSQL real, app real com validação de pedidos E respostas, `access` e `families` reais) do lado da FAMÍLIA de
// `messaging` (MK2 S6): TC-MKT-55/56/58/61/69, TC-AZ-MKT-11/12. Privacidade (BR-MKT-46/48), concorrência, idempotência, limites,
// estados, denúncias e auditoria sem texto/rótulo/nota.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signAccessToken } from "../../src/modules/auth/domain/jwt.js";
import { createAccessModule } from "../../src/modules/access/index.js";
import { createFamiliesModule } from "../../src/modules/families/index.js";
import { createMessagingModule } from "../../src/modules/messaging/index.js";
import { createUsersModule } from "../../src/modules/users/index.js";
import { API, SIGNING_KEYS, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const TEXT_CANARY = "canario-texto-xyz";
const LABEL_CANARY = "canario-rotulo-xyz";
const NOTE_CANARY = "canario-nota-xyz";
const MIN = 60_000;

describe("integração: conversas do lado da família (MK2 S6)", () => {
  let h: ProfessionalsHarness;
  const logs: string[] = [];
  const alertCalls: { conversationId: string }[] = [];
  const notices: string[] = [];
  const tokens = new Map<string, string>();
  const users: Record<string, string> = {};
  let familyId: string;
  let m1: string; // titular u1 (SELF)
  let d1: string; // dependente, tutores u1 e u2
  let d2: string; // dependente com conta u4 (DEPENDENT_SELF) tutor u1
  let dBlocked: string;
  let mOther: string; // membro u3 (OTHER para m1)
  let otherFamily: string;
  let otherMember: string;
  let p1: string;
  let p2: string;
  let pSuspended: string;
  let pDraft: string;

  const call = (method: "get" | "post" | "put", user: string, path: string, body?: unknown) => {
    let r = request(h.app)[method](`${API}${path}`).set("Authorization", `Bearer ${tokens.get(user) ?? ""}`);
    if (body !== undefined) r = r.send(body as object);
    return r;
  };
  const famOf = new Map<string, string>();
  const base = (member: string, fam = famOf.get(member) ?? familyId) => `/families/${fam}/members/${member}/conversations`;

  async function user(name: string, birth = "1985-01-01"): Promise<string> {
    const id = randomUUID();
    await h.pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x',$3,$4,'Africa/Luanda','ACTIVE','1',now())", [id, `${name}-${id}@exemplo.ao`, name, birth]);
    users[name] = id;
    tokens.set(name, (await signAccessToken({ subject: { userId: id, sessionId: randomUUID() }, now: h.clock.now(), ttlSeconds: 900, signingKeys: SIGNING_KEYS })).token);
    return id;
  }
  async function member(fam: string, name: string, opts: { userId?: string; dependent?: boolean; role?: string; blocked?: boolean; guardians?: string[] } = {}): Promise<string> {
    const id = randomUUID();
    await h.pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role, is_dependent, status, blocked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, fam, opts.userId ?? null, name, opts.dependent ? "2018-01-01" : "1985-01-01", opts.role ?? null, opts.dependent ?? false, opts.blocked ? "BLOCKED" : "ACTIVE", opts.blocked ? h.clock.now() : null]);
    for (const [i, g] of (opts.guardians ?? []).entries()) await h.pool.query("INSERT INTO guardianships (family_id, dependent_id, guardian_id, is_primary) VALUES ($1,$2,$3,$4)", [fam, id, g, i === 0]);
    famOf.set(id, fam);
    return id;
  }
  async function pro(status: "APPROVED" | "SUSPENDED" | "DRAFT", name: string): Promise<string> {
    const { professionalId } = await h.registerVerified();
    await h.pool.query("UPDATE professionals SET validation_status = $2::professional_validation_status, display_name = $3, city = 'Luanda', approved_at = CASE WHEN $2 <> 'DRAFT' THEN now() END, submitted_at = CASE WHEN $2 <> 'DRAFT' THEN now() END WHERE id = $1", [professionalId, status, name]);
    return professionalId;
  }
  /** Utilizador novo com família própria (titular `m`, dependente `d` e dependente com conta `d2`) para os limites não interferirem. */
  async function actor(): Promise<{ u: string; m: string; d: string; fam: string }> {
    const name = `a${randomUUID().slice(0, 8)}`;
    const uid = await user(name);
    const fam = randomUUID();
    await h.pool.query("INSERT INTO families (id, name) VALUES ($1,'A')", [fam]);
    const m = await member(fam, "M", { userId: uid, role: "FAMILY_ADMIN" });
    const d = await member(fam, "D", { dependent: true, guardians: [m] });
    return { u: name, m, d, fam };
  }
  async function rawPro(): Promise<string> {
    const accountId = randomUUID();
    await h.pool.query("INSERT INTO professional_accounts (id, email, password_hash, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','v1',now())", [accountId, `r-${accountId}@teste.pt`]);
    const id = randomUUID();
    await h.pool.query("INSERT INTO professionals (id, account_id, validation_status, display_name, city, approved_at, submitted_at) VALUES ($1,$2,'APPROVED','Raw','Luanda',now(),now())", [id, accountId]);
    return id;
  }
  async function setStatus(id: string, status: string): Promise<void> {
    await h.pool.query("UPDATE professionals SET validation_status = $2::professional_validation_status WHERE id = $1", [id, status]);
  }
  /** Resposta do profissional simulada por SQL (o lado profissional é a S8). */
  async function professionalReply(conversationId: string, text = "resposta"): Promise<string> {
    const { rows } = await h.pool.query<{ last_seq: number }>("SELECT last_seq FROM conversations WHERE id = $1", [conversationId]);
    const seq = (rows[0]?.last_seq ?? 0) + 1;
    const id = randomUUID();
    await h.pool.query("INSERT INTO messages (id, conversation_id, seq, side, body, created_at) VALUES ($1,$2,$3,'PROFESSIONAL',$4,$5)", [id, conversationId, seq, text, h.clock.now()]);
    await h.pool.query("UPDATE conversations SET last_seq = $2, last_professional_seq = $2, last_message_at = $3 WHERE id = $1", [conversationId, seq, h.clock.now()]);
    return id;
  }
  async function start(u: string, member: string, professionalId: string, extra: Record<string, unknown> = {}) {
    return call("post", u, base(member), { professionalId, participantLabel: "Ana", text: "Olá, tenho uma dúvida", ...extra });
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
            raiseMessageReceived: () => Promise.resolve(),
            markConversationRead: (_trx, input) => {
              alertCalls.push(input);
              return Promise.resolve();
            },
          },
          noticeQueue: {
            enqueue: (id) => {
              notices.push(id);
              return Promise.resolve();
            },
          },
        });
        return [messaging.router];
      },
      { logStream: logs },
    );
    const u1 = await user("u1");
    const u2 = await user("u2");
    await user("u3");
    const u4 = await user("u4", "2012-01-01");
    await user("ug");
    await user("uh");
    familyId = randomUUID();
    otherFamily = randomUUID();
    await h.pool.query("INSERT INTO families (id, name) VALUES ($1,'F'), ($2,'G')", [familyId, otherFamily]);
    m1 = await member(familyId, "M1", { userId: u1, role: "FAMILY_ADMIN" });
    const m2 = await member(familyId, "M2", { userId: u2, role: "FAMILY_MEMBER" });
    mOther = await member(familyId, "M3", { userId: users.u3 ?? "", role: "FAMILY_MEMBER" });
    d1 = await member(familyId, "D1", { dependent: true, guardians: [m1, m2] });
    d2 = await member(familyId, "D2", { dependent: true, userId: u4, guardians: [m1] });
    dBlocked = await member(familyId, "DB", { dependent: true, blocked: true, guardians: [m1] });
    otherMember = await member(otherFamily, "MG", { userId: users.ug ?? "", role: "FAMILY_ADMIN" });
    p1 = await pro("APPROVED", "Dra. Ana");
    p2 = await pro("APPROVED", "Dr. Bruno");
    pSuspended = await pro("SUSPENDED", "Dr. Suspenso");
    pDraft = await pro("DRAFT", "Rascunho");
  }, 240_000);

  afterAll(async () => {
    await h.stop();
  });

  it("TC-AZ-MKT-11: SELF e TUTOR_OF abrem; DEPENDENT_SELF, OTHER ⇒ 403; outra família ⇒ 404; bloqueado ⇒ 423; sem token ⇒ 401", async () => {
    expect((await start("u1", m1, p1)).status).toBe(201);
    expect((await start("u1", d1, p1)).status).toBe(201);
    expect((await start("u2", d1, p2)).status).toBe(201); // segundo tutor
    expect((await start("u3", m1, p1)).status).toBe(403); // OTHER
    expect((await start("u3", mOther, p1)).status).toBe(201); // o próprio
    expect((await start("u4", d2, p1)).status).toBe(403); // DEPENDENT_SELF
    expect((await start("u1", d2, p1)).status).toBe(201); // tutor do dependente com conta
    expect((await start("ug", m1, p1)).status).toBe(404); // outra família
    expect((await call("get", "ug", base(m1))).status).toBe(404);
    expect((await start("u1", dBlocked, p1)).status).toBe(423);
    expect((await request(h.app).get(`${API}${base(m1)}`)).status).toBe(401);
    const pro = await h.newProfessional();
    expect((await request(h.app).get(`${API}${base(m1)}`).set("Authorization", `Bearer ${pro.token}`)).status).toBe(401);
    expect((await request(h.app).get(`${API}${base(m1)}`).set("Authorization", `Bearer ${await h.clinicToken()}`)).status).toBe(401);
    expect((await call("get", "u2", base(m1))).status).toBe(403); // u2 não é tutor de m1
  });

  it("TC-MKT-55/56: abrir (201 + conversa + seq 1), continuar (200, seq 2), profissional inexistente/não APPROVED ⇒ 404; nunca expõe ids da família/utilizador", async () => {
    const res = await start("u1", m1, p2, { participantLabel: LABEL_CANARY, text: TEXT_CANARY });
    expect(res.status).toBe(201);
    const b = bodyOf(res);
    expect(b.message).toMatchObject({ seq: 1, side: "FAMILY", mine: true, text: TEXT_CANARY, hidden: false, readByOtherSide: false });
    expect(b.conversation).toMatchObject({ memberId: m1, participantLabel: LABEL_CANARY, status: "OPEN", closedBy: null, canSend: true, unreadCount: 0, professional: { id: p2, displayName: "Dr. Bruno", city: "Luanda" } });
    const dump = JSON.stringify(b);
    for (const secret of [familyId, users.u1 ?? "", "senderUserId", "openedBy", "familyId", "conversationId"]) expect(dump).not.toContain(secret);
    const again = await start("u1", m1, p2, { text: "segunda" });
    expect(again.status).toBe(200);
    expect(bodyOf(again).message.seq).toBe(2);
    expect(bodyOf(again).conversation.id).toBe(b.conversation.id);
    expect((await start("u1", m1, randomUUID())).status).toBe(404);
    expect((await start("u1", m1, pDraft)).status).toBe(404);
    expect((await start("u1", m1, pSuspended)).status).toBe(404);
  });

  it("validação: texto vazio/controlo ⇒ 422 sem eco do texto; 1001 e rótulo > 40 ⇒ 400 do contrato; campo extra ⇒ 400", async () => {
    for (const text of ["   ", "ola\u0000mundo", "x\u0007"]) {
      const r = await start("u1", d1, p1, { text });
      expect(r.status).toBe(422);
      expect(JSON.stringify(r.body)).not.toContain("ola");
    }
    expect((await start("u1", d1, p1, { participantLabel: "  " })).status).toBe(422);
    expect((await start("u1", d1, p1, { text: "x".repeat(1001) })).status).toBe(422);
    expect((await start("u1", d1, p1, { participantLabel: "y".repeat(41) })).status).toBe(422);
    expect((await start("u1", d1, p1, { extra: 1 })).status).toBe(422);
  });

  it("TC-MKT-58: idempotência: clientMessageId repetido devolve a mesma mensagem (200), sem duplicar nem avisar; em paralelo só uma é 201", async () => {
    const pId = await pro("APPROVED", "Idem");
    const first = await start("u1", d1, pId, { clientMessageId: randomUUID() });
    const conv = bodyOf(first).conversation.id as string;
    await professionalReply(conv);
    const cid = randomUUID();
    const before = notices.length;
    const results = await Promise.all(Array.from({ length: 5 }, () => call("post", "u1", `${base(d1)}/${conv}/messages`, { text: "uma só vez", clientMessageId: cid })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(4);
    expect(new Set(results.map((r) => bodyOf(r).id)).size).toBe(1);
    expect(notices.length - before).toBe(1);
    const { rows } = await h.pool.query("SELECT 1 FROM messages WHERE conversation_id = $1 AND client_message_id = $2", [conv, cid]);
    expect(rows).toHaveLength(1);
  });

  it("TC-MKT-61: concorrência: aberturas paralelas do mesmo par ⇒ 1 conversa; envios paralelos ⇒ seq sem lacunas e no máximo 3 seguidas sem resposta", async () => {
    const a = await actor();
    const pId = await pro("APPROVED", "Conc");
    const opens = await Promise.all(Array.from({ length: 3 }, (_, i) => start(a.u, a.m, pId, { text: `m${String(i)}` })));
    expect(opens.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    const winner = opens.find((r) => r.status === 201) ?? opens[0];
    if (!winner) throw new Error("sem resposta");
    const conv = bodyOf(winner).conversation.id as string;
    const { rows: convs } = await h.pool.query("SELECT 1 FROM conversations WHERE family_id = $1 AND member_id = $2 AND professional_id = $3", [a.fam, a.m, pId]);
    expect(convs).toHaveLength(1);
    await professionalReply(conv);
    const sends = await Promise.all(Array.from({ length: 8 }, (_, i) => call("post", a.u, `${base(a.m, a.fam)}/${conv}/messages`, { text: `p${String(i)}` })));
    expect(sends.filter((r) => r.status === 201)).toHaveLength(3);
    expect(sends.filter((r) => r.status === 409).every((r) => bodyOf(r).code === "LIMIT_EXCEEDED")).toBe(true);
    const { rows } = await h.pool.query<{ seq: number }>("SELECT seq FROM messages WHERE conversation_id = $1 ORDER BY seq", [conv]);
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i + 1));
    // a resposta do profissional liberta o envio
    await professionalReply(conv);
    expect((await call("post", a.u, `${base(a.m, a.fam)}/${conv}/messages`, { text: "outra" })).status).toBe(201);
  });

  it("BR-MKT-42: 4.ª seguida ⇒ 409 com o detalhe fixo; > 30/hora ⇒ 429 com Retry-After; > 5 conversas novas/24 h ⇒ 429; ≥ 20 abertas ⇒ 409", async () => {
    const a = await actor();
    const pId = await pro("APPROVED", "Lim");
    const conv = bodyOf(await start(a.u, a.d, pId)).conversation.id as string;
    await call("post", a.u, `${base(a.d, a.fam)}/${conv}/messages`, { text: "2" }).expect(201);
    await call("post", a.u, `${base(a.d, a.fam)}/${conv}/messages`, { text: "3" }).expect(201);
    const blocked = await call("post", a.u, `${base(a.d, a.fam)}/${conv}/messages`, { text: "4" });
    expect(blocked.status).toBe(409);
    expect(bodyOf(blocked)).toMatchObject({ code: "LIMIT_EXCEEDED", detail: "Aguarde a resposta do profissional." });

    // hora por conversa: 30 mensagens da família já na última hora (relógio fixo) + resposta do profissional
    const p3 = await pro("APPROVED", "Hora");
    const c3 = bodyOf(await start(a.u, a.d, p3)).conversation.id as string;
    for (let i = 2; i <= 31; i += 1) await h.pool.query("INSERT INTO messages (conversation_id, seq, side, sender_user_id, body, created_at) VALUES ($1,$2,'FAMILY',$3,'x',$4)", [c3, i, users[a.u], new Date(h.clock.now().getTime() - 5 * MIN)]);
    await h.pool.query("UPDATE conversations SET last_seq = 31, last_professional_seq = 31 WHERE id = $1", [c3]);
    const hour = await call("post", a.u, `${base(a.d, a.fam)}/${c3}/messages`, { text: "y" });
    expect(hour.status).toBe(429);
    expect(Number(hour.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("BR-MKT-42: conversas novas por dia e conversas abertas por membro (utilizador isolado)", async () => {
    const uh = users.uh ?? "";
    const fam = randomUUID();
    await h.pool.query("INSERT INTO families (id, name) VALUES ($1,'H')", [fam]);
    const self = await member(fam, "H0", { userId: uh, role: "FAMILY_ADMIN" });
    const deps: string[] = [];
    for (let i = 0; i < 6; i += 1) deps.push(await member(fam, `HD${String(i)}`, { dependent: true, guardians: [self] }));
    const target = await pro("APPROVED", "Alvo");
    for (let i = 0; i < 5; i += 1) expect((await start("uh", deps[i] ?? "", target)).status).toBe(201);
    const sixth = await start("uh", deps[5] ?? "", target);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);
    // 20 abertas no mesmo membro (por SQL, há mais de 24 h) ⇒ a 21.ª é LIMIT_EXCEEDED
    const old = new Date(h.clock.now().getTime() - 3 * 86_400_000);
    for (let i = 0; i < 20; i += 1) {
      await h.pool.query("INSERT INTO conversations (family_id, member_id, professional_id, opened_by_user_id, participant_label, last_seq, last_message_at, created_at) VALUES ($1,$2,$3,$4,'A',1,$5,$5)", [fam, self, await rawPro(), uh, old]);
    }
    const over = await start("uh", self, target);
    expect(over.status).toBe(409);
    expect(bodyOf(over).code).toBe("LIMIT_EXCEEDED");
  });

  it("TC-MKT-56: leitura: lista com unreadCount e marcador partilhado entre tutores; mensagens por seq decrescente com cursor; ler não marca como lido", async () => {
    const a = await actor();
    const pId = await pro("APPROVED", "Leitura");
    const conv = bodyOf(await start(a.u, a.d, pId)).conversation.id as string;
    const r1 = await professionalReply(conv, "r1");
    await professionalReply(conv, "r2");
    await h.pool.query("UPDATE messages SET hidden_at = $2 WHERE id = $1", [r1, h.clock.now()]);
    const list = await call("get", a.u, base(a.d, a.fam)); // o outro tutor vê a mesma conversa
    const item = (bodyOf(list).items as { id: string; unreadCount: number }[]).find((c) => c.id === conv);
    expect(item?.unreadCount).toBe(2);
    const page1 = await call("get", a.u, `${base(a.d, a.fam)}/${conv}/messages?limit=2`);
    expect(bodyOf(page1).items.map((m: { seq: number }) => m.seq)).toEqual([3, 2]);
    expect(bodyOf(page1).items[1]).toMatchObject({ hidden: true, text: null, side: "PROFESSIONAL", mine: false });
    const page2 = await call("get", a.u, `${base(a.d, a.fam)}/${conv}/messages?limit=2&cursor=${String(bodyOf(page1).nextCursor)}`);
    expect(bodyOf(page2).items.map((m: { seq: number }) => m.seq)).toEqual([1]);
    expect(bodyOf(page2).items[0]).toMatchObject({ mine: true });
    expect(bodyOf(page2).nextCursor).toBeNull();
    expect((await call("get", a.u, `${base(a.d, a.fam)}/${conv}/messages?cursor=lixo`)).status).toBe(400);
    expect((await call("get", a.u, `${base(a.d, a.fam)}/${conv}`)).body).toMatchObject({ unreadCount: 2 });
    // marcar como lido (u2) ⇒ também para u1; nunca recua; fora do intervalo ⇒ 422
    const before = alertCalls.length;
    expect((await call("put", a.u, `${base(a.d, a.fam)}/${conv}/read`, {})).body).toMatchObject({ unreadCount: 0 });
    expect(alertCalls.at(-1)?.conversationId).toBe(conv);
    expect(alertCalls.length).toBe(before + 1);
    expect((await call("get", a.u, `${base(a.d, a.fam)}/${conv}`)).body).toMatchObject({ unreadCount: 0 });
    await call("put", a.u, `${base(a.d, a.fam)}/${conv}/read`, { upToSeq: 1 }).expect(200);
    const { rows } = await h.pool.query<{ family_read_seq: number }>("SELECT family_read_seq FROM conversations WHERE id = $1", [conv]);
    expect(rows[0]?.family_read_seq).toBe(3);
    expect((await call("put", a.u, `${base(a.d, a.fam)}/${conv}/read`, { upToSeq: 99 })).status).toBe(422);
  });

  it("TC-MKT-57/BR-MKT-43/47: fechar/reabrir, fecho pelo profissional ou sistema, profissional não APPROVED ⇒ leitura sim, envio ⇒ CONVERSATION_CLOSED, retoma ao reativar", async () => {
    const a = await actor();
    const pId = await pro("APPROVED", "Estados");
    const conv = bodyOf(await start(a.u, a.m, pId)).conversation.id as string;
    const url = `${base(a.m, a.fam)}/${conv}`;
    const closed = await call("post", a.u, `${url}/close`);
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: "CLOSED", closedBy: "FAMILY", canSend: false });
    expect((await call("post", a.u, `${url}/close`)).status).toBe(409);
    expect(bodyOf(await call("post", a.u, `${url}/close`)).code).toBe("INVALID_STATE_TRANSITION");
    const blocked = await call("post", a.u, `${url}/messages`, { text: "x" });
    expect(bodyOf(blocked).code).toBe("CONVERSATION_CLOSED");
    expect(bodyOf(await start(a.u, a.m, pId)).code).toBe("CONVERSATION_CLOSED");
    expect((await call("get", a.u, `${url}/messages`)).status).toBe(200);
    expect((await call("post", a.u, `${url}/reopen`)).body).toMatchObject({ status: "OPEN", closedBy: null, canSend: true });
    expect(bodyOf(await call("post", a.u, `${url}/reopen`)).code).toBe("INVALID_STATE_TRANSITION");
    for (const by of ["PROFESSIONAL", "SYSTEM"]) {
      await h.pool.query("UPDATE conversations SET status = 'CLOSED', closed_by = $2::conversation_closed_by, closed_at = now() WHERE id = $1", [conv, by]);
      expect(bodyOf(await call("post", a.u, `${url}/reopen`)).code).toBe("CONVERSATION_CLOSED");
      await h.pool.query("UPDATE conversations SET status = 'OPEN', closed_by = NULL, closed_at = NULL WHERE id = $1", [conv]);
    }
    await setStatus(pId, "SUSPENDED");
    expect((await call("get", a.u, url)).body).toMatchObject({ canSend: false, status: "OPEN", professional: { displayName: "Estados" } });
    expect((await call("get", a.u, `${url}/messages`)).status).toBe(200);
    expect(bodyOf(await call("post", a.u, `${url}/messages`, { text: "z" })).code).toBe("CONVERSATION_CLOSED");
    await setStatus(pId, "APPROVED");
    expect((await call("get", a.u, url)).body).toMatchObject({ canSend: true });
    expect((await call("post", a.u, `${url}/messages`, { text: "z" })).status).toBe(201);
    const audits = await h.pool.query<{ action: string }>("SELECT action FROM audit_logs WHERE resource_id = $1 ORDER BY occurred_at", [conv]);
    expect(audits.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["CONVERSATION_START", "CONVERSATION_CLOSE", "CONVERSATION_REOPEN"]));
  });

  it("TC-AZ-MKT-12 / BR-MKT-48: isolamento: conversa de outro membro ou família ⇒ 404 em todas as rotas (inclui o caminho do membro errado)", async () => {
    const a = await actor();
    const conv = bodyOf(await start(a.u, a.m, await pro("APPROVED", "Iso"))).conversation.id as string;
    const msg = bodyOf(await call("get", a.u, `${base(a.m, a.fam)}/${conv}/messages`)).items[0].id as string;
    const probes: [("get" | "post" | "put"), string, unknown?][] = [
      ["get", ""],
      ["get", "/messages"],
      ["post", "/messages", { text: "x" }],
      ["put", "/read", {}],
      ["post", "/close"],
      ["post", "/reopen"],
      ["post", `/messages/${msg}/reports`, { reason: "SPAM" }],
    ];
    for (const [method, suffix, body] of probes) {
      // utilizador de outra família, e o mesmo utilizador com o membro errado (d1) no caminho
      expect((await call(method, "ug", `${base(otherMember, otherFamily)}/${conv}${suffix}`, body)).status, `outra família ${suffix}`).toBe(404);
      expect((await call(method, a.u, `${base(a.d, a.fam)}/${conv}${suffix}`, body)).status, `membro errado ${suffix}`).toBe(404);
      expect((await call(method, "ug", `${base(a.m, a.fam)}/${conv}${suffix}`, body)).status, `família alheia ${suffix}`).toBe(404);
    }
    expect((await call("get", a.u, `${base(a.m, a.fam)}/${randomUUID()}`)).status).toBe(404);
    expect(bodyOf(await call("get", "ug", base(otherMember, otherFamily))).items).toEqual([]);
  });

  it("TC-MKT-69: denúncias: 201, repetir ⇒ 200 igual, própria ⇒ 422, de outra conversa ⇒ 404, > 10/dia ⇒ 429; auditoria só com o motivo", async () => {
    const a = await actor();
    const pId = await pro("APPROVED", "Denuncia");
    const conv = bodyOf(await start(a.u, a.d, pId)).conversation.id as string;
    const own = bodyOf(await call("get", a.u, `${base(a.d, a.fam)}/${conv}/messages`)).items[0].id as string;
    const url = `${base(a.d, a.fam)}/${conv}`;
    expect((await call("post", a.u, `${url}/messages/${own}/reports`, { reason: "SPAM" })).status).toBe(422);
    const ids: string[] = [];
    for (let i = 0; i < 11; i += 1) ids.push(await professionalReply(conv, `p${String(i)}`));
    const first = await call("post", a.u, `${url}/messages/${ids[0] ?? ""}/reports`, { reason: "ABUSE", note: NOTE_CANARY });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: "OPEN", reason: "ABUSE" });
    expect(Object.keys(bodyOf(first)).sort()).toEqual(["createdAt", "id", "reason", "status"]);
    const repeat = await call("post", a.u, `${url}/messages/${ids[0] ?? ""}/reports`, { reason: "SPAM" });
    expect(repeat.status).toBe(200);
    expect(bodyOf(repeat).id).toBe(bodyOf(first).id);
    expect((await call("post", a.u, `${url}/messages/${randomUUID()}/reports`, { reason: "SPAM" })).status).toBe(404);
    expect((await call("post", a.u, `${url}/messages/${ids[1] ?? ""}/reports`, { reason: "OTHER", note: "x".repeat(301) })).status).toBe(422);
    for (let i = 1; i < 10; i += 1) expect((await call("post", a.u, `${url}/messages/${ids[i] ?? ""}/reports`, { reason: "SPAM" })).status).toBe(201);
    const limited = await call("post", a.u, `${url}/messages/${ids[10] ?? ""}/reports`, { reason: "SPAM" });
    expect(limited.status).toBe(429);
    const { rows } = await h.pool.query<{ metadata: unknown; action: string }>("SELECT action, metadata FROM audit_logs WHERE action = 'MESSAGE_REPORT_CREATE' AND resource_id = $1", [bodyOf(first).id]);
    expect(rows[0]?.metadata).toEqual({ reason: "ABUSE" });
  });

  it("BR-MKT-46: canário: texto, rótulo e nota nunca aparecem na auditoria nem nos logs técnicos; só professionalId na abertura", async () => {
    const a = await actor();
    const pId = await pro("APPROVED", "Canario");
    const conv = bodyOf(await start(a.u, a.m, pId, { participantLabel: LABEL_CANARY, text: TEXT_CANARY })).conversation.id as string;
    await call("post", a.u, `${base(a.m, a.fam)}/${conv}/messages`, { text: TEXT_CANARY }).expect(201);
    await call("get", a.u, `${base(a.m, a.fam)}/${conv}/messages?limit=5`).expect(200);
    await call("post", a.u, `${base(a.m, a.fam)}/${conv}/messages`, { text: "ctl\u0000" + TEXT_CANARY }).expect(422);
    await call("get", "ug", `${base(a.m, a.fam)}/${conv}/messages`).expect(404);
    const audit = await h.pool.query<{ t: string }>("SELECT row_to_json(a)::text AS t FROM audit_logs a");
    const everything = audit.rows.map((r) => r.t).join("\n") + logs.join("\n");
    for (const canary of [TEXT_CANARY, LABEL_CANARY, NOTE_CANARY]) expect(everything).not.toContain(canary);
    expect(logs.join("\n")).not.toContain("limit=5");
    const started = await h.pool.query<{ metadata: unknown }>("SELECT metadata FROM audit_logs WHERE action = 'CONVERSATION_START' AND resource_id = $1", [conv]);
    expect(started.rows[0]?.metadata).toEqual({ professionalId: pId });
  });
});
