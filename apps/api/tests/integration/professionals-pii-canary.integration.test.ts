/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- respostas HTTP/linhas SQL de teste sem tipagem (supertest devolve `any`). */
// Integração do canário de PII do profissional (MK1; TC-MKT-29; AC-MKT-12; AC-NFR-01; audit.md §3 «MK1»): um fluxo completo com valores
// ÚNICOS («canários») que nunca podem sair em `audit_logs` (metadata incluída), nos logs técnicos reais da API nem no texto dos e-mails.
// Os logs são capturados com `logStream` do harness (logger `debug` real, não um mock). Um contentor PostgreSQL real por ficheiro.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { API, PROFESSIONAL_API, nextIp, startProfessionalsHarness, type ProfessionalsHarness } from "../support/professionals-harness.js";

const EMAIL = "canario-xyz@exemplo.ao";
const SENHA = "senha-canario-xyz-2026";
const SENHA_NOVA = "senha-nova-canario-xyz-2026";
const SENHA_ERRADA = "senha-errada-canario-xyz-2026";
const NOME = "Nome Canario Xyz";
const BIO = "bio-canario-xyz";
const CIDADE = "Cidade-Canario";
const PAGAMENTO = "iban-canario-xyz";
const NUMERO = "NUM-CANARIO-XYZ";
const ORGAO = "Ordem-Canario-XYZ";
const FICHEIRO = "nome-canario-xyz.pdf";
const NOTA = "nota-canario-xyz";
const PRECO = 424242;
const BLOQUEIO = "ferias-canario-xyz";
const MOTIVO = "motivo-canario-xyz";

/** Um valor sensível. `fronteira`: procura-se como token isolado (códigos de 6 dígitos e preço, para não casar dentro de UUIDs). */
interface Canario {
  rotulo: string;
  valor: string;
  fronteira: boolean;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ocorre = (texto: string, c: Canario): boolean => (c.fronteira ? new RegExp(`(?<![0-9A-Za-z])${escapeRegex(c.valor)}(?![0-9A-Za-z])`).test(texto) : texto.includes(c.valor));

/** PDF mínimo válido (assinatura `%PDF-`). */
const pdf = (): Buffer => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n");
const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });
const api = (path: string): string => `${PROFESSIONAL_API}${path}`;
const adminApi = (path: string): string => `${API}/admin/${path}`;

/** Valores sensíveis conhecidos antes do fluxo; tokens, cookies e códigos acrescentam-se à medida que surgem. */
const canarios: Canario[] = [
  { rotulo: "e-mail", valor: EMAIL, fronteira: false },
  { rotulo: "palavra-passe", valor: SENHA, fronteira: false },
  { rotulo: "palavra-passe nova", valor: SENHA_NOVA, fronteira: false },
  { rotulo: "palavra-passe errada (login falhado)", valor: SENHA_ERRADA, fronteira: false },
  { rotulo: "displayName", valor: NOME, fronteira: false },
  { rotulo: "bio", valor: BIO, fronteira: false },
  { rotulo: "cidade", valor: CIDADE, fronteira: false },
  { rotulo: "pagamento (paymentInstructions)", valor: PAGAMENTO, fronteira: false },
  { rotulo: "nº da credencial", valor: NUMERO, fronteira: false },
  { rotulo: "entidade da credencial", valor: ORGAO, fronteira: false },
  { rotulo: "nome do ficheiro", valor: FICHEIRO, fronteira: false },
  { rotulo: "nota da oferta", valor: NOTA, fronteira: false },
  { rotulo: "preço (priceKz)", valor: String(PRECO), fronteira: true },
  { rotulo: "motivo do bloqueio", valor: BLOQUEIO, fronteira: false },
  { rotulo: "motivo da decisão do admin", valor: MOTIVO, fronteira: false },
];

/** Canários que, sem ser código, ficam fora do texto dos e-mails (a palavra-passe e os tokens nunca saem num e-mail). */
const SECRETOS_FORA_DE_EMAILS = (): Canario[] => canarios.filter((c) => !c.rotulo.startsWith("código"));

/** Ações que TC-MKT-29 exige (audit.md §3 «MK1») com o `actor_type` esperado. */
const ACOES_ESPERADAS: [string, string][] = [
  ["PROFESSIONAL_REGISTER", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_EMAIL_VERIFIED", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_LOGIN", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_LOGIN_FAILED", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_LOGOUT", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_PASSWORD_RESET", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_PROFILE_UPDATE", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_SPECIALTIES_SET", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_CREDENTIAL_UPLOAD", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_CREDENTIAL_DOWNLOAD", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_OFFER_CREATE", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_SCHEDULE_RULE_CREATE", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_TIME_OFF_CREATE", "PROFESSIONAL_ACCOUNT"],
  ["PROFESSIONAL_SUBMIT", "PROFESSIONAL_ACCOUNT"],
  ["ACCESS_DENIED", "PROFESSIONAL_ACCOUNT"],
  ["ADMIN_PROFESSIONAL_REQUEST_INFO", "PLATFORM_ADMIN"],
  ["ADMIN_PROFESSIONAL_APPROVE", "PLATFORM_ADMIN"],
  ["ADMIN_PROFESSIONAL_CREDENTIAL_DOWNLOAD", "PLATFORM_ADMIN"],
  ["ADMIN_SPECIALTY_CREATE", "PLATFORM_ADMIN"],
  ["PROFESSIONAL_CREDENTIAL_EXPIRED", "SYSTEM"],
  ["PROFESSIONAL_SCHEDULE_GENERATE", "SYSTEM"],
];

describe("detetor de canários (sem BD): o teste só vale se encontrar um canário quando ele existe", () => {
  it("apanha o valor literal e o código isolado, mas não dígitos dentro de um UUID", () => {
    expect(ocorre('{"x":"ola canario-xyz@exemplo.ao"}', { rotulo: "e-mail", valor: EMAIL, fronteira: false })).toBe(true);
    expect(ocorre('{"x":123456}', { rotulo: "código", valor: "123456", fronteira: true })).toBe(true);
    expect(ocorre('{"id":"0a123456b-0000-4000-8000-000000000000"}', { rotulo: "código", valor: "123456", fronteira: true })).toBe(false);
    expect(ocorre('{"priceKz":424242}', { rotulo: "preço", valor: String(PRECO), fronteira: true })).toBe(true);
  });
});

describe("TC-MKT-29: canário de PII do profissional (auditoria, logs técnicos e e-mails)", () => {
  let h: ProfessionalsHarness;
  /** Linhas JSON reais do logger (nível `debug`), capturadas pelo harness. */
  const LOGS: string[] = [];

  beforeAll(async () => {
    h = await startProfessionalsHarness({}, () => [], { logStream: LOGS });
  }, 120_000);

  afterAll(async () => {
    await h.stop();
  });

  it("fluxo completo com canários e pedidos de erro (422, 409 LOCKED, 404, 401, login falhado)", async () => {
    const xff = { "X-Forwarded-For": nextIp() };

    // Registo, verificação, registo repetido (resposta neutra) e login com palavra-passe errada.
    await request(h.app).post(api("/auth/register")).set(xff).send({ email: EMAIL, password: SENHA, termsVersion: "1.0" }).expect(202);
    const codigoVerificacao = h.lastCode(EMAIL);
    canarios.push({ rotulo: "código de verificação", valor: codigoVerificacao, fronteira: true });
    await request(h.app).post(api("/auth/verify-email")).set({ "X-Forwarded-For": nextIp() }).send({ email: EMAIL, token: codigoVerificacao }).expect(204);
    await request(h.app).post(api("/auth/register")).set({ "X-Forwarded-For": nextIp() }).send({ email: EMAIL, password: SENHA, termsVersion: "1.0" }).expect(202);
    const falhou = await request(h.app).post(api("/auth/login")).set({ "X-Forwarded-For": nextIp() }).send({ email: EMAIL, password: SENHA_ERRADA }).expect(401);
    expect(falhou.body.code).toBe("AUTH_INVALID_CREDENTIALS");

    // Login, perfil, 422 (campo desconhecido com canário no corpo) e especialidade ligada pelo profissional.
    const entrou = await h.login(EMAIL, SENHA);
    const pid = entrou.professionalId;
    let token = entrou.token;
    canarios.push({ rotulo: "JWT de acesso (login)", valor: token, fronteira: false });
    canarios.push({ rotulo: "refresh token (login)", valor: entrou.refreshCookie.split("=")[1] ?? "", fronteira: false });

    await request(h.app).get(api("/me")).set(bearer(token)).expect(200);
    await request(h.app).patch(api("/me")).set(bearer(token)).send({ displayName: NOME, bio: BIO, city: CIDADE, paymentInstructions: PAGAMENTO }).expect(200);
    const invalido = await request(h.app).patch(api("/me")).set(bearer(token)).send({ bio: BIO, campoDesconhecido: NOTA }).expect(422);
    expect(invalido.body.code).toBe("VALIDATION_ERROR");

    const adminToken = await h.adminToken();
    canarios.push({ rotulo: "JWT de Platform Admin", valor: adminToken, fronteira: false });
    const especialidade = await request(h.app).post(adminApi("specialties")).set(bearer(adminToken)).send({ name: "Fisioterapia Canario", category: "HEALTH" }).expect(201);
    await request(h.app).put(api("/me/specialties")).set(bearer(token)).send({ specialtyIds: [especialidade.body.id] }).expect(200);

    // Credenciais (identidade e cédula), antivírus, listagem e download próprio.
    for (const kind of ["IDENTITY", "PROFESSIONAL_LICENSE"]) {
      await request(h.app).post(api("/credentials")).set(bearer(token)).field("kind", kind).field("number", NUMERO).field("issuingBody", ORGAO).attach("file", pdf(), { filename: FICHEIRO, contentType: "application/pdf" }).expect(201);
    }
    await h.runScans();
    const credenciais = await request(h.app).get(api("/credentials")).set(bearer(token)).expect(200);
    const identidade = (credenciais.body as { id: string; kind: string }[]).find((c) => c.kind === "IDENTITY")?.id ?? "";
    await request(h.app).get(api(`/credentials/${identidade}/file`)).set(bearer(token)).expect(200);

    // Oferta com nota e preço, regra de horário e bloqueio com motivo.
    const oferta = await request(h.app).post(api("/offers")).set(bearer(token)).send({ specialtyId: especialidade.body.id, method: "VIDEO", durationMinutes: 30, priceKz: PRECO, note: NOTA }).expect(201);
    await request(h.app).post(api("/schedule-rules")).set(bearer(token)).send({ offerId: oferta.body.id, weekdays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "12:00" }).expect(201);
    await request(h.app).post(api("/time-off")).set(bearer(token)).send({ startsAt: "2026-12-20T08:00:00.000Z", endsAt: "2026-12-20T18:00:00.000Z", reason: BLOQUEIO }).expect(201);

    // Submissão; durante a revisão, `displayName` está bloqueado (authorization.md §10.2: 409 PROFESSIONAL_LOCKED, auditado como ACCESS_DENIED).
    // `city` continua editável em PENDING_REVIEW (matriz §10.2), por isso não serve para este pedido.
    const submetido = await request(h.app).post(api("/submission")).set(bearer(token)).expect(200);
    expect(submetido.body.validationStatus).toBe("PENDING_REVIEW");
    const bloqueado = await request(h.app).patch(api("/me")).set(bearer(token)).send({ displayName: NOME }).expect(409);
    expect(bloqueado.body.code).toBe("PROFESSIONAL_LOCKED");

    // Admin: lista, detalhe, download da credencial, pedido de informação com motivo.
    await request(h.app).get(adminApi("professionals?status=PENDING_REVIEW")).set(bearer(adminToken)).expect(200);
    await request(h.app).get(adminApi(`professionals/${pid}`)).set(bearer(adminToken)).expect(200);
    await request(h.app).get(adminApi(`professionals/${pid}/credentials/${identidade}/file`)).set(bearer(adminToken)).expect(200);
    await request(h.app).post(adminApi(`professionals/${pid}/decisions`)).set(bearer(adminToken)).send({ decision: "REQUEST_INFO", reason: MOTIVO }).expect(200);

    // Em NEEDS_INFO: 404 sem enumeração para oferta inexistente; reedição, nova submissão e aprovação.
    await request(h.app).patch(api(`/offers/${randomUUID()}`)).set(bearer(token)).send({ priceKz: 1 }).expect(404).expect((res) => {
      expect(res.body.code).toBe("NOT_FOUND");
    });
    await request(h.app).patch(api("/me")).set(bearer(token)).send({ city: CIDADE }).expect(200);
    await request(h.app).post(api("/submission")).set(bearer(token)).expect(200);
    await request(h.app).post(adminApi(`professionals/${pid}/decisions`)).set(bearer(adminToken)).send({ decision: "APPROVE" }).expect(200);

    // Jobs de manutenção (SYSTEM) e download próprio após aprovação.
    await h.jobs.generateSlots();
    await h.jobs.expireCredentials();
    await request(h.app).get(api(`/credentials/${identidade}/file`)).set(bearer(token)).expect(200);

    // 401: sem token (e a rota protegida não aceita a sessão de ninguém).
    await request(h.app).get(api("/me")).set(xff).expect(401);

    // Recuperação de palavra-passe, login com a nova, refresh rotativo, download e logout.
    await request(h.app).post(api("/auth/password/forgot")).set({ "X-Forwarded-For": nextIp() }).send({ email: EMAIL }).expect(202);
    const codigoRecuperacao = h.lastCode(EMAIL);
    canarios.push({ rotulo: "código de recuperação", valor: codigoRecuperacao, fronteira: true });
    await request(h.app).post(api("/auth/password/reset")).set({ "X-Forwarded-For": nextIp() }).send({ email: EMAIL, token: codigoRecuperacao, newPassword: SENHA_NOVA }).expect(204);
    const entrou2 = await h.login(EMAIL, SENHA_NOVA);
    // O refresh exige `X-Requested-With: vita` (mitigação CSRF, authentication.md §5; openapi `refreshToken`).
    const renovado = await request(h.app).post(api("/auth/refresh")).set({ "X-Forwarded-For": nextIp(), "X-Requested-With": "vita" }).set("Cookie", entrou2.refreshCookie).expect(200);
    token = renovado.body.accessToken as string;
    canarios.push({ rotulo: "JWT de acesso (refresh)", valor: token, fronteira: false });
    canarios.push({ rotulo: "refresh token (login 2)", valor: entrou2.refreshCookie.split("=")[1] ?? "", fronteira: false });
    const cookieRotacionado = (renovado.headers["set-cookie"] as unknown as string[] | undefined)?.find((c) => c.startsWith("professional_refresh_token=")) ?? "";
    canarios.push({ rotulo: "refresh token (rotação)", valor: cookieRotacionado.split(";")[0]?.split("=")[1] ?? "", fronteira: false });
    await request(h.app).get(api(`/credentials/${identidade}/file`)).set(bearer(token)).expect(200);
    await request(h.app).post(api("/auth/logout")).set(bearer(token)).expect(204);

    // Falha do SMTP num registo: o envio é «best effort» e o aviso técnico tem de aparecer nos logs (prova de que a captura funciona).
    const falhaSmtp = vi.spyOn(h.mailer, "send").mockRejectedValueOnce(new Error("smtp indisponivel"));
    await request(h.app).post(api("/auth/register")).set({ "X-Forwarded-For": nextIp() }).send({ email: "falha-smtp@exemplo.ao", password: SENHA, termsVersion: "1.0" }).expect(202);
    expect(falhaSmtp).toHaveBeenCalledTimes(1);
    falhaSmtp.mockRestore();
  }, 120_000);

  it("(1) nenhum canário em audit_logs (SELECT * serializado; só as colunas de ids ficam de fora)", async () => {
    const { rows } = await h.pool.query<Record<string, unknown>>("SELECT * FROM audit_logs ORDER BY id");
    expect(rows.length).toBeGreaterThanOrEqual(ACOES_ESPERADAS.length);
    const fugas: string[] = [];
    for (const row of rows) {
      const visivel = Object.fromEntries(Object.entries(row).filter(([coluna]) => !/(^id$|_id$)/.test(coluna)));
      const texto = JSON.stringify(visivel);
      for (const c of canarios) {
        if (ocorre(texto, c)) fugas.push(`audit_logs.id=${String(row.id)} (${String(row.action)}): ${c.rotulo}`);
      }
    }
    expect(fugas).toEqual([]);
  });

  it("(1b) ações de audit.md (MK1) existem com o actor_type certo; família e membro NULL; escritas com requestId não vazio", async () => {
    const { rows } = await h.pool.query<{ action: string; actor_type: string; result: string; family_id: unknown; subject_member_id: unknown; request_id: string; resource_id: unknown }>(
      "SELECT action, actor_type, result, family_id, subject_member_id, request_id, resource_id FROM audit_logs",
    );
    for (const [acao, ator] of ACOES_ESPERADAS) {
      expect(
        rows.some((r) => r.action === acao && r.actor_type === ator),
        `falta ${acao} com actor_type ${ator}`,
      ).toBe(true);
    }
    expect(rows.find((r) => r.action === "ACCESS_DENIED")?.result).toBe("DENIED");
    expect(rows.every((r) => r.family_id === null && r.subject_member_id === null)).toBe(true);
    expect(rows.every((r) => typeof r.request_id === "string" && r.request_id.length > 0)).toBe(true);
    // Download de credencial pelo admin: `resourceId` = a credencial (obrigatória, audit.md §3).
    expect(rows.find((r) => r.action === "ADMIN_PROFESSIONAL_CREDENTIAL_DOWNLOAD")?.resource_id).not.toBeNull();
  });

  it("(2) nenhum canário nos logs técnicos capturados (a captura não está vazia: há o aviso real de SMTP)", () => {
    expect(LOGS.some((linha) => linha.includes('"professional_mailer_send_failed"'))).toBe(true);
    const texto = LOGS.join("\n");
    const fugas = canarios.filter((c) => ocorre(texto, c)).map((c) => `logs técnicos: ${c.rotulo}`);
    expect(fugas).toEqual([]);
  });

  it("(3) e-mails: só o código aparece (esperado); a palavra-passe e os tokens nunca", () => {
    const textos = h.mailer.sent.map((e) => `${e.subject}\n${e.text}`);
    // Dois e-mails reais: o de verificação e o de recuperação (o registo com SMTP falhado não envia; o repetido não envia).
    expect(textos.length).toBe(2);
    // Os códigos de verificação e de recuperação saem por e-mail (é o que se espera).
    for (const c of canarios.filter((x) => x.rotulo.startsWith("código"))) {
      expect(textos.some((t) => ocorre(t, c)), `${c.rotulo} deveria estar num e-mail`).toBe(true);
    }
    const fugas: string[] = [];
    textos.forEach((texto, i) => {
      for (const c of SECRETOS_FORA_DE_EMAILS()) {
        if (ocorre(texto, c)) fugas.push(`e-mail #${String(i + 1)}: ${c.rotulo}`);
      }
    });
    expect(fugas).toEqual([]);
  });
});
