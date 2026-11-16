// Adaptador da porta `CredentialFileStore` sobre `platform/storage` (MinIO em produção, `InMemoryStorage` nos testes).
import type { Readable } from "node:stream";
import type { Storage } from "../../../platform/storage/index.js";
import type { CredentialFileStore } from "../application/ports.js";

export class StorageCredentialFileStore implements CredentialFileStore {
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
