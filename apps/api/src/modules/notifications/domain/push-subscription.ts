// Entidade pura `PushSubscription` (entities.md; schema.md §1; UC-ALR-06). Sem I/O.

export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  lastSuccessAt?: Date;
  createdAt: Date;
}

export interface NewPushSubscriptionInput {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}
