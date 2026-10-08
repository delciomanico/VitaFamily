import { describe, expect, it } from "vitest";
import { checkConnection, createPool } from "./index.js";

describe("checkConnection", () => {
  it("devolve false (sem lançar) quando a ligação falha", async () => {
    // Porta sem servidor à escuta: a ligação é recusada rapidamente (localhost).
    const pool = createPool("postgres://vita:vita@127.0.0.1:1/vita", {
      connectionTimeoutMillis: 2000,
    });
    try {
      await expect(checkConnection(pool)).resolves.toBe(false);
    } finally {
      await pool.end();
    }
  });
});
