/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-non-null-assertion -- respostas HTTP/linhas SQL de teste sem tipagem (supertest devolve `any`). */
// Integração (PostgreSQL real + API real validada contra o openapi.yaml, pedidos E respostas) da identidade do profissional (MK1 S3):
// TC-MKT-01..04, TC-AZ-MKT-01/06, AC-MKT-01. Tokens cruzados, sessões rotativas, anti-enumeração, rate limit, auditoria sem PII.
import { SignJWT } from "jose";
import request from "supertest";
import { signProfessionalAccessToken } from "../../src/modules/professionals/domain/jwt.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROFESSIONAL_API, SIGNING_KEYS, STRONG_PASSWORD, startProfessionalsHarness, uniqueEmail, type ProfessionalsHarness } from "../support/professionals-harness.js";

const AUTH = `${PROFESSIONAL_API}/auth`;
const REFRESH_PATH = `/api/v1/professional-portal/auth`;

describe("integração: identidade do profissional (MK1 S3)", () => {
  let h: ProfessionalsHarness;
  beforeAll(async () => {
    h = await startProfessionalsHarness();
  });
  afterAll(async () => {
    await h.stop();
  });

  const post = (path: string, body: unknown, ip = "10.0.0.1") => request(h.app).post(`${AUTH}${path}`).set("X-Forwarded-For", ip).send(body as object);

  describe("registo e verificação (TC-MKT-01)", () => {
    it("regista: 202 neutro, cria conta PENDING_VERIFICATION + Professional DRAFT, e-mail com código e auditoria sem PII", async () => {
      const email = uniqueEmail();
      const res = await post("/register", { email, password: STRONG_PASSWORD, termsVersion: "1.0" }, "10.0.1.1").expect(202);
      expect(res.body).toEqual({ message: expect.any(String) });
      const { rows } = await h.pool.query("SELECT a.status, a.password_hash, p.validation_status FROM professional_accounts a JOIN professionals p ON p.account_id = a.id WHERE a.email = $1", [email]);
      expect(rows[0]).toMatchObject({ status: "PENDING_VERIFICATION", validation_status: "DRAFT" });
      expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
      expect(h.lastCode(email)).toMatch(/^\d{6}$/);
      const audit = await h.pool.query("SELECT actor_type, action, result, metadata, request_id FROM audit_logs WHERE action = 'PROFESSIONAL_REGISTER' ORDER BY id DESC LIMIT 1");
      expect(audit.rows[0]).toMatchObject({ actor_type: "PROFESSIONAL_ACCOUNT", action: "PROFESSIONAL_REGISTER", result: "SUCCESS" });
      expect(JSON.stringify(audit.rows[0])).not.toContain(email);
    });

    it("e-mail já registado: MESMA resposta 202, nada novo criado, nenhum e-mail enviado, FAILURE interno auditado", async () => {
      const { email } = await h.registerVerified();
      const before = h.mailer.sent.length;
      const res = await post("/register", { email: email.toUpperCase(), password: STRONG_PASSWORD, termsVersion: "1.0" }, "10.0.1.2").expect(202);
      expect(res.body).toEqual({ message: expect.any(String) });
      expect(h.mailer.sent.length).toBe(before);
      const count = await h.pool.query("SELECT count(*)::int AS n FROM professional_accounts WHERE email = $1", [email]);
      expect(count.rows[0].n).toBe(1);
      const audit = await h.pool.query("SELECT result FROM audit_logs WHERE action = 'PROFESSIONAL_REGISTER' ORDER BY id DESC LIMIT 1");
      expect(audit.rows[0].result).toBe("FAILURE");
    });

    it("palavra-passe fraca ⇒ 422 PASSWORD_WEAK; contrato recusa campos extra e e-mail inválido", async () => {
      expect((await post("/register", { email: uniqueEmail(), password: "curta", termsVersion: "1.0" }, "10.0.1.3").expect(422)).body.code).toBe("PASSWORD_WEAK");
      expect((await post("/register", { email: uniqueEmail(), password: "password1234", termsVersion: "1.0" }, "10.0.1.3").expect(422)).body.code).toBe("PASSWORD_WEAK");
      await post("/register", { email: uniqueEmail(), password: STRONG_PASSWORD, termsVersion: "1.0", role: "ADMIN" }, "10.0.1.3").expect(422);
      await post("/register", { email: "nao-e-email", password: STRONG_PASSWORD, termsVersion: "1.0" }, "10.0.1.3").expect(422);
    });

    it("código errado, expirado ou já usado ⇒ 404 genérico; o certo ativa a conta uma só vez", async () => {
      const email = uniqueEmail();
      await post("/register", { email, password: STRONG_PASSWORD, termsVersion: "1.0" }, "10.0.2.1").expect(202);
      const code = h.lastCode(email);
      const wrong = code === "000000" ? "000001" : "000000";
      expect((await post("/verify-email", { email, token: wrong }, "10.0.2.1").expect(404)).body.code).toBe("NOT_FOUND");
      await post("/verify-email", { email: uniqueEmail(), token: code }, "10.0.2.1").expect(404); // outro e-mail (inexistente): mesmo erro
      await post("/verify-email", { email, token: code }, "10.0.2.1").expect(204);
      await post("/verify-email", { email, token: code }, "10.0.2.1").expect(404); // uso único
      const { rows } = await h.pool.query("SELECT status, email_verified_at FROM professional_accounts WHERE email = $1", [email]);
      expect(rows[0].status).toBe("ACTIVE");
      expect(rows[0].email_verified_at).not.toBeNull();

      const expired = uniqueEmail();
      await post("/register", { email: expired, password: STRONG_PASSWORD, termsVersion: "1.0" }, "10.0.2.2").expect(202);
      const expiredCode = h.lastCode(expired);
      h.clock.advance(25 * 3600 * 1000);
      await post("/verify-email", { email: expired, token: expiredCode }, "10.0.2.2").expect(404);
      h.clock.advance(-25 * 3600 * 1000);
    });

    it("força bruta do código: depois de 5 tentativas por e-mail ⇒ 429 (mesmo com o código certo)", async () => {
      const email = uniqueEmail();
      await post("/register", { email, password: STRONG_PASSWORD, termsVersion: "1.0" }, "10.0.3.1").expect(202);
      const code = h.lastCode(email);
      const wrong = code === "123456" ? "654321" : "123456";
      for (let i = 0; i < 5; i += 1) await post("/verify-email", { email, token: wrong }, `10.0.3.${String(10 + i)}`).expect(404);
      const res = await post("/verify-email", { email, token: code }, "10.0.3.99").expect(429);
      expect(res.headers["retry-after"]).toBeDefined();
    });

    it("reenvio: neutro para existentes e inexistentes, invalida o código anterior; 3/h por e-mail", async () => {
      const email = uniqueEmail();
      await post("/register", { email, password: STRONG_PASSWORD, termsVersion: "1.0" }, "10.0.4.1").expect(202);
      const first = h.lastCode(email);
      await post("/resend-verification", { email }, "10.0.4.1").expect(202);
      const second = h.lastCode(email);
      await post("/resend-verification", { email: uniqueEmail() }, "10.0.4.1").expect(202); // inexistente: igual
      if (first !== second) await post("/verify-email", { email, token: first }, "10.0.4.2").expect(404);
      await post("/resend-verification", { email }, "10.0.4.1").expect(202);
      await post("/resend-verification", { email }, "10.0.4.1").expect(202);
      await post("/resend-verification", { email }, "10.0.4.1").expect(429);
    });
  });

  describe("login, refresh e logout (TC-MKT-02)", () => {
    it("login com e-mail por verificar ⇒ EMAIL_NOT_VERIFIED só depois da palavra-passe certa; errada ⇒ credenciais inválidas", async () => {
      const email = uniqueEmail();
      await post("/register", { email, password: STRONG_PASSWORD, termsVersion: "1.0" }, "10.0.5.1").expect(202);
      expect((await post("/login", { email, password: "errada-errada-123" }, "10.0.5.2").expect(401)).body.code).toBe("AUTH_INVALID_CREDENTIALS");
      expect((await post("/login", { email, password: STRONG_PASSWORD }, "10.0.5.2").expect(403)).body.code).toBe("EMAIL_NOT_VERIFIED");
    });

    it("sem enumeração: e-mail inexistente e palavra-passe errada dão exatamente a mesma resposta", async () => {
      const { email } = await h.registerVerified();
      const wrong = await post("/login", { email, password: "errada-errada-123" }, "10.0.6.1").expect(401);
      const ghost = await post("/login", { email: uniqueEmail("fantasma"), password: "errada-errada-123" }, "10.0.6.1").expect(401);
      const strip = (b: Record<string, unknown>) => ({ ...b, requestId: undefined });
      expect(strip(ghost.body as Record<string, unknown>)).toEqual(strip(wrong.body as Record<string, unknown>));
    });

    it("login ok: token + cookie HttpOnly/Strict com Path do portal; último login e auditoria; sem Cache", async () => {
      const { email } = await h.registerVerified();
      const res = await post("/login", { email, password: STRONG_PASSWORD }, "10.0.7.1").expect(200);
      expect(res.body).toMatchObject({ accessToken: expect.any(String), expiresIn: 900, validationStatus: "DRAFT", professionalId: expect.any(String) });
      expect(res.headers["cache-control"]).toContain("no-store");
      const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("professional_refresh_token="));
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toContain(`Path=${REFRESH_PATH}`);
      expect((res.headers["set-cookie"] as unknown as string[]).some((c) => c.startsWith("refresh_token=") || c.startsWith("clinic_refresh_token="))).toBe(false);
      const row = await h.pool.query("SELECT last_login_at FROM professional_accounts WHERE email = $1", [email]);
      expect(row.rows[0].last_login_at).not.toBeNull();
    });

    it("5 falhas por (e-mail+IP) ⇒ 429, e a palavra-passe certa deixa de entrar enquanto bloqueado (falha fechada)", async () => {
      const { email } = await h.registerVerified();
      for (let i = 0; i < 5; i += 1) await post("/login", { email, password: "errada-errada-123" }, "10.0.8.1").expect(401);
      await post("/login", { email, password: STRONG_PASSWORD }, "10.0.8.1").expect(429);
      await post("/login", { email, password: STRONG_PASSWORD }, "10.0.8.2").expect(200); // outro IP: não está bloqueado
    });

    it("refresh: exige o cookie e X-Requested-With: vita; roda o token; reutilização revoga a cadeia inteira e audita", async () => {
      const { email } = await h.registerVerified();
      const { refreshCookie } = await h.login(email);
      await request(h.app).post(`${AUTH}/refresh`).expect(401); // sem cookie
      await request(h.app).post(`${AUTH}/refresh`).set("Cookie", refreshCookie).expect(401); // sem cabeçalho CSRF
      const r1 = await request(h.app).post(`${AUTH}/refresh`).set("Cookie", refreshCookie).set("X-Requested-With", "vita").expect(200);
      expect(r1.body.accessToken).toEqual(expect.any(String));
      const newCookie = ((r1.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("professional_refresh_token=")) ?? "").split(";")[0] ?? "";
      expect(newCookie).not.toBe(refreshCookie);
      // reutilização do antigo: 401 + cadeia revogada (o novo também deixa de servir)
      await request(h.app).post(`${AUTH}/refresh`).set("Cookie", refreshCookie).set("X-Requested-With", "vita").expect(401);
      await request(h.app).post(`${AUTH}/refresh`).set("Cookie", newCookie).set("X-Requested-With", "vita").expect(401);
      const audit = await h.pool.query("SELECT 1 FROM audit_logs WHERE action = 'PROFESSIONAL_REFRESH_REUSE_DETECTED' AND result = 'FAILURE'");
      expect(audit.rowCount).toBeGreaterThan(0);
    });

    it("dois refresh concorrentes com o mesmo token: só um roda; o outro conta como reutilização e revoga a cadeia", async () => {
      const { email } = await h.registerVerified();
      const { refreshCookie } = await h.login(email);
      const call = () => request(h.app).post(`${AUTH}/refresh`).set("Cookie", refreshCookie).set("X-Requested-With", "vita");
      const results = await Promise.all([call(), call()]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((x) => x === 200).length).toBeLessThanOrEqual(1);
      expect(statuses).toContain(401);
    });

    it("refresh expirado (30 dias) ⇒ 401", async () => {
      const { email } = await h.registerVerified();
      const { refreshCookie } = await h.login(email);
      h.clock.advance(31 * 24 * 3600 * 1000);
      await request(h.app).post(`${AUTH}/refresh`).set("Cookie", refreshCookie).set("X-Requested-With", "vita").expect(401);
      h.clock.advance(-31 * 24 * 3600 * 1000);
    });

    it("logout revoga a sessão (o refresh deixa de servir), limpa o cookie e audita; sem token ⇒ 401", async () => {
      const { email } = await h.registerVerified();
      const { token, refreshCookie } = await h.login(email);
      await request(h.app).post(`${AUTH}/logout`).expect(401);
      const res = await request(h.app).post(`${AUTH}/logout`).set("Authorization", `Bearer ${token}`).expect(204);
      expect((res.headers["set-cookie"] as unknown as string[]).join(";")).toContain("professional_refresh_token=;");
      await request(h.app).post(`${AUTH}/refresh`).set("Cookie", refreshCookie).set("X-Requested-With", "vita").expect(401);
      const audit = await h.pool.query("SELECT 1 FROM audit_logs WHERE action = 'PROFESSIONAL_LOGOUT'");
      expect(audit.rowCount).toBeGreaterThan(0);
    });

    it("token expirado ⇒ 401", async () => {
      const { token } = await h.newProfessional();
      h.clock.advance(16 * 60 * 1000);
      await request(h.app).post(`${AUTH}/logout`).set("Authorization", `Bearer ${token}`).expect(401);
      h.clock.advance(-16 * 60 * 1000);
    });
  });

  describe("recuperação de palavra-passe (TC-MKT-03)", () => {
    it("forgot é neutro; reset com o código muda a palavra-passe, revoga TODAS as sessões e o código é de uso único", async () => {
      const { email } = await h.registerVerified();
      const s1 = await h.login(email);
      const s2 = await h.login(email);
      const ghost = await post("/password/forgot", { email: uniqueEmail("x") }, "10.0.9.1").expect(202);
      const real = await post("/password/forgot", { email }, "10.0.9.1").expect(202);
      expect(real.body).toEqual(ghost.body);
      const code = h.lastCode(email);
      await post("/password/reset", { email, token: code, newPassword: "curta" }, "10.0.9.2").expect(422);
      await post("/password/reset", { email, token: code, newPassword: "outra-palavra-forte-456" }, "10.0.9.2").expect(204);
      await post("/password/reset", { email, token: code, newPassword: "mais-outra-forte-789" }, "10.0.9.2").expect(404);
      for (const s of [s1, s2]) await request(h.app).post(`${AUTH}/refresh`).set("Cookie", s.refreshCookie).set("X-Requested-With", "vita").expect(401);
      await post("/login", { email, password: STRONG_PASSWORD }, "10.0.9.3").expect(401);
      await post("/login", { email, password: "outra-palavra-forte-456" }, "10.0.9.3").expect(200);
      const audit = await h.pool.query("SELECT metadata FROM audit_logs WHERE action = 'PROFESSIONAL_PASSWORD_RESET'");
      expect(audit.rowCount).toBe(1);
    });

    it("código de recuperação expirado (1 h) ⇒ 404", async () => {
      const { email } = await h.registerVerified();
      await post("/password/forgot", { email }, "10.0.10.1").expect(202);
      const code = h.lastCode(email);
      h.clock.advance(61 * 60 * 1000);
      await post("/password/reset", { email, token: code, newPassword: "outra-palavra-forte-456" }, "10.0.10.2").expect(404);
      h.clock.advance(-61 * 60 * 1000);
    });
  });

  describe("tokens cruzados (TC-MKT-04, TC-AZ-MKT-01/06)", () => {
    it("token de User, de clínica, sem token e lixo ⇒ 401 nas rotas do portal do profissional", async () => {
      for (const token of [await h.userToken(), await h.clinicToken(), "lixo.lixo.lixo"]) {
        await request(h.app).post(`${AUTH}/logout`).set("Authorization", `Bearer ${token}`).expect(401);
      }
    });

    it("token de profissional ⇒ 401 em rotas de User e de clínica (claims e aud distintos)", async () => {
      const { token } = await h.newProfessional();
      const bearer = { Authorization: `Bearer ${token}` };
      await request(h.app).get("/api/v1/users/me").set(bearer).expect(401);
      await request(h.app).get("/api/v1/clinic-portal/staff").set(bearer).expect(401);
      await request(h.app).get("/api/v1/admin/clinics").set(bearer).expect(401);
    });

    it("token com professionalId que não é o da conta (forjado com a chave certa) ⇒ 401; sem aud ⇒ 401", async () => {
      const a = await h.newProfessional();
      const b = await h.newProfessional();
      const forged = await signProfessionalAccessToken({
        subject: { professionalAccountId: a.accountId, professionalId: b.professionalId, sessionId: "88888888-8888-4888-8888-888888888888" },
        now: h.clock.now(),
        ttlSeconds: 900,
        signingKeys: SIGNING_KEYS,
      });
      await request(h.app).post(`${AUTH}/logout`).set("Authorization", `Bearer ${forged.token}`).expect(401);
      const noAud = await new SignJWT({ professionalAccountId: a.accountId, professionalId: a.professionalId, sid: "88888888-8888-4888-8888-888888888888" })
        .setProtectedHeader({ alg: "HS256", kid: "k1" })
        .setIssuedAt(Math.floor(h.clock.now().getTime() / 1000))
        .setExpirationTime(Math.floor(h.clock.now().getTime() / 1000) + 900)
        .sign(SIGNING_KEYS[0]!.secret);
      await request(h.app).post(`${AUTH}/logout`).set("Authorization", `Bearer ${noAud}`).expect(401);
    });
  });
});
