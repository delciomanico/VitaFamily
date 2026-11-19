/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- corpos JSON de respostas HTTP lidos de forma dinâmica nos testes */
// Integração (PostgreSQL real, app real com validação de pedidos E respostas) da moderação do admin de `messaging` (MK2 S9):
// TC-MKT-62..64, TC-AZ-MKT-15 (denunciada + 2 mensagens de contexto, OP-76), auditoria da abertura sem conteúdo, decisões concorrentes.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMessagingModule } from "../../src/modules/messaging/index.js";
import { API, PROFESSIONAL_API, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const LABEL = "canario-rotulo-mod-xyz";
const NOTE = "canario-nota-mod-xyz";

describe("integração: moderação de denúncias do admin (MK2 S9)", () => {
  let h: ProfessionalsHarness;
  const logs: string[] = [];
  let familyId: string;
  let adminToken: string;
  let userToken: string;
  let pro: { professionalId: string; token: string };
  let senderUser: string;

  const admin = (method: "get" | "post", path: string, body?: unknown, token = adminToken) => {
    let r = request(h.app)[method](`${API}/admin/message-reports${path}`).set("Authorization", `Bearer ${token}`);
    if (body !== undefined) r = r.send(body as object);
    return r;
  };
  const bodyOf = (res: { body: unknown }) => res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  interface ContextMessage { id: string; seq: number; side: string; hidden: boolean; text: string | null; createdAt: string }
  interface ReportDetail { contextBefore: ContextMessage[]; message: { text: string | null } }
  interface ReportItem { id: string; reportedSide: string; [key: string]: unknown }
  interface ReportPage { items: ReportItem[]; nextCursor: string | null }

  /** Conversa com `n` mensagens (ímpares da família, pares do profissional), texto `tNNx` único por seq. */
  async function conversation(n: number, extra: { status?: "OPEN" | "CLOSED"; closedBy?: string } = {}): Promise<{ id: string; messageId: (seq: number) => Promise<string> }> {
    const id = randomUUID();
    const member = randomUUID();
    await h.pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role, is_dependent, status) VALUES ($1,$2,NULL,'D','2018-01-01',NULL,true,'ACTIVE')", [member, familyId]);
    const closed = extra.status === "CLOSED";
    await h.pool.query("INSERT INTO conversations (id, family_id, member_id, professional_id, participant_label, status, closed_by, closed_at, last_seq, last_message_at) VALUES ($1,$2,$3,$4,$5,$6::conversation_status,$7::conversation_closed_by,$8,$9,$10)", [id, familyId, member, pro.professionalId, LABEL, extra.status ?? "OPEN", closed ? (extra.closedBy ?? "FAMILY") : null, closed ? h.clock.now() : null, n, h.clock.now()]);
    for (let seq = 1; seq <= n; seq++) {
      const family = seq % 2 === 1;
      await h.pool.query("INSERT INTO messages (id, conversation_id, seq, side, sender_user_id, body, created_at) VALUES ($1,$2,$3,$4::message_side,$5,$6,$7)", [randomUUID(), id, seq, family ? "FAMILY" : "PROFESSIONAL", family ? senderUser : null, `t${String(seq).padStart(2, "0")}x`, h.clock.now()]);
    }
    return { id, messageId: async (seq) => (await h.pool.query<{ id: string }>("SELECT id FROM messages WHERE conversation_id = $1 AND seq = $2", [id, seq])).rows[0]?.id ?? "" };
  }
  async function report(messageId: string, side: "FAMILY" | "PROFESSIONAL" = "PROFESSIONAL", note: string | null = NOTE): Promise<string> {
    const id = randomUUID();
    await h.pool.query("INSERT INTO message_reports (id, message_id, reporter_side, reason, note, created_at) VALUES ($1,$2,$3::message_side,'ABUSE',$4,$5)", [id, messageId, side, note, h.clock.now()]);
    h.clock.advance(1000);
    return id;
  }

  beforeAll(async () => {
    h = await startProfessionalsHarness(
      {},
      ({ audit, db, clock }) => {
        const messaging = createMessagingModule({
          db,
          audit,
          clock,
          access: { assertCanMessage: () => Promise.reject(new Error("não usado")) },
          professionals: { findIdentities: (ids) => h.module.directory.getConversationIdentities(ids), getNotificationEmail: () => Promise.resolve(null) },
          alerts: { raiseMessageReceived: () => Promise.resolve(), markConversationRead: () => Promise.resolve() },
          noticeQueue: { enqueue: () => Promise.resolve() },
        });
        return [messaging.professionalRouter, messaging.adminRouter];
      },
      { logStream: logs },
    );
    familyId = randomUUID();
    await h.pool.query("INSERT INTO families (id, name) VALUES ($1,'F')", [familyId]);
    senderUser = randomUUID();
    await h.pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','S','1985-01-01','Africa/Luanda','ACTIVE','1',now())", [senderUser, `s-${senderUser}@exemplo.ao`]);
    const p = await h.newProfessional();
    await h.pool.query("UPDATE professionals SET validation_status = 'APPROVED', display_name = 'Dra. Mod', city = 'Luanda', approved_at = now(), submitted_at = now() WHERE id = $1", [p.professionalId]);
    pro = p;
    adminToken = await h.adminToken();
    userToken = await h.userToken();
  }, 240_000);

  afterAll(async () => {
    await h.stop();
  });

  it("autorização: sem token/profissional ⇒ 401; User sem privilégio ⇒ 403 nas 3 rotas", async () => {
    const c = await conversation(2);
    const rid = await report(await c.messageId(1));
    const routes: [("get" | "post"), string, unknown?][] = [["get", ""], ["get", `/${rid}`], ["post", `/${rid}/decisions`, { decision: "DISMISS" }]];
    for (const [m, p, b] of routes) {
      let anon = request(h.app)[m](`${API}/admin/message-reports${p}`);
      if (b !== undefined) anon = anon.send(b as object);
      expect((await anon).status).toBe(401);
      expect((await admin(m, p, b, pro.token)).status).toBe(401);
      expect((await admin(m, p, b, userToken)).status).toBe(403);
    }
    expect(bodyOf(await admin("get", `/${rid}`)).status).toBe("OPEN");
  });

  it("TC-AZ-MKT-15: conversa de 10 mensagens, denúncia da 7.ª ⇒ exatamente seq 5, 6 e 7 (nunca posteriores nem mais antigas)", async () => {
    const c = await conversation(10);
    await conversation(10); // outra conversa: nada dela pode aparecer
    const rid = await report(await c.messageId(7));
    const res = await admin("get", `/${rid}`);
    expect(res.status).toBe(200);
    const body = bodyOf(res) as ReportDetail;
    expect(body.contextBefore.map((m) => m.seq)).toEqual([5, 6]);
    expect(body.message.text).toBe("t07x");
    expect(body.contextBefore.map((m) => m.text)).toEqual(["t05x", "t06x"]);
    const raw = JSON.stringify(body);
    for (const n of [1, 2, 3, 4, 8, 9, 10]) expect(raw).not.toContain(`t${String(n).padStart(2, "0")}x"`);
    for (const m of body.contextBefore) expect(Object.keys(m).sort()).toEqual(["createdAt", "hidden", "id", "seq", "side", "text"]);
    expect(body.contextBefore[0]).toMatchObject({ side: "FAMILY", hidden: false });
    expect(body.contextBefore[1]).toMatchObject({ side: "PROFESSIONAL" });
  });

  it("contexto nas bordas: 1.ª ⇒ vazio; 2.ª ⇒ só a 1.ª; anterior oculta ocupa o lugar com hidden=true e sem texto", async () => {
    const c = await conversation(5);
    const first = bodyOf(await admin("get", `/${await report(await c.messageId(1), "PROFESSIONAL")}`));
    expect(first.contextBefore).toEqual([]);
    const second = bodyOf(await admin("get", `/${await report(await c.messageId(2), "FAMILY")}`));
    expect(second.contextBefore.map((m: { seq: number }) => m.seq)).toEqual([1]);
    await h.pool.query("UPDATE messages SET hidden_at = now() WHERE conversation_id = $1 AND seq = 4", [c.id]);
    const fifth = bodyOf(await admin("get", `/${await report(await c.messageId(5))}`));
    expect(fifth.contextBefore.map((m: { seq: number }) => m.seq)).toEqual([3, 4]);
    expect(fifth.contextBefore[1]).toMatchObject({ hidden: true, text: null });
    expect(JSON.stringify(fifth)).not.toContain("t04x");
  });

  it("privacidade: sem ids de família/membro/conversa nem rótulo; reportedUserId só do lado da família", async () => {
    const c = await conversation(4);
    const family = bodyOf(await admin("get", `/${await report(await c.messageId(3))}`));
    const pros = bodyOf(await admin("get", `/${await report(await c.messageId(4), "FAMILY")}`));
    expect(family.reportedUserId).toBe(senderUser);
    expect(family.reportedSide).toBe("FAMILY");
    expect(pros.reportedUserId ?? null).toBeNull();
    expect(pros.reportedSide).toBe("PROFESSIONAL");
    expect(family.professional).toMatchObject({ id: pro.professionalId, displayName: "Dra. Mod" });
    const raw = JSON.stringify([family, pros]);
    for (const forbidden of [familyId, c.id, LABEL, "familyId", "memberId", "participantLabel", "conversationId", "senderUserId"]) expect(raw, forbidden).not.toContain(forbidden);
    expect(family.note).toBe(NOTE);
  });

  it("auditoria: abrir o detalhe regista ADMIN_MESSAGE_REPORT_VIEW com contextCount 0..2 e sem conteúdo; logs sem texto", async () => {
    const c = await conversation(6);
    const counts: number[] = [];
    for (const seq of [1, 2, 6]) {
      const rid = await report(await c.messageId(seq));
      expect((await admin("get", `/${rid}`)).status).toBe(200);
      const { rows } = await h.pool.query<{ actor_type: string; metadata: Record<string, unknown>; family_id: string | null; actor_user_id: string | null }>("SELECT actor_type, metadata, family_id, actor_user_id FROM audit_logs WHERE action = 'ADMIN_MESSAGE_REPORT_VIEW' AND resource_id = $1", [rid]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actor_type).toBe("PLATFORM_ADMIN");
      expect(rows[0]?.family_id).toBeNull();
      expect(Object.keys(rows[0]?.metadata ?? {})).toEqual(["contextCount"]);
      counts.push(Number(rows[0]?.metadata.contextCount));
    }
    expect(counts).toEqual([0, 1, 2]);
    const all = await h.pool.query("SELECT metadata::text AS m FROM audit_logs WHERE action LIKE 'ADMIN_MESSAGE_REPORT_%'");
    expect(JSON.stringify(all.rows)).not.toMatch(/t0\dx|canario/);
    const dump = logs.join("");
    for (const c2 of ["t01x", "t06x", NOTE, LABEL]) expect(dump).not.toContain(c2);
    // A listagem não é detalhe: não audita.
    const before = Number((await h.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_logs WHERE action = 'ADMIN_MESSAGE_REPORT_VIEW'")).rows[0]?.n);
    await admin("get", "?limit=5");
    expect(Number((await h.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_logs WHERE action = 'ADMIN_MESSAGE_REPORT_VIEW'")).rows[0]?.n)).toBe(before);
  });

  it("fila: OPEN por omissão, mais antiga primeiro, sem texto, com cursor, filtro DECIDED e validação do limite", async () => {
    const c = await conversation(4);
    const ids = [await report(await c.messageId(1)), await report(await c.messageId(3)), await report(await c.messageId(2), "FAMILY")];
    const page1 = bodyOf(await admin("get", "?limit=100")) as ReportPage;
    const mine = page1.items.filter((i) => ids.includes(i.id));
    expect(mine.map((i) => i.id)).toEqual(ids);
    expect(Object.keys(mine[0] ?? {}).sort()).toEqual(["createdAt", "id", "professionalDisplayName", "professionalId", "reason", "reportedSide", "status"]);
    expect(mine[2]?.reportedSide).toBe("PROFESSIONAL");
    expect(JSON.stringify(page1)).not.toMatch(/t0\dx|canario/);
    const total = page1.items.length;
    const small = bodyOf(await admin("get", "?limit=2")) as ReportPage;
    expect(small.items).toHaveLength(2);
    expect(small.nextCursor).not.toBeNull();
    const rest = bodyOf(await admin("get", `?limit=100&cursor=${encodeURIComponent(small.nextCursor ?? "")}`)) as ReportPage;
    expect(small.items.length + rest.items.length).toBe(total);
    expect((await admin("post", `/${ids[0] ?? ""}/decisions`, { decision: "DISMISS" })).status).toBe(200);
    expect(bodyOf(await admin("get", "?status=DECIDED&limit=100")).items.map((i: { id: string }) => i.id)).toContain(ids[0]);
    expect(bodyOf(await admin("get", "?limit=100")).items.map((i: { id: string }) => i.id)).not.toContain(ids[0]);
    expect((await admin("get", "?limit=0")).status).toBe(400);
    expect((await admin("get", `/${randomUUID()}`)).status).toBe(404);
  });

  describe("decisões", () => {
    it("DISMISS não oculta nem fecha; HIDE_MESSAGE oculta para todos (o profissional vê hidden); a decisão é única", async () => {
      const c = await conversation(3);
      const m3 = await c.messageId(3);
      const dismiss = await admin("post", `/${await report(m3)}/decisions`, { decision: "DISMISS" });
      expect(dismiss.body).toMatchObject({ status: "DECIDED", decision: "DISMISS" });
      expect((await h.pool.query("SELECT 1 FROM messages WHERE id = $1 AND hidden_at IS NOT NULL", [m3])).rowCount).toBe(0);
      const m1 = await c.messageId(1);
      const rid = await report(m1);
      const hide = await admin("post", `/${rid}/decisions`, { decision: "HIDE_MESSAGE" });
      expect(hide.status).toBe(200);
      expect(hide.body.message).toMatchObject({ hidden: true, text: "t01x" }); // o admin continua a ver o original
      const seen = await request(h.app).get(`${PROFESSIONAL_API}/conversations/${c.id}/messages`).set("Authorization", `Bearer ${pro.token}`);
      expect(seen.body.items.find((m: { seq: number }) => m.seq === 1)).toMatchObject({ hidden: true, text: null });
      expect((await h.pool.query<{ status: string }>("SELECT status FROM conversations WHERE id = $1", [c.id])).rows[0]?.status).toBe("OPEN");
      const again = await admin("post", `/${rid}/decisions`, { decision: "DISMISS" });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("INVALID_STATE_TRANSITION");
      expect(bodyOf(await admin("post", `/${await report(m1, "FAMILY")}/decisions`, { decision: "HIDE_MESSAGE" })).status).toBe("DECIDED"); // já oculta: idempotente
    });

    it("HIDE_AND_CLOSE fecha com closedBy=SYSTEM (também se já fechada por um lado) e ninguém a reabre", async () => {
      for (const prior of [undefined, "FAMILY", "PROFESSIONAL"] as const) {
        const c = prior ? await conversation(3, { status: "CLOSED", closedBy: prior }) : await conversation(3);
        const res = await admin("post", `/${await report(await c.messageId(3))}/decisions`, { decision: "HIDE_AND_CLOSE" });
        expect(res.status).toBe(200);
        const { rows } = await h.pool.query<{ status: string; closed_by: string }>("SELECT status, closed_by FROM conversations WHERE id = $1", [c.id]);
        expect(rows[0]).toEqual({ status: "CLOSED", closed_by: "SYSTEM" });
        const reopen = await request(h.app).post(`${PROFESSIONAL_API}/conversations/${c.id}/reopen`).set("Authorization", `Bearer ${pro.token}`);
        expect(reopen.status).toBe(409);
        expect(reopen.body.code).toBe("CONVERSATION_CLOSED");
      }
    });

    it("decisões concorrentes: exatamente uma vence (200) e as outras ⇒ 409; sem efeitos duplicados", async () => {
      const c = await conversation(3);
      const rid = await report(await c.messageId(3));
      const res = await Promise.all(["DISMISS", "HIDE_MESSAGE", "HIDE_AND_CLOSE", "DISMISS"].map((decision) => admin("post", `/${rid}/decisions`, { decision })));
      expect(res.filter((r) => r.status === 200)).toHaveLength(1);
      expect(res.filter((r) => r.status === 409)).toHaveLength(3);
      const { rows } = await h.pool.query<{ decision: string }>("SELECT decision FROM message_reports WHERE id = $1", [rid]);
      expect(rows[0]?.decision).toBe(res.find((r) => r.status === 200)?.body.decision);
      const audits = await h.pool.query("SELECT 1 FROM audit_logs WHERE action = 'ADMIN_MESSAGE_REPORT_DECIDE' AND resource_id = $1", [rid]);
      expect(audits.rowCount).toBe(1);
    });

    it("validação e auditoria: decisão inválida ⇒ 422; denúncia inexistente ⇒ 404; DECIDE regista decision/from/to sem conteúdo e decided_by", async () => {
      const c = await conversation(2);
      const rid = await report(await c.messageId(1));
      expect((await admin("post", `/${rid}/decisions`, { decision: "DELETE_ALL" })).status).toBe(422);
      expect((await admin("post", `/${randomUUID()}/decisions`, { decision: "DISMISS" })).status).toBe(404);
      expect((await admin("post", `/${rid}/decisions`, { decision: "HIDE_MESSAGE" })).status).toBe(200);
      const { rows } = await h.pool.query<{ metadata: Record<string, unknown>; actor_type: string }>("SELECT metadata, actor_type FROM audit_logs WHERE action = 'ADMIN_MESSAGE_REPORT_DECIDE' AND resource_id = $1", [rid]);
      expect(rows[0]?.actor_type).toBe("PLATFORM_ADMIN");
      expect(rows[0]?.metadata).toMatchObject({ decision: "HIDE_MESSAGE", fromStatus: "OPEN", toStatus: "DECIDED" });
      expect(JSON.stringify(rows)).not.toMatch(/t0\dx|canario/);
      const decided = await h.pool.query("SELECT 1 FROM message_reports WHERE id = $1 AND status = 'DECIDED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL", [rid]);
      expect(decided.rowCount).toBe(1);
    });
  });
});
