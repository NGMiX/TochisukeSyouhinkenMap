import { describe, expect, test } from 'bun:test'
import {
  buildSearchIndex,
  katakanaToHiragana,
  matchesQuery,
  normalizeForDisplay,
  normalizeForSearch,
  normalizeHyphens,
  normalizeQuery,
  shopKey,
} from './normalize'

describe('katakanaToHiragana', () => {
  test('全角カタカナをひらがなにする', () => {
    expect(katakanaToHiragana('セブンイレブン')).toBe('せぶんいれぶん')
  })

  test('長音記号は変換しない', () => {
    expect(katakanaToHiragana('コーヒー')).toBe('こーひー')
  })

  test('漢字・英字はそのまま', () => {
    expect(katakanaToHiragana('栃木市 abc')).toBe('栃木市 abc')
  })
})

describe('normalizeForSearch', () => {
  test('全角英数を半角にする（実データ: ３ＷＩＮ）', () => {
    expect(normalizeForSearch('３ＷＩＮ')).toBe('3win')
  })

  test('全角数字の住所を半角にする（実データ: 栃木市倭町１４－２）', () => {
    expect(normalizeForSearch('栃木市倭町１４－２')).toBe('栃木市倭町14-2')
  })

  test('英字を小文字に寄せる（実データ: nail salon Anna）', () => {
    expect(normalizeForSearch('nail salon Anna')).toBe('nailsalonanna')
  })

  test('空白を完全に除去する', () => {
    expect(normalizeForSearch('アクト ヘアー ディレクト')).toBe('アクトヘアーディレクト')
  })

  test('全角スペースと改行も除去する', () => {
    expect(normalizeForSearch('栃木市新井町1004-2　２F')).toBe('栃木市新井町1004-22f')
    expect(normalizeForSearch('栃木市アンテナショップ\nまちの駅')).toBe(
      '栃木市アンテナショップまちの駅',
    )
  })
})

describe('normalizeHyphens', () => {
  test('全角ハイフンを半角にする', () => {
    expect(normalizeHyphens('栃木市片柳町２－４－３５')).toBe('栃木市片柳町２-４-３５')
  })

  test('U+2212 マイナス記号を半角にする（実データ: 栃木市万町４−３）', () => {
    expect(normalizeHyphens('栃木市万町４−３')).toBe('栃木市万町４-３')
  })

  test('U+2010 ハイフンを半角にする（実データ: 藤岡町大前925‐８）', () => {
    expect(normalizeHyphens('栃木市藤岡町大前925‐８')).toBe('栃木市藤岡町大前925-８')
  })

  test('長音記号が番地区切りに使われた場合も半角にする', () => {
    expect(normalizeHyphens('栃木市境町8ー18')).toBe('栃木市境町8-18')
  })
})

describe('normalizeForDisplay', () => {
  test('セル内改行を空白に畳む（実データ: 屋号 14 件）', () => {
    expect(normalizeForDisplay('栃木市アンテナショップ\nまちの駅コエド市場')).toBe(
      '栃木市アンテナショップ まちの駅コエド市場',
    )
  })

  test('前後の空白を落とす（実データ: AKARI Catering ）', () => {
    expect(normalizeForDisplay('AKARI Catering ')).toBe('AKARI Catering')
  })

  test('語中の空白は 1 つ残す', () => {
    expect(normalizeForDisplay('コスモ石油  岸オイル')).toBe('コスモ石油 岸オイル')
  })
})

describe('buildSearchIndex / matchesQuery', () => {
  const seven = buildSearchIndex({
    name: 'セブンイレブン栃木城内町2丁目店',
    kana: 'セブンイレブントチギジョウナイチョウニチョウメテン',
    address: '栃木市城内町2-1-1',
    categoryLabel: 'スーパー・コンビニ',
  })

  test('カタカナで引ける', () => {
    expect(matchesQuery(seven, 'セブンイレブン')).toBe(true)
  })

  test('ひらがなで引ける', () => {
    expect(matchesQuery(seven, 'せぶんいれぶん')).toBe(true)
  })

  test('漢字で引ける', () => {
    expect(matchesQuery(seven, '城内町')).toBe(true)
  })

  test('住所で引ける', () => {
    expect(matchesQuery(seven, '栃木市城内町')).toBe(true)
  })

  test('業種で引ける', () => {
    expect(matchesQuery(seven, 'コンビニ')).toBe(true)
  })

  test('空白を含むクエリでも引ける', () => {
    expect(matchesQuery(seven, 'セブン イレブン')).toBe(true)
  })

  test('無関係な語には当たらない', () => {
    expect(matchesQuery(seven, 'ラーメン')).toBe(false)
  })

  test('空クエリは全件に当たる', () => {
    expect(matchesQuery(seven, '')).toBe(true)
  })

  test('英字店名は大文字小文字を問わず引ける', () => {
    const index = buildSearchIndex({
      name: 'nail salon Anna',
      kana: 'ネイルサロンアンナ',
      address: '栃木市大平町富田1-1',
      categoryLabel: 'サービス',
    })
    expect(matchesQuery(index, 'NAIL')).toBe(true)
    expect(matchesQuery(index, 'anna')).toBe(true)
    expect(matchesQuery(index, 'ねいるさろん')).toBe(true)
  })

  test('全角英字の店名を半角クエリで引ける（実データ: ３ＷＩＮ）', () => {
    const index = buildSearchIndex({
      name: '３ＷＩＮ',
      kana: 'スリーウィン',
      address: '栃木市片柳町1-1',
      categoryLabel: 'サービス',
    })
    expect(matchesQuery(index, '3win')).toBe(true)
    expect(matchesQuery(index, 'すりーうぃん')).toBe(true)
  })
})

describe('normalizeQuery', () => {
  test('カタカナクエリをひらがなに寄せる', () => {
    expect(normalizeQuery('セブン イレブン')).toBe('せぶんいれぶん')
  })
})

describe('shopKey', () => {
  test('表記ゆれを吸収して同じキーになる', () => {
    expect(shopKey('３ＷＩＮ', '栃木市片柳町２－４－３５')).toBe(
      shopKey('3WIN', '栃木市片柳町2-4-35'),
    )
  })

  test('別の店は別のキーになる', () => {
    expect(shopKey('こまどり楼', '栃木市万町24-18')).not.toBe(
      shopKey('青木商店', '栃木市万町24-18'),
    )
  })

  test('同名でも住所が違えば別のキーになる', () => {
    expect(shopKey('西松屋チェーン', '栃木市箱森町1-1')).not.toBe(
      shopKey('西松屋チェーン', '栃木市合戦場1-1'),
    )
  })
})
