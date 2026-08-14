#!/usr/bin/env bun
/**
 * `public/shops.json` の住所をジオコーディングして緯度経度を書き戻す。
 *
 *   GEOCODING_API_KEY=... bun run geocode
 *   GEOCODING_API_KEY=... bun run geocode -- --limit 10   # 試しに 10 件だけ
 *
 * 方針:
 * - **結果は `data/geocode-cache.json` にキャッシュしてコミットする。**
 *   住所文字列がキーなので、Excel が更新されても住所が変わっていない店は問い合わせない。
 *   655 件を毎回引き直すのは無駄で、費用も無意味に増える。
 * - **精度が低い結果を黙って採用しない。** 日本の住所は建物名や枝番で失敗しやすく、
 *   町の代表点に落ちることがある。誤った位置に店が出るのが最悪の結果なので、
 *   `APPROXIMATE` と `partial_match` は座標を付けずに警告として報告する。
 * - 表示用キーとは**別のキー**を使う（`GEOCODING_API_KEY`）。
 *   `NEXT_PUBLIC_` を付けないため、ビルド成果物には入らない。
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { ShopsFile } from '../src/lib/shop'

const SHOPS_PATH = resolve(import.meta.dir, '../public/shops.json')
const CACHE_PATH = resolve(import.meta.dir, '../data/geocode-cache.json')

/** Google が返す精度。店舗の位置として信用できるのは上位 3 つまで。 */
type LocationType = 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE'

type CacheEntry = {
  lat: number
  lng: number
  locationType: LocationType
  /** Google 側が解釈した住所。ずれの確認用に残す。 */
  formatted: string
  /** 入力住所の一部しか一致しなかった場合に true */
  partialMatch: boolean
}

type Cache = Record<string, CacheEntry | null>

/**
 * 住所から番地の並びを取り出す（`大平町富田558-11プラッツ内` → `['558','11']`）。
 *
 * 町名の直後にある最初の「数字とハイフンの並び」だけを見る。
 * それ以降はテナント名や部屋番号が続くことが多く、含めると判定が濁る。
 */
function banchi(address: string): string[] {
  const normalized = address.normalize('NFKC').replace(/[‐‑‒–—―−ー]/g, '-')
  const match = normalized.match(/\d+(?:-\d+)*/)
  return match === null ? [] : match[0].split('-')
}

/**
 * 結果を店舗の位置として信用してよいか。
 *
 * 実データ 635 件の分布:
 *   589 ROOFTOP / 21 ROOFTOP+partial / 11 APPROXIMATE+partial
 *     5 GEOMETRIC_CENTER / 5 APPROXIMATE / 4 GEOMETRIC_CENTER+partial
 *
 * - `APPROXIMATE` と `GEOMETRIC_CENTER` は町や通りの代表点。店舗の位置にならないので捨てる。
 * - `partial_match` の多くは「番地は合っているがテナント名が一致しなかった」だけで、
 *   座標としては正しい（例: `大平町富田558-11プラッツ大平内` → `大平町富田558-11`）。
 *   一方で番地ごと別地点に飛ぶ例もある（例: `都賀町家中字三ツ塚1870番1` → `都賀町原宿573`）。
 *   **番地が返り値に含まれるかで機械的に切り分ける。**
 *
 * 誤った位置に店を出すのが最悪の結果なので、判断が付かないものは座標を付けない。
 */
function isTrustworthy(entry: CacheEntry, address: string): boolean {
  if (entry.locationType !== 'ROOFTOP' && entry.locationType !== 'RANGE_INTERPOLATED') {
    return false
  }
  if (!entry.partialMatch) return true

  const parts = banchi(address)
  if (parts.length === 0) return false
  const formatted = entry.formatted.normalize('NFKC').replace(/[‐‑‒–—―−ー]/g, '-')
  // 番地の各要素が数値として現れることを見る（「20」が「200」に当たらないよう境界を付ける）。
  return parts.every((part) => new RegExp(`(?<!\\d)${part}(?!\\d)`).test(formatted))
}

async function readCache(): Promise<Cache> {
  if (!existsSync(CACHE_PATH)) return {}
  return JSON.parse(await readFile(CACHE_PATH, 'utf8')) as Cache
}

async function writeCache(cache: Cache): Promise<void> {
  await mkdir(dirname(CACHE_PATH), { recursive: true })
  // キー順を固定して冪等にする（差分レビューを可能にするため）。
  const sorted = Object.fromEntries(
    Object.entries(cache).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  await writeFile(CACHE_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
}

async function geocode(address: string, key: string): Promise<CacheEntry | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', address)
  url.searchParams.set('key', key)
  // 日本国内に限定して、同名地名を国外に取られるのを防ぐ。
  url.searchParams.set('components', 'country:JP')
  url.searchParams.set('language', 'ja')

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Geocoding API が HTTP ${response.status} を返した`)
  }
  const body = (await response.json()) as {
    status: string
    error_message?: string
    results: {
      formatted_address: string
      partial_match?: boolean
      geometry: { location: { lat: number; lng: number }; location_type: LocationType }
    }[]
  }

  if (body.status === 'ZERO_RESULTS') return null
  if (body.status !== 'OK') {
    // OVER_QUERY_LIMIT / REQUEST_DENIED はキーや割り当ての問題。
    // 残りを無駄に叩かないよう、ここで止める。
    throw new Error(
      `Geocoding API: ${body.status}${body.error_message ? ` — ${body.error_message}` : ''}`,
    )
  }

  const top = body.results[0]
  if (top === undefined) return null
  return {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    locationType: top.geometry.location_type,
    formatted: top.formatted_address,
    partialMatch: top.partial_match === true,
  }
}

async function main(): Promise<void> {
  const key = process.env.GEOCODING_API_KEY
  if (key === undefined || key === '') {
    console.error(
      'GEOCODING_API_KEY が未設定。.env.local.example を参照すること。\n' +
        '表示用の NEXT_PUBLIC_GOOGLE_MAPS_API_KEY とは別のキーを使う。',
    )
    process.exit(1)
  }

  const limitIndex = process.argv.indexOf('--limit')
  const limit =
    limitIndex >= 0
      ? Number(process.argv[limitIndex + 1] ?? '0')
      : Number.POSITIVE_INFINITY

  const file = JSON.parse(await readFile(SHOPS_PATH, 'utf8')) as ShopsFile
  const cache = await readCache()

  const pending = file.shops
    .map((shop) => shop.address)
    .filter((address, i, all) => all.indexOf(address) === i)
    .filter((address) => !(address in cache))

  console.log(`全 ${file.shops.length} 件 / 未取得 ${pending.length} 件`)

  let queried = 0
  try {
    for (const address of pending) {
      if (queried >= limit) break
      cache[address] = await geocode(address, key)
      queried++
      if (queried % 25 === 0) {
        console.log(`  ${queried} / ${Math.min(pending.length, limit)} …`)
        // 途中で落ちても取得済みを失わないよう、こまめに保存する。
        await writeCache(cache)
      }
      // 連続呼び出しを少し空ける（レート制限に当たると全体が止まるため）。
      await Bun.sleep(50)
    }
  } finally {
    await writeCache(cache)
  }

  // 座標を書き戻す。信用できない結果は付けない（リストには出るが地図には出ない）。
  const failures: string[] = []
  const untrusted: string[] = []
  let resolved = 0

  for (const shop of file.shops) {
    const entry = cache[shop.address]
    if (entry === undefined) continue
    if (entry === null) {
      failures.push(`${shop.name} / ${shop.address}`)
      shop.lat = null
      shop.lng = null
      continue
    }
    if (!isTrustworthy(entry, shop.address)) {
      untrusted.push(
        `${shop.name} / ${shop.address} → ${entry.formatted}` +
          ` (${entry.locationType}${entry.partialMatch ? ', partial_match' : ''})`,
      )
      shop.lat = null
      shop.lng = null
      continue
    }
    shop.lat = entry.lat
    shop.lng = entry.lng
    resolved++
  }

  // import-excel.ts と同じ 1 店舗 1 行の形を保つ。
  const head = [
    '{',
    `  "sourceLabel": ${JSON.stringify(file.sourceLabel)},`,
    `  "importedAt": ${JSON.stringify(file.importedAt)},`,
    '  "shops": [',
  ]
  const body = file.shops.map(
    (shop, i) => `    ${JSON.stringify(shop)}${i === file.shops.length - 1 ? '' : ','}`,
  )
  await writeFile(SHOPS_PATH, `${[...head, ...body, '  ]', '}'].join('\n')}\n`, 'utf8')

  console.log(`\n今回問い合わせ: ${queried} 件`)
  console.log(`座標あり: ${resolved} / ${file.shops.length}`)

  if (untrusted.length > 0) {
    console.log(
      `\n精度不足で不採用 ${untrusted.length} 件（町の代表点に落ちた可能性。要確認）:`,
    )
    for (const line of untrusted) console.log(`  - ${line}`)
  }
  if (failures.length > 0) {
    console.log(`\n解決できず ${failures.length} 件:`)
    for (const line of failures) console.log(`  - ${line}`)
  }
  if (untrusted.length > 0 || failures.length > 0) {
    console.log(
      '\nこれらは地図に出ないがリストには出る。' +
        '住所を直すか、data/geocode-cache.json に手で座標を入れて対応する。',
    )
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
