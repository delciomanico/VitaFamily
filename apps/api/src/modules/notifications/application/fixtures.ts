// Fakes em memória das portas de `notifications` (mesmo padrão de `medications`/`appointments`
// `application/fixtures.ts`). Não é ficheiro de teste.
import type { AlertNotificationType, Channel, NotificationPreference } from "../domain/preference.js";
import { defaultPreference } from "../domain/preference.js";
import type { NewPushSubscriptionInput, PushSubscription } from "../domain/push-subscription.js";
import type { Notification, NotificationStatus } from "../domain/notification.js";
import type {
  Mailer,
  NewNotificationRecord,
  NotificationsDeps,
  NotificationsRepository,
  PreferencesRepository,
  PushSender,
  PushSendResult,
  PushSubscriptionsRepository,
  UsersPort,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
export const FAKE_TRX: FakeTrx = {};

export class FakePreferencesRepository implements PreferencesRepository<FakeTrx> {
  readonly byUserId = new Map<string, NotificationPreference>();

  async findByUserId(_trx: FakeTrx, userId: string): Promise<NotificationPreference | null> {
    return Promise.resolve(this.byUserId.get(userId) ?? null);
  }

  async upsert(_trx: FakeTrx, preference: NotificationPreference): Promise<NotificationPreference> {
    this.byUserId.set(preference.userId, preference);
    return Promise.resolve(preference);
  }

  seed(preference: NotificationPreference): void {
    this.byUserId.set(preference.userId, preference);
  }
}

export class FakePushSubscriptionsRepository implements PushSubscriptionsRepository<FakeTrx> {
  readonly byId = new Map<string, PushSubscription>();
  private seq = 0;

  async listByUserId(_trx: FakeTrx, userId: string): Promise<PushSubscription[]> {
    return Promise.resolve([...this.byId.values()].filter((s) => s.userId === userId));
  }

  async findByEndpoint(_trx: FakeTrx, endpoint: string): Promise<PushSubscription | null> {
    return Promise.resolve([...this.byId.values()].find((s) => s.endpoint === endpoint) ?? null);
  }

  async upsert(_trx: FakeTrx, input: NewPushSubscriptionInput, id: string, createdAt: Date): Promise<PushSubscription> {
    const existing = [...this.byId.values()].find((s) => s.endpoint === input.endpoint);
    const subscription: PushSubscription = {
      id: existing?.id ?? id,
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      createdAt: existing?.createdAt ?? createdAt,
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    };
    this.byId.set(subscription.id, subscription);
    return Promise.resolve(subscription);
  }

  async delete(_trx: FakeTrx, userId: string, id: string): Promise<void> {
    const subscription = this.byId.get(id);
    if (subscription?.userId === userId) {
      this.byId.delete(id);
    }
    return Promise.resolve();
  }

  async markSuccess(_trx: FakeTrx, id: string, at: Date): Promise<void> {
    const subscription = this.byId.get(id);
    if (subscription) {
      this.byId.set(id, { ...subscription, lastSuccessAt: at });
    }
    return Promise.resolve();
  }

  async deleteByEndpoint(_trx: FakeTrx, endpoint: string): Promise<void> {
    for (const [id, subscription] of this.byId) {
      if (subscription.endpoint === endpoint) {
        this.byId.delete(id);
      }
    }
    return Promise.resolve();
  }

  seed(subscription: PushSubscription): void {
    this.byId.set(subscription.id, subscription);
  }

  nextId(): string {
    this.seq += 1;
    return `fake-push-sub-${String(this.seq)}`;
  }
}

export class FakeNotificationsRepository implements NotificationsRepository<FakeTrx> {
  readonly byId = new Map<string, Notification>();

  async insertIfNew(_trx: FakeTrx, record: NewNotificationRecord): Promise<Notification | null> {
    const exists = [...this.byId.values()].some((n) => n.alertId === record.alertId && n.channel === record.channel);
    if (exists) {
      return Promise.resolve(null);
    }
    const notification: Notification = {
      id: record.id,
      alertId: record.alertId,
      recipientUserId: record.recipientUserId,
      channel: record.channel,
      status: "PENDING",
      attempts: 0,
      createdAt: record.createdAt,
    };
    this.byId.set(notification.id, notification);
    return Promise.resolve(notification);
  }

  async listDueForSending(_trx: FakeTrx, now: Date, limit: number): Promise<Notification[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter((n) => n.status === "PENDING" || (n.status === "FAILED" && n.nextAttemptAt !== undefined && n.nextAttemptAt.getTime() <= now.getTime()))
        .slice(0, limit),
    );
  }

  async markSent(_trx: FakeTrx, id: string, sentAt: Date): Promise<void> {
    const n = this.require(id);
    const updated: Notification = { ...n, status: "SENT", sentAt };
    delete updated.nextAttemptAt;
    this.byId.set(id, updated);
    return Promise.resolve();
  }

  async markSkipped(_trx: FakeTrx, id: string, reasonCode: string): Promise<void> {
    const n = this.require(id);
    this.byId.set(id, { ...n, status: "SKIPPED", lastErrorCode: reasonCode });
    return Promise.resolve();
  }

  async markRetry(_trx: FakeTrx, id: string, attempts: number, nextAttemptAt: Date, errorCode: string): Promise<void> {
    const n = this.require(id);
    this.byId.set(id, { ...n, status: "FAILED", attempts, nextAttemptAt, lastErrorCode: errorCode });
    return Promise.resolve();
  }

  async markFailedTerminal(_trx: FakeTrx, id: string, attempts: number, errorCode: string): Promise<void> {
    const n = this.require(id);
    const updated: Notification = { ...n, status: "FAILED", attempts, lastErrorCode: errorCode };
    delete updated.nextAttemptAt;
    this.byId.set(id, updated);
    return Promise.resolve();
  }

  async skipPendingByAlertId(_trx: FakeTrx, alertId: string): Promise<void> {
    for (const [id, n] of this.byId) {
      if (n.alertId === alertId && (n.status === "PENDING" || n.status === "FAILED")) {
        this.byId.set(id, { ...n, status: "SKIPPED", lastErrorCode: "ALERT_READ" });
      }
    }
    return Promise.resolve();
  }

  countByStatus(_trx: FakeTrx, status: NotificationStatus): Promise<number> {
    return Promise.resolve([...this.byId.values()].filter((n) => n.status === status).length);
  }

  private require(id: string): Notification {
    const n = this.byId.get(id);
    if (!n) {
      throw new Error("notificação inexistente no fake");
    }
    return n;
  }
}

export class FakeUsersPort implements UsersPort<FakeTrx> {
  readonly byId_ = new Map<string, { id: string; status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED"; email: string; name: string }>();

  async byId(_trx: FakeTrx, id: string) {
    return Promise.resolve(this.byId_.get(id) ?? null);
  }

  seed(user: { id: string; status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED"; email: string; name: string }): void {
    this.byId_.set(user.id, user);
  }
}

export class FakeMailer implements Mailer {
  readonly sent: { to: string; subject: string; body: string }[] = [];
  shouldFail = false;

  async send(to: string, subject: string, body: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error("falha simulada de envio de e-mail");
    }
    this.sent.push({ to, subject, body });
    return Promise.resolve();
  }
}

export class FakePushSender implements PushSender {
  readonly sent: { endpoint: string; payload: string }[] = [];
  nextResult: PushSendResult = { delivered: true };

  async send(subscription: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<PushSendResult> {
    this.sent.push({ endpoint: subscription.endpoint, payload });
    return Promise.resolve(this.nextResult);
  }
}

export interface NotificationsFixtures {
  deps: NotificationsDeps<FakeTrx>;
  preferencesRepo: FakePreferencesRepository;
  pushSubscriptionsRepo: FakePushSubscriptionsRepository;
  notificationsRepo: FakeNotificationsRepository;
  users: FakeUsersPort;
  mailer: FakeMailer;
  pushSender: FakePushSender;
}

export function createNotificationsFixtures(clock: { now(): Date }): NotificationsFixtures {
  const preferencesRepo = new FakePreferencesRepository();
  const pushSubscriptionsRepo = new FakePushSubscriptionsRepository();
  const notificationsRepo = new FakeNotificationsRepository();
  const users = new FakeUsersPort();
  const mailer = new FakeMailer();
  const pushSender = new FakePushSender();
  const deps: NotificationsDeps<FakeTrx> = {
    preferencesRepo,
    pushSubscriptionsRepo,
    notificationsRepo,
    users,
    mailer,
    pushSender,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, preferencesRepo, pushSubscriptionsRepo, notificationsRepo, users, mailer, pushSender };
}

export { defaultPreference };
export type { AlertNotificationType, Channel };
