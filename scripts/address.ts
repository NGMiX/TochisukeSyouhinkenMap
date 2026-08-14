/**
 * ジオコーディング用の住所の扱い。
 *
 * 提供 Excel の住所は人が読む前提で書かれており、Google のジオコーダが期待する形
 * （町名＋丁目＋番地）とずれることがある。`字岩家` のような小字、`1870番1` の
 * 番号表記、番地の後ろに続くビル名などが典型で、これらが混じると町の代表点
 * （APPROXIMATE）に落ちて店舗の位置として使えない。
 *
 * ここでは**住所を機械的に書き換えた候補**を作る。個別の店舗に対する修正は書かない
 * （次回の Excel で直っている可能性があるため）。候補で引き直した結果も
 * `geocode.ts` の信用判定を通すので、当たりを緩めることにはならない。
 */

/** 住所に現れるハイフン類。Excel には長音記号（U+30FC）も番地区切りとして混入している。 */
const HYPHENS = /[‐‑‒–—―−－ー]/g

/**
 * 比較・問い合わせ用に住所を揃える。全角英数とハイフン類を潰し、空白を 1 つに畳む。
 *
 * **空白は消さずに残す。** 消すと `2-7 1 KURA` が `2-71KURA` になり、
 * 番地が返り値に含まれるかの判定（`isTrustworthy`）が数字を跨いで狂う。
 */
export function normalizeAddress(address: string): string {
  return address.normalize('NFKC').replace(HYPHENS, '-').replace(/\s+/g, ' ').trim()
}

/**
 * 住所から番地の並びを取り出す（`大平町富田558-11プラッツ内` → `['558','11']`）。
 *
 * 町名の直後にある最初の「数字とハイフンの並び」だけを見る。
 * それ以降はテナント名や部屋番号が続くことが多く、含めると判定が濁る。
 */
export function banchi(address: string): string[] {
  const match = normalizeAddress(address).match(/\d+(?:-\d+)*/)
  return match === null ? [] : match[0].split('-')
}

/** 町名部分（最初の数字より前）と番地以降に切る。 */
function splitAtFirstDigit(address: string): [string, string] {
  const index = address.search(/\d/)
  return index < 0 ? [address, ''] : [address.slice(0, index), address.slice(index)]
}

/** `1870番1` → `1870-1`、`6号` → `6`、`1870番` → `1870`。 */
function normalizeBanchiSeparators(address: string): string {
  return address
    .replace(/(\d)\s*番地?\s*(?=\d)/g, '$1-')
    .replace(/(\d)\s*(?:番地?|号)(?!\d)/g, '$1')
}

/** 番地の後ろに続くビル名・テナント名・部屋番号を落とす（`境町1-8F1ビル103` → `境町1-8`）。 */
function stripAfterBanchi(address: string): string {
  const [head, rest] = splitAtFirstDigit(address)
  const match = rest.match(/^\d+(?:-\d+)*/)
  return match === null ? address : head + match[0]
}

/** 小字を落とす（`大塚町字岩家521-1` → `大塚町521-1`）。Google の住所データに小字は無い。 */
function stripAza(address: string): string {
  // 「字」に続く非数字は小字名。長すぎる一致は誤爆なので範囲を絞る。
  return address.replace(/大字/g, '').replace(/字[^0-9]{1,6}(?=\d)/g, '')
}

/** `2丁目727-1` → `2-727-1`。丁目とハイフンが混在する表記を揃える。 */
function chomeToHyphen(address: string): string {
  return address.replace(/(\d)\s*丁目\s*(?=\d)/g, '$1-')
}

/**
 * 町名の `の` を `ノ` にする（`日の出町` → `日ノ出町`）。
 *
 * 地名の `の`/`ノ` は表記が揺れる。栃木市の住所データ上は `日ノ出町` で、
 * Excel の `日の出町` では番地まで解決しない。番地部分には触らない。
 */
function noToKatakana(address: string): string {
  const [head, rest] = splitAtFirstDigit(address)
  return head.replace(/の/g, 'ノ') + rest
}

/**
 * 町名に `町` を補う（`川連650` → `川連町650`）。Excel では省かれている例がある。
 *
 * すでに `町` を含む町名（`都賀町平川` など旧町＋大字の形）には掛けない。
 * `都賀町平川町` のような存在しない地名を作って無駄に問い合わせるだけになる。
 */
function appendCho(address: string): string {
  const [head, rest] = splitAtFirstDigit(address)
  if (rest === '') return address
  // 市名は判定から外す（`栃木市` の `市` より後ろが町名）。
  const town = head.replace(/^.*[市区郡]/, '')
  if (town === '' || town.includes('町')) return address
  return `${head}町${rest}`
}

/**
 * 適用するかしないかを選べる規則。
 * 部分集合の全通りを試すため、規則の数が少ない候補から順に返す。
 */
const OPTIONAL_RULES = [stripAza, chomeToHyphen, noToKatakana, appendCho]

/**
 * 引き直す候補の住所を、元の住所に近いものから順に返す。
 *
 * 元の住所そのものは含めない（既に問い合わせ済みのため）。
 * 番号表記の揃えとビル名の除去は常に掛け、それ以外は組み合わせで試す。
 */
export function addressVariants(address: string): string[] {
  // ビル名の除去は最後に掛ける。先に掛けると `2丁目727-1` の `727-1` が
  // 番地の外と見なされて落ち、丁目を揃える規則が働かなくなる。
  const base = normalizeBanchiSeparators(normalizeAddress(address))

  const variants: string[] = []
  const seen = new Set([address])

  // 規則の数が少ない順（元の住所からの離れ方が小さい順）に並べる。
  const masks = Array.from(
    { length: 1 << OPTIONAL_RULES.length },
    (_, mask) => mask,
  ).sort((a, b) => popcount(a) - popcount(b) || a - b)

  for (const mask of masks) {
    let candidate = base
    for (const [i, rule] of OPTIONAL_RULES.entries()) {
      if (mask & (1 << i)) candidate = rule(candidate)
    }
    candidate = stripAfterBanchi(candidate)
    if (seen.has(candidate)) continue
    seen.add(candidate)
    variants.push(candidate)
  }

  // 番地の桁数が他の候補より少ないものを捨てる。
  // `2丁目727-1` を揃えずに切ると `城内町2` だけが残り、丁目の代表点に当たってしまう。
  const depth = Math.max(0, ...variants.map((v) => banchi(v).length))
  return variants.filter((v) => banchi(v).length === depth)
}

function popcount(value: number): number {
  let count = 0
  for (let v = value; v !== 0; v >>= 1) count += v & 1
  return count
}
