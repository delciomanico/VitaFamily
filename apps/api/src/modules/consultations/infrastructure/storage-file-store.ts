// Adaptador da porta `ProofFileStore` sobre `platform/storage` (MinIO em produção, `InMemoryStorage` nos testes).
import type { Readable } from "node:stream";
import type { Storage } from "../../../platform/storage/index.js";
import type { ProofFileStore } from "../application/ports.js";

export class StorageProofFileStore implements ProofFileStore {
  constructor(private readonly storage: Storage) {}

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.storage.putObject(key, body, contentType);
  }

  get(key: string): Promise<Readable> {
    return this.storage.getObject(key);
  }

  copy(sourceKey: string, destKey: string): Promise<void> {
    return this.storage.copyObject(sourceKey, destKey);
  }

  delete(key: string): Promise<void> {
    return this.storage.deleteObject(key);
  }
}
