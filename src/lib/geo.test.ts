import { describe, expect, test } from 'bun:test'
import { distanceMeters, formatDistance, shopDistance, sortShops } from './geo'
import { toShop } from './load-shops'
import type { ShopRecord } from './shop'

function shop(overrides: Partial<ShopRecord> = {}) {
  return toShop({
    name: 'こまどり楼',
    kana: 'コマドリロウ',
    address: '栃木市万町24-18',
    tel: '0282-22-1290',
    category: 'E',
    area: 'tochigi',
    isLarge: false,
    lat: null,
    lng: null,
    ...overrides,
  })
}

/** 栃木市役所付近。 */
const CITY_HALL = { lat: 36.3826, lng: 139.7333 }

describe('distanceMeters', () => {
  test('同じ点なら 0', () => {
    expect(distanceMeters(CITY_HALL, CITY_HALL)).toBe(0)
  })

  test('緯度 0.01 度（約 1.1km）の差を正しく測る', () => {
    const d = distanceMeters(CITY_HALL, { ...CITY_HALL, lat: CITY_HALL.lat + 0.01 })
    expect(d).toBeGreaterThan(1100)
    expect(d).toBeLessThan(1120)
  })

  test('向きによらず同じ距離', () => {
    const a = CITY_HALL
    const b = { lat: 36.39, lng: 139.74 }
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6)
  })
})

describe('shopDistance', () => {
  test('現在地が無ければ null', () => {
    expect(shopDistance(shop({ lat: 36.38, lng: 139.73 }), null)).toBeNull()
  })

  test('店舗の座標が無ければ null', () => {
    expect(shopDistance(shop(), CITY_HALL)).toBeNull()
  })
})

describe('formatDistance', () => {
  test('1km 未満は 10m 単位', () => {
    expect(formatDistance(834)).toBe('約 830 m')
  })

  test('測位誤差より細かい値を主張しない', () => {
    expect(formatDistance(3)).toBe('約 10 m')
  })

  test('1km 以上は小数第 1 位までの km', () => {
    expect(formatDistance(1234)).toBe('約 1.2 km')
  })

  test('10km 以上は整数の km', () => {
    expect(formatDistance(12_340)).toBe('約 12 km')
  })
})

describe('sortShops', () => {
  const near = shop({ name: '近い店', lat: 36.383, lng: 139.7335 })
  const far = shop({ name: '遠い店', lat: 36.45, lng: 139.8 })
  const noCoords = shop({ name: '座標なしの店' })
  const all = [far, noCoords, near]

  test('default は並べ替えない', () => {
    expect(sortShops(all, 'default', CITY_HALL)).toBe(all)
  })

  test('現在地が無ければ並べ替えない', () => {
    expect(sortShops(all, 'distance', null)).toBe(all)
  })

  test('近い順に並べる', () => {
    const sorted = sortShops(all, 'distance', CITY_HALL)
    expect(sorted.map((s) => s.name)).toEqual(['近い店', '遠い店', '座標なしの店'])
  })

  test('座標が無い店を落とさない', () => {
    expect(sortShops(all, 'distance', CITY_HALL)).toHaveLength(3)
  })

  test('元の配列を書き換えない', () => {
    sortShops(all, 'distance', CITY_HALL)
    expect(all.map((s) => s.name)).toEqual(['遠い店', '座標なしの店', '近い店'])
  })
})
