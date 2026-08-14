import type { AreaCode } from './shop'

/**
 * 住所から地区を判定する。
 *
 * 栃木市は合併で旧 5 町（大平・藤岡・都賀・西方・岩舟）を含む。
 * 町名は 111 種あり選択肢にできないため、旧市町の単位までまとめる。
 * どの旧町にも該当しない住所は合併前からの市域とみなして `tochigi` にする。
 */
const AREA_PREFIXES: [string, AreaCode][] = [
  ['大平町', 'ohira'],
  ['藤岡町', 'fujioka'],
  ['都賀町', 'tsuga'],
  ['西方町', 'nishikata'],
  ['岩舟町', 'iwafune'],
]

export function areaFromAddress(address: string): AreaCode {
  // 「栃木県」「栃木市」が付く版と付かない版の両方が届きうるため、先に落とす。
  const body = address.replace(/^栃木県/, '').replace(/^栃木市/, '')
  for (const [prefix, code] of AREA_PREFIXES) {
    if (body.startsWith(prefix)) return code
  }
  return 'tochigi'
}
