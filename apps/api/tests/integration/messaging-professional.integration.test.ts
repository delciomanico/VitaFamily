/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Integração (PostgreSQL real, app real com validação de pedidos E respostas) do lado do PROFISSIONAL de `messaging` (MK2 S8):
// TC-MKT-57, TC-AZ-MKT-13/14 (matriz estado de validação × operação, precedência da OP-91), isolamento entre profissionais (BR-MKT-48),
// ausência de ids de família/membro/utilizador (BR-MKT-38/46), idempotência, limites, alerta MESSAGE_RECEIVED, auditoria sem conteúdo.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMessagingModule } from "../../src/modules/messaging/index.js";
import { PROFESSIONAL_API, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const TEXT_CANARY = "canario-texto-prof-xyz";
const NOTE_CANARY = "canario-nota-prof-xyz";
const LABEL = "canario-rotulo-prof-xyz";
const STATES = ["APPROVED", "SUSPENDED", "REJECTED", "NEEDS_INFO", "PENDING_REVIEW", "DRAFT"] as const;
type State = (typeof STATES)[number];

describe("integração: conversas do lado do profissional (MK2 S8)", () => {
  let h: ProfessionalsHarness;
  const logs: string[] = [];
  const alerts: { conversationId: string; familyId: string; memberId: string; familyReadSeq: number }[] = [];
  let familyId: string;
  let p1: { professionalId: string; accountId: string; token: string };
  let p2: { professionalId: string; accountId: string; token: string };
  let userToken: string;

  const call = (method: "get" | "post" | "put", token: string, path: string, body?: unknown) => {
    let r = request(h.app)[method](`${PROFESSIONAL_API}/conversations${path}`).set("Authorization", `Bearer ${token}`);
    if (body !== undefined) r = r.send(body as object);
    return r;
  };
  async function setState(professionalId: string, status: State): Promise<void> {
    await h.pool.query("UPDATE professionals SET validation_status = $2::professional_validation_status, display_name = 'Dra. Teste', city = 'Luanda', approved_at = CASE WHEN $2 <> 'DRAFT' THEN now() END, submitted_at = CASE WHEN $2 <> 'DRAFT' THEN now() END WHERE id = $1", [professionalId, status]);
  }
  /** Conversa com `n` mensagens alternadas a começar pela família (SQL: o lado da família é testado em `messaging-family`). */
  async function conversation(professionalId: string, opts: { messages?: number; status?: "OPEN" | "CLOSED"; closedBy?: "FAMILY" | "PROFESSIONAL" | "SYSTEM" | null } = {}): Promise<string> {
    const id = randomUUID();
    const n = opts.messages ?? 1;
    const status = opts.status ?? "OPEN";
    const closedBy = status === "OPEN" ? null : (opts.closedBy ?? "FAMILY");
    // Um membro-sujeito por conversa (UNIQUE família+membro+profissional não o exige, mas isola os contadores).
    const member = randomUUID();
    await h.pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role, is_dependent, status) VALUES ($1,$2,NULL,'D','2018-01-01',NULL,true,'ACTIVE')", [member, familyId]);
    await h.pool.query(
      "INSERT INTO conversations (id, family_id, member_id, professional_id, participant_label, status, closed_by, closed_at, last_seq, last_professional_seq, last_message_at) VALUES ($1,$2,$3,$4,$5,$6::conversation_status,$7::conversation_closed_by,$8,$9,0,$10)",
      [id, familyId, member, professionalId, LABEL, status, closedBy, status === "CLOSED" ? h.clock.now() : null, n, h.clock.now()],
    );
    for (let seq = 1; seq <= n; seq++) {
      await h.pool.query("INSERT INTO messages (id, conversation_id, seq, side, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)", [randomUUID(), id, seq, seq % 2 === 1 ? "FAMILY" : "PROFESSIONAL", seq === 1 ? TEXT_CANARY : `msg ${String(seq)}`, h.clock.now()]);
    }
    await h.pool.query("UPDATE conversations SET last_professional_seq = (SELECT COALESCE(max(seq),0) FROM messages WHERE conversation_id = $1 AND side = 'PROFESSIONAL') WHERE id = $1", [id]);
    return id;
  }
  async function firstMessageId(conversationId: string, seq = 1): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>("SELECT id FROM messages WHERE conversation_id = $1 AND seq = $2", [conversationId, seq]);
    return rows[0]?.id ?? "";
  }
  const bodyOf = (res: { body: unknown }) => res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    h = await startProfessionalsHarness(
      {},
      ({ audit, db, clock }) => {
        const messaging = createMessagingModule({
          db,
          audit,
          clock,
          access: { assertCanMessage: () => Promise.reject(new Error("não usado no lado do profissional")) },
          professionals: { findIdentities: async (ids) => (await h.module.directory.getConversationIdentities(ids)), getNotificationEmail: () => Promise.resolve(null) },
          alerts: {
            raiseMessageReceived: (_trx, input) => {
              alerts.push(input);
              return Promise.resolve();
            },
            markConversationRead: () => Promise.resolve(),
          },
          noticeQueue: { enqueue: () => Promise.resolve() },
        });
        return [messaging.professionalRouter];
      },
      { logStream: logs },
    );
    familyId = randomUUID();
    await h.pool.query("INSERT INTO families (id, name) VALUES ($1,'F')", [familyId]);
    p1 = await h.newProfessional();
    p2 = await h.newProfessional();
    await setState(p1.professionalId, "APPROVED");
    await setState(p2.professionalId, "APPROVED");
    userToken = await h.userToken();
  }, 240_000);

  afterAll(async () => {
    await h.stop();
  });

  it("autenticação: sem token, token de User ⇒ 401 em todas as rotas", async () => {
    const cid = await conversation(p1.professionalId);
    const mid = await firstMessageId(cid);
    const routes: [("get" | "post" | "put"), string, unknown?][] = [
      ["get", ""],
      ["get", `/${cid}`],
      ["get", `/${cid}/messages`],
      ["post", `/${cid}/messages`, { text: "x" }],
      ["put", `/${cid}/read`, {}],
      ["post", `/${cid}/close`],
      ["post", `/${cid}/reopen`],
      ["post", `/${cid}/messages/${mid}/reports`, { reason: "SPAM" }],
    ];
    for (const [method, path, body] of routes) {
      let anon = request(h.app)[method](`${PROFESSIONAL_API}/conversations${path}`);
      if (body !== undefined) anon = anon.send(body as object);
      expect((await anon).status, `${method} ${path} sem token`).toBe(401);
      expect((await call(method, userToken, path, body)).status, `${method} ${path} token de User`).toBe(401);
    }
  });

  describe("matriz estado de validação × operação (TC-AZ-MKT-13/14; OP-59, OP-91)", () => {
    for (const state of STATES) {
      it(`${state}: leitura/lido/denúncia sempre; enviar/fechar/reabrir só APPROVED`, async () => {
        const acc = await h.newProfessional();
        await setState(acc.professionalId, state);
        const approved = state === "APPROVED";
        const open = await conversation(acc.professionalId, { messages: 3 });
        const closedByPro = await conversation(acc.professionalId, { status: "CLOSED", closedBy: "PROFESSIONAL" });
        const t = acc.token;

        expect((await call("get", t, "")).status).toBe(200);
        const got = await call("get", t, `/${open}`);
        expect(got.status).toBe(200);
        expect(got.body.canSend).toBe(approved);
        expect((await call("get", t, `/${open}/messages`)).status).toBe(200);
        expect((await call("put", t, `/${open}/read`, {})).status).toBe(200);
        expect((await call("post", t, `/${open}/messages/${await firstMessageId(open)}/reports`, { reason: "SPAM" })).status).toBe(201);

        const send = await call("post", t, `/${open}/messages`, { text: "resposta" });
        const close = await call("post", t, `/${open}/close`);
        const reopen = await call("post", t, `/${closedByPro}/reopen`);
        if (approved) {
          expect(send.status).toBe(201);
          expect(close.status).toBe(200);
          expect(reopen.status).toBe(200);
        } else {
          for (const res of [send, close, reopen]) {
            expect(res.status).toBe(409);
            expect(res.body.code).toBe("PROFESSIONAL_LOCKED");
          }
          // O estado não mudou (o efeito é derivado, BR-MKT-47).
          const { rows } = await h.pool.query<{ status: string; n: string }>("SELECT c.status, (SELECT count(*) FROM messages WHERE conversation_id = c.id) AS n FROM conversations c WHERE c.id = $1", [open]);
          expect(rows[0]?.status).toBe("OPEN");
          expect(Number(rows[0]?.n)).toBe(3);
        }
      });
    }

    it("precedência (OP-91): não APPROVED + conversa fechada ⇒ PROFESSIONAL_LOCKED; APPROVED + fechada ⇒ CONVERSATION_CLOSED", async () => {
      const acc = await h.newProfessional();
      await setState(acc.professionalId, "SUSPENDED");
      const closed = await conversation(acc.professionalId, { status: "CLOSED", closedBy: "FAMILY" });
      expect(bodyOf(await call("post", acc.token, `/${closed}/messages`, { text: "x" })).code).toBe("PROFESSIONAL_LOCKED");
      await setState(acc.professionalId, "APPROVED");
      expect(bodyOf(await call("post", acc.token, `/${closed}/messages`, { text: "x" })).code).toBe("CONVERSATION_CLOSED");
    });

    it("o estado lê-se por pedido: suspender a meio bloqueia e reativar retoma no mesmo ponto (BR-MKT-47)", async () => {
      const acc = await h.newProfessional();
      await setState(acc.professionalId, "APPROVED");
      const cid = await conversation(acc.professionalId);
      expect((await call("post", acc.token, `/${cid}/messages`, { text: "a" })).status).toBe(201);
      await setState(acc.professionalId, "SUSPENDED");
      expect((await call("post", acc.token, `/${cid}/messages`, { text: "b" })).status).toBe(409);
      await setState(acc.professionalId, "APPROVED");
      expect((await call("post", acc.token, `/${cid}/messages`, { text: "c" })).status).toBe(201);
    });
  });

  describe("fecho e reabertura (BR-MKT-43)", () => {
    it("fecha, não volta a fechar, reabre só o que fechou; família/sistema não se reabrem; aberta ⇒ INVALID_STATE_TRANSITION", async () => {
      const cid = await conversation(p1.professionalId);
      const closed = await call("post", p1.token, `/${cid}/close`);
      expect(closed.status).toBe(200);
      expect(closed.body).toMatchObject({ status: "CLOSED", closedBy: "PROFESSIONAL", canSend: false });
      expect(bodyOf(await call("post", p1.token, `/${cid}/close`)).code).toBe("INVALID_STATE_TRANSITION");
      expect(bodyOf(await call("post", p1.token, `/${cid}/messages`, { text: "x" })).code).toBe("CONVERSATION_CLOSED");
      const reopened = await call("post", p1.token, `/${cid}/reopen`);
      expect(reopened.body).toMatchObject({ status: "OPEN", closedBy: null, canSend: true });
      expect(bodyOf(await call("post", p1.token, `/${cid}/reopen`)).code).toBe("INVALID_STATE_TRANSITION");
      for (const by of ["FAMILY", "SYSTEM"] as const) {
        const other = await conversation(p1.professionalId, { status: "CLOSED", closedBy: by });
        const res = await call("post", p1.token, `/${other}/reopen`);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("CONVERSATION_CLOSED");
      }
      const { rows } = await h.pool.query<{ action: string; actor_type: string; family_id: string | null; subject_member_id: string | null }>("SELECT action, actor_type, family_id, subject_member_id FROM audit_logs WHERE resource_id = $1 ORDER BY occurred_at", [cid]);
      expect(rows.map((r) => r.action)).toEqual(["PROFESSIONAL_CONVERSATION_CLOSE", "PROFESSIONAL_CONVERSATION_REOPEN"]);
      expect(rows.every((r) => r.actor_type === "PROFESSIONAL_ACCOUNT" && r.family_id === null && r.subject_member_id === null)).toBe(true);
    });
  });

  describe("isolamento entre profissionais (BR-MKT-48; TC-AZ-MKT-13)", () => {
    it("conversa de outro profissional ou inexistente ⇒ 404 idêntico em todas as rotas e a lista não a mostra", async () => {
      const mine = await conversation(p1.professionalId, { messages: 2 });
      const theirs = await conversation(p2.professionalId, { messages: 2 });
      const theirMsg = await firstMessageId(theirs);
      const ghost = randomUUID();
      const probe = async (cid: string, mid: string) => {
        const out: Record<string, unknown>[] = [];
        for (const [method, path, body] of [
          ["get", `/${cid}`],
          ["get", `/${cid}/messages`],
          ["post", `/${cid}/messages`, { text: "x" }],
          ["put", `/${cid}/read`, {}],
          ["post", `/${cid}/close`],
          ["post", `/${cid}/reopen`],
          ["post", `/${cid}/messages/${mid}/reports`, { reason: "SPAM" }],
        ] as [("get" | "post" | "put"), string, unknown?][]) {
          const res = await call(method, p1.token, path, body);
          const problem: Record<string, unknown> = { ...(res.body as Record<string, unknown>) };
          delete problem.requestId;
          out.push({ status: res.status, ...problem });
        }
        return out;
      };
      const other = await probe(theirs, theirMsg);
      expect(other.every((r) => r.status === 404)).toBe(true);
      // Idêntico a uma conversa que não existe (sem enumeração).
      expect(other.map((r) => ({ ...r, instance: undefined, detail: undefined }))).toEqual((await probe(ghost, randomUUID())).map((r) => ({ ...r, instance: undefined, detail: undefined })));
      const list = await call("get", p1.token, "?limit=100");
      const ids = (list.body as { items: { id: string }[] }).items.map((c) => c.id);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(theirs);
      // E nada mudou na conversa alheia.
      const { rows } = await h.pool.query<{ status: string; last_seq: number; professional_read_seq: number }>("SELECT status, last_seq, professional_read_seq FROM conversations WHERE id = $1", [theirs]);
      expect(rows[0]).toMatchObject({ status: "OPEN", last_seq: 2, professional_read_seq: 0 });
    });

    it("mensagem de outra conversa do mesmo profissional ⇒ 404 na denúncia", async () => {
      const a = await conversation(p1.professionalId);
      const b = await conversation(p1.professionalId);
      expect((await call("post", p1.token, `/${a}/messages/${await firstMessageId(b)}/reports`, { reason: "SPAM" })).status).toBe(404);
    });
  });

  describe("privacidade (BR-MKT-38/46; TC-AZ-MKT-12)", () => {
    it("nenhuma resposta tem ids de família, membro ou utilizador, nem chaves proibidas; o `participantLabel` sim", async () => {
      const cid = await conversation(p1.professionalId, { messages: 3 });
      const sent = await call("post", p1.token, `/${cid}/messages`, { text: "olá" });
      const responses = [await call("get", p1.token, ""), await call("get", p1.token, `/${cid}`), await call("get", p1.token, `/${cid}/messages`), sent, await call("put", p1.token, `/${cid}/read`, {}), await call("post", p1.token, `/${cid}/close`), await call("post", p1.token, `/${cid}/reopen`)];
      const { rows } = await h.pool.query<{ member_id: string }>("SELECT member_id FROM conversations WHERE id = $1", [cid]);
      const raw = responses.map((r) => JSON.stringify(r.body)).join("\n");
      for (const forbidden of ["familyId", "family_id", "memberId", "member_id", "userId", "user_id", "senderUserId", "openedBy", "professionalId", familyId, rows[0]?.member_id ?? "x"]) expect(raw, forbidden).not.toContain(forbidden);
      expect(raw).toContain(LABEL);
      for (const r of responses) expect(r.headers["cache-control"]).toContain("no-store");
    });

    it("texto, rótulo e nota nunca vão para logs nem para a auditoria", async () => {
      const cid = await conversation(p1.professionalId, { messages: 1 });
      await call("post", p1.token, `/${cid}/messages`, { text: `${TEXT_CANARY}-resposta` });
      await call("post", p1.token, `/${cid}/messages/${await firstMessageId(cid)}/reports`, { reason: "ABUSE", note: NOTE_CANARY });
      const { rows } = await h.pool.query<{ metadata: unknown }>("SELECT metadata FROM audit_logs WHERE actor_type = 'PROFESSIONAL_ACCOUNT' AND resource_id IS NOT NULL AND action LIKE 'PROFESSIONAL_%REPORT%'");
      expect(JSON.stringify(rows)).not.toMatch(/canario/);
      const dump = logs.join("");
      for (const c of [TEXT_CANARY, NOTE_CANARY, LABEL]) expect(dump).not.toContain(c);
      // A nota fica guardada para o admin (BR-MKT-44), nunca na auditoria.
      const stored = await h.pool.query<{ note: string | null }>("SELECT r.note FROM message_reports r JOIN messages m ON m.id = r.message_id WHERE m.conversation_id = $1", [cid]);
      expect(stored.rows[0]?.note).toBe(NOTE_CANARY);
    });
  });

  describe("responder (BR-MKT-39/41/42)", () => {
    it("atribui seq sem lacunas, atualiza lastProfessionalSeq e cria UM alerta por envio com o marcador da família", async () => {
      const cid = await conversation(p1.professionalId, { messages: 1 });
      alerts.length = 0;
      const first = await call("post", p1.token, `/${cid}/messages`, { text: "  resposta 1  " });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ seq: 2, side: "PROFESSIONAL", mine: true, text: "resposta 1", hidden: false, readByOtherSide: false });
      const second = await call("post", p1.token, `/${cid}/messages`, { text: "resposta 2" });
      expect(second.body.seq).toBe(3);
      expect(alerts).toHaveLength(2);
      expect(alerts[0]).toMatchObject({ conversationId: cid, familyId, familyReadSeq: 0 });
      const { rows } = await h.pool.query<{ last_seq: number; last_professional_seq: number }>("SELECT last_seq, last_professional_seq FROM conversations WHERE id = $1", [cid]);
      expect(rows[0]).toMatchObject({ last_seq: 3, last_professional_seq: 3 });
      // `sender_user_id` fica nulo (o profissional não é um User).
      const sender = await h.pool.query("SELECT 1 FROM messages WHERE conversation_id = $1 AND side = 'PROFESSIONAL' AND sender_user_id IS NOT NULL", [cid]);
      expect(sender.rowCount).toBe(0);
    });

    it("idempotência: o mesmo clientMessageId devolve 200 com a mesma mensagem, sem duplicar nem voltar a alertar", async () => {
      const cid = await conversation(p1.professionalId);
      alerts.length = 0;
      const clientMessageId = randomUUID();
      const a = await call("post", p1.token, `/${cid}/messages`, { text: "uma vez", clientMessageId });
      const b = await call("post", p1.token, `/${cid}/messages`, { text: "uma vez", clientMessageId });
      expect([a.status, b.status]).toEqual([201, 200]);
      expect(b.body.id).toBe(a.body.id);
      expect(alerts).toHaveLength(1);
      const { rows } = await h.pool.query<{ n: string }>("SELECT count(*) AS n FROM messages WHERE conversation_id = $1 AND side = 'PROFESSIONAL'", [cid]);
      expect(Number(rows[0]?.n)).toBe(1);
    });

    it("concorrência: 8 envios em paralelo ⇒ seq 2..9 sem lacunas nem repetições", async () => {
      const cid = await conversation(p1.professionalId);
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => call("post", p1.token, `/${cid}/messages`, { text: `p${String(i)}` })));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(results.map((r) => r.body.seq).sort((x: number, y: number) => x - y)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("validação: vazio, > 1000 caracteres e controlo ⇒ 422 sem eco do texto; nada é gravado", async () => {
      const cid = await conversation(p1.professionalId);
      for (const text of ["   ", "x".repeat(1001), "a\u0000b"]) {
        const res = await call("post", p1.token, `/${cid}/messages`, { text });
        expect(res.status, JSON.stringify(text).slice(0, 12)).toBe(422);
        expect(JSON.stringify(res.body)).not.toContain("xxxx");
      }
      expect((await call("post", p1.token, `/${cid}/messages`, { text: "x".repeat(1000) })).status).toBe(201);
    });

    it("limite de 60 mensagens/hora por conversa ⇒ 429 com Retry-After; falha fechada, nada gravado", async () => {
      const cid = await conversation(p1.professionalId, { messages: 1 });
      for (let i = 0; i < 60; i++) await h.pool.query("INSERT INTO messages (id, conversation_id, seq, side, body, created_at) VALUES ($1,$2,$3,'PROFESSIONAL','m',$4)", [randomUUID(), cid, 2 + i, h.clock.now()]);
      await h.pool.query("UPDATE conversations SET last_seq = 61, last_professional_seq = 61 WHERE id = $1", [cid]);
      const res = await call("post", p1.token, `/${cid}/messages`, { text: "61.ª" });
      expect(res.status).toBe(429);
      expect(res.headers["retry-after"]).toBeDefined();
      const { rows } = await h.pool.query<{ last_seq: number }>("SELECT last_seq FROM conversations WHERE id = $1", [cid]);
      expect(rows[0]?.last_seq).toBe(61);
    });
  });

  describe("leitura, marcador e denúncias", () => {
    it("lista: ordem, filtro, cursor e unreadCount (mensagens da família com seq > professionalReadSeq)", async () => {
      const acc = await h.newProfessional();
      await setState(acc.professionalId, "APPROVED");
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push(await conversation(acc.professionalId, { messages: 3, status: i === 2 ? "CLOSED" : "OPEN" }));
        h.clock.advance(1000);
        await h.pool.query("UPDATE conversations SET last_message_at = $2 WHERE id = $1", [ids[i], h.clock.now()]);
      }
      const all = await call("get", acc.token, "?limit=2");
      expect(all.body.items.map((c: { id: string }) => c.id)).toEqual([ids[2], ids[1]]);
      expect(all.body.items[0].unreadCount).toBe(2);
      const page2 = await call("get", acc.token, `?limit=2&cursor=${encodeURIComponent((all.body as { nextCursor: string }).nextCursor)}`);
      expect(page2.body.items.map((c: { id: string }) => c.id)).toEqual([ids[0]]);
      expect(page2.body.nextCursor).toBeNull();
      expect((await call("get", acc.token, "?status=CLOSED")).body.items.map((c: { id: string }) => c.id)).toEqual([ids[2]]);
      expect((await call("get", acc.token, "?limit=0")).status).toBe(400);
      expect((await call("get", acc.token, "?limit=101")).status).toBe(400);
    });

    it("ler mensagens não marca como lido; PUT read é monótono, idempotente e valida o intervalo", async () => {
      const cid = await conversation(p1.professionalId, { messages: 5 });
      const msgs = await call("get", p1.token, `/${cid}/messages?limit=2`);
      expect(msgs.body.items.map((m: { seq: number }) => m.seq)).toEqual([5, 4]);
      expect((await call("get", p1.token, `/${cid}`)).body.unreadCount).toBe(3);
      const rest = await call("get", p1.token, `/${cid}/messages?limit=10&cursor=${encodeURIComponent((msgs.body as { nextCursor: string }).nextCursor)}`);
      expect(rest.body.items.map((m: { seq: number }) => m.seq)).toEqual([3, 2, 1]);
      expect((await call("put", p1.token, `/${cid}/read`, { upToSeq: 3 })).body.unreadCount).toBe(1);
      expect((await call("put", p1.token, `/${cid}/read`, { upToSeq: 1 })).body.unreadCount).toBe(1);
      expect((await call("put", p1.token, `/${cid}/read`, { upToSeq: 6 })).status).toBe(422);
      expect((await call("put", p1.token, `/${cid}/read`, {})).body.unreadCount).toBe(0);
      expect((await call("put", p1.token, `/${cid}/read`, {})).body.unreadCount).toBe(0);
      // O marcador do outro lado (família) nunca muda.
      const { rows } = await h.pool.query<{ family_read_seq: number; professional_read_seq: number }>("SELECT family_read_seq, professional_read_seq FROM conversations WHERE id = $1", [cid]);
      expect(rows[0]).toMatchObject({ family_read_seq: 0, professional_read_seq: 5 });
      const mine = (await call("get", p1.token, `/${cid}/messages?limit=10`)).body.items as { seq: number; readByOtherSide: boolean }[];
      expect(mine.find((m: { seq: number }) => m.seq === 4).readByOtherSide).toBe(false);
    });

    it("mensagem oculta por moderação vem com hidden=true e sem texto", async () => {
      const cid = await conversation(p1.professionalId, { messages: 2 });
      await h.pool.query("UPDATE messages SET hidden_at = now() WHERE conversation_id = $1 AND seq = 1", [cid]);
      const items = (await call("get", p1.token, `/${cid}/messages`)).body.items as { seq: number }[];
      const hidden = items.find((m: { seq: number }) => m.seq === 1);
      expect(hidden).toMatchObject({ hidden: true, text: null });
    });

    it("denúncia: só mensagens da família, idempotente por (mensagem, lado), motivo/nota validados, auditada sem conteúdo", async () => {
      const cid = await conversation(p1.professionalId, { messages: 2 });
      const familyMsg = await firstMessageId(cid, 1);
      const ownMsg = await firstMessageId(cid, 2);
      expect((await call("post", p1.token, `/${cid}/messages/${ownMsg}/reports`, { reason: "SPAM" })).status).toBe(422);
      expect((await call("post", p1.token, `/${cid}/messages/${familyMsg}/reports`, { reason: "NOPE" })).status).toBe(422);
      expect((await call("post", p1.token, `/${cid}/messages/${familyMsg}/reports`, { reason: "SPAM", note: "n".repeat(301) })).status).toBe(422);
      const first = await call("post", p1.token, `/${cid}/messages/${familyMsg}/reports`, { reason: "SCAM_OR_OFF_PLATFORM_PAYMENT" });
      const again = await call("post", p1.token, `/${cid}/messages/${familyMsg}/reports`, { reason: "SPAM" });
      expect([first.status, again.status]).toEqual([201, 200]);
      expect(again.body).toMatchObject({ id: (first.body as { id: string }).id, status: "OPEN", reason: "SCAM_OR_OFF_PLATFORM_PAYMENT" });
      const { rows } = await h.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_logs WHERE action = 'PROFESSIONAL_MESSAGE_REPORT_CREATE' AND resource_id = $1", [first.body.id]);
      expect(Number(rows[0]?.n)).toBe(1);
    });

    it("limite de 10 denúncias/dia do profissional ⇒ 429", async () => {
      const acc = await h.newProfessional();
      await setState(acc.professionalId, "APPROVED");
      const cid = await conversation(acc.professionalId, { messages: 21 });
      const odd: string[] = [];
      for (let seq = 1; seq <= 21; seq += 2) odd.push(await firstMessageId(cid, seq));
      const statuses: number[] = [];
      for (const mid of odd.slice(0, 11)) statuses.push((await call("post", acc.token, `/${cid}/messages/${mid}/reports`, { reason: "SPAM" })).status);
      expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
      expect(statuses[10]).toBe(429);
    });
  });
});
