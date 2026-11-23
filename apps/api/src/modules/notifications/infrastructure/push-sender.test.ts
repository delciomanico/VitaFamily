// Prova do emissor Web Push contra um "serviço de push" local (servidor HTTPS com certificado de teste, só em memória/tmp):
// o pedido chega cifrado (RFC 8291) com o cabeçalho VAPID e o payload decifrado é o texto genérico (N8).
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { Agent } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import webpush from "web-push";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createEnqueueForAlertUseCase } from "../application/for-alerts.js";
import { createNotificationsFixtures, FAKE_TRX } from "../application/fixtures.js";
import { createSendJobUseCase } from "../application/send-job.js";
import { WebPushSender } from "./push-sender.js";

const b64url = (buf: Buffer) => buf.toString("base64url");

/** Decifra um corpo `aes128gcm` (RFC 8188/8291) com a chave privada do "browser". */
function decryptWebPush(body: Buffer, uaEcdh: ReturnType<typeof createECDH>, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLen);
  const ciphertext = body.subarray(21 + idLen);
  const secret = uaEcdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaEcdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", secret, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  return padded.subarray(0, padded.lastIndexOf(0x02)).toString("utf8");
}

interface Received {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

describe("WebPushSender contra um serviço de push simulado", () => {
  const dir = mkdtempSync(join(tmpdir(), "vita-push-"));
  const vapid = webpush.generateVAPIDKeys();
  const received: Received[] = [];
  let respond = (_: Received): { status: number } => ({ status: 201 });
  let server: Server;
  let origin = "";
  const agent = new Agent({ rejectUnauthorized: false });
  const browser = createECDH("prime256v1");
  browser.generateKeys();
  const authSecret = randomBytes(16);

  beforeAll(async () => {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
    server = createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const entry = { url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) };
        received.push(entry);
        res.statusCode = respond(entry).status;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `https://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  afterAll(() => {
    server.close();
    agent.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  const sender = () => new WebPushSender({ ...vapid2(), timeoutMs: 2000, agent });
  const vapid2 = () => ({ publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "mailto:ops@vitafamily.cassfrei.com" });
  const subscription = (path: string) => ({ endpoint: `${origin}${path}`, p256dh: b64url(browser.getPublicKey()), auth: b64url(authSecret) });
  const PAYLOAD = JSON.stringify({ title: "Vita Family", body: "Tem uma notificação nova. Abra a app para ver os detalhes." });

  it("entrega o payload cifrado com VAPID, TTL e urgência; decifrado é o texto genérico", async () => {
    received.length = 0;
    const result = await sender().send(subscription("/push/abc"), PAYLOAD);
    expect(result).toEqual({ delivered: true });
    const [req] = received;
    expect(req?.url).toBe("/push/abc");
    expect(String(req?.headers.authorization)).toMatch(/^vapid t=.+, k=.+$/);
    expect(req?.headers.ttl).toBe("7200");
    expect(req?.headers.urgency).toBe("high");
    expect(req?.headers["content-encoding"]).toBe("aes128gcm");
    expect(req?.body.toString("utf8")).not.toContain("Vita Family");
    const text = decryptWebPush(req?.body ?? Buffer.alloc(0), browser, authSecret);
    expect(JSON.parse(text)).toEqual({ title: "Vita Family", body: "Tem uma notificação nova. Abra a app para ver os detalhes." });
  });

  it("ponta a ponta: alerta -> notificação -> job de envio -> serviço de push; 410 remove a subscrição e agenda retry", async () => {
    received.length = 0;
    const fx = createNotificationsFixtures(new FixedClock(new Date("2026-10-10T08:00:00Z")));
    fx.users.seed({ id: "u1", status: "ACTIVE", email: "a@b.pt", name: "A" });
    fx.deps.pushSender = sender();
    fx.pushSubscriptionsRepo.seed({ id: "s-ok", userId: "u1", createdAt: new Date(), ...subscription("/push/ok") });
    fx.pushSubscriptionsRepo.seed({ id: "s-gone", userId: "u1", createdAt: new Date(), ...subscription("/push/gone") });
    respond = (r) => ({ status: r.url === "/push/gone" ? 410 : 201 });
    await createEnqueueForAlertUseCase(fx.deps)(FAKE_TRX, { alertId: "alert-1", recipientUserId: "u1" });
    const result = await createSendJobUseCase(fx.deps)();
    respond = () => ({ status: 201 });
    expect(result.sent).toBe(2); // e-mail + push (um dispositivo basta)
    expect(received.map((r) => r.url).sort()).toEqual(["/push/gone", "/push/ok"]);
    const ok = received.find((r) => r.url === "/push/ok");
    expect(JSON.parse(decryptWebPush(ok?.body ?? Buffer.alloc(0), browser, authSecret))).toEqual({ title: "Vita Family", body: expect.stringContaining("notificação nova") as string });
    expect([...fx.pushSubscriptionsRepo.byId.keys()]).toEqual(["s-ok"]);
  });

  it.each([
    [404, true, "HTTP_404"],
    [410, true, "HTTP_410"],
    [403, false, "HTTP_403"],
    [500, false, "HTTP_500"],
    [429, false, "HTTP_429"],
  ])("resposta %i do serviço de push: inválida=%s (%s)", async (status, invalid, code) => {
    respond = () => ({ status });
    const result = await sender().send(subscription("/push/x"), PAYLOAD);
    respond = () => ({ status: 201 });
    expect(result).toEqual({ delivered: false, invalidSubscription: invalid, errorCode: code });
  });

  it("serviço inacessível: falha sem lançar (o job faz retry)", async () => {
    const result = await sender().send({ ...subscription("/x"), endpoint: "https://127.0.0.1:1/x" }, PAYLOAD);
    expect(result.delivered).toBe(false);
    expect(result.invalidSubscription).toBeFalsy();
    expect(result.errorCode).toBe("PUSH_SEND_ERROR");
  });

  it("chaves VAPID inválidas: falha clara no arranque sem expor as chaves", () => {
    expect(() => new WebPushSender({ publicKey: "pub", privateKey: "SEGREDO-XYZ", subject: "mailto:a@b.pt" })).toThrow(/VAPID_PUBLIC_KEY.*inválidas.*generate-vapid-keys/);
    try {
      new WebPushSender({ publicKey: "pub", privateKey: "SEGREDO-XYZ", subject: "mailto:a@b.pt" });
    } catch (err) {
      expect((err as Error).message).not.toContain("SEGREDO-XYZ");
    }
  });
});
