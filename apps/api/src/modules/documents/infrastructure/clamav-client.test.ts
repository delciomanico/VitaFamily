// Testa o framing INSTREAM (`ClamAvScanner`) contra um servidor TCP falso (sem Docker/ClamAV real
// — a integração com o daemon real é um detalhe de protocolo bem documentado; o que este teste
// garante é que o cliente envia os cabeçalhos de tamanho corretos e interpreta "OK"/"FOUND").
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ClamAvScanner } from "./clamav-client.js";

function readUInt32BE(chunks: Buffer, offset: number): number {
  return chunks.readUInt32BE(offset);
}

describe("ClamAvScanner (protocolo INSTREAM)", () => {
  let server: Server;
  let port: number;

  function startFakeServer(reply: (received: Buffer) => string): Promise<void> {
    return new Promise((resolve) => {
      server = createServer((socket: Socket) => {
        const received: Buffer[] = [];
        socket.on("data", (chunk) => received.push(chunk));
        socket.on("end", () => {
          socket.end(reply(Buffer.concat(received)));
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        port = typeof address === "object" && address ? address.port : 0;
        resolve();
      });
    });
  }

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it("devolve CLEAN quando o daemon responde OK", async () => {
    await startFakeServer(() => "stream: OK\0");
    const scanner = new ClamAvScanner({ host: "127.0.0.1", port });
    await expect(scanner.scan(Buffer.from("conteúdo limpo"))).resolves.toBe("CLEAN");
  });

  it("devolve INFECTED quando o daemon responde FOUND (ex.: EICAR)", async () => {
    await startFakeServer(() => "stream: Win.Test.EICAR_HDB-1 FOUND\0");
    const scanner = new ClamAvScanner({ host: "127.0.0.1", port });
    await expect(scanner.scan(Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR"))).resolves.toBe("INFECTED");
  });

  it("lança para uma resposta inesperada (ERROR)", async () => {
    await startFakeServer(() => "stream: ERROR\0");
    const scanner = new ClamAvScanner({ host: "127.0.0.1", port });
    await expect(scanner.scan(Buffer.from("x"))).rejects.toThrow();
  });

  it("envia o cabeçalho zINSTREAM e o framing de 4 bytes (big-endian) por chunk + terminador de tamanho zero", async () => {
    let capturedBody = Buffer.alloc(0);
    await startFakeServer((received) => {
      capturedBody = received;
      return "stream: OK\0";
    });
    const scanner = new ClamAvScanner({ host: "127.0.0.1", port });
    const payload = Buffer.from("abc");
    await scanner.scan(payload);

    expect(capturedBody.subarray(0, 10).toString("utf8")).toBe("zINSTREAM\0");
    const sizeHeader = readUInt32BE(capturedBody, 10);
    expect(sizeHeader).toBe(payload.length);
    expect(capturedBody.subarray(14, 14 + payload.length)).toEqual(payload);
    const terminator = readUInt32BE(capturedBody, 14 + payload.length);
    expect(terminator).toBe(0);
  });
});
