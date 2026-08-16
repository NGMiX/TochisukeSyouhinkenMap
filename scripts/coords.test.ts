import { describe, expect, test } from 'bun:test'
import { type Cache, type Caches, crossCheckMeters, resolveCoords } from './coords'
import type { PlacesCache } from './places'
import { placeQuery } from './places'

const SHOP = { name: 'こまどり楼', address: '栃木市万町24-18' }

/** 住所で引いた結果（信用できる形）。 */
function addressCache(overrides: Partial<Cache[string]> = {}): Cache {
  return {
    [SHOP.address]: {
      lat: 36.3826,
      lng: 139.7333,
      locationType: 'ROOFTOP',
      formatted: '日本、〒328-0015 栃木県栃木市万町24-18',
      partialMatch: false,
      ...overrides,
    },
  }
}

/** 店名で引いた結果。 */
function placesCache(overrides: Record<string, unknown> = {}): PlacesCache {
  return {
    [placeQuery(SHOP)]: {
      lat: 36.383,
      lng: 139.734,
      name: 'こまどり楼',
      formatted: '〒328-0015 栃木県栃木市万町24-18',
      ...overrides,
    },
  }
}

function caches(geocode: Cache = {}, places: PlacesCache = {}): Caches {
  return { geocode, places }
}

describe('resolveCoords', () => {
  test('店名の結果を住所より優先する（Places は店そのものの位置）', () => {
    const result = resolveCoords(SHOP, null, caches(addressCache(), placesCache()))
    expect(result?.source).toBe('place')
    expect(result?.lat).toBe(36.383)
  })

  test('店名で引けなければ住所の結果を使う', () => {
    const result = resolveCoords(SHOP, null, caches(addressCache(), {}))
    expect(result?.source).toBe('address')
    expect(result?.lat).toBe(36.3826)
  })

  test('店名の結果が別の店なら採らず、住所に戻る', () => {
    const wrong = placesCache({
      name: '別の店',
      formatted: '〒328-0071 栃木県栃木市大町35-4',
    })
    const result = resolveCoords(SHOP, null, caches(addressCache(), wrong))
    expect(result?.source).toBe('address')
  })

  test('人が入れた座標がすべてに優先する', () => {
    const result = resolveCoords(
      SHOP,
      { lat: 36.4, lng: 139.8 },
      caches(addressCache(), placesCache()),
    )
    expect(result?.source).toBe('human')
    expect(result?.lat).toBe(36.4)
  })

  test('どこからも決まらなければ null', () => {
    expect(resolveCoords(SHOP, null, caches())).toBeNull()
  })

  test('住所の結果が精度不足なら使わない', () => {
    const rough = addressCache({ locationType: 'APPROXIMATE' })
    expect(resolveCoords(SHOP, null, caches(rough, {}))).toBeNull()
  })
})

describe('crossCheckMeters', () => {
  test('店名と住所の両方があればずれを返す', () => {
    const gap = crossCheckMeters(SHOP, caches(addressCache(), placesCache()))
    expect(gap).toBeGreaterThan(60)
    expect(gap).toBeLessThan(120)
  })

  test('片方しか無ければ null（突き合わせようがない）', () => {
    expect(crossCheckMeters(SHOP, caches(addressCache(), {}))).toBeNull()
    expect(crossCheckMeters(SHOP, caches({}, placesCache()))).toBeNull()
  })
})
