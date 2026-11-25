import type { AiProviderId } from '@/types/ai'

/*
 * Guarda a chave de API do utilizador SÓ neste dispositivo (BR-AI-02, ADR-039): cifrada com AES-GCM por uma `CryptoKey` NÃO exportável (WebCrypto),
 * ambas em IndexedDB. A chave nunca vai à Vita, a logs, ao localStorage em claro nem a relatórios de erro. O token Google vive só em memória
 * (`google.ts`). Risco residual assumido: XSS na própria app (por isso a app não carrega scripts de terceiros).
 */

export interface KeyValueStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

const DB_NAME = 'vita-ai'
const STORE = 'keys'
const MASTER = 'master'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('IndexedDB indisponível'))
  })
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error('IndexedDB falhou'))
    })
  } finally {
    db.close()
  }
}

export const indexedDbStore: KeyValueStore = {
  get: (key) => run('readonly', (s) => s.get(key)),
  set: async (key, value) => {
    await run('readwrite', (s) => s.put(value, key))
  },
  delete: async (key) => {
    await run('readwrite', (s) => s.delete(key))
  },
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, unknown>()
  return {
    get: (key) => Promise.resolve(map.get(key)),
    set: (key, value) => {
      map.set(key, value)
      return Promise.resolve()
    },
    delete: (key) => {
      map.delete(key)
      return Promise.resolve()
    },
  }
}

interface Sealed {
  iv: Uint8Array<ArrayBuffer>
  data: ArrayBuffer
}

export interface KeyStore {
  supported(): boolean
  has(provider: AiProviderId): Promise<boolean>
  save(provider: AiProviderId, apiKey: string): Promise<void>
  load(provider: AiProviderId): Promise<string | null>
  remove(provider: AiProviderId): Promise<void>
}

/** `subtleOverride`: `undefined` ⇒ o WebCrypto do navegador; `null` ⇒ sem WebCrypto (testes). */
export function createKeyStore(store: KeyValueStore, subtleOverride?: SubtleCrypto | null): KeyStore {
  const subtle: SubtleCrypto | undefined = subtleOverride === undefined ? globalThis.crypto?.subtle : (subtleOverride ?? undefined)
  const slot = (provider: AiProviderId) => `key:${provider}`

  async function master(create: boolean): Promise<CryptoKey | null> {
    if (!subtle) return null
    const existing = (await store.get(MASTER)) as CryptoKey | undefined
    if (existing) return existing
    if (!create) return null
    const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await store.set(MASTER, key)
    return key
  }

  return {
    supported: () => subtle !== undefined && typeof indexedDB !== 'undefined',
    async has(provider) {
      return (await store.get(slot(provider))) !== undefined
    },
    async save(provider, apiKey) {
      const key = await master(true)
      if (!key || !subtle) throw new Error('WebCrypto indisponível')
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)))
      const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(apiKey))
      await store.set(slot(provider), { iv, data } satisfies Sealed)
    },
    async load(provider) {
      const sealed = (await store.get(slot(provider))) as Sealed | undefined
      const key = await master(false)
      if (!sealed || !key || !subtle) return null
      try {
        return new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.data))
      } catch {
        return null
      }
    },
    async remove(provider) {
      await store.delete(slot(provider))
    },
  }
}

let shared: KeyStore | undefined
/** Instância da app (IndexedDB + WebCrypto); os testes injetam `createKeyStore(memoryStore())`. */
export function keyStore(): KeyStore {
  shared ??= createKeyStore(indexedDbStore)
  return shared
}

export function setKeyStoreForTests(replacement: KeyStore | undefined): void {
  shared = replacement
}
