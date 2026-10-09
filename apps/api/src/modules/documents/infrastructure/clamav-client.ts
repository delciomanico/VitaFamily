// Cliente ClamAV (`VirusScanner`, application/ports.ts) sobre o protocolo INSTREAM
// (https://docs.clamav.net/manual/Usage/Scanning.html#stream-scan) por socket TCP simples
// (`node:net`, builtin). ESCOLHA DOCUMENTADA (README do módulo): não existe nenhum pacote npm
// chamado exatamente "clamd" (nome que `tests/architecture-rules.ts` já antecipava na lista de
// pacotes de I/O banidos em domain/application/interface — descoberto ao implementar M5; o nome
// ficou inerte, nunca importado, porque o pacote não existe no registo público); as alternativas
// reais (`clamdjs`, `node-clamav`, `clamav.js`) são pequenas wrappers finas sobre o mesmo protocolo
// INSTREAM — escreveu-se aqui diretamente para não acrescentar uma dependência só para ~60 linhas
// de framing bem documentado, e para controlar timeouts/erros com os mesmos padrões do resto do
// código (sem callbacks).
import { Socket } from "node:net";
import type { VirusScanner } from "../application/ports.js";

const INSTREAM_CHUNK_BYTES = 64 * 1024;
const RESPONSE_TIMEOUT_MS = 30_000;

export interface ClamAvClientOptions {
  host: string;
  port: number;
  timeoutMs?: number;
}

/**
 * Envia `buffer` pelo protocolo INSTREAM e devolve "CLEAN"/"INFECTED" consoante a resposta
 * ("... OK" ou "... FOUND"). Qualquer outra resposta ("... ERROR") ou falha de ligação lança —
 * quem chama (worker `documents.scan`) decide se tenta de novo (pg-boss retry).
 */
export class ClamAvScanner implements VirusScanner {
  constructor(private readonly options: ClamAvClientOptions) {}

  async scan(buffer: Buffer): Promise<"CLEAN" | "INFECTED"> {
    const response = await this.sendInstream(buffer);
    if (response.includes("FOUND")) {
      return "INFECTED";
    }
    if (response.includes("OK")) {
      return "CLEAN";
    }
    throw new Error(`resposta inesperada do ClamAV: ${response}`);
  }

  private sendInstream(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        fn();
      };

      socket.setTimeout(this.options.timeoutMs ?? RESPONSE_TIMEOUT_MS);
      socket.on("timeout", () => {
        finish(() => {
          reject(new Error("ClamAV: tempo de resposta excedido"));
        });
      });
      socket.on("error", (err) => {
        finish(() => {
          reject(err);
        });
      });
      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      socket.on("close", () => {
        finish(() => {
          resolve(Buffer.concat(chunks).toString("utf8").trim());
        });
      });

      socket.connect(this.options.port, this.options.host, () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < buffer.length; offset += INSTREAM_CHUNK_BYTES) {
          const chunk = buffer.subarray(offset, offset + INSTREAM_CHUNK_BYTES);
          const sizeHeader = Buffer.alloc(4);
          sizeHeader.writeUInt32BE(chunk.length, 0);
          socket.write(sizeHeader);
          socket.write(chunk);
        }
        // Chunk de tamanho zero termina o stream (protocolo INSTREAM); fecha a escrita a seguir
        // (half-close) — o daemon já tem tudo o que precisa, e isto permite a quem testa com um
        // servidor TCP simples reagir a "end" em vez de ter de interpretar o framing.
        const zero = Buffer.alloc(4);
        zero.writeUInt32BE(0, 0);
        socket.end(zero);
      });
    });
  }
}
