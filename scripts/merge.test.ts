import { describe, expect, test } from 'bun:test'
import type { ExcelRow } from './baseline'
import type { ShopRow } from './csv'
import { mergeShopRows } from './merge'

function excel(overrides: Partial<ExcelRow> = {}): ExcelRow {
  return {
    name: 'こまどり楼',
    kana: 'コマドリロウ',
    address: '栃木市万町24-18',
    tel: '0282-22-1290',
    category: 'E.飲食業',
    flag: '中小店舗/黄色・青色',
    ...overrides,
  }
}

function csv(overrides: Partial<ShopRow> = {}): ShopRow {
  return {
    ...excel(),
    lat: '',
    lng: '',
    source: '',
    check: '',
    issues: '',
    memo: '',
    ...overrides,
  }
}

/** 屋号で行を引く。 */
function find(rows: ShopRow[], name: string): ShopRow | undefined {
  return rows.find((row) => row.name === name)
}

describe('mergeShopRows', () => {
  test('CSV がまだ無ければ Excel をそのまま写す', () => {
    const result = mergeShopRows([excel()], null, null)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.lat).toBe('')
  })

  describe('CSV が正本なので、既存行のデータ列は書き換えない', () => {
    test('原本で値が変わっても CSV は据え置き、報告だけする', () => {
      const result = mergeShopRows([excel({ tel: '0282-22-9999' })], [excel()], [csv()])
      expect(find(result.rows, 'こまどり楼')?.tel).toBe('0282-22-1290')
      expect(result.cityChanged).toHaveLength(1)
      expect(result.cityChanged[0]).toContain('電話番号')
    })

    test('人が直した値を原本の値で巻き戻さない', () => {
      const result = mergeShopRows(
        [excel({ address: '栃木市川連650' })],
        [excel({ address: '栃木市川連650' })],
        [csv({ address: '栃木市大平町川連650' })],
      )
      expect(find(result.rows, 'こまどり楼')?.address).toBe('栃木市大平町川連650')
      expect(result.standing).toHaveLength(1)
      expect(result.cityChanged).toHaveLength(0)
    })

    test('原本が変わったのか人の修正なのかを分けて報告する', () => {
      // 控えと原本が同じ = 人の修正が残っているだけ
      const standing = mergeShopRows(
        [excel()],
        [excel()],
        [csv({ kana: 'コマドリロー' })],
      )
      expect(standing.standing).toHaveLength(1)
      expect(standing.cityChanged).toHaveLength(0)

      // 控えと原本が違う = 市が今回変えた
      const changed = mergeShopRows(
        [excel({ kana: 'コマドリロウホンテン' })],
        [excel()],
        [csv()],
      )
      expect(changed.cityChanged).toHaveLength(1)
      expect(changed.standing).toHaveLength(0)
    })

    test('緯度・経度・確認・メモは持ち越す', () => {
      const mine = csv({
        lat: '36.38',
        lng: '139.73',
        source: '人',
        check: '済',
        issues: '原本と違う: 住所',
        memo: '現地で確認',
      })
      const result = mergeShopRows([excel({ tel: '0282-22-9999' })], [excel()], [mine])
      expect(find(result.rows, 'こまどり楼')).toEqual(mine)
    })
  })

  describe('行の増減', () => {
    test('原本に新しく載った店は足す', () => {
      const added = excel({ name: '新しい店', kana: 'アタラシイミセ' })
      const result = mergeShopRows([excel(), added], [excel()], [csv()])
      expect(result.added).toEqual(['新しい店'])
      expect(find(result.rows, '新しい店')?.check).toBe('')
    })

    test('原本から消えた店は CSV から消さず、報告する', () => {
      const gone = excel({ name: '閉店した店', kana: 'ヘイテンシタミセ' })
      const mine = csv({ name: '閉店した店', kana: 'ヘイテンシタミセ', memo: '確認中' })
      const result = mergeShopRows([excel()], [excel(), gone], [csv(), mine])
      expect(result.cityRemoved).toEqual(['閉店した店'])
      expect(find(result.rows, '閉店した店')).toBeDefined()
    })

    test('人が足した店（原本にも控えにも無い）はそのまま残す', () => {
      const mine = csv({ name: '人が足した店', kana: 'ヒトガタシタミセ' })
      const result = mergeShopRows([excel()], [excel()], [csv(), mine])
      expect(find(result.rows, '人が足した店')).toBeDefined()
      expect(result.cityRemoved).toHaveLength(0)
    })

    test('人が消した店は、原本にまだあっても復活させない', () => {
      const result = mergeShopRows([excel()], [excel()], [])
      expect(result.humanDeleted).toEqual(['こまどり楼'])
      expect(result.rows).toHaveLength(0)
    })
  })

  test('フリガナ順（五十音順）に並べる', () => {
    const rows = [
      excel({ name: 'わかば', kana: 'ワカバ' }),
      excel({ name: 'あさひ', kana: 'アサヒ' }),
      excel({ name: 'なかむら', kana: 'ナカムラ' }),
    ]
    const result = mergeShopRows(rows, null, null)
    expect(result.rows.map((r) => r.name)).toEqual(['あさひ', 'なかむら', 'わかば'])
  })

  test('屋号の表記ゆれ（全角・空白）でも同じ行として突き合わせる', () => {
    const result = mergeShopRows(
      [excel({ name: 'ＡＯＫＩ 栃木店' })],
      [excel({ name: 'ＡＯＫＩ 栃木店' })],
      [csv({ name: 'AOKI栃木店', memo: '表記を直した' })],
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.name).toBe('AOKI栃木店')
    expect(result.added).toHaveLength(0)
  })
})
