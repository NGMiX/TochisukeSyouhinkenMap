import { describe, expect, test } from 'bun:test'
import { EMPTY_FILTERS, filterShops, hasActiveFilters, toggle } from './filter'
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

const small = shop()
const large = shop({
  name: 'AOKI栃木店',
  kana: 'アオキトチギテン',
  address: '栃木市箱森町41-11',
  category: 'C',
  isLarge: true,
})
const ohira = shop({
  name: 'ヤマダデンキ大平店',
  kana: 'ヤマダデンキオオヒラテン',
  address: '栃木市大平町富田1-1',
  category: 'C',
  area: 'ohira',
})
const all = [small, large, ohira]

describe('filterShops', () => {
  test('条件なしなら全件返す', () => {
    expect(filterShops(all, EMPTY_FILTERS)).toHaveLength(3)
  })

  test('黄色券のみ: 大型店舗を除外する', () => {
    const result = filterShops(all, { ...EMPTY_FILTERS, yellowOnly: true })
    expect(result.map((s) => s.name)).toEqual(['こまどり楼', 'ヤマダデンキ大平店'])
  })

  test('業種で絞る', () => {
    const result = filterShops(all, { ...EMPTY_FILTERS, categories: ['E'] })
    expect(result.map((s) => s.name)).toEqual(['こまどり楼'])
  })

  test('業種は複数選択で OR になる', () => {
    const result = filterShops(all, { ...EMPTY_FILTERS, categories: ['E', 'C'] })
    expect(result).toHaveLength(3)
  })

  test('地区で絞る', () => {
    const result = filterShops(all, { ...EMPTY_FILTERS, areas: ['ohira'] })
    expect(result.map((s) => s.name)).toEqual(['ヤマダデンキ大平店'])
  })

  test('テキスト検索: ひらがなで漢字の店名に当たる', () => {
    const result = filterShops(all, { ...EMPTY_FILTERS, query: 'こまどり' })
    expect(result.map((s) => s.name)).toEqual(['こまどり楼'])
  })

  test('テキスト検索: 英字の大文字小文字を問わない', () => {
    const result = filterShops(all, { ...EMPTY_FILTERS, query: 'aoki' })
    expect(result.map((s) => s.name)).toEqual(['AOKI栃木店'])
  })

  test('テキスト検索: 住所でも当たる', () => {
    const result = filterShops(all, { ...EMPTY_FILTERS, query: '大平町' })
    expect(result.map((s) => s.name)).toEqual(['ヤマダデンキ大平店'])
  })

  test('複数条件は AND になる', () => {
    const result = filterShops(all, {
      ...EMPTY_FILTERS,
      yellowOnly: true,
      categories: ['C'],
    })
    expect(result.map((s) => s.name)).toEqual(['ヤマダデンキ大平店'])
  })

  test('該当なしなら空配列', () => {
    expect(filterShops(all, { ...EMPTY_FILTERS, query: '存在しない店' })).toEqual([])
  })
})

describe('hasActiveFilters', () => {
  test('初期状態では false', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
  })

  test('空白だけのクエリは条件とみなさない', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: '   ' })).toBe(false)
  })

  test('いずれかが設定されていれば true', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, yellowOnly: true })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, areas: ['ohira'] })).toBe(true)
  })
})

describe('toggle', () => {
  test('無ければ足す', () => {
    expect(toggle(['A'], 'B')).toEqual(['A', 'B'])
  })

  test('あれば外す', () => {
    expect(toggle(['A', 'B'], 'A')).toEqual(['B'])
  })
})
