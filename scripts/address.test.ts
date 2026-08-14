import { describe, expect, test } from 'bun:test'
import { addressVariants, banchi, normalizeAddress } from './address'

/** 候補に含まれるかを見る（順序は「元に近い順」だが、位置そのものは仕様にしない）。 */
function variantsOf(address: string): string[] {
  return addressVariants(address)
}

describe('normalizeAddress', () => {
  test('全角英数とハイフン類を潰す', () => {
    expect(normalizeAddress('栃木市倭町１４－２')).toBe('栃木市倭町14-2')
  })

  test('長音記号が番地区切りに使われていても揃う', () => {
    expect(normalizeAddress('栃木市万町31ー19')).toBe('栃木市万町31-19')
  })

  test('空白は畳むだけで、消さない（番地の判定が数字を跨がないように）', () => {
    expect(normalizeAddress('栃木市 大平町  富田 558-11')).toBe(
      '栃木市 大平町 富田 558-11',
    )
  })
})

describe('banchi', () => {
  test('町名直後の数字の並びだけを取る', () => {
    expect(banchi('栃木市大平町富田558-11プラッツ内')).toEqual(['558', '11'])
  })

  test('番地が無ければ空', () => {
    expect(banchi('栃木市平井町')).toEqual([])
  })
})

describe('addressVariants', () => {
  test('元の住所は含めない', () => {
    expect(variantsOf('栃木市万町31-19')).not.toContain('栃木市万町31-19')
  })

  test('番地の後ろのビル名・部屋番号を落とした候補を出す', () => {
    expect(variantsOf('栃木市境町1-8F1ビル103')).toContain('栃木市境町1-8')
    expect(variantsOf('栃木市川原田町405-6tove103')).toContain('栃木市川原田町405-6')
    expect(variantsOf('栃木市大平町455-4金太郎ビル1F')).toContain('栃木市大平町455-4')
  })

  test('小字を落とした候補を出す', () => {
    expect(variantsOf('栃木市大塚町字岩家521-1')).toContain('栃木市大塚町521-1')
    expect(variantsOf('栃木市箱森町字岡堀690-1')).toContain('栃木市箱森町690-1')
    expect(variantsOf('栃木市西方町金崎字木ノ下263-1')).toContain('栃木市西方町金崎263-1')
  })

  test('大字を落とした候補を出す', () => {
    expect(variantsOf('栃木市岩舟町大字下津原167')).toContain('栃木市岩舟町下津原167')
  })

  test('番号表記をハイフンに揃えた候補を出す', () => {
    // 小字の除去と組み合わせても出ること
    expect(variantsOf('栃木市都賀町家中字三ツ塚1870番1')).toContain(
      '栃木市都賀町家中1870-1',
    )
  })

  test('末尾の号を落とす', () => {
    expect(variantsOf('栃木市平井町公園地内6号')).toContain('栃木市平井町公園地内6')
  })

  test('丁目とハイフンの混在を揃えた候補を出す', () => {
    expect(variantsOf('栃木市城内町2丁目727-1')).toContain('栃木市城内町2-727-1')
    expect(variantsOf('栃木市今泉町2丁目16-23')).toContain('栃木市今泉町2-16-23')
  })

  test('町名の の を ノ にした候補を出す', () => {
    expect(variantsOf('栃木市日の出町14-42')).toContain('栃木市日ノ出町14-42')
  })

  test('番地部分には の → ノ を掛けない', () => {
    for (const variant of variantsOf('栃木市日の出町14-42')) {
      expect(variant).not.toContain('14ノ42')
    }
  })

  test('町 が省かれている町名に町を補った候補を出す', () => {
    expect(variantsOf('栃木市川連650')).toContain('栃木市川連町650')
    expect(variantsOf('栃木市藤岡1015-5')).toContain('栃木市藤岡町1015-5')
  })

  test('すでに町を含む町名には町を補わない', () => {
    for (const variant of variantsOf('栃木市箱森町51-33')) {
      expect(variant).not.toContain('箱森町町')
    }
    // 旧町＋大字の形。`都賀町平川町` という地名は存在しないので候補にしない。
    expect(variantsOf('栃木市都賀町平川661-1')).not.toContain('栃木市都賀町平川町661-1')
  })

  test('小字を落としたうえで町を補う組み合わせも出す', () => {
    expect(variantsOf('栃木市樋ノ口字中芝原75-4')).toContain('栃木市樋ノ口町75-4')
  })

  test('番地の桁数が他の候補より浅いものは出さない', () => {
    // `城内町2` は丁目の代表点にしか当たらず、店舗の位置にならない。
    expect(variantsOf('栃木市城内町2丁目727-1')).not.toContain('栃木市城内町2')
    expect(variantsOf('栃木市城内町2丁目727-1')).toContain('栃木市城内町2-727-1')
  })

  test('候補は重複しない', () => {
    const variants = variantsOf('栃木市都賀町家中字三ツ塚1870番1')
    expect(new Set(variants).size).toBe(variants.length)
  })

  test('候補数は住所 1 件あたり十数件に収まる（問い合わせ費用の上限）', () => {
    expect(variantsOf('栃木市都賀町家中字三ツ塚1870番1').length).toBeLessThanOrEqual(16)
  })
})
