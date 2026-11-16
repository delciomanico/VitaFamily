/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- respostas HTTP/linhas SQL de teste sem tipagem (supertest devolve `any`). */
// Integração (PostgreSQL real + API real validada contra o openapi.yaml, pedidos E respostas) das credenciais do profissional (MK1 S6):
// UC-MKT-04, BR-MKT-16/17/23, TC-MKT-08/09/10, TC-AZ-MKT-02 (parte credenciais), TC-AZ-MKT-03/08. Cada teste cria os seus profissionais.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INFECTED_MARKER, PROFESSIONAL_API, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const CREDENTIALS = `${PROFESSIONAL_API}/credentials`;
const MAX_BYTES = 10 * 1024 * 1024;

type Status = "DRAFT" | "PENDING_REVIEW" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";
const ESTADOS: readonly Status[] = ["DRAFT", "PENDING_REVIEW", "NEEDS_INFO", "APPROVED", "REJECTED", "SUSPENDED"];
const LOCKED: readonly Status[] = ["PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"];
const WRITABLE: readonly Status[] = ["DRAFT", "NEEDS_INFO"];

/** PDF mínimo válido (assinatura `%PDF-` no início). */
const pdf = (): Buffer => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n");
const pngDeclaredAsPdf = (): Buffer => pdf();
const JPG = (): Buffer => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = (): Buffer => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
/** «executável disfarçado»: assinatura MZ, declarado como PDF. */
const DISGUISED = (): Buffer => Buffer.from("MZ\x90\x00 programa");
const INFECTED_PDF = (): Buffer => Buffer.from(`%PDF-1.4\n${INFECTED_MARKER}\n%%EOF\n`);

/** Ids de uma lista de credenciais (corpo JSON de `GET /credentials`). */
const idsOf = (body: unknown): string[] => (body as { id: string }[]).map((c) => c.id);

/** Parser binário para supertest (`application/octet-stream` chega como Buffer). */
/** Respostas JSON (problemas) chegam como objeto; o ficheiro como Buffer. */
const binaryParser = (res: NodeJS.ReadableStream & { headers: Record<string, string | undefined> }, callback: (err: Error | null, body: unknown) => void): void => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => {
    const body = Buffer.concat(chunks);
    if (res.headers["content-type"]?.includes("json")) {
      callback(null, JSON.parse(body.toString("utf8")) as unknown);
      return;
    }
    callback(null, body);
  });
};

describe("integração: credenciais do profissional (MK1 S6)", () => {
  let h: ProfessionalsHarness;

  beforeAll(async () => {
    h = await startProfessionalsHarness();
  });
  afterAll(async () => {
    await h.stop();
  });

  // ---------------------------------------------------------------- helpers locais

  /** Força o estado de validação por SQL (pré-condição de teste; contorna a máquina de estados de propósito). */
  async function setState(professionalId: string, status: Status): Promise<void> {
    const reason = status === "DRAFT" || status === "APPROVED" ? null : "motivo de teste";
    await h.pool.query(
      `UPDATE professionals SET
         validation_status = $2::professional_validation_status,
         status_reason = $3,
         status_changed_at = now(),
         submitted_at = CASE WHEN $2::professional_validation_status = 'DRAFT' THEN NULL ELSE COALESCE(submitted_at, now()) END,
         approved_at = CASE WHEN $2::professional_validation_status = 'APPROVED' THEN COALESCE(approved_at, now()) ELSE NULL END,
         display_name = CASE WHEN $2::professional_validation_status = 'APPROVED' THEN COALESCE(display_name, 'Nome Aprovado') ELSE display_name END,
         city = CASE WHEN $2::professional_validation_status = 'APPROVED' THEN COALESCE(city, 'Luanda') ELSE city END,
         updated_at = now()
       WHERE id = $1`,
      [professionalId, status, reason],
    );
  }

  /** Upload multipart (`kind` IDENTITY por omissão, ficheiro PDF por omissão). */
  function upload(token: string, opts: { kind?: string; buffer?: Buffer; filename?: string; contentType?: string; fields?: Record<string, string> } = {}) {
    let req = request(h.app).post(CREDENTIALS).set("Authorization", `Bearer ${token}`).field("kind", opts.kind ?? "IDENTITY");
    for (const [name, value] of Object.entries(opts.fields ?? {})) req = req.field(name, value);
    return req.attach("file", opts.buffer ?? pdf(), { filename: opts.filename ?? "x.pdf", contentType: opts.contentType ?? "application/pdf" });
  }
  const list = (token: string) => request(h.app).get(CREDENTIALS).set("Authorization", `Bearer ${token}`);
  const remove = (token: string, id: string) => request(h.app).delete(`${CREDENTIALS}/${id}`).set("Authorization", `Bearer ${token}`);
  const download = (token: string, id: string) =>
    request(h.app).get(`${CREDENTIALS}/${id}/file`).set("Authorization", `Bearer ${token}`).buffer(true).parse(binaryParser);

  /** Linha da BD (ou `undefined`). */
  async function row(credentialId: string) {
    const { rows } = await h.pool.query<{
      id: string;
      professional_id: string;
      kind: string;
      number: string | null;
      issuing_body: string | null;
      valid_until: string | null;
      storage_key: string;
      content_type: string;
      size_bytes: number;
      scan_status: string;
    }>("SELECT * FROM professional_credentials WHERE id = $1", [credentialId]);
    return rows[0];
  }

  /** Esvazia a outbox de ficheiros por completo (o `deleteFiles` processa lotes de 50, FIFO). */
  async function drainDeletions(): Promise<{ deleted: number; failed: number }> {
    const total = { deleted: 0, failed: 0 };
    for (let i = 0; i < 100; i += 1) {
      const batch = await h.jobs.deleteFiles();
      total.deleted += batch.deleted;
      total.failed += batch.failed;
      if (batch.deleted + batch.failed === 0) return total;
    }
    throw new Error("outbox de ficheiros não esvaziou");
  }

  async function countCredentials(professionalId: string): Promise<number> {
    const { rows } = await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM professional_credentials WHERE professional_id = $1", [professionalId]);
    return rows[0]?.n ?? 0;
  }

  async function deletionRowsFor(storageKey: string): Promise<number> {
    const { rows } = await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM professional_file_deletions WHERE storage_key = $1", [storageKey]);
    return rows[0]?.n ?? 0;
  }

  async function auditRows(action: string, resourceId: string) {
    const { rows } = await h.pool.query("SELECT * FROM audit_logs WHERE action = $1 AND resource_id = $2", [action, resourceId]);
    return rows;
  }

  /** Carrega um PDF limpo, corre o antivírus e devolve o id (CLEAN). */
  async function cleanCredential(token: string, opts: { kind?: string; fields?: Record<string, string> } = {}): Promise<string> {
    const res = await upload(token, opts).expect(201);
    await h.runScans();
    return res.body.id as string;
  }

  /** Profissional com um `professionalId` e token. */
  const pro = () => h.newProfessional();

  // ---------------------------------------------------------------- (1) upload feliz

  describe("(1) upload feliz (UC-MKT-04, BR-MKT-17)", () => {
    it("201 em PENDING com metadados, contentType do CONTEÚDO e sem storageKey, caminho interno nem nome do ficheiro na resposta", async () => {
      const p = await pro();
      const res = await upload(p.token, {
        kind: "IDENTITY",
        filename: "cedula-original.pdf",
        fields: { number: "NUM-1", issuingBody: "Serviço de Identificação", validUntil: "2030-05-31" },
      }).expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        kind: "IDENTITY",
        number: "NUM-1",
        issuingBody: "Serviço de Identificação",
        validUntil: "2030-05-31",
        scanStatus: "PENDING",
        contentType: "application/pdf",
        sizeBytes: pdf().length,
        createdAt: expect.any(String),
      });
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain("storageKey");
      expect(serialized).not.toContain("storage_key");
      expect(serialized).not.toContain("professional-credentials");
      expect(serialized).not.toContain("cedula-original");
    });

    it("o objeto existe em quarentena na chave guardada na BD, com os mesmos bytes", async () => {
      const p = await pro();
      const buffer = pdf();
      const res = await upload(p.token, { buffer }).expect(201);
      const stored = await row(res.body.id as string);

      expect(stored.storage_key).toMatch(/^professional-credentials\/quarantine\/.+\.pdf$/);
      expect(stored.scan_status).toBe("PENDING");
      expect(h.storage.objects.get(stored.storage_key)?.body.equals(buffer)).toBe(true);
    });

    it("enfileira exatamente um trabalho de antivírus para a credencial", async () => {
      await h.runScans();
      const p = await pro();
      const res = await upload(p.token).expect(201);

      expect(h.scanQueue).toEqual([{ credentialId: res.body.id }]);
      await h.runScans();
    });

    it("GET lista só as próprias credenciais, sem storageKey, com cache-control no-store", async () => {
      const a = await pro();
      const b = await pro();
      const mine = await upload(a.token).expect(201);
      const theirs = await upload(b.token).expect(201);

      const res = await list(a.token).expect(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(idsOf(res.body)).toEqual([mine.body.id]);
      expect(idsOf(res.body)).not.toContain(theirs.body.id);
      expect(JSON.stringify(res.body)).not.toContain("professional-credentials");
      await h.runScans();
    });
  });

  // ---------------------------------------------------------------- (2) validação por conteúdo e limites

  describe("(2) validação do ficheiro e dos metadados (BR-MKT-17)", () => {
    it("executável disfarcado de PDF (content-type pdf) ⇒ 415 FILE_TYPE_NOT_ALLOWED, sem objeto nem linha", async () => {
      const p = await pro();
      const objectsBefore = h.storage.objects.size;
      const queueBefore = h.scanQueue.length;
      const res = await upload(p.token, { buffer: DISGUISED(), filename: "cedula.pdf", contentType: "application/pdf" }).expect(415);

      expect(res.body.code).toBe("FILE_TYPE_NOT_ALLOWED");
      expect(h.storage.objects.size).toBe(objectsBefore);
      expect(h.scanQueue.length).toBe(queueBefore);
      expect(await countCredentials(p.professionalId)).toBe(0);
    });

    it("PDF declarado como image/png é aceite e o contentType guardado é o do CONTEÚDO (application/pdf)", async () => {
      const p = await pro();
      const res = await upload(p.token, { buffer: pngDeclaredAsPdf(), filename: "foto.png", contentType: "image/png" }).expect(201);
      expect(res.body.contentType).toBe("application/pdf");
      expect((await row(res.body.id as string)).content_type).toBe("application/pdf");
      await h.runScans();
    });

    it("JPG e PNG reais são aceites com o content-type correspondente ao conteúdo", async () => {
      const p = await pro();
      const jpg = await upload(p.token, { buffer: JPG(), filename: "a.pdf", contentType: "application/pdf" }).expect(201);
      const png = await upload(p.token, { buffer: PNG(), filename: "b.jpg", contentType: "image/jpeg" }).expect(201);
      expect(jpg.body.contentType).toBe("image/jpeg");
      expect(png.body.contentType).toBe("image/png");
      await h.runScans();
    });

    it("ficheiro vazio ⇒ 415 ou 422 (nunca 201 nem 500), sem linha", async () => {
      const p = await pro();
      const res = await upload(p.token, { buffer: Buffer.alloc(0) });
      expect([415, 422]).toContain(res.status);
      expect(res.status).not.toBe(500);
      expect(await countCredentials(p.professionalId)).toBe(0);
    });

    it("ficheiro de 10 MB + 1 byte (PDF válido no início) ⇒ 413 FILE_TOO_LARGE e nada guardado", async () => {
      const p = await pro();
      const head = pdf();
      const big = Buffer.concat([head, Buffer.alloc(MAX_BYTES + 1 - head.length, 0x20)]);
      expect(big.length).toBe(MAX_BYTES + 1);
      const objectsBefore = h.storage.objects.size;

      const res = await upload(p.token, { buffer: big }).expect(413);
      expect(res.body.code).toBe("FILE_TOO_LARGE");
      expect(h.storage.objects.size).toBe(objectsBefore);
      expect(await countCredentials(p.professionalId)).toBe(0);
    });

    it("exatamente 10 MB é aceite (201, sizeBytes = 10485760)", async () => {
      const p = await pro();
      const head = pdf();
      const exact = Buffer.concat([head, Buffer.alloc(MAX_BYTES - head.length, 0x20)]);
      const res = await upload(p.token, { buffer: exact }).expect(201);
      expect(res.body.sizeBytes).toBe(MAX_BYTES);
      await h.runScans();
    });

    it("sem ficheiro ⇒ 422 e nada criado", async () => {
      const p = await pro();
      await request(h.app).post(CREDENTIALS).set("Authorization", `Bearer ${p.token}`).field("kind", "IDENTITY").expect(422);
      expect(await countCredentials(p.professionalId)).toBe(0);
    });

    it("kind inválido ⇒ 422", async () => {
      const p = await pro();
      await upload(p.token, { kind: "PASSPORT" }).expect(422);
      expect(await countCredentials(p.professionalId)).toBe(0);
    });

    it("validUntil inexistente no calendário (2026-02-31) ⇒ 422", async () => {
      const p = await pro();
      await upload(p.token, { fields: { validUntil: "2026-02-31" } }).expect(422);
      expect(await countCredentials(p.professionalId)).toBe(0);
    });

    it("number com 61 caracteres ⇒ 422", async () => {
      const p = await pro();
      await upload(p.token, { fields: { number: "n".repeat(61) } }).expect(422);
      expect(await countCredentials(p.professionalId)).toBe(0);
    });

    it("issuingBody com 121 caracteres ⇒ 422", async () => {
      const p = await pro();
      await upload(p.token, { fields: { issuingBody: "o".repeat(121) } }).expect(422);
      expect(await countCredentials(p.professionalId)).toBe(0);
    });

    it("number com exatamente 60 e issuingBody com exatamente 120 caracteres são aceites", async () => {
      const p = await pro();
      const res = await upload(p.token, { fields: { number: "n".repeat(60), issuingBody: "o".repeat(120) } }).expect(201);
      expect(res.body).toMatchObject({ number: "n".repeat(60), issuingBody: "o".repeat(120) });
      await h.runScans();
    });
  });

  // ---------------------------------------------------------------- (3) antivírus (TC-MKT-09)

  describe("(3) antivírus (TC-MKT-09, state-machines «ProfessionalCredential»)", () => {
    it("credencial limpa ⇒ CLEAN, chave final com os mesmos bytes; quarentena só some depois do deleteFiles", async () => {
      const p = await pro();
      await h.runScans();
      const buffer = pdf();
      const res = await upload(p.token, { buffer }).expect(201);
      const quarantineKey = (await row(res.body.id as string)).storage_key;

      await h.runScans();
      const after = await row(res.body.id as string);
      expect(after.scan_status).toBe("CLEAN");
      expect(after.storage_key).toBe(`professional-credentials/final/${res.body.id as string}.pdf`);
      expect(h.storage.objects.get(after.storage_key)?.body.equals(buffer)).toBe(true);
      expect(h.storage.objects.has(quarantineKey)).toBe(true);

      const deleted = await drainDeletions();
      expect(deleted.failed).toBe(0);
      expect(h.storage.objects.has(quarantineKey)).toBe(false);
      expect(h.storage.objects.get(after.storage_key)?.body.equals(buffer)).toBe(true);
    });

    it("credencial infetada ⇒ INFECTED, linha mantida, objeto apagado após deleteFiles; GET mostra INFECTED", async () => {
      const p = await pro();
      await h.runScans();
      const res = await upload(p.token, { buffer: INFECTED_PDF() }).expect(201);
      const quarantineKey = (await row(res.body.id as string)).storage_key;
      expect(h.storage.objects.has(quarantineKey)).toBe(true);

      await h.runScans();
      const stored = await row(res.body.id as string);
      expect(stored).toBeDefined();
      expect(stored.scan_status).toBe("INFECTED");
      expect(stored.storage_key).toBe(quarantineKey);
      expect(h.storage.objects.has(quarantineKey)).toBe(true);

      await drainDeletions();
      expect(h.storage.objects.has(quarantineKey)).toBe(false);
      expect(await row(res.body.id as string)).toBeDefined();

      const listed = await list(p.token).expect(200);
      expect(listed.body).toEqual([expect.objectContaining({ id: res.body.id, scanStatus: "INFECTED" })]);
    });

    it("correr o scan duas vezes é idempotente: sem erro e uma só linha de remoção por credencial limpa", async () => {
      const p = await pro();
      await h.runScans();
      const res = await upload(p.token).expect(201);
      const quarantineKey = (await row(res.body.id as string)).storage_key;

      await h.jobs.scanCredential({ credentialId: res.body.id as string });
      await h.jobs.scanCredential({ credentialId: res.body.id as string });
      await h.runScans();

      const after = await row(res.body.id as string);
      expect(after.scan_status).toBe("CLEAN");
      expect(await deletionRowsFor(quarantineKey)).toBe(1);
      expect(h.storage.objects.has(after.storage_key)).toBe(true);
    });

    it("scan de uma credencial infetada duas vezes também é idempotente (uma linha de remoção)", async () => {
      const p = await pro();
      await h.runScans();
      const res = await upload(p.token, { buffer: INFECTED_PDF() }).expect(201);
      const quarantineKey = (await row(res.body.id as string)).storage_key;

      await h.jobs.scanCredential({ credentialId: res.body.id as string });
      await h.jobs.scanCredential({ credentialId: res.body.id as string });
      expect(await deletionRowsFor(quarantineKey)).toBe(1);
      expect((await row(res.body.id as string)).scan_status).toBe("INFECTED");
    });

    it("scan de uma credencial removida entretanto é no-op (sem erro, sem objeto final, sem linhas novas além da remoção)", async () => {
      const p = await pro();
      await h.runScans();
      const res = await upload(p.token).expect(201);
      const quarantineKey = (await row(res.body.id as string)).storage_key;
      await remove(p.token, res.body.id as string).expect(204);
      const removalRows = await deletionRowsFor(quarantineKey);

      await expect(h.jobs.scanCredential({ credentialId: res.body.id as string })).resolves.toBeUndefined();
      await h.runScans();

      expect(await row(res.body.id as string)).toBeUndefined();
      expect(await deletionRowsFor(quarantineKey)).toBe(removalRows);
      expect(h.storage.objects.has(`professional-credentials/final/${res.body.id as string}.pdf`)).toBe(false);
    });
  });

  // ---------------------------------------------------------------- (4) limites, estados e rate limit

  describe("(4) limites e estados (TC-MKT-10, TC-AZ-MKT-02)", () => {
    it("a 11.ª credencial ⇒ 409 LIMIT_EXCEEDED e não guarda objeto", async () => {
      const p = await pro();
      for (let i = 0; i < 10; i += 1) await upload(p.token).expect(201);
      await h.runScans();
      const objectsBefore = h.storage.objects.size;

      const res = await upload(p.token).expect(409);
      expect(res.body.code).toBe("LIMIT_EXCEEDED");
      expect(h.storage.objects.size).toBe(objectsBefore);
      expect(await countCredentials(p.professionalId)).toBe(10);
    });

    it.each(LOCKED)("upload em %s ⇒ 409 PROFESSIONAL_LOCKED, sem objeto nem linha, e registo ACCESS_DENIED", async (status) => {
      const p = await pro();
      await setState(p.professionalId, status);
      const objectsBefore = h.storage.objects.size;

      const res = await upload(p.token).expect(409);
      expect(res.body.code).toBe("PROFESSIONAL_LOCKED");
      expect(h.storage.objects.size).toBe(objectsBefore);
      expect(await countCredentials(p.professionalId)).toBe(0);
      const denied = await h.pool.query("SELECT metadata FROM audit_logs WHERE action = 'ACCESS_DENIED' AND actor_professional_account_id = $1", [p.accountId]);
      expect(denied.rows.map((r: { metadata: { operation?: string } }) => r.metadata.operation)).toContain("UPLOAD_CREDENTIAL");
    });

    it.each(LOCKED)("remoção em %s ⇒ 409 PROFESSIONAL_LOCKED e a credencial mantém-se intacta", async (status) => {
      const p = await pro();
      const id = (await upload(p.token).expect(201)).body.id as string;
      await h.runScans();
      await setState(p.professionalId, status);
      const before = await row(id);

      const res = await remove(p.token, id).expect(409);
      expect(res.body.code).toBe("PROFESSIONAL_LOCKED");
      expect(await row(id)).toEqual(before);
      expect(await deletionRowsFor(before.storage_key)).toBe(0);
    });

    it.each(WRITABLE)("upload e remoção permitidos em %s", async (status) => {
      const p = await pro();
      await setState(p.professionalId, status);
      const id = (await upload(p.token).expect(201)).body.id as string;
      await remove(p.token, id).expect(204);
      expect(await row(id)).toBeUndefined();
    });

    it.each(ESTADOS)("leitura (list e download de CLEAN) sempre permitida em %s", async (status) => {
      const p = await pro();
      const id = await cleanCredential(p.token);
      await setState(p.professionalId, status);

      const listed = await list(p.token).expect(200);
      expect(idsOf(listed.body)).toEqual([id]);
      const file = await download(p.token, id).expect(200);
      expect((file.body as Buffer).equals(pdf())).toBe(true);
    });

    it("rate limit: 20 uploads/hora por conta; o 21.º ⇒ 429 com Retry-After; após 61 min volta a permitir", async () => {
      const p = await pro();
      try {
        for (let i = 0; i < 20; i += 1) {
          const id = (await upload(p.token).expect(201)).body.id as string;
          await remove(p.token, id).expect(204);
        }
        const objectsBefore = h.storage.objects.size;
        const limited = await upload(p.token).expect(429);
        expect(limited.body.code).toBe("RATE_LIMITED");
        expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
        expect(h.storage.objects.size).toBe(objectsBefore);

        h.clock.advance(61 * 60 * 1000);
        const fresh = await h.login(p.email);
        await upload(fresh.token).expect(201);
      } finally {
        h.clock.advance(-61 * 60 * 1000);
        await h.runScans();
      }
    });

    it("o rate limit é por conta: outro profissional continua a carregar", async () => {
      const a = await pro();
      const b = await pro();
      for (let i = 0; i < 20; i += 1) {
        const id = (await upload(a.token).expect(201)).body.id as string;
        await remove(a.token, id).expect(204);
      }
      await upload(a.token).expect(429);
      await upload(b.token).expect(201);
      await h.runScans();
    });
  });

  // ---------------------------------------------------------------- (5) remoção

  describe("(5) remoção (UC-MKT-04, BR-MKT-17)", () => {
    it("DELETE 204: linha apagada, remoção enfileirada na outbox, objeto some após deleteFiles, auditoria", async () => {
      const p = await pro();
      await h.runScans();
      const id = (await upload(p.token).expect(201)).body.id as string;
      const stored = await row(id);
      await h.runScans();
      const finalKey = (await row(id)).storage_key;

      await remove(p.token, id).expect(204);
      expect(await row(id)).toBeUndefined();
      expect(await deletionRowsFor(finalKey)).toBe(1);
      expect(h.storage.objects.has(finalKey)).toBe(true);

      await drainDeletions();
      expect(h.storage.objects.has(finalKey)).toBe(false);
      expect(stored.storage_key).not.toBe(finalKey);

      const audits = await auditRows("PROFESSIONAL_CREDENTIAL_DELETE", id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actor_type: "PROFESSIONAL_ACCOUNT", actor_professional_account_id: p.accountId, result: "SUCCESS" });
    });

    it("remover uma credencial pendente também apaga a quarentena", async () => {
      const p = await pro();
      await h.runScans();
      const id = (await upload(p.token).expect(201)).body.id as string;
      const quarantineKey = (await row(id)).storage_key;
      await remove(p.token, id).expect(204);
      await drainDeletions();
      expect(h.storage.objects.has(quarantineKey)).toBe(false);
      await h.runScans();
    });

    it("credencial de outro profissional ⇒ 404 e a credencial fica intacta (BD e storage)", async () => {
      const owner = await pro();
      const other = await pro();
      await h.runScans();
      const id = (await upload(owner.token).expect(201)).body.id as string;
      const before = await row(id);

      const foreign = await remove(other.token, id).expect(404);
      const missing = await remove(other.token, randomUUID()).expect(404);
      expect(foreign.body.code).toBe("NOT_FOUND");
      expect({ code: foreign.body.code, detail: foreign.body.detail }).toEqual({ code: missing.body.code, detail: missing.body.detail });
      expect(await row(id)).toEqual(before);
      expect(await deletionRowsFor(before.storage_key)).toBe(0);
      expect(h.storage.objects.has(before.storage_key)).toBe(true);
    });

    it("id inexistente ⇒ 404; id que não é UUID ⇒ 400 ou 422 do validador", async () => {
      const p = await pro();
      await remove(p.token, randomUUID()).expect(404);
      const bad = await remove(p.token, "nao-e-uuid");
      expect([400, 422]).toContain(bad.status);
    });
  });

  // ---------------------------------------------------------------- (6) download (TC-AZ-MKT-03/08)

  describe("(6) download mediado (TC-AZ-MKT-03/08)", () => {
    it("próprio CLEAN ⇒ 200 com os mesmos bytes e cabeçalhos seguros e genéricos", async () => {
      const p = await pro();
      const id = await cleanCredential(p.token, { kind: "IDENTITY", fields: { number: "NUM-HDR" } });

      const res = await download(p.token, id).expect(200);
      expect((res.body as Buffer).equals(pdf())).toBe(true);
      expect(res.headers["cache-control"]).toContain("no-store");
      expect(res.headers["cache-control"]).toContain("private");
      expect(res.headers["content-disposition"]).toBe('attachment; filename="credencial-identity.pdf"');
      expect(res.headers["content-type"]).toContain("application/octet-stream");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("cada download gera uma linha PROFESSIONAL_CREDENTIAL_DOWNLOAD, sem nome, nº nem entidade no registo", async () => {
      const p = await pro();
      const id = await cleanCredential(p.token, { fields: { number: "NUM-AUD-1", issuingBody: "Entidade Auditada" } });
      await download(p.token, id).expect(200);
      await download(p.token, id).expect(200);

      const audits = await auditRows("PROFESSIONAL_CREDENTIAL_DOWNLOAD", id);
      expect(audits).toHaveLength(2);
      for (const audit of audits) {
        const json = JSON.stringify(audit);
        expect(json).not.toContain("x.pdf");
        expect(json).not.toContain("NUM-AUD-1");
        expect(json).not.toContain("Entidade Auditada");
      }
    });

    it("PENDING ⇒ 409 DOCUMENT_NOT_AVAILABLE e nenhuma auditoria de download", async () => {
      const p = await pro();
      await h.runScans();
      const id = (await upload(p.token).expect(201)).body.id as string;
      const res = await download(p.token, id).expect(409);
      expect(res.body.code).toBe("DOCUMENT_NOT_AVAILABLE");
      expect(await auditRows("PROFESSIONAL_CREDENTIAL_DOWNLOAD", id)).toHaveLength(0);
    });

    it("INFECTED ⇒ 409 DOCUMENT_NOT_AVAILABLE e nenhuma auditoria de download", async () => {
      const p = await pro();
      await h.runScans();
      const id = (await upload(p.token, { buffer: INFECTED_PDF() }).expect(201)).body.id as string;
      await h.runScans();
      const res = await download(p.token, id).expect(409);
      expect(res.body.code).toBe("DOCUMENT_NOT_AVAILABLE");
      expect(await auditRows("PROFESSIONAL_CREDENTIAL_DOWNLOAD", id)).toHaveLength(0);
    });

    it("credencial de outro profissional ⇒ 404 idêntico ao de inexistente (sem enumeração) e sem auditoria", async () => {
      const owner = await pro();
      const other = await pro();
      const id = await cleanCredential(owner.token);

      const foreign = await download(other.token, id).expect(404);
      const missing = await download(other.token, randomUUID()).expect(404);
      expect(foreign.body.code).toBe("NOT_FOUND");
      expect({ code: foreign.body.code, detail: foreign.body.detail }).toEqual({ code: missing.body.code, detail: missing.body.detail });
      expect(await auditRows("PROFESSIONAL_CREDENTIAL_DOWNLOAD", id)).toHaveLength(0);
    });

    it("o download funciona nos 6 estados de validação (leitura) e não é auditado como escrita", async () => {
      const p = await pro();
      const id = await cleanCredential(p.token);
      for (const status of ESTADOS) {
        await setState(p.professionalId, status);
        await download(p.token, id).expect(200);
      }
      expect(await auditRows("PROFESSIONAL_CREDENTIAL_DOWNLOAD", id)).toHaveLength(ESTADOS.length);
    });

    it.each([
      ["GET lista", "GET", "list"],
      ["POST upload", "POST", "upload"],
      ["DELETE remoção", "DELETE", "delete"],
      ["GET download", "GET", "download"],
    ] as const)("%s: token de User, token de clínica ou sem token ⇒ 401", async (_label, _method, route) => {
      const p = await pro();
      const id = await cleanCredential(p.token);
      const call = (token: string | null) => {
        const auth = token === null ? {} : { Authorization: `Bearer ${token}` };
        if (route === "list") return request(h.app).get(CREDENTIALS).set(auth);
        if (route === "upload") return request(h.app).post(CREDENTIALS).set(auth).field("kind", "IDENTITY").attach("file", pdf(), { filename: "x.pdf", contentType: "application/pdf" });
        if (route === "delete") return request(h.app).delete(`${CREDENTIALS}/${id}`).set(auth);
        return request(h.app).get(`${CREDENTIALS}/${id}/file`).set(auth);
      };
      const objectsBefore = h.storage.objects.size;
      for (const token of [await h.userToken(), await h.clinicToken(), null]) {
        await call(token).expect(401);
      }
      expect(h.storage.objects.size).toBe(objectsBefore);
      expect(await row(id)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------- (7) canário de PII

  describe("(7) canário de PII em auditoria (BR-MKT-17)", () => {
    it("número, entidade e nome do ficheiro nunca aparecem em audit_logs (upload, download e remoção)", async () => {
      const p = await pro();
      const created = await upload(p.token, {
        filename: "cedula-canario.pdf",
        fields: { number: "NUM-CANARIO-123", issuingBody: "Ordem Canario" },
      }).expect(201);
      await h.runScans();
      await download(p.token, created.body.id as string).expect(200);
      await remove(p.token, created.body.id as string).expect(204);

      const { rows } = await h.pool.query("SELECT * FROM audit_logs");
      const serialized = JSON.stringify(rows);
      expect(serialized).toContain("PROFESSIONAL_CREDENTIAL_UPLOAD");
      expect(serialized).not.toContain("NUM-CANARIO-123");
      expect(serialized).not.toContain("Ordem Canario");
      expect(serialized).not.toContain("cedula-canario");
    });
  });

  // ---------------------------------------------------------------- (8) isolamento (TC-AZ-MKT-03)

  describe("(8) isolamento entre profissionais (TC-AZ-MKT-03)", () => {
    it("nenhuma operação de A (list, delete, download) toca nas credenciais de B (BD e storage)", async () => {
      const a = await pro();
      const b = await pro();
      await h.runScans();
      const bId = (await upload(b.token, { fields: { number: "NUM-B" } }).expect(201)).body.id as string;
      await h.runScans();
      const bBefore = await row(bId);
      const bCountBefore = await countCredentials(b.professionalId);
      const objectsBefore = new Set(h.storage.objects.keys());

      expect((await list(a.token).expect(200)).body).toEqual([]);
      await remove(a.token, bId).expect(404);
      await download(a.token, bId).expect(404);

      expect(await row(bId)).toEqual(bBefore);
      expect(await countCredentials(b.professionalId)).toBe(bCountBefore);
      expect(await deletionRowsFor(bBefore.storage_key)).toBe(0);
      expect(new Set(h.storage.objects.keys())).toEqual(objectsBefore);
      const bList = await list(b.token).expect(200);
      expect(idsOf(bList.body)).toEqual([bId]);
    });

    it("as credenciais carregadas por A não aparecem na lista de B", async () => {
      const a = await pro();
      const b = await pro();
      const aId = (await upload(a.token).expect(201)).body.id as string;
      const bList = await list(b.token).expect(200);
      expect(idsOf(bList.body)).not.toContain(aId);
      expect(await countCredentials(b.professionalId)).toBe(0);
      await h.runScans();
    });
  });

  describe("limite de transporte (multipart)", () => {
    it("ficheiro muito acima do limite é cortado no parse (413) e nada é guardado", async () => {
      const p = await h.newProfessional();
      const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(12 * 1024 * 1024, 1)]);
      const before = h.storage.objects.size;
      const res = await request(h.app)
        .post(`${PROFESSIONAL_API}/credentials`)
        .set("Authorization", `Bearer ${p.token}`)
        .field("kind", "IDENTITY")
        .attach("file", big, { filename: "x.pdf", contentType: "application/pdf" });
      expect(res.status).toBe(413);
      expect(h.storage.objects.size).toBe(before);
    });
  });
});
