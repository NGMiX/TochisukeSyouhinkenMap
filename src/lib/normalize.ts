/**
 * 検索用の正規化。
 *
 * 取り込み側（Node / Bun）と検索側（ブラウザ）で **同じ実装を共有する**。
 * 片方だけ変更すると、インデックスとクエリの正規化がずれて検索が静かに当たらなくなる。
 */

/** カタカナ → ひらがな。長音符（ー）はそのまま残す。 */
export function katakanaToHiragana(input: string): string {
  return input.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
}

/**
 * ハイフン類を半角ハイフンに寄せる。
 *
 * 提供 Excel の住所には U+FF0D / U+2212 / U+2010 に加えて **U+30FC（長音記号）が
 * 番地区切りとして混入している**。NFKC は U+30FC を変換しないため、ここで個別に潰す。
 * ただし katakanaToHiragana より後に呼ぶと「コーヒー」等の長音まで壊れるため、
 * **住所にのみ適用する**こと。
 */
export function normalizeHyphens(input: string): string {
  return input.replace(/[‐‑‒–—―−－ー]/g, '-')
}

/** 表示用。改行と連続空白を 1 つの半角スペースに畳み、前後を落とす。 */
export function normalizeForDisplay(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

/**
 * 検索用。NFKC → 小文字化 → 空白を完全除去。
 *
 * 空白を残さないのは、利用者が「セブン イレブン」と打っても
 * 「セブンイレブン」に当たるようにするため。クエリ側にも同じ処理をかける。
 */
export function normalizeForSearch(input: string): string {
  return input.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

/**
 * 店舗 1 件から検索対象文字列を組み立てる。
 *
 * フリガナはカタカナのままだと「せぶん」で当たらないため、ひらがなに変換した形も含める。
 * 漢字表記・カタカナ表記・ひらがな表記・住所のいずれで打っても引けるようにする。
 */
export function buildSearchIndex(parts: {
  name: string
  kana: string
  address: string
  categoryLabel: string
}): string {
  const name = normalizeForSearch(parts.name)
  const kana = normalizeForSearch(parts.kana)
  const address = normalizeForSearch(parts.address)
  const category = normalizeForSearch(parts.categoryLabel)
  return [name, kana, katakanaToHiragana(kana), address, category].join(' ')
}

/** クエリ正規化。インデックス側と同じ規則を通す。 */
export function normalizeQuery(query: string): string {
  return katakanaToHiragana(normalizeForSearch(query))
}

/**
 * 検索語がインデックスに当たるか。
 *
 * インデックスにはカタカナ形とひらがな形の両方が入っているので、
 * クエリをひらがなに寄せた形と、寄せる前の形の両方で見る。
 */
export function matchesQuery(index: string, query: string): boolean {
  const raw = normalizeForSearch(query)
  if (raw === '') return true
  const hira = katakanaToHiragana(raw)
  return index.includes(raw) || index.includes(hira)
}

/**
 * 店舗の同一性キー。
 *
 * Excel の `No.` 列は五十音順の通し番号と見られ、版をまたいで安定しない可能性が高い。
 * 屋号と住所の正規化値から作る。URL に載せる ID もこれを使う。
 */
export function shopKey(name: string, address: string): string {
  return `${normalizeForSearch(name)}|${normalizeHyphens(normalizeForSearch(address))}`
}
