import { describe, expect, test } from 'bun:test'
import {
  CSV_HEADERS,
  parseCsv,
  resolveColumns,
  rowsToShopRows,
  shopRowsToRows,
  toCsv,
} from './csv'

describe('parseCsv', () => {
  test('素朴な行を読む', () => {
    expect(parseCsv('a,b,c\r\n1,2,3\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  test('BOM を落とす', () => {
    expect(parseCsv('﻿屋号,住所\r\n店,栃木市\r\n')[0]).toEqual(['屋号', '住所'])
  })

  test('LF だけの改行も読む（Excel を経由しない編集）', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  test('引用符の中のカンマと改行を保つ', () => {
    expect(parseCsv('"あ,い","う\r\nえ"\r\n')).toEqual([['あ,い', 'う\r\nえ']])
  })

  test('引用符の中の "" は引用符 1 つ', () => {
    expect(parseCsv('"言""葉",x\r\n')).toEqual([['言"葉', 'x']])
  })

  test('空の欄を落とさない', () => {
    expect(parseCsv('a,,c\r\n')).toEqual([['a', '', 'c']])
  })

  test('末尾に改行が無くても最後の行を読む', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('toCsv', () => {
  test('BOM と CRLF を付ける（Excel が素直に開ける形）', () => {
    expect(toCsv([['a', 'b']])).toBe('﻿a,b\r\n')
  })

  test('カンマ・引用符・改行を含む値を引用する', () => {
    expect(toCsv([['あ,い', '言"葉', '行\n行']])).toBe('﻿"あ,い","言""葉","行\n行"\r\n')
  })

  test('引用が要らない値は引用しない（差分を読みやすく保つ）', () => {
    expect(toCsv([['栃木市万町24-18']])).toBe('﻿栃木市万町24-18\r\n')
  })

  test('書いて読み直すと元に戻る', () => {
    const rows = [
      ['屋号', 'メモ'],
      ['こまどり楼', 'カンマ, と "引用符" と\n改行'],
    ]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})

describe('resolveColumns', () => {
  test('列の並びが変わっても見出しで解決する', () => {
    const header = [...CSV_HEADERS].reverse()
    expect(resolveColumns(header).name).toBe(CSV_HEADERS.length - 1)
    expect(resolveColumns(header).memo).toBe(0)
  })

  test('Excel の見出しをそのまま貼っても読める', () => {
    const header = [
      '屋号（店舗名）',
      'フリガナ',
      '店舗所在地',
      'TEL',
      '業種',
      'のぼり旗の色：',
    ]
    expect(resolveColumns(header).address).toBe(2)
    expect(resolveColumns(header).flag).toBe(5)
  })

  test('機械が管理する列は無くても読める（列を足す前の CSV を読めるように）', () => {
    const header = ['屋号', 'フリガナ', '住所', '電話番号', '業種', 'のぼり旗の色']
    expect(resolveColumns(header).source).toBe(-1)
    expect(resolveColumns(header).check).toBe(-1)
  })

  test('店舗の中身の列が足りなければ失敗させる（静かに列がずれるのが最悪）', () => {
    expect(() => resolveColumns(['屋号', 'フリガナ'])).toThrow('住所')
  })
})

describe('rowsToShopRows', () => {
  const header = [...CSV_HEADERS]
  const filled = [
    '店',
    'ミセ',
    '栃木市1',
    '0282-1-2',
    'C.小売業',
    '中小店舗',
    '36.1',
    '139.1',
    '人',
    '済',
    '店名で照合した座標',
    'めも',
  ]

  test('屋号の無い行は空行として飛ばす', () => {
    const rows = [header, header.map(() => ''), filled]
    expect(rowsToShopRows(rows)).toHaveLength(1)
  })

  test('前後の空白を落とす（表計算ソフトで入りやすい）', () => {
    const rows = [header, filled.map((v, i) => (i === 0 || i === 2 ? ` ${v} ` : v))]
    expect(rowsToShopRows(rows)[0]?.name).toBe('店')
    expect(rowsToShopRows(rows)[0]?.address).toBe('栃木市1')
  })

  test('列が欠けた短い行でも落ちない', () => {
    const rows = [header, ['店', 'ミセ', '栃木市1']]
    expect(rowsToShopRows(rows)[0]?.memo).toBe('')
    expect(rowsToShopRows(rows)[0]?.check).toBe('')
  })

  test('機械が管理する列が無い CSV は、その列を空として読む', () => {
    const rows = [header.slice(0, 6), filled.slice(0, 6)]
    const shop = rowsToShopRows(rows)[0]
    expect([shop?.lat, shop?.source, shop?.check, shop?.issues]).toEqual(['', '', '', ''])
  })

  test('shopRowsToRows と往復する', () => {
    const rows = [header, filled]
    expect(shopRowsToRows(rowsToShopRows(rows))).toEqual(rows)
  })
})
