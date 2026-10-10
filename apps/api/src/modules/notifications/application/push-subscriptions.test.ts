// UC-ALR-06: registar/revogar subscrição Web Push.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { NotFoundError } from "../../../platform/errors/index.js";
import { createAddPushSubscriptionUseCase } from "./add-push-subscription.js";
import { createDeletePushSubscriptionUseCase } from "./delete-push-subscription.js";
import { createNotificationsFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-10T08:00:00Z");

describe("addPushSubscription", () => {
  it("regista uma subscrição nova", async () => {
    const fx = createNotificationsFixtures(new FixedClock(NOW));
    const addPushSubscription = createAddPushSubscriptionUseCase(fx.deps);
    const sub = await addPushSubscription({ userId: "user-1", endpoint: "https://push/1", p256dh: "k", auth: "a" });
    expect(sub.endpoint).toBe("https://push/1");
    expect(fx.pushSubscriptionsRepo.byId.size).toBe(1);
  });

  it("endpoint repetido atualiza a existente em vez de duplicar", async () => {
    const fx = createNotificationsFixtures(new FixedClock(NOW));
    const addPushSubscription = createAddPushSubscriptionUseCase(fx.deps);
    await addPushSubscription({ userId: "user-1", endpoint: "https://push/1", p256dh: "k1", auth: "a" });
    const second = await addPushSubscription({ userId: "user-1", endpoint: "https://push/1", p256dh: "k2", auth: "a" });
    expect(fx.pushSubscriptionsRepo.byId.size).toBe(1);
    expect(second.p256dh).toBe("k2");
  });
});

describe("deletePushSubscription", () => {
  it("remove a subscrição do próprio utilizador", async () => {
    const fx = createNotificationsFixtures(new FixedClock(NOW));
    fx.pushSubscriptionsRepo.seed({ id: "sub-1", userId: "user-1", endpoint: "https://push/1", p256dh: "k", auth: "a", createdAt: NOW });
    const deletePushSubscription = createDeletePushSubscriptionUseCase(fx.deps);
    await deletePushSubscription("user-1", "sub-1");
    expect(fx.pushSubscriptionsRepo.byId.has("sub-1")).toBe(false);
  });

  it("NOT_FOUND se não é do utilizador", async () => {
    const fx = createNotificationsFixtures(new FixedClock(NOW));
    fx.pushSubscriptionsRepo.seed({ id: "sub-1", userId: "other-user", endpoint: "https://push/1", p256dh: "k", auth: "a", createdAt: NOW });
    const deletePushSubscription = createDeletePushSubscriptionUseCase(fx.deps);
    await expect(deletePushSubscription("user-1", "sub-1")).rejects.toBeInstanceOf(NotFoundError);
  });
});
