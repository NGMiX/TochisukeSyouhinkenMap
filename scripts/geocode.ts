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
 * - **信用できなかった住所は書き換えた候補で引き直す**（`scripts/address.ts`）。
 *   小字や番号表記、番地の後ろのビル名を機械的に落とした形で当たる場合がある。
 *   候補の結果にも同じ信用判定を掛けるので、当たりを緩めることにはならない。
 * - **住所でどうしても解決しない店は店名で引く**（`scripts/places.ts`）。
 *   Google の住所データに番地が無い地域があり、住所からは何をしても座標にならない。
 *   店名と番地の両方が一致した結果だけを採る。Geocoding より高い SKU なので最後に回す。
 * - **それでも解決しない住所は `data/manual-coords.json` に人が座標を入れる。**
 *   API のキャッシュ（消しても引き直せる）と人の判断（消すと失われる）を混ぜない。
 * - 表示用キーとは**別のキー**を使う（`GEOCODING_API_KEY`）。
 *   `NEXT_PUBLIC_` を付けないため、ビルド成果物には入らない。
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { ShopsFile } from '../src/lib/shop'
import { addressVariants, banchi, normalizeAddress } from './address'
import {
  isTrustworthyPlace,
  placeQuery,
  readPlacesCache,
  searchPlace,
  writePlacesCache,
} from './places'

const SHOPS_PATH = resolve(import.meta.dir, '../public/shops.json')
const CACHE_PATH = resolve(import.meta.dir, '../data/geocode-cache.json')
const MANUAL_PATH = resolve(import.meta.dir, '../data/manual-coords.json')

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
 * 人が調べて入れた座標。`data/manual-coords.json` の中身。
 *
 * キーは `public/shops.json` の住所そのまま。API の結果より優先する
 * （人が地図を見て決めた位置の方が確かなので）。
 */
type ManualEntry = {
  lat: number
  lng: number
  /** 何を根拠にこの座標にしたか。後から人が検証できるように残す。 */
  note?: string
}

type Manual = Record<string, ManualEntry>

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
  const formatted = normalizeAddress(entry.formatted)
  // 番地の各要素が数値として現れることを見る（「20」が「200」に当たらないよう境界を付ける）。
  return parts.every((part) => new RegExp(`(?<!\\d)${part}(?!\\d)`).test(formatted))
}

async function readCache(): Promise<Cache> {
  if (!existsSync(CACHE_PATH)) return {}
  return JSON.parse(await readFile(CACHE_PATH, 'utf8')) as Cache
}

async function readManual(): Promise<Manual> {
  if (!existsSync(MANUAL_PATH)) return {}
  return JSON.parse(await readFile(MANUAL_PATH, 'utf8')) as Manual
}

/**
 * キャッシュから信用できる座標を探す。
 *
 * 元の住所と、書き換えた候補の住所を順に見る。**判定は実際に問い合わせた住所に対して行う**
 * （候補側の方が番地が明確なため、そちらを基準にする方が厳しくなる）。
 */
function resolveFromCache(
  address: string,
  cache: Cache,
): { entry: CacheEntry; queried: string } | null {
  for (const queried of [address, ...addressVariants(address)]) {
    const entry = cache[queried]
    if (entry === undefined || entry === null) continue
    if (isTrustworthy(entry, queried)) return { entry, queried }
  }
  return null
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

function requireApiKey(): string {
  const key = process.env.GEOCODING_API_KEY
  if (key === undefined || key === '') {
    console.error(
      'GEOCODING_API_KEY が未設定。.env.local.example を参照すること。\n' +
        '表示用の NEXT_PUBLIC_GOOGLE_MAPS_API_KEY とは別のキーを使う。',
    )
    process.exit(1)
  }
  return key
}

/**
 * 店名検索に使うキー。
 *
 * 既定ではジオコーディング用と同じキーを使う（どちらも取り込み時にしか叩かず、
 * 成果物には入らない）。Places API (New) の権限を別のキーに分けたい場合は
 * `PLACES_API_KEY` を設定する。
 */
function placesKey(): string {
  const key = process.env.PLACES_API_KEY
  return key !== undefined && key !== '' ? key : requireApiKey()
}

async function main(): Promise<void> {
  const key = requireApiKey()

  const limitIndex = process.argv.indexOf('--limit')
  const limit =
    limitIndex >= 0
      ? Number(process.argv[limitIndex + 1] ?? '0')
      : Number.POSITIVE_INFINITY

  const file = JSON.parse(await readFile(SHOPS_PATH, 'utf8')) as ShopsFile
  const cache = await readCache()
  const manual = await readManual()

  const addresses = file.shops
    .map((shop) => shop.address)
    .filter((address, i, all) => all.indexOf(address) === i)

  let queried = 0

  /** 1 件問い合わせる。件数の管理・待ち・途中保存をまとめる。 */
  async function ask(address: string): Promise<CacheEntry | null> {
    cache[address] = await geocode(address, key)
    queried++
    // 途中で落ちても取得済みを失わないよう、こまめに保存する。
    if (queried % 25 === 0) await writeCache(cache)
    // 連続呼び出しを少し空ける（レート制限に当たると全体が止まるため）。
    await Bun.sleep(50)
    return cache[address] ?? null
  }

  try {
    // 1 段目: まだ引いていない住所を引く。
    // 手で座標を入れた住所は問い合わせない（人の判断が API より優先される）。
    const pending = addresses.filter(
      (address) => !(address in cache) && !(address in manual),
    )
    console.log(`全 ${file.shops.length} 件 / 未取得 ${pending.length} 件`)
    for (const address of pending) {
      if (queried >= limit) break
      await ask(address)
      if (queried % 25 === 0) {
        console.log(`  ${queried} / ${Math.min(pending.length, limit)} …`)
      }
    }

    // 2 段目: 信用できる結果が無い住所を、書き換えた候補で引き直す。
    const retry = addresses.filter(
      (address) => !(address in manual) && resolveFromCache(address, cache) === null,
    )
    if (retry.length > 0) {
      console.log(`\n書き換えた住所で引き直す: ${retry.length} 件`)
    }
    for (const address of retry) {
      for (const variant of addressVariants(address)) {
        if (queried >= limit) break
        if (variant in cache) continue
        const entry = await ask(variant)
        // 当たった時点で打ち切る。候補は元の住所に近い順に並んでいる。
        if (entry !== null && isTrustworthy(entry, variant)) break
      }
    }
  } finally {
    await writeCache(cache)
  }

  // 3 段目: 住所では解決しない店を店名で引く（Places API (New) / Text Search）。
  // Geocoding より高い SKU なので、ここまで残った店だけに使う。
  const places = await readPlacesCache()
  try {
    const needsPlaces = file.shops.filter(
      (shop) =>
        !(shop.address in manual) &&
        resolveFromCache(shop.address, cache) === null &&
        !(placeQuery(shop) in places),
    )
    if (needsPlaces.length > 0) {
      console.log(`\n店名で引く: ${needsPlaces.length} 件（Places API）`)
      for (const shop of needsPlaces) {
        if (queried >= limit) break
        const query = placeQuery(shop)
        places[query] = await searchPlace(query, placesKey())
        queried++
        await Bun.sleep(50)
      }
    }
  } catch (error: unknown) {
    // ここで落ちても、住所で解決した分は書き戻したい。全体を止めない。
    console.error(
      `\n店名での問い合わせを中止した: ${error instanceof Error ? error.message : error}`,
    )
    console.error(
      'Places API (New)（places.googleapis.com）を Cloud Console で有効化し、\n' +
        '取り込み用キーの API 制限に追加すること。旧「Places API」とは別のサービス。',
    )
  } finally {
    await writePlacesCache(places)
  }

  // 座標を書き戻す。信用できない結果は付けない（リストには出るが地図には出ない）。
  const failures: string[] = []
  const untrusted: string[] = []
  const viaVariant: string[] = []
  const viaPlace: string[] = []
  const placeHints: string[] = []
  let resolved = 0
  let placeCount = 0
  let manualCount = 0

  for (const shop of file.shops) {
    // 人が入れた座標が最優先。
    const hand = manual[shop.address]
    if (hand !== undefined) {
      shop.lat = hand.lat
      shop.lng = hand.lng
      resolved++
      manualCount++
      continue
    }

    const hit = resolveFromCache(shop.address, cache)
    if (hit !== null) {
      shop.lat = hit.entry.lat
      shop.lng = hit.entry.lng
      resolved++
      if (hit.queried !== shop.address) {
        viaVariant.push(
          `${shop.name} / ${shop.address} → 「${hit.queried}」 → ${hit.entry.formatted}`,
        )
      }
      continue
    }

    // 住所で解決しなかった店は、店名で引いた結果を見る。
    const place = places[placeQuery(shop)]
    if (place !== undefined && place !== null && isTrustworthyPlace(place, shop)) {
      shop.lat = place.lat
      shop.lng = place.lng
      resolved++
      placeCount++
      viaPlace.push(
        `${shop.name} / ${shop.address} → ${place.name}（${place.formatted}）`,
      )
      continue
    }

    shop.lat = null
    shop.lng = null

    // 名前か住所の一方しか合わなかった候補は、人が判断する材料として出す。
    if (place !== undefined && place !== null) {
      placeHints.push(
        `${shop.name} / ${shop.address}\n      Google の候補: ${place.name}` +
          `（${place.formatted}）lat ${place.lat}, lng ${place.lng}`,
      )
    }

    const entry = cache[shop.address]
    // undefined は「まだ引いていない」（--limit で打ち切った場合）。報告しない。
    if (entry === undefined) continue
    if (entry === null) {
      failures.push(`${shop.name} / ${shop.address}`)
      continue
    }
    untrusted.push(
      `${shop.name} / ${shop.address} → ${entry.formatted}` +
        ` (${entry.locationType}${entry.partialMatch ? ', partial_match' : ''})`,
    )
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
  console.log(
    `座標あり: ${resolved} / ${file.shops.length}` +
      `（うち店名で解決 ${placeCount} 件、手入力 ${manualCount} 件）`,
  )

  // 書き換えた住所・店名で当たったものは、位置がずれていないか人の目で確認できるように出す。
  if (viaVariant.length > 0) {
    console.log(`\n住所を書き換えて解決 ${viaVariant.length} 件（位置の確認推奨）:`)
    for (const line of viaVariant) console.log(`  - ${line}`)
  }
  if (viaPlace.length > 0) {
    console.log(`\n店名で解決 ${viaPlace.length} 件（位置の確認推奨）:`)
    for (const line of viaPlace) console.log(`  - ${line}`)
  }
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
  if (placeHints.length > 0) {
    console.log(
      `\n店名で引いた候補が一致しなかった ${placeHints.length} 件` +
        '（店名か番地が合わない。人が地図で確かめてから使うこと）:',
    )
    for (const line of placeHints) console.log(`  - ${line}`)
  }
  if (untrusted.length > 0 || failures.length > 0) {
    console.log(
      '\nこれらは地図に出ないがリストには出る。住所を直すか、' +
        'data/manual-coords.json に住所をキーにして緯度経度を入れて対応する。',
    )
  }

  // Excel の更新で住所が変わると、手入力の座標が使われないまま残る。気付けるように出す。
  const stale = Object.keys(manual).filter(
    (address) => !file.shops.some((shop) => shop.address === address),
  )
  if (stale.length > 0) {
    console.log(
      `\ndata/manual-coords.json に、どの店の住所とも一致しない項目が ${stale.length} 件ある` +
        '（住所が更新された可能性。確認して消すか直すこと）:',
    )
    for (const address of stale) console.log(`  - ${address}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
