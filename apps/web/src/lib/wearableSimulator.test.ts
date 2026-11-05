import { describe, expect, it } from 'vitest'
import { findWatchModel, metricFromSlug, metricSlugs, readMetric, watchModels } from './wearableSimulator'
import type { MetricRange, MetricType } from '@/types/wearable'

const NOW = new Date(2026, 10, 5, 15, 30)
const ALL: MetricType[] = ['HEART_RATE', 'STEPS', 'SLEEP', 'OXYGEN_SATURATION', 'BLOOD_PRESSURE', 'CALORIES']

describe('simulador de relógio', () => {
  it('é determinístico: mesmos argumentos, mesmos dados', () => {
    const model = findWatchModel('samsung-galaxy-watch-6')!
    expect(readMetric(model, 'HEART_RATE', 'WEEK', NOW)).toEqual(readMetric(model, 'HEART_RATE', 'WEEK', NOW))
  })

  it('só devolve tipos que o dispositivo suporta', () => {
    const band = findWatchModel('xiaomi-smart-band-8')!
    expect(readMetric(band, 'BLOOD_PRESSURE', 'WEEK', NOW)).toBeNull()
    expect(readMetric(band, 'OXYGEN_SATURATION', 'WEEK', NOW)).toBeNull()
    expect(readMetric(band, 'STEPS', 'WEEK', NOW)).not.toBeNull()
  })

  it('a pressão arterial só existe no modelo que a fornece', () => {
    const withBp = watchModels.filter((m) => m.capabilities.includes('BLOOD_PRESSURE'))
    expect(withBp.map((m) => m.id)).toEqual(['samsung-galaxy-watch-6'])
  })

  it.each([
    ['HEART_RATE', 40, 200],
    ['OXYGEN_SATURATION', 90, 100],
  ] as const)('%s fica num intervalo fisiologicamente plausível', (type, low, high) => {
    const model = findWatchModel('samsung-galaxy-watch-6')!
    for (const range of ['WEEK', 'MONTH'] as MetricRange[]) {
      for (const point of readMetric(model, type, range, NOW)!.points) {
        expect(point.value).toBeGreaterThanOrEqual(low)
        expect(point.value).toBeLessThanOrEqual(high)
      }
    }
  })

  it('os dados de hoje só vão até à última sincronização', () => {
    const model = findWatchModel('garmin-venu-3')!
    const reading = readMetric(model, 'HEART_RATE', 'DAY', NOW)!
    expect(reading.points).toHaveLength(NOW.getHours() + 1)
  })

  it('o intervalo dá o número esperado de pontos', () => {
    const model = findWatchModel('samsung-galaxy-watch-6')!
    expect(readMetric(model, 'STEPS', 'WEEK', NOW)!.points).toHaveLength(7)
    expect(readMetric(model, 'STEPS', 'MONTH', NOW)!.points).toHaveLength(30)
  })

  it('todos os tipos têm slug único e reversível', () => {
    expect(new Set(Object.values(metricSlugs)).size).toBe(ALL.length)
    for (const type of ALL) expect(metricFromSlug(metricSlugs[type])).toBe(type)
    expect(metricFromSlug('desconhecido')).toBeUndefined()
  })
})
