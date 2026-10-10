// Adaptador Web Push (VAPID, `web-push`) da porta `PushSender` (application/ports.ts).
// `infrastructure.md`: "os pedidos passam por serviços dos fabricantes de browsers... por isso o
// payload é genérico, sem dados de saúde (N8)" — o texto genérico é responsabilidade de quem
// chama (`application/send-job.ts`), não deste adaptador.
import webpush from "web-push";
import type { PushSendResult, PushSender } from "../application/ports.js";

export interface WebPushSenderOptions {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export class WebPushSender implements PushSender {
  constructor(options: WebPushSenderOptions) {
    webpush.setVapidDetails(options.subject, options.publicKey, options.privateKey);
  }

  async send(subscription: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<PushSendResult> {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
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
