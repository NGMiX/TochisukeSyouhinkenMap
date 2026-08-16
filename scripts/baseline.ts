/**
 * 前回取り込んだ Excel の内容（`data/excel-baseline.json`）。
 *
 * **人は開かない。** これは「市の Excel には何が書いてあったか」の記録で、
 * 次に Excel が届いたときに「人が CSV で直した値」と「Excel 側で変わった値」を
 * 見分けるためだけに使う（3 つを突き合わせるのに、基準が要る）。
 *
 * 版のラベル（`R8.7.31時点`）もここに持つ。CSV には無い情報で、
 * `public/shops.json` に載せて画面のヘッダーに出している。
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { ShopRow } from './csv'

export const BASELINE_PATH = resolve(import.meta.dir, '../data/excel-baseline.json')

/** Excel から読める列だけ。CSV 独自の列（緯度・経度・メモ）は含めない。 */
export type ExcelRow = Pick<
  ShopRow,
  'name' | 'kana' | 'address' | 'tel' | 'category' | 'flag'
>

export type Baseline = {
  /** 元となった Excel の版（例: `R8.7.31時点`） */
  sourceLabel: string
  /** 取り込みを実行した日付 (YYYY-MM-DD) */
  importedAt: string
  /** 取り込んだファイル名。どの版から入ったかを追えるようにする。 */
  source: string
  rows: ExcelRow[]
}

export async function readBaseline(): Promise<Baseline | null> {
  if (!existsSync(BASELINE_PATH)) return null
  return JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as Baseline
}

export async function writeBaseline(baseline: Baseline): Promise<void> {
  await mkdir(dirname(BASELINE_PATH), { recursive: true })
  // 1 店舗 1 行。git diff で増減が読めるようにする。
  const head = [
    '{',
    `  "sourceLabel": ${JSON.stringify(baseline.sourceLabel)},`,
    `  "importedAt": ${JSON.stringify(baseline.importedAt)},`,
    `  "source": ${JSON.stringify(baseline.source)},`,
    '  "rows": [',
  ]
  const body = baseline.rows.map(
    (row, i) => `    ${JSON.stringify(row)}${i === baseline.rows.length - 1 ? '' : ','}`,
  )
  await writeFile(BASELINE_PATH, `${[...head, ...body, '  ]', '}'].join('\n')}\n`, 'utf8')
}
