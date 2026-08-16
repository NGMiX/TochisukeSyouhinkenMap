/**
 * 新しい Excel が届いたときに、`data/shops.csv` と突き合わせる。
 *
 * **`data/shops.csv` が正本。Excel は「市が何を出したか」の記録に過ぎない。**
 * したがってここでは **CSV のデータ列（屋号・フリガナ・住所・電話番号・業種・のぼり旗の色）を
 * 一切書き換えない。** 食い違いは報告するだけで、取り込むかどうかは人が決める。
 *
 * 機械が CSV に書いてよいのは「確認」「確認事項」と、機械が求めた座標の列だけ。
 * メモは人の欄で、機械は引き継ぐだけ。
 *
 * 行については **Excel に新しく載った店だけを足す**（上書きではないので人の作業を壊さない）。
 * **消しはしない。** 市が外した店も、人が足した店も、行はそのまま残して報告する。
 * 座標やメモを機械の判断で失わせないため。
 *
 * 行の同一性は**屋号**で見る（実データ 655 件で重複なし）。住所は人が直す対象なので鍵にできない。
 */

import { normalizeForSearch } from '../src/lib/normalize'
import type { ExcelRow } from './baseline'
import type { ShopRow } from './csv'

/** Excel から来る列。CSV では人が直しうるので、機械は読むだけ。 */
export const EXCEL_FIELDS = [
  'name',
  'kana',
  'address',
  'tel',
  'category',
  'flag',
] as const

export const FIELD_LABELS: Record<(typeof EXCEL_FIELDS)[number], string> = {
  name: '屋号',
  kana: 'フリガナ',
  address: '住所',
  tel: '電話番号',
  category: '業種',
  flag: 'のぼり旗の色',
}

export type MergeReport = {
  /** 書き出す CSV の行。既存行は**そのまま**、Excel の新規行だけを足したもの。 */
  rows: ShopRow[]
  /** Excel に新しく載ったので追加した店 */
  added: string[]
  /** 前回の原本にあり、今回の原本から消えた店（CSV には残す。掲載終了の可能性） */
  cityRemoved: string[]
  /** 人が CSV から消していて、原本にはまだある店（復活させない） */
  humanDeleted: string[]
  /** 原本側で値が変わった列（CSV は据え置き。取り込むかは人が決める） */
  cityChanged: string[]
  /** 原本と違ったままの列（人の修正が残っている） */
  standing: string[]
}

/** 行の同一性キー。表記ゆれを吸収するため正規化した屋号で見る。 */
function keyOf(row: { name: string }): string {
  return normalizeForSearch(row.name)
}

/** 同じ屋号が複数あっても取りこぼさないよう、2 件目以降は別のキーにする。 */
function indexByName<T extends { name: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>()
  for (const row of rows) {
    let key = keyOf(row)
    for (let i = 2; map.has(key); i++) key = `${keyOf(row)}#${i}`
    map.set(key, row)
  }
  return map
}

function toShopRow(excel: ExcelRow): ShopRow {
  return { ...excel, lat: '', lng: '', source: '', check: '', issues: '', memo: '' }
}

/** フリガナ順（五十音順）に並べる。市の Excel と同じ並びで、人が探しやすい。 */
function byKana(a: ShopRow, b: ShopRow): number {
  const left = `${a.kana} ${a.name}`
  const right = `${b.kana} ${b.name}`
  return left < right ? -1 : left > right ? 1 : 0
}

export function mergeShopRows(
  excel: ExcelRow[],
  baseline: ExcelRow[] | null,
  current: ShopRow[] | null,
): MergeReport {
  const report: MergeReport = {
    rows: [],
    added: [],
    cityRemoved: [],
    humanDeleted: [],
    cityChanged: [],
    standing: [],
  }

  // まだ CSV が無ければ、Excel をそのまま写すだけ。
  if (current === null) {
    report.rows = excel.map(toShopRow).sort(byKana)
    return report
  }

  const baselineByName = indexByName(baseline ?? [])
  const currentByName = indexByName(current)
  // 既存の行はそのまま持ち越す。ここが「CSV が正本」の実装そのもの。
  report.rows = [...current]

  for (const [key, row] of indexByName(excel)) {
    const mine = currentByName.get(key)

    if (mine === undefined) {
      if (baselineByName.has(key)) {
        // 前回の原本にはあり、人が CSV から消した行。原本にまだあるが復活させない。
        report.humanDeleted.push(row.name)
      } else {
        report.added.push(row.name)
        report.rows.push(toShopRow(row))
      }
      continue
    }

    // 列は触らない。違いがあれば、市が変えたのか人の修正なのかを分けて報告するだけ。
    for (const field of EXCEL_FIELDS) {
      if (mine[field] === row[field]) continue
      const label = FIELD_LABELS[field]
      const before = baselineByName.get(key)?.[field]

      if (before !== undefined && before !== row[field]) {
        report.cityChanged.push(
          `${mine.name} の${label}: 原本「${before}」→「${row[field]}」` +
            `（CSV は「${mine[field]}」のまま）`,
        )
      } else {
        report.standing.push(
          `${mine.name} の${label}: CSV「${mine[field]}」/ 原本「${row[field]}」`,
        )
      }
    }
  }

  // 原本に無い行。前回の原本にあったなら市が外した、無かったなら人が足した。
  const excelByName = indexByName(excel)
  for (const [key, row] of currentByName) {
    if (excelByName.has(key)) continue
    if (baselineByName.has(key)) report.cityRemoved.push(row.name)
  }

  report.rows.sort(byKana)
  return report
}
