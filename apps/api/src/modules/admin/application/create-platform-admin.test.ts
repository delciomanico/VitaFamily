import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../../audit/index.js";
import { createCreatePlatformAdminUseCase, type CreatePlatformAdminDeps } from "./create-platform-admin.js";

type Status = "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED";
type Role = "NONE" | "PLATFORM_ADMIN";

function setup(status: Status, role: Role = "NONE") {
  const user = { id: "u1", status, platformRole: role };
  const events: AuditEvent[] = [];
  const deps: CreatePlatformAdminDeps<null> = {
    clock: { now: () => new Date("2026-10-12T10:00:00.000Z") },
    withTransaction: (fn) => fn(null),
    audit: { record: (_t, e) => { events.push(e); return Promise.resolve(); } },
    users: {
      byEmail: (_t, email) => Promise.resolve(email === "a@x.pt" ? user : null),
      setPlatformRole: (_t, _id, r) => { user.platformRole = r; return Promise.resolve(); },
    },
  };
  return { run: createCreatePlatformAdminUseCase(deps), user, events };
}

describe("create-platform-admin", () => {
  it("promove uma conta ativa e audita como SYSTEM", async () => {
    const { run, user, events } = setup("ACTIVE");
    await expect(run("a@x.pt")).resolves.toBe("CREATED");
    expect(user.platformRole).toBe("PLATFORM_ADMIN");
    expect(events).toMatchObject([{ action: "ADMIN_PLATFORM_ADMIN_CREATE", actorType: "SYSTEM", resourceId: "u1" }]);
  });

  it("é idempotente e não audita de novo", async () => {
    const { run, events } = setup("ACTIVE", "PLATFORM_ADMIN");
    await expect(run("a@x.pt")).resolves.toBe("ALREADY_ADMIN");
    expect(events).toHaveLength(0);
  });

  it.each([["PENDING_VERIFICATION"], ["SUSPENDED"]] as const)("recusa contas %s", async (status) => {
    const { run, user } = setup(status);
    await expect(run("a@x.pt")).resolves.toBe("NOT_ACTIVE");
    expect(user.platformRole).toBe("NONE");
  });

  it("conta inexistente", async () => {
    const { run } = setup("ACTIVE");
    await expect(run("zz@x.pt")).resolves.toBe("NOT_FOUND");
  });
});
