import { beforeEach, describe, expect, it } from 'vitest'
import { marketplaceDb, resetMarketplaceDb } from '../marketplaceDb'
import { resetProfessionalDb } from '../professionalDb'
import * as mkt from './marketplace'

beforeEach(() => {
  resetMarketplaceDb()
  resetProfessionalDb()
  window.sessionStorage.clear()
})

const ids = (items: { id: string }[]) => items.map((i) => i.id)

/** Pagina até ao fim e devolve todos os itens, na ordem devolvida. */
async function collectAll(params: Parameters<typeof mkt.searchProfessionals>[0] = {}) {
  const all: Awaited<ReturnType<typeof mkt.searchProfessionals>>['items'] = []
  let cursor: string | undefined
  do {
    const page = await mkt.searchProfessionals({ ...params, limit: 2, cursor })
    all.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor !== undefined)
  return all
}

// ───── Filtros ─────

describe('filtros do mercado', () => {
  it('só especialidades com profissionais visíveis, com contagem; cidades e métodos das ofertas ativas', async () => {
    const f = await mkt.getMarketplaceFilters()
    const specialtyIds = f.specialties.map((s) => s.id)

    expect(specialtyIds).toEqual(expect.arrayContaining(['spc_psico', 'spc_nutri', 'spc_treino', 'spc_yoga']))
    // Sem profissional visível: geral (ninguém), antiga (inativa) e nutri do suspenso não contam.
    expect(specialtyIds).not.toContain('spc_geral')
    expect(specialtyIds).not.toContain('spc_antiga')
    // psico1, psico2 e psico3; o pro_fila (PENDING_REVIEW) não entra.
    expect(f.specialties.find((s) => s.id === 'spc_psico')?.professionalCount).toBe(3)
    expect(f.specialties.find((s) => s.id === 'spc_nutri')?.professionalCount).toBe(1)

    expect(f.cities.map((c) => c.name)).toEqual(expect.arrayContaining(['Luanda', 'Benguela', 'Huambo']))
    expect(f.methods).toEqual(['CHAT', 'IN_PERSON', 'PHONE', 'VIDEO'])
  })

  it('filtro por cidade', async () => {
    const page = await mkt.searchProfessionals({ city: 'Luanda' })
    expect(ids(page.items).sort()).toEqual(['pro_pub_nutri1', 'pro_pub_psico1', 'pro_pub_psico2'])
  })

  it('specialtyId=spc_psico devolve ranking com label NEW, reasons em array e score entre 0 e 100, ordenado por ranking', async () => {
    const page = await mkt.searchProfessionals({ specialtyId: 'spc_psico' })
    expect(ids(page.items).sort()).toEqual(['pro_pub_psico1', 'pro_pub_psico2', 'pro_pub_psico3'])

    expect(page.items[0]?.ranking?.label).toBe('NEW')
    for (const item of page.items) {
      const r = item.ranking!
      expect(Array.isArray(r.reasons)).toBe(true)
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
    }
    const scores = page.items.map((i) => i.ranking!.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  it('sem specialtyId não há ranking e a ordem por omissão é NEXT_AVAILABLE', async () => {
    const page = await mkt.searchProfessionals()
    expect(page.items.every((i) => i.ranking === undefined)).toBe(true)

    const keys = page.items.map((i) => (i.nextAvailableAt ? Date.parse(i.nextAvailableAt) : Number.POSITIVE_INFINITY))
    expect(keys).toEqual([...keys].sort((a, b) => a - b))
  })

  it('sort=RANKING sem specialtyId ⇒ VALIDATION_ERROR', async () => {
    await expect(mkt.searchProfessionals({ sort: 'RANKING' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('min > max ⇒ VALIDATION_ERROR', async () => {
    await expect(mkt.searchProfessionals({ minPriceKz: 20000, maxPriceKz: 10000 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('q com 1 letra ⇒ VALIDATION_ERROR; q com 2 letras pesquisa pelo nome', async () => {
    await expect(mkt.searchProfessionals({ q: 'a' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const page = await mkt.searchProfessionals({ q: 'marta' })
    expect(ids(page.items)).toEqual(['pro_aprovada'])
  })

  it('filtros de oferta aplicam-se à MESMA oferta (method=VIDEO + maxPriceKz=13000 ⇒ só psico2)', async () => {
    const page = await mkt.searchProfessionals({ specialtyId: 'spc_psico', method: 'VIDEO', maxPriceKz: 13000 })
    // psico1 tem VIDEO a 15000 e IN_PERSON a 18000: nenhuma oferta cumpre ambos os filtros.
    expect(ids(page.items)).toEqual(['pro_pub_psico2'])
    expect(page.items[0]?.matchingOffers.map((o) => o.id)).toEqual(['ofr_pub_3'])
    expect(page.items[0]?.matchingOffers.every((o) => o.method === 'VIDEO' && o.priceKz <= 13000)).toBe(true)

    // psico3 tem PHONE a 9000 mas VIDEO a 14000: PHONE com mínimo de 10000 não existe.
    await expect(mkt.searchProfessionals({ specialtyId: 'spc_psico', method: 'PHONE', minPriceKz: 10000 })).resolves.toMatchObject({ items: [] })
  })

  it('matchingOffers só tem as ofertas que cumprem os filtros', async () => {
    const page = await mkt.searchProfessionals({ specialtyId: 'spc_psico', maxPriceKz: 15000 })
    const psico1 = page.items.find((i) => i.id === 'pro_pub_psico1')!
    expect(psico1.matchingOffers.map((o) => o.id)).toEqual(['ofr_pub_2'])
    expect(psico1.fromPriceKz).toBe(15000)
  })

  it('PRICE_ASC e PRICE_DESC ordenam por preço mínimo', async () => {
    const asc = await mkt.searchProfessionals({ sort: 'PRICE_ASC' })
    const desc = await mkt.searchProfessionals({ sort: 'PRICE_DESC' })
    const ascPrices = asc.items.map((i) => i.fromPriceKz)
    const descPrices = desc.items.map((i) => i.fromPriceKz)
    expect(ascPrices).toEqual([...ascPrices].sort((a, b) => a - b))
    expect(descPrices).toEqual([...descPrices].sort((a, b) => b - a))
  })

  it('paginação com limit=2 e cursor devolve todos os profissionais sem repetições', async () => {
    const first = await mkt.searchProfessionals({ limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).toBe('2')

    const all = await collectAll()
    const full = await mkt.searchProfessionals({ limit: 50 })
    expect(new Set(ids(all)).size).toBe(all.length)
    expect(ids(all).sort()).toEqual(ids(full.items).sort())
    expect(all).toHaveLength(6)
  })

  it('cursor inválido ⇒ VALIDATION_ERROR', async () => {
    await expect(mkt.searchProfessionals({ cursor: '-1' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

// ───── Visibilidade ─────

describe('visibilidade dos profissionais', () => {
  it('suspenso e não aprovado nunca aparecem na pesquisa nem nos filtros', async () => {
    const page = await mkt.searchProfessionals({ limit: 50 })
    expect(ids(page.items)).not.toContain('pro_suspensa')
    expect(ids(page.items)).not.toContain('pro_fila')
    expect(ids(page.items)).not.toContain('pro_demo')
    await expect(mkt.searchProfessionals({ q: 'rui' })).resolves.toMatchObject({ items: [] })
    expect(mkt.isApprovedProfessional('pro_suspensa')).toBe(false)
  })

  it('getMarketplaceProfessional de suspenso ou não aprovado ⇒ NOT_FOUND', async () => {
    await expect(mkt.getMarketplaceProfessional('pro_suspensa')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(mkt.getMarketplaceProfessional('pro_fila')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

// ───── Perfil público ─────

describe('perfil público', () => {
  it('não expõe e-mail nem instruções de pagamento (perfil nem items)', async () => {
    const profile = await mkt.getMarketplaceProfessional('pro_aprovada')
    expect(profile).not.toHaveProperty('email')
    expect(profile).not.toHaveProperty('paymentInstructions')
    expect(JSON.stringify(profile)).not.toContain('marta.lopes@exemplo.ao')

    const page = await mkt.searchProfessionals({ limit: 50 })
    for (const item of page.items) {
      expect(item).not.toHaveProperty('email')
      expect(item).not.toHaveProperty('paymentInstructions')
    }
    expect(JSON.stringify(page)).not.toContain('@')
  })

  it('perfil com specialtyId de outra especialidade ⇒ ranking undefined; com a sua ⇒ ranking', async () => {
    const other = await mkt.getMarketplaceProfessional('pro_pub_psico1', 'spc_nutri')
    expect(other.ranking).toBeUndefined()

    const own = await mkt.getMarketplaceProfessional('pro_pub_psico1', 'spc_psico')
    expect(own.ranking?.label).toBe('NEW')
    expect(own.ranking?.score).toBeGreaterThanOrEqual(0)
  })

  it('perfil inexistente ⇒ NOT_FOUND', async () => {
    await expect(mkt.getMarketplaceProfessional('pro_nao_existe')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

// ───── Comparação ─────

describe('comparação de profissionais', () => {
  it('com 3 ids devolve priceSummary por método com o mais barato', async () => {
    const cmp = await mkt.compareProfessionals(['pro_pub_psico1', 'pro_pub_psico2', 'pro_pub_psico3'], 'spc_psico')
    expect(cmp.specialtyId).toBe('spc_psico')
    expect(cmp.items).toHaveLength(3)

    const video = cmp.priceSummary.find((s) => s.method === 'VIDEO')!
    expect(video).toMatchObject({ minPriceKz: 12000, maxPriceKz: 15000, cheapestProfessionalIds: ['pro_pub_psico2'] })
    const inPerson = cmp.priceSummary.find((s) => s.method === 'IN_PERSON')!
    expect(inPerson.cheapestProfessionalIds).toEqual(['pro_pub_psico1'])
  })

  it('com 2 ids devolve empates no priceSummary', async () => {
    // Acerta o preço de psico2 em VIDEO para empatar com psico1 (15000).
    marketplaceDb.catalogExtras.find((p) => p.id === 'pro_pub_psico2')!.offers[0]!.priceKz = 15000

    const cmp = await mkt.compareProfessionals(['pro_pub_psico1', 'pro_pub_psico2'], 'spc_psico')
    const video = cmp.priceSummary.find((s) => s.method === 'VIDEO')!
    expect(video.minPriceKz).toBe(15000)
    expect(video.cheapestProfessionalIds.sort()).toEqual(['pro_pub_psico1', 'pro_pub_psico2'])
  })

  it('1 ou 4 ids, ou ids repetidos ⇒ VALIDATION_ERROR', async () => {
    await expect(mkt.compareProfessionals(['pro_pub_psico1'], 'spc_psico')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(
      mkt.compareProfessionals(['pro_pub_psico1', 'pro_pub_psico2', 'pro_pub_psico3', 'pro_pub_nutri1'], 'spc_psico'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(mkt.compareProfessionals(['pro_pub_psico1', 'pro_pub_psico1'], 'spc_psico')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('id inexistente ou suspenso ⇒ NOT_FOUND', async () => {
    await expect(mkt.compareProfessionals(['pro_pub_psico1', 'pro_nao_existe'], 'spc_psico')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(mkt.compareProfessionals(['pro_pub_psico1', 'pro_suspensa'], 'spc_psico')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('profissional sem oferta na especialidade ⇒ VALIDATION_ERROR', async () => {
    await expect(mkt.compareProfessionals(['pro_pub_psico1', 'pro_pub_nutri1'], 'spc_psico')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

// ───── Regras de ranking ─────

describe('regras de ranking', () => {
  it('4 sinais cuja soma de pesos é 100 e notUsed não vazio', async () => {
    const rules = await mkt.getRankingRules()
    expect(rules.signals).toHaveLength(4)
    expect(rules.signals.reduce((sum, s) => sum + s.weightPercent, 0)).toBe(100)
    expect(rules.notUsed.length).toBeGreaterThan(0)
  })
})
