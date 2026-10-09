// Porta `Storage` (conventions.md §2: "Ficheiros | porta Storage, implementada por adaptador minio
// em infrastructure") sobre S3/MinIO (ADR-006). Vive em `platform` porque nenhum módulo a definia
// ainda (M5 é o primeiro a precisar dela — `documents`); é um detalhe de infraestrutura reutilizável,
// mesmo critério de `platform/clock`/`platform/db`: a interface é o "porquê" (substituível/testável),
// a classe `MinioStorage` é o único adaptador real. `minio` é o SDK oficial (`architecture-rules.ts`
// já antecipava "minio" na lista de pacotes de I/O banidos em domain/application/interface).
import { Readable } from "node:stream";
import { Client } from "minio";

/** Porta de armazenamento de objetos (ADR-006): nunca público, sempre mediado pela API. */
export interface Storage {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Readable>;
  deleteObject(key: string): Promise<void>;
  /** Usado para "sair da quarentena": copia para a chave final e o chamador apaga a original. */
  copyObject(sourceKey: string, destKey: string): Promise<void>;
}

export interface MinioStorageOptions {
  /** URL completa (ex.: "http://localhost:9000", `S3_ENDPOINT`) — só host/porta são usados pelo SDK. */
  endpoint: string;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  region?: string;
  bucket: string;
}

/** Extrai host/porta de `S3_ENDPOINT` — o SDK MinIO não aceita a URL completa com protocolo. */
function parseEndpoint(endpoint: string): { host: string; port?: number } {
  const url = new URL(endpoint);
  return url.port ? { host: url.hostname, port: Number(url.port) } : { host: url.hostname };
}

/** Adaptador real (produção/desenvolvimento) sobre o SDK oficial `minio`. */
export class MinioStorage implements Storage {
  private readonly client: Client;
  private readonly bucket: string;

  constructor(options: MinioStorageOptions) {
    const { host, port } = parseEndpoint(options.endpoint);
    this.client = new Client({
      endPoint: host,
      ...(port !== undefined ? { port } : {}),
      useSSL: options.useSSL,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
      ...(options.region ? { region: options.region } : {}),
    });
    this.bucket = options.bucket;
  }

  /** Cria o bucket se não existir — chamado uma vez no arranque (main/api.ts, main/worker.ts). */
  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket).catch(() => false);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, body, body.length, { "Content-Type": contentType });
  }

  async getObject(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    await this.client.copyObject(this.bucket, destKey, `/${this.bucket}/${sourceKey}`);
  }
}

/** Fake em memória para testes (mesmo critério de `FixedClock`) — nunca usado em produção. */
export class InMemoryStorage implements Storage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
    return Promise.resolve();
  }

  async getObject(key: string): Promise<Readable> {
    const object = this.objects.get(key);
    if (!object) {
      throw new Error(`objeto inexistente no fake de armazenamento: ${key}`);
    }
    return Promise.resolve(Readable.from(object.body));
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    const object = this.objects.get(sourceKey);
    if (!object) {
      throw new Error(`objeto inexistente no fake de armazenamento: ${sourceKey}`);
    }
    this.objects.set(destKey, object);
    return Promise.resolve();
  }
}
