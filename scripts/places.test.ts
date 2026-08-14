import { describe, expect, test } from 'bun:test'
import { isTrustworthyPlace, type PlaceEntry, placeQuery } from './places'

/** 栃木市箱森町付近。 */
const IN_TOCHIGI = { lat: 36.3785, lng: 139.7215 }

function place(overrides: Partial<PlaceEntry> = {}): PlaceEntry {
  return {
    ...IN_TOCHIGI,
    name: 'ヤマダデンキ テックランド栃木店',
    formatted: '日本、〒328-0075 栃木県栃木市箱森町690-1',
    ...overrides,
  }
}

const shop = {
  name: 'ヤマダデンキ テックランド栃木店',
  address: '栃木市箱森町字岡堀690-1',
}

describe('placeQuery', () => {
  test('店名と住所から作る（住所が無いとチェーン店を絞れない）', () => {
    expect(placeQuery(shop)).toBe(
      'ヤマダデンキテックランド栃木店 栃木市箱森町字岡堀690-1',
    )
  })

  test('同じ店なら同じ文字列（キャッシュのキーになるため）', () => {
    expect(placeQuery(shop)).toBe(placeQuery({ ...shop }))
  })
})

describe('isTrustworthyPlace', () => {
  test('店名と番地が合えば採用する（小字は Google 側に無くてよい）', () => {
    expect(isTrustworthyPlace(place(), shop)).toBe(true)
  })

  test('Excel が店名を省いていても、含まれていれば採用する', () => {
    expect(
      isTrustworthyPlace(
        place({
          name: '元祖田舎そば すぎのや本陣 栃木店',
          formatted: '日本、〒328-0033 栃木県栃木市城内町2-727-1',
        }),
        { name: 'すぎのや本陣栃木店', address: '栃木市城内町2丁目727-1' },
      ),
    ).toBe(true)
  })

  test('Google 側のハイフンは店名の違いと見なさない', () => {
    expect(
      isTrustworthyPlace(
        place({
          name: 'セブン-イレブン 都賀インター南店',
          formatted: '〒328-0111 栃木県栃木市都賀町家中7775',
          lat: 36.4285,
          lng: 139.7529,
        }),
        { name: 'セブンイレブン都賀インター南店', address: '栃木市都賀町家中小松原7775' },
      ),
    ).toBe(true)
  })

  test('法人格は店名の違いと見なさない（Excel 側は省いている）', () => {
    expect(
      isTrustworthyPlace(
        place({
          name: '（有）フローリストアイ',
          formatted: '〒328-0033 栃木県栃木市城内町2丁目23-6 204 1階',
          lat: 36.3715,
          lng: 139.7487,
        }),
        { name: 'フローリストアイ本店', address: '栃木市城内店2-23-6' },
      ),
    ).toBe(true)
  })

  test('番地が合っていても別の店なら採用しない', () => {
    // シャディ・サラダ館 大町店。同じチェーンの別の支店を返した例。
    expect(
      isTrustworthyPlace(
        place({
          name: 'シャディ・サラダ館 大町店',
          formatted: '〒328-0071 栃木県栃木市大町35-4',
        }),
        { name: 'サラダ館 栃木城内店', address: '栃木市城内町2-44-37' },
      ),
    ).toBe(false)
  })

  test('番地が違えば採用しない（近所の別の店を返すことがある）', () => {
    expect(
      isTrustworthyPlace(
        place({ formatted: '日本、〒328-0075 栃木県栃木市箱森町41-11' }),
        shop,
      ),
    ).toBe(false)
  })

  test('店名が違えば採用しない', () => {
    expect(isTrustworthyPlace(place({ name: 'ケーズデンキ栃木店' }), shop)).toBe(false)
  })

  test('栃木市の外なら採用しない', () => {
    expect(
      isTrustworthyPlace(
        place({ formatted: '日本、〒320-0033 栃木県宇都宮市690-1' }),
        shop,
      ),
    ).toBe(false)
  })

  test('住所が栃木市でも座標が遠ければ採用しない', () => {
    expect(isTrustworthyPlace(place({ lat: 35.6812, lng: 139.7671 }), shop)).toBe(false)
  })

  test('番地の無い住所は判定できないので採用しない', () => {
    expect(
      isTrustworthyPlace(place(), { name: shop.name, address: '栃木市箱森町' }),
    ).toBe(false)
  })
})
