// Adaptador Web Push (VAPID, `web-push`) da porta `PushSender` (application/ports.ts).
// `infrastructure.md`: "os pedidos passam por serviços dos fabricantes de browsers... por isso o
// payload é genérico, sem dados de saúde (N8)" — o texto genérico é responsabilidade de quem
// chama (`application/send-job.ts`), não deste adaptador.
import type { Agent } from "node:https";
import webpush from "web-push";
import type { PushSendResult, PushSender } from "../application/ports.js";

export interface WebPushSenderOptions {
  publicKey: string;
  privateKey: string;
  subject: string;
  /** Tempo máximo por envio: o job `notifications.send` envia dentro de uma transação; sem limite um
   * serviço de push pendurado prenderia a ligação à BD. */
  timeoutMs?: number;
  /** Só para testes (servidor HTTPS local com certificado de teste). */
  agent?: Agent;
}

const DEFAULT_TIMEOUT_MS = 10_000;
/** Os avisos (toma, consulta) deixam de fazer sentido horas depois: o serviço de push descarta-os após 2 h. */
const PUSH_TTL_SECONDS = 2 * 60 * 60;

export class WebPushSender implements PushSender {
  private readonly requestOptions: webpush.RequestOptions;

  constructor(options: WebPushSenderOptions) {
    try {
      webpush.setVapidDetails(options.subject, options.publicKey, options.privateKey);
    } catch (err) {
      // Falha clara no arranque (api/worker): nunca incluir o valor das chaves na mensagem.
      throw new Error(
        `VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT inválidas (${(err as Error).message}). Gere um par com "npx web-push generate-vapid-keys"; VAPID_SUBJECT é "mailto:..." ou "https://...".`,
      );
    }
    this.requestOptions = {
      TTL: PUSH_TTL_SECONDS,
      urgency: "high",
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(options.agent ? { agent: options.agent } : {}),
    };
  }

  async send(subscription: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<PushSendResult> {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
        this.requestOptions,
      );
      return { delivered: true };
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      // 404/410: endpoint inexistente/expirado (API Web Push) — UC-ALR-06: "regra" (remover).
      const invalidSubscription = statusCode === 404 || statusCode === 410;
      return { delivered: false, invalidSubscription, errorCode: statusCode ? `HTTP_${String(statusCode)}` : "PUSH_SEND_ERROR" };
    }
  }
}
