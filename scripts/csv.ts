/**
 * 人が編集する店舗リスト `data/shops.csv` の読み書き。
 *
 * **市から届く Excel は原本として `data/raw/` に置いたまま触らない。**
 * 住所の誤り・閉店・新規開店・手で調べた座標といった手直しはこの CSV で行い、
 * `public/shops.json` はここから作る（`bun run import:csv`）。
 *
 * Excel や表計算ソフトで開いて編集される前提のファイルなので:
 * - **UTF-8 の BOM を付ける。** 無いと Windows の Excel が Shift_JIS と解釈して文字化けする。
 * - **改行は CRLF。** 同じ理由で、Excel がそのまま開ける形に寄せる。
 * - **解析は自前で行い、すべて文字列として扱う。** 表計算ソフトのパーサに掛けると
 *   電話番号や番地が日付・数値に化ける。列の意味を保つ方を優先する。
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export const CSV_PATH = resolve(import.meta.dir, '../data/shops.csv')

/**
 * CSV の 1 行。**すべて文字列**（人が書いた通りに持ち、解釈は取り込み側で行う）。
 *
 * 誰がその列を書くかが決まっている:
 *
 * | 列 | 書くのは |
 * | --- | --- |
 * | 屋号〜のぼり旗の色 | Excel（人が直してよい） |
 * | 緯度・経度・座標の出どころ | 機械。ただし**出どころが `人` の行は機械が触らない** |
 * | 確認 | 機械が `要確認` を立て、**人が `済` にする** |
 * | 確認事項 | 機械。毎回書き直す |
 * | メモ | 人だけ。機械は引き継ぐだけで中身を見ない |
 */
export type ShopRow = {
  name: string
  kana: string
  address: string
  tel: string
  /** `C.小売業` の形。Excel の表記のまま。 */
  category: string
  /** `中小店舗/黄色・青色` の形。Excel の表記のまま。 */
  flag: string
  lat: string
  lng: string
  /** `人` / `住所` / `住所を書き換え` / `店名`。`人` の行は機械が座標を書き換えない。 */
  source: string
  /** 空欄 / `要確認` / `済`。 */
  check: string
  /** なぜ確認が要るのか。機械が毎回書き直すので、人の書き込みはメモ欄へ。 */
  issues: string
  /** なぜ直したかを人が残す欄。取り込みでは使わないが、更新時に引き継ぐ。 */
  memo: string
}

type Column = {
  key: keyof ShopRow
  label: string
  /** 別の書き方でも読めるようにする（Excel の見出しをそのまま貼った場合など）。 */
  aliases?: string[]
  /**
   * 無くても読める列。**機械が管理する列と人のメモだけ**に付ける。
   *
   * 店舗の中身（屋号〜のぼり旗の色）は欠けたら失敗させる。列が静かにずれて
   * 別の値が入るのが最悪の結果になるため。一方これらは列を作り直せば済むので、
   * 古い CSV をそのまま読めることを優先する。
   */
  optional?: true
}

/** 列の並び。人が読む順に置く。前半は Excel と同じ並び。 */
const COLUMNS: Column[] = [
  { key: 'name', label: '屋号', aliases: ['屋号（店舗名）', '店舗名'] },
  { key: 'kana', label: 'フリガナ' },
  { key: 'address', label: '住所', aliases: ['店舗所在地'] },
  { key: 'tel', label: '電話番号', aliases: ['TEL'] },
  { key: 'category', label: '業種' },
  { key: 'flag', label: 'のぼり旗の色', aliases: ['のぼり旗の色：', '店舗区分'] },
  { key: 'lat', label: '緯度', optional: true },
  { key: 'lng', label: '経度', optional: true },
  { key: 'source', label: '座標の出どころ', optional: true },
  { key: 'check', label: '確認', optional: true },
  { key: 'issues', label: '確認事項', optional: true },
  { key: 'memo', label: 'メモ', aliases: ['備考'], optional: true },
]

export const CSV_HEADERS = COLUMNS.map((column) => column.label)

/** 見出しの照合用。空白・全角半角・末尾のコロンの差を無視する。 */
function headerKey(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[:：]$/, '')
}

/**
 * RFC 4180 の CSV を行×列に開く。
 *
 * 引用符の中の改行とカンマ、`""` による引用符のエスケープを扱う。
 * 先頭の BOM は落とす（Excel が付けるため）。
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < source.length; i++) {
    const char = source[i]

    if (quoted) {
      if (char === '"') {
        // 引用符の中の `""` は引用符 1 つ。
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  // 末尾に改行があれば、その時点で行は閉じている。
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** 行×列を CSV の文字列にする（BOM 付き・CRLF）。 */
export function toCsv(rows: string[][]): string {
  const body = rows.map((row) => row.map(escapeField).join(',')).join('\r\n')
  return `\uFEFF${body}\r\n`
}

/**
 * 見出し行から列の位置を決める。
 *
 * **位置ではなく見出し名で解決し、見つからなければ失敗させる。**
 * 人が列を入れ替えたり増やしたりしても壊れないようにするため。
 * 静かに列がずれて別の値が入るのが最悪の結果になる。
 */
export function resolveColumns(header: string[]): Record<keyof ShopRow, number> {
  const found = {} as Record<keyof ShopRow, number>
  const missing: string[] = []

  for (const column of COLUMNS) {
    const labels = [column.label, ...(column.aliases ?? [])].map(headerKey)
    const index = header.findIndex((cell) => labels.includes(headerKey(cell)))
    // 無い列は -1。必須の列だけを missing に積む。
    found[column.key] = index
    if (index < 0 && column.optional !== true) missing.push(column.label)
  }

  if (missing.length > 0) {
    throw new Error(
      `data/shops.csv の見出しに列が見つからない: ${missing.join(', ')}\n` +
        `実際の見出し: ${header.join(' | ')}`,
    )
  }
  return found
}

export function rowsToShopRows(rows: string[][]): ShopRow[] {
  const header = rows[0]
  if (header === undefined) throw new Error('data/shops.csv が空。')
  const columns = resolveColumns(header)

  const shops: ShopRow[] = []
  for (const row of rows.slice(1)) {
    const cell = (key: keyof ShopRow): string => {
      const index = columns[key]
      return index < 0 ? '' : (row[index] ?? '').trim()
    }
    // 屋号の無い行は空行とみなす（末尾の空行や、人が消しかけた行）。
    if (cell('name') === '') continue
    shops.push({
      name: cell('name'),
      kana: cell('kana'),
      address: cell('address'),
      tel: cell('tel'),
      category: cell('category'),
      flag: cell('flag'),
      lat: cell('lat'),
      lng: cell('lng'),
      source: cell('source'),
      check: cell('check'),
      issues: cell('issues'),
      memo: cell('memo'),
    })
  }
  return shops
}

export function shopRowsToRows(shops: ShopRow[]): string[][] {
  return [CSV_HEADERS, ...shops.map((shop) => COLUMNS.map((column) => shop[column.key]))]
}

/** CSV を読む。まだ作られていなければ null。 */
export async function readShopCsv(): Promise<ShopRow[] | null> {
  if (!existsSync(CSV_PATH)) return null
  return rowsToShopRows(parseCsv(await readFile(CSV_PATH, 'utf8')))
}

export async function writeShopCsv(shops: ShopRow[]): Promise<void> {
  await mkdir(dirname(CSV_PATH), { recursive: true })
  await writeFile(CSV_PATH, toCsv(shopRowsToRows(shops)), 'utf8')
}
