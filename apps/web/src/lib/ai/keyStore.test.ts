import { beforeEach, describe, expect, it } from 'vitest'
import { createKeyStore, memoryStore, type KeyValueStore } from './keyStore'

describe('cofre de chaves (BR-AI-02)', () => {
  let backing: KeyValueStore
  beforeEach(() => {
    backing = memoryStore()
  })

  it('guarda cifrado e recupera; o valor guardado não contém a chave em claro', async () => {
    const store = createKeyStore(backing, globalThis.crypto.subtle)
    await store.save('CLAUDE', 'sk-ant-segredo-1234567890')
    expect(await store.has('CLAUDE')).toBe(true)
    expect(await store.load('CLAUDE')).toBe('sk-ant-segredo-1234567890')
    const sealed = (await backing.get('key:CLAUDE')) as { iv: Uint8Array; data: ArrayBuffer }
    expect(new TextDecoder().decode(sealed.data)).not.toContain('segredo')
    expect(sealed.iv).toHaveLength(12)
  })

  it('a chave-mestra não é exportável', async () => {
    const store = createKeyStore(backing, globalThis.crypto.subtle)
    await store.save('OPENAI', 'sk-teste-aaaaaaaa')
    const master = (await backing.get('master')) as CryptoKey
    expect(master.extractable).toBe(false)
    await expect(globalThis.crypto.subtle.exportKey('raw', master)).rejects.toThrow()
  })

  it('fornecedores são independentes e remover apaga', async () => {
    const store = createKeyStore(backing, globalThis.crypto.subtle)
    await store.save('CLAUDE', 'a'.repeat(12))
    await store.save('OPENAI', 'b'.repeat(12))
    await store.remove('CLAUDE')
    expect(await store.load('CLAUDE')).toBeNull()
    expect(await store.load('OPENAI')).toBe('b'.repeat(12))
    expect(await store.has('CLAUDE')).toBe(false)
  })

  it('dados adulterados ou sem chave-mestra ⇒ null (nunca lança nem devolve lixo)', async () => {
    const store = createKeyStore(backing, globalThis.crypto.subtle)
    await store.save('CLAUDE', 'c'.repeat(12))
    const sealed = (await backing.get('key:CLAUDE')) as { iv: Uint8Array; data: ArrayBuffer }
    const tampered = new Uint8Array(sealed.data.slice(0))
    tampered[0] = (tampered[0] ?? 0) ^ 0xff
    await backing.set('key:CLAUDE', { iv: sealed.iv, data: tampered.buffer })
    expect(await store.load('CLAUDE')).toBeNull()
    await backing.delete('master')
    expect(await store.load('CLAUDE')).toBeNull()
  })

  it('sem WebCrypto não guarda (falha explícita) e não é suportado', async () => {
    const store = createKeyStore(backing, null)
    expect(store.supported()).toBe(false)
    await expect(store.save('CLAUDE', 'x'.repeat(12))).rejects.toThrow()
  })
})
