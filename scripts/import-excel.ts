#!/usr/bin/env bun
/**
 * 市から届く Excel を読み、`public/shops.json` を生成する。
 *
 *   bun run import:excel -- data/raw/2026-08-14-加盟店一覧.xlsx
 *
 * 方針:
 * - 列は **位置ではなくヘッダー名で解決**する。見つからなければ失敗させる。
 *   取り込みの静かな失敗（列ずれに気付かず変なデータが入る）が最悪の結果になるため。
 * - 明らかな誤りを自動修正しない。**警告として出し、人が判断する。**
 *   次の版で直っている可能性があり、個別修正をコードに埋めると腐る。
 * - 冪等。同じ Excel を二度流せば同じ JSON が出る。
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { areaFromAddress } from '../src/lib/area'
import { normalizeForDisplay, shopKey } from '../src/lib/normalize'
import {
  CATEGORY_LABELS,
  type CategoryCode,
  type ShopRecord,
  type ShopsFile,
} from '../src/lib/shop'

/** 電話番号非公開を意味するダミー値。そのまま表示・発信可能にしてはいけない。 */
const TEL_PLACEHOLDER = '000-0000-0000'

/** 期待するヘッダー。表記ゆれに備えて正規化して突き合わせる。 */
const COLUMNS = {
  no: 'No.',
  name: '屋号（店舗名）',
  kana: 'フリガナ',
  address: '店舗所在地',
  tel: 'TEL',
  category: '業種',
  flag: 'のぼり旗の色：',
} as const

type ColumnKey = keyof typeof COLUMNS

const warnings: string[] = []
function warn(message: string): void {
  warnings.push(message)
}

/** ヘッダー照合用。空白と全角半角の差を無視する。 */
function headerKey(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[:：]$/, '')
}

function readSheet(path: string): string[][] {
  const workbook = XLSX.read(readFileSync(path), { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (sheetName === undefined) {
    throw new Error(`シートが 1 枚も無い: ${path}`)
  }
  if (workbook.SheetNames.length > 1) {
    warn(
      `シートが ${workbook.SheetNames.length} 枚ある。先頭「${sheetName}」だけを読んだ: ` +
        workbook.SheetNames.join(' / '),
    )
  }
  const sheet = workbook.Sheets[sheetName]
  if (sheet === undefined) {
    throw new Error(`シートを読めない: ${sheetName}`)
  }
  // defval を指定して、空セルでも列位置がずれないようにする。
  return XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: true,
  })
}

/**
 * ヘッダー行を探す。
 *
 * 1〜2 行目にタイトルと注記があり 3 行目がヘッダー、という構造だが、
 * 版によって前置きの行数が変わりうるため位置を決め打ちにしない。
 */
function findHeader(rows: string[][]): {
  rowIndex: number
  columns: Record<ColumnKey, number>
} {
  const wanted = Object.entries(COLUMNS) as [ColumnKey, string][]

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i]
    if (row === undefined) continue
    const found = {} as Record<ColumnKey, number>
    let hits = 0
    for (const [key, label] of wanted) {
      const index = row.findIndex((cell) => headerKey(String(cell)) === headerKey(label))
      if (index >= 0) {
        found[key] = index
        hits++
      }
    }
    if (hits === wanted.length) return { rowIndex: i, columns: found }
    if (hits > 0 && hits >= wanted.length - 2) {
      // 惜しい行が見つかった場合、どの列が欠けたかを添えて落とす。
      const missing = wanted
        .filter(([key]) => found[key] === undefined)
        .map(([, label]) => label)
      throw new Error(
        `${i + 1} 行目がヘッダーらしいが、列が見つからない: ${missing.join(', ')}\n` +
          `実際の行: ${row.filter((c) => c !== '').join(' | ')}`,
      )
    }
  }
  throw new Error(
    'ヘッダー行を特定できなかった。列名が変わった可能性がある。\n' +
      `期待した列: ${wanted.map(([, label]) => label).join(', ')}`,
  )
}

/** `A.スーパー・コンビニ` を コードと表示名に割る。 */
function parseCategory(raw: string, rowLabel: string): CategoryCode | null {
  const match = raw.normalize('NFKC').match(/^([A-I])\s*[.．]\s*(.+)$/)
  if (match === null) {
    warn(`${rowLabel}: 業種を解釈できない: ${JSON.stringify(raw)}`)
    return null
  }
  const code = match[1] as CategoryCode
  const label = match[2]?.trim() ?? ''
  const expected = CATEGORY_LABELS[code]
  if (label !== expected) {
    warn(
      `${rowLabel}: 業種 ${code} の表示名が既知と異なる。` +
        `Excel「${label}」/ コード上「${expected}」。` +
        'src/lib/shop.ts の CATEGORY_LABELS を確認すること。',
    )
  }
  return code
}

/**
 * のぼり旗の色から大型店舗かどうかを判定する。
 *
 * 実データは `中小店舗/黄色・青色` と `大型店舗/青色` の 2 値のみ。
 * 想定外の値は握りつぶさず失敗させる（券種の誤判定は利用者の実害に直結する）。
 */
function parseIsLarge(raw: string, rowLabel: string): boolean | null {
  const value = raw.normalize('NFKC').replace(/\s+/g, '')
  if (value.startsWith('大型店舗')) return true
  if (value.startsWith('中小店舗')) return false
  warn(
    `${rowLabel}: のぼり旗の色を解釈できない: ${JSON.stringify(raw)}。この店は除外した。`,
  )
  return null
}

function parseTel(raw: string, rowLabel: string): string | null {
  const value = raw.normalize('NFKC').trim()
  if (value === '') return null
  // 非公開を意味するダミー値。区切り位置が変わった版でも拾えるよう、
  // 0 とハイフンだけで構成された値はすべて非公開として扱う。
  if (value === TEL_PLACEHOLDER || /^[0-]+$/.test(value)) return null
  if (!/^0\d{1,3}-\d{2,4}-\d{3,4}$/.test(value)) {
    warn(`${rowLabel}: 電話番号の形が想定外: ${JSON.stringify(raw)}`)
  }
  return value
}

/**
 * 1 店舗 1 行で書き出す。
 *
 * 全体を整形すると gzip 後で 3 割ほど太り、逆に全体を 1 行にすると
 * Excel 更新時の差分が読めなくなる。行単位なら git diff が
 * 「どの店が増えて、どの店が消えたか」をそのまま見せてくれる。
 */
function serialize(file: ShopsFile): string {
  const head = [
    '{',
    `  "sourceLabel": ${JSON.stringify(file.sourceLabel)},`,
    `  "importedAt": ${JSON.stringify(file.importedAt)},`,
    '  "shops": [',
  ]
  const body = file.shops.map(
    (shop, i) => `    ${JSON.stringify(shop)}${i === file.shops.length - 1 ? '' : ','}`,
  )
  return `${[...head, ...body, '  ]', '}'].join('\n')}\n`
}

async function main(): Promise<void> {
  const input = process.argv[2]
  if (input === undefined) {
    console.error(
      'Excel のパスを指定すること。\n' +
        '  bun run import:excel -- data/raw/2026-08-14-加盟店一覧.xlsx\n\n' +
        '最新ファイルの自動選択はしない。どの版を取り込んだか不明瞭になるため。',
    )
    process.exit(1)
  }
  const path = resolve(input)
  if (!existsSync(path)) {
    console.error(`ファイルが無い: ${path}`)
    process.exit(1)
  }

  const rows = readSheet(path)
  const { rowIndex, columns } = findHeader(rows)

  // タイトル行から版のラベルを拾う（例: 栃木市とち介商品券取扱加盟店（R8.7.31時点））
  const title = rows
    .slice(0, rowIndex)
    .flat()
    .find((cell) => String(cell).includes('とち介商品券'))
  const sourceLabel = String(title ?? '').match(/（([^）]*時点)）/)?.[1] ?? '不明'

  const shops: ShopRecord[] = []
  const seen = new Map<string, number>()

  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i]
    if (row === undefined) continue
    const cell = (key: ColumnKey): string => String(row[columns[key]] ?? '')

    // 実データの判定は屋号の有無で行う。行数・使用範囲・No 列は信用しない。
    // 末尾には No だけ入った行と、書式だけ残った完全な空行が数百行続く。
    const rawName = cell('name').trim()
    if (rawName === '') continue

    const rowLabel = `row ${i + 1}「${normalizeForDisplay(rawName)}」`

    const category = parseCategory(cell('category'), rowLabel)
    const isLarge = parseIsLarge(cell('flag'), rowLabel)
    if (category === null || isLarge === null) continue

    const name = normalizeForDisplay(rawName)
    const kana = normalizeForDisplay(cell('kana'))
    const address = normalizeForDisplay(cell('address'))

    if (address === '') {
      warn(`${rowLabel}: 住所が空。除外した。`)
      continue
    }
    if (kana === '') {
      warn(`${rowLabel}: フリガナが空。かな検索に当たらない。`)
    }
    if (!address.startsWith('栃木市')) {
      warn(`${rowLabel}: 住所が「栃木市」で始まらない: ${JSON.stringify(address)}`)
    }

    const id = shopKey(name, address)
    const duplicate = seen.get(id)
    if (duplicate !== undefined) {
      warn(
        `${rowLabel}: row ${duplicate} と屋号・住所が同一。重複の可能性がある。両方とも残した。`,
      )
    } else {
      seen.set(id, i + 1)
    }

    // id と検索インデックスはファイルに持たない（読み込み時に導出する）。
    // 詳細は src/lib/shop.ts の ShopRecord を参照。
    shops.push({
      name,
      kana,
      address,
      tel: parseTel(cell('tel'), rowLabel),
      category,
      area: areaFromAddress(address),
      isLarge,
      lat: null,
      lng: null,
    })
  }

  if (shops.length === 0) {
    console.error('1 件も取り込めなかった。列の解決かシートの選択が誤っている。')
    process.exit(1)
  }

  // 並び順を固定して冪等にする（git diff で増減が読めるようにするため）。
  // Excel の No. 順は五十音の通し番号で版ごとにずれるため、同一性キー順で並べる。
  shops.sort((a, b) => {
    const left = shopKey(a.name, a.address)
    const right = shopKey(b.name, b.address)
    return left < right ? -1 : left > right ? 1 : 0
  })

  const output: ShopsFile = {
    sourceLabel,
    importedAt: new Date().toISOString().slice(0, 10),
    shops,
  }

  const outPath = resolve(import.meta.dir, '../public/shops.json')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, serialize(output), 'utf8')

  const large = shops.filter((s) => s.isLarge).length
  console.log(`取り込み: ${shops.length} 件（${sourceLabel}）`)
  console.log(`  中小店舗（黄色・青色）: ${shops.length - large}`)
  console.log(`  大型店舗（青色のみ）  : ${large}`)
  console.log(`  電話番号なし          : ${shops.filter((s) => s.tel === null).length}`)
  console.log(`出力: ${outPath}`)

  if (warnings.length > 0) {
    console.log(`\n警告 ${warnings.length} 件（自動修正はしていない）:`)
    for (const message of warnings) console.log(`  - ${message}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
