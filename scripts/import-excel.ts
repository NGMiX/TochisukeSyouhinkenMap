#!/usr/bin/env bun
/**
 * 市から届く Excel を読み、人が編集する `data/shops.csv` を作る（そこから JSON も作る）。
 *
 *   bun run import:excel -- data/raw/2026-08-14-加盟店一覧.xlsx
 *
 *   Excel（原本・触らない）─┐
 *                          ├─▶ data/shops.csv ─▶ public/shops.json
 *              人の手直し ─┘
 *
 * 方針:
 * - **原本の Excel は加工しない。** `data/raw/` に受領時のまま置く。
 *   住所の誤りや閉店・新規開店の反映は CSV 側で行う。
 * - 列は **位置ではなくヘッダー名で解決**する。見つからなければ失敗させる。
 *   取り込みの静かな失敗（列ずれに気付かず変なデータが入る）が最悪の結果になるため。
 * - **すでに CSV があれば、人が直した値を残したまま Excel の更新を取り込む**（`scripts/merge.ts`）。
 *   前回の Excel を `data/excel-baseline.json` に控えてあり、それと突き合わせて
 *   「人が直した列」と「Excel 側で変わった列」を見分ける。
 * - 明らかな誤りを自動修正しない。**警告として出し、人が判断する。**
 * - 冪等。同じ Excel を二度流せば同じ CSV が出る。
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { normalizeForDisplay } from '../src/lib/normalize'
import { type Baseline, type ExcelRow, readBaseline, writeBaseline } from './baseline'
import { CSV_PATH, readShopCsv, writeShopCsv } from './csv'
import { buildShops, printReport } from './import-csv'
import { mergeShopRows } from './merge'

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

/** Excel の全行から、データ行だけを取り出す。 */
function readExcelRows(rows: string[][]): { rows: ExcelRow[]; sourceLabel: string } {
  const { rowIndex, columns } = findHeader(rows)

  // タイトル行から版のラベルを拾う（例: 栃木市とち介商品券取扱加盟店（R8.7.31時点））
  const title = rows
    .slice(0, rowIndex)
    .flat()
    .find((cell) => String(cell).includes('とち介商品券'))
  const sourceLabel = String(title ?? '').match(/（([^）]*時点)）/)?.[1] ?? '不明'

  const result: ExcelRow[] = []
  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i]
    if (row === undefined) continue
    const cell = (key: ColumnKey): string =>
      normalizeForDisplay(String(row[columns[key]] ?? ''))

    // 実データの判定は屋号の有無で行う。行数・使用範囲・No 列は信用しない。
    // 末尾には No だけ入った行と、書式だけ残った完全な空行が数百行続く。
    const name = cell('name')
    if (name === '') continue

    result.push({
      name,
      kana: cell('kana'),
      address: cell('address'),
      tel: cell('tel'),
      category: cell('category'),
      flag: cell('flag'),
    })
  }
  return { rows: result, sourceLabel }
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

  const { rows: excelRows, sourceLabel } = readExcelRows(readSheet(path))
  if (excelRows.length === 0) {
    console.error('1 件も読めなかった。列の解決かシートの選択が誤っている。')
    process.exit(1)
  }

  const previous = await readBaseline()
  const current = await readShopCsv()
  const merge = mergeShopRows(excelRows, previous?.rows ?? null, current)

  await writeShopCsv(merge.rows)
  const baseline: Baseline = {
    sourceLabel,
    importedAt: new Date().toISOString().slice(0, 10),
    source: basename(path),
    rows: excelRows,
  }
  await writeBaseline(baseline)

  console.log(`Excel: ${excelRows.length} 件（${sourceLabel}）← ${basename(path)}`)
  console.log(`CSV  : ${merge.rows.length} 件 → ${CSV_PATH}`)

  const sections: [string, string[]][] = [
    ['原本に新しく載ったので CSV に足した店', merge.added],
    [
      '前回の原本にあり、今回の原本から消えた店（CSV には残した。掲載終了か要確認）',
      merge.cityRemoved,
    ],
    [
      '人が CSV から消していて、原本にはまだある店（消したままにした）',
      merge.humanDeleted,
    ],
    [
      '**原本側で値が変わった列**（CSV は据え置き。取り込むかは人が決める）',
      merge.cityChanged,
    ],
    ['CSV が原本と違うままの列（人の修正が残っている）', merge.standing],
  ]
  for (const [title, lines] of sections) {
    if (lines.length === 0) continue
    console.log(`\n${title} ${lines.length} 件:`)
    for (const line of lines) console.log(`  - ${line}`)
  }

  if (warnings.length > 0) {
    console.log(`\nExcel の読み取りに関する警告 ${warnings.length} 件:`)
    for (const message of warnings) console.log(`  - ${message}`)
  }

  // CSV ができたら、そのまま JSON まで作る（人が続けて 2 コマンド打たなくて済むように）。
  // 原本との食い違いは buildShops が控えから計算して確認事項に出す。
  printReport(await buildShops())
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
