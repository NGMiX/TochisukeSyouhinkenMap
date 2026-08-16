#!/usr/bin/env bun
/**
 * 人が編集する `data/shops.csv` から `public/shops.json` を作る。
 *
 *   bun run import:csv
 *
 * **API は叩かない。** 座標はすでに取ってあるキャッシュ（`data/geocode-cache.json`、
 * `data/places-cache.json`）から決める。新しい住所の座標が要る場合は `bun run geocode`。
 *
 * 方針:
 * - **CSV が正本。** 決まった座標と「確認 / 確認事項」列は CSV に書き戻し、
 *   JSON はその値をそのまま載せる。人が CSV を開けば、地図に出ている位置がそのまま見える。
 * - **座標の出どころが `人` の行は触らない。** 人が地図を見て決めた座標は消すと失われる。
 * - 値の解釈で迷ったら**黙って直さず、警告と確認事項として出して人が判断する**。
 *   個別修正をコードに埋めると、CSV を直す意味が無くなる。
 * - 冪等。CSV を変えずに二度流せば、同じ CSV と同じ JSON が出る。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { areaFromAddress } from '../src/lib/area'
import { normalizeForSearch, shopKey } from '../src/lib/normalize'
import {
  CATEGORY_LABELS,
  type CategoryCode,
  type ShopRecord,
  type ShopsFile,
} from '../src/lib/shop'
import { type ExcelRow, readBaseline } from './baseline'
import {
  type Caches,
  type CoordSource,
  crossCheckMeters,
  isHumanSource,
  type Resolution,
  readCache,
  resolveCoords,
  SOURCE_LABELS,
  unresolvedDetail,
} from './coords'
import { readShopCsv, type ShopRow, writeShopCsv } from './csv'
import { EXCEL_FIELDS, FIELD_LABELS } from './merge'
import { readPlacesCache } from './places'
import { isHidden, updateReview } from './review'

const SHOPS_PATH = resolve(import.meta.dir, '../public/shops.json')

/** 電話番号非公開を意味するダミー値。そのまま表示・発信可能にしてはいけない。 */
const TEL_PLACEHOLDER = '000-0000-0000'

/**
 * 店名で得た座標と住所で得た座標が、これ以上離れていたら人に見てもらう（メートル）。
 *
 * 実データ 493 件のずれは中央値 4m・90% が 27m 以内・最大 146m で、200m を超えるものは無い。
 * 100m を超える 4 件はいずれも敷地の広い店（モール・教習所など）で、
 * 店名の座標が入口を指し、住所の座標が敷地の代表点を指している類。
 * **両方が近ければ人が見に行く必要はない。** 閾値を下げすぎると印だらけになって意味を失う。
 */
const CROSS_CHECK_LIMIT_M = 100

export type BuildReport = {
  shops: ShopRecord[]
  sourceLabel: string
  /** 値を解釈できなかった等、人が見るべきこと。 */
  warnings: string[]
  /** 座標の出どころ別の件数。 */
  counts: Record<CoordSource | 'none', number>
  /** 書き換えた住所で当たったもの（位置の確認用）。 */
  viaVariant: string[]
  /** 店名で当たったもののうち、人に見てほしいもの（住所と離れている・住所では出ない）。 */
  viaPlace: string[]
  /** 座標が付かなかった店と、その理由。 */
  unresolved: string[]
  /** 店名で引いた候補が一致しなかったもの（人が確かめて CSV に入れる材料）。 */
  placeHints: string[]
  /** 人が「非表示」にしたので JSON に出していない店。 */
  hidden: string[]
}

/** 値を解釈できなかったことを人に伝える手段。警告（実行時の出力）と確認事項（CSV の列）。 */
type Report = { warn: (message: string) => void; flag: (issue: string) => void }

/** `A.スーパー・コンビニ` を コードと表示名に割る。 */
function parseCategory(raw: string, label: string, { warn, flag }: Report) {
  const match = raw.normalize('NFKC').match(/^([A-I])\s*[.．]\s*(.+)$/)
  if (match === null) {
    warn(
      `${label}: 業種を解釈できない: ${JSON.stringify(raw)}。この店は JSON に入れていない。`,
    )
    flag('業種を解釈できない')
    return null
  }
  const code = match[1] as CategoryCode
  const name = match[2]?.trim() ?? ''
  const expected = CATEGORY_LABELS[code]
  if (name !== expected) {
    warn(
      `${label}: 業種 ${code} の表示名が既知と異なる。` +
        `CSV「${name}」/ コード上「${expected}」。` +
        'src/lib/shop.ts の CATEGORY_LABELS を確認すること。',
    )
    flag('業種の表示名が既知と異なる')
  }
  return code
}

/**
 * のぼり旗の色から大型店舗かどうかを判定する。
 *
 * 実データは `中小店舗/黄色・青色` と `大型店舗/青色` の 2 値のみ。
 * 想定外の値は握りつぶさない（券種の誤判定は利用者の実害に直結する）。
 */
function parseIsLarge(raw: string, label: string, { warn, flag }: Report) {
  const value = raw.normalize('NFKC').replace(/\s+/g, '')
  if (value.startsWith('大型店舗')) return true
  if (value.startsWith('中小店舗')) return false
  warn(
    `${label}: のぼり旗の色を解釈できない: ${JSON.stringify(raw)}。この店は JSON に入れていない。`,
  )
  flag('のぼり旗の色を解釈できない')
  return null
}

function parseTel(raw: string, label: string, warn: (m: string) => void): string | null {
  const value = raw.normalize('NFKC').trim()
  if (value === '') return null
  // 非公開を意味するダミー値。区切り位置が変わった版でも拾えるよう、
  // 0 とハイフンだけで構成された値はすべて非公開として扱う。
  if (value === TEL_PLACEHOLDER || /^[0-]+$/.test(value)) return null
  if (!/^0\d{1,3}-\d{2,4}-\d{3,4}$/.test(value)) {
    warn(`${label}: 電話番号の形が想定外: ${JSON.stringify(raw)}`)
  }
  return value
}

/** 人が CSV に入れた緯度・経度。両方揃っているときだけ使う。 */
function parseHumanCoords(row: ShopRow, label: string, { warn, flag }: Report) {
  const lat = row.lat.trim()
  const lng = row.lng.trim()
  if (lat === '' || lng === '') {
    warn(
      `${label}: 座標の出どころが「人」なのに緯度・経度が入っていない。` +
        '両方入れるか、出どころの列を空にして機械に任せること。',
    )
    flag('人の座標が入っていない')
    return null
  }
  const values = { lat: Number(lat), lng: Number(lng) }
  if (!Number.isFinite(values.lat) || !Number.isFinite(values.lng)) {
    warn(`${label}: 緯度・経度が数値でない: ${JSON.stringify([lat, lng])}`)
    flag('緯度・経度が数値でない')
    return null
  }
  // 栃木市から極端に離れた値は入力間違い（緯度と経度の取り違えなど）。
  if (Math.abs(values.lat - 36.38) > 1 || Math.abs(values.lng - 139.73) > 1) {
    warn(`${label}: 緯度・経度が栃木市から離れすぎている: ${values.lat}, ${values.lng}`)
    flag('緯度・経度が栃木市から離れすぎている')
  }
  return values
}

/**
 * CSV の行が、市の原本（`data/excel-baseline.json` に控えた Excel）とどう違うかを返す。
 *
 * **CSV が正本なので、違っていても直さない。** ただし「市の原本とどこが違うか」は
 * 人が把握しておくべきことなので、確認事項として毎回出す。
 *
 * **控えと CSV だけから計算する。** `import:excel` のときだけ立てる作りにすると、
 * あとで `import:csv` を流したときに確認事項が消えて、実行するコマンド次第で
 * CSV の中身が変わってしまう。
 */
function diffFromSource(row: ShopRow, source: Map<string, ExcelRow> | null): string[] {
  if (source === null) return []
  const original = source.get(normalizeForSearch(row.name))
  if (original === undefined) return ['市の原本に載っていない']

  const issues: string[] = []
  for (const field of EXCEL_FIELDS) {
    if (row[field] === original[field]) continue
    issues.push(`原本と違う: ${FIELD_LABELS[field]}（原本は「${original[field]}」）`)
  }
  return issues
}

/**
 * 決まった座標を CSV の行に書き戻す。**前回の値から変わっていれば true。**
 *
 * 変わったことは「済」を「要確認」に戻す根拠になる（住所を直して位置がずれた行が
 * 確認済みのまま埋もれるのを防ぐ）。空欄から埋まっただけのときは変化に数えない。
 */
function writeCoords(row: ShopRow, coords: Resolution | null): boolean {
  const before = row.lat === '' || row.lng === '' ? null : `${row.lat},${row.lng}`

  if (coords === null) {
    row.lat = ''
    row.lng = ''
    row.source = ''
  } else {
    row.lat = String(coords.lat)
    row.lng = String(coords.lng)
    row.source = SOURCE_LABELS[coords.source]
  }

  return before !== null && before !== `${row.lat},${row.lng}`
}

/**
 * 1 店舗 1 行で書き出す。
 *
 * 全体を整形すると gzip 後で 3 割ほど太り、逆に全体を 1 行にすると
 * 更新時の差分が読めなくなる。行単位なら git diff が
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

/**
 * CSV から `public/shops.json` を作る。**CSV が正本。**
 *
 * 座標はまずキャッシュ（すでに引いてある結果）から決めて **CSV に書き戻し**、
 * JSON はその CSV の値をそのまま載せる。人が CSV を開けば、地図に出ている位置が
 * そのまま見えている状態を保つ。
 *
 * `bun run geocode` からも呼ぶ。座標の決め方が 1 か所に集まっていないと、
 * 取り込み直すたびに地図上の位置が変わりうる。
 */
export async function buildShops(): Promise<BuildReport> {
  const rows = await readShopCsv()
  if (rows === null) {
    throw new Error(
      'data/shops.csv が無い。先に Excel を取り込むこと:\n' +
        '  bun run import:excel -- data/raw/とち介商品券_0731.xlsx',
    )
  }

  const baseline = await readBaseline()
  // 市の原本の控え。CSV との食い違いを確認事項に出すために引く。
  const sourceRows =
    baseline === null
      ? null
      : new Map(baseline.rows.map((row) => [normalizeForSearch(row.name), row]))
  const caches: Caches = { geocode: await readCache(), places: await readPlacesCache() }

  const warnings: string[] = []
  const warn = (message: string) => warnings.push(message)
  const counts: BuildReport['counts'] = {
    human: 0,
    address: 0,
    variant: 0,
    place: 0,
    none: 0,
  }
  const viaVariant: string[] = []
  const viaPlace: string[] = []
  const unresolved: string[] = []
  const placeHints: string[] = []
  const hidden: string[] = []

  const shops: ShopRecord[] = []
  const seen = new Map<string, string>()
  // 屋号と住所が同じ行は、あとから両方に印を付けるため一度集める。
  const duplicated = new Set<string>()
  for (const row of rows) {
    const id = shopKey(row.name, row.address)
    if (seen.has(id)) duplicated.add(id)
    seen.set(id, row.name)
  }

  for (const row of rows) {
    // 人が「非表示」にした行は機械が素通りする。
    // 座標も引かず、確認事項も立てず、JSON にも出さない。人が書いた記録はそのまま残る。
    if (isHidden(row.check)) {
      hidden.push(`${row.name} / ${row.address}`)
      continue
    }

    const label = `「${row.name}」`
    const issues: string[] = []
    const report: Report = { warn, flag: (issue: string) => issues.push(issue) }
    const flag = report.flag

    const category = parseCategory(row.category, label, report)
    const isLarge = parseIsLarge(row.flag, label, report)

    if (row.address === '') {
      warn(`${label}: 住所が空。この店は JSON に入れていない。`)
      flag('住所が空')
    } else if (!row.address.startsWith('栃木市')) {
      warn(`${label}: 住所が「栃木市」で始まらない: ${JSON.stringify(row.address)}`)
      flag('住所が栃木市で始まらない')
    }
    if (row.kana === '') {
      warn(`${label}: フリガナが空。かな検索に当たらない。`)
      flag('フリガナが空')
    }
    if (duplicated.has(shopKey(row.name, row.address))) {
      flag('屋号と住所が他の行と同じ')
    }
    for (const issue of diffFromSource(row, sourceRows)) flag(issue)

    // 座標を決める。出どころが `人` の行は機械が触らない。
    const shop = { name: row.name, address: row.address }
    const human = isHumanSource(row.source) ? parseHumanCoords(row, label, report) : null
    const coords = resolveCoords(shop, human, caches)

    if (coords === null) {
      counts.none++
      flag('座標が無い（地図に出ない）')
      const detail = unresolvedDetail(shop, caches)
      unresolved.push(
        `${row.name} / ${row.address}` +
          (detail.geocode === null ? '（住所は未問い合わせ）' : ` → ${detail.geocode}`),
      )
      if (detail.place !== null) {
        placeHints.push(
          `${row.name} / ${row.address}\n      Google の候補: ${detail.place.name}` +
            `（${detail.place.formatted}）緯度 ${detail.place.lat}, 経度 ${detail.place.lng}`,
        )
      }
    } else {
      counts[coords.source]++
      if (coords.source === 'variant') {
        flag('住所を書き換えて求めた座標')
        viaVariant.push(`${row.name} / ${row.address} → ${coords.detail}`)
      }
      if (coords.source === 'place') {
        // 住所からも座標が出るなら突き合わせる。近ければ確認は要らない。
        const gap = crossCheckMeters(shop, caches)
        if (gap === null) {
          flag('店名で照合した座標（住所からは求まらない）')
          viaPlace.push(`${row.name} / ${row.address} → ${coords.detail}`)
        } else if (gap > CROSS_CHECK_LIMIT_M) {
          flag(`店名と住所で座標が ${Math.round(gap)}m 離れている`)
          viaPlace.push(
            `${row.name} / ${row.address} → ${coords.detail}` +
              `（住所から求めた位置と ${Math.round(gap)}m 離れている）`,
          )
        }
      }
    }

    // 機械が持つ列を CSV に書き戻す。
    const coordChanged = writeCoords(row, coords)
    const review = updateReview({
      storedCheck: row.check,
      storedIssues: row.issues,
      issues,
      coordChanged,
    })
    row.check = review.check
    row.issues = review.issues

    if (category === null || isLarge === null || row.address === '') continue

    // id と検索インデックスはファイルに持たない（読み込み時に導出する）。
    // 詳細は src/lib/shop.ts の ShopRecord を参照。
    shops.push({
      name: row.name,
      kana: row.kana,
      address: row.address,
      tel: parseTel(row.tel, label, warn),
      category,
      area: areaFromAddress(row.address),
      isLarge,
      // JSON は CSV の値をそのまま載せる（CSV が正本）。
      lat: row.lat === '' ? null : Number(row.lat),
      lng: row.lng === '' ? null : Number(row.lng),
    })
  }

  await writeShopCsv(rows)

  if (shops.length === 0) {
    throw new Error('1 件も取り込めなかった。data/shops.csv の中身を確認すること。')
  }

  // 並び順を固定して冪等にする（git diff で増減が読めるようにするため）。
  shops.sort((a, b) => {
    const left = shopKey(a.name, a.address)
    const right = shopKey(b.name, b.address)
    return left < right ? -1 : left > right ? 1 : 0
  })

  if (baseline === null) {
    warn('data/excel-baseline.json が無い。版のラベルを「不明」にした。')
  }
  const output: ShopsFile = {
    sourceLabel: baseline?.sourceLabel ?? '不明',
    // Excel を取り込んだ日。CSV を直した日ではない（どの版のデータかを示すため）。
    importedAt: baseline?.importedAt ?? new Date().toISOString().slice(0, 10),
    shops,
  }

  await mkdir(dirname(SHOPS_PATH), { recursive: true })
  await writeFile(SHOPS_PATH, serialize(output), 'utf8')

  return {
    shops,
    sourceLabel: output.sourceLabel,
    warnings,
    counts,
    viaVariant,
    viaPlace,
    unresolved,
    placeHints,
    hidden,
  }
}

/** 取り込み結果の報告。`geocode` からも同じ形で出す。 */
export function printReport(report: BuildReport): void {
  const { shops, counts } = report
  const large = shops.filter((s) => s.isLarge).length
  console.log(`\n${shops.length} 件（${report.sourceLabel}） → ${SHOPS_PATH}`)
  if (report.hidden.length > 0) {
    console.log(
      `  非表示                : ${report.hidden.length}（JSON に出していない）`,
    )
  }
  console.log(`  中小店舗（黄色・青色）: ${shops.length - large}`)
  console.log(`  大型店舗（青色のみ）  : ${large}`)
  console.log(`  電話番号なし          : ${shops.filter((s) => s.tel === null).length}`)
  console.log(
    `  座標あり: ${shops.length - counts.none} / ${shops.length}` +
      `（店名 ${counts.place}、住所 ${counts.address}、住所を書き換え ${counts.variant}、` +
      `人が入力 ${counts.human}）`,
  )

  if (report.viaVariant.length > 0) {
    console.log(
      `\n住所を書き換えて解決 ${report.viaVariant.length} 件（位置の確認推奨）:`,
    )
    for (const line of report.viaVariant) console.log(`  - ${line}`)
  }
  if (report.viaPlace.length > 0) {
    console.log(
      `\n店名で解決したうち ${report.viaPlace.length} 件は位置の確認推奨` +
        `（残る ${counts.place - report.viaPlace.length} 件は住所から求めた位置と` +
        `${CROSS_CHECK_LIMIT_M}m 以内で一致）:`,
    )
    for (const line of report.viaPlace) console.log(`  - ${line}`)
  }
  if (report.unresolved.length > 0) {
    console.log(
      `\n座標なし ${report.unresolved.length} 件（リストには出るが地図には出ない）:`,
    )
    for (const line of report.unresolved) console.log(`  - ${line}`)
  }
  if (report.placeHints.length > 0) {
    console.log(
      `\n店名で引いた候補が一致しなかった ${report.placeHints.length} 件` +
        '（人が地図で確かめ、確かなら data/shops.csv の緯度・経度に入れる）:',
    )
    for (const line of report.placeHints) console.log(`  - ${line}`)
  }
  if (report.hidden.length > 0) {
    console.log(`\n非表示 ${report.hidden.length} 件（アプリに出ない）:`)
    for (const line of report.hidden) console.log(`  - ${line}`)
  }
  if (report.warnings.length > 0) {
    console.log(`\n警告 ${report.warnings.length} 件（自動修正はしていない）:`)
    for (const line of report.warnings) console.log(`  - ${line}`)
  }
}

async function main(): Promise<void> {
  printReport(await buildShops())
}

// geocode.ts から読み込まれたときは実行しない。
if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
