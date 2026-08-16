#!/usr/bin/env bun
/**
 * `data/shops.csv` の住所・店名から緯度経度を引き、`public/shops.json` を作り直す。
 *
 *   bun run geocode
 *   bun run geocode -- --limit 10   # 試しに 10 リクエストだけ
 *
 * 方針:
 * - **結果は `data/geocode-cache.json` / `data/places-cache.json` にキャッシュしてコミットする。**
 *   住所（店名）がキーなので、Excel が更新されても変わっていない店は問い合わせない。
 *   655 件を毎回引き直すのは無駄で、費用も無意味に増える。
 * - **精度が低い結果を黙って採用しない。** 日本の住所は建物名や枝番で失敗しやすく、
 *   町の代表点に落ちることがある。誤った位置に店が出るのが最悪の結果なので、
 *   `APPROXIMATE` と番地の合わない `partial_match` は座標を付けずに報告する。
 * - **信用できなかった住所は書き換えた候補で引き直す**（`scripts/address.ts`）。
 *   小字や番号表記、番地の後ろのビル名を機械的に落とした形で当たる場合がある。
 *   候補の結果にも同じ信用判定を掛けるので、当たりを緩めることにはならない。
 * - **店名で引いた結果（Google Places）を住所より優先する**（`scripts/places.ts`）。
 *   Places が返すのは店そのものの位置で、住所のジオコーディングが返すのは番地の代表点。
 *   ただし別の店を掴まないよう、店名と番地の両方が一致した結果だけを採る。
 *   Geocoding より高い SKU なので、キャッシュに無い店だけを 1 回ずつ引く。
 * - **それでも解決しない店は、人が `data/shops.csv` の緯度・経度に入れて出どころを `人` にする。**
 *   API のキャッシュ（消しても引き直せる）と人の判断（消すと失われる）を混ぜない。
 * - 座標の決め方そのものは `scripts/coords.ts` にあり、`bun run import:csv` と共有する。
 *   ここが分かれていると、取り込み直すたびに地図上の店の位置が変わりうる。
 * - 表示用キーとは**別のキー**を使う（`GEOCODING_API_KEY`）。
 *   `NEXT_PUBLIC_` を付けないため、ビルド成果物には入らない。
 */

import { addressVariants } from './address'
import {
  type CacheEntry,
  isHumanSource,
  isTrustworthy,
  type LocationType,
  readCache,
  resolveFromCache,
  writeCache,
} from './coords'
import { readShopCsv } from './csv'
import { buildShops, printReport } from './import-csv'
import { placeQuery, readPlacesCache, searchPlace, writePlacesCache } from './places'
import { isHidden } from './review'

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

  const rows = await readShopCsv()
  if (rows === null) {
    console.error(
      'data/shops.csv が無い。先に Excel を取り込むこと:\n' +
        '  bun run import:excel -- data/raw/とち介商品券_0731.xlsx',
    )
    process.exit(1)
  }

  // 座標の出どころが「人」の行は問い合わせない（人の判断が API より優先される）。
  // 「非表示」の行も配信しないので引かない（無駄な課金を避ける）。
  const targets = rows.filter((row) => !isHumanSource(row.source) && !isHidden(row.check))
  const addresses = targets
    .map((row) => row.address)
    .filter((address, i, all) => address !== '' && all.indexOf(address) === i)

  const cache = await readCache()
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
    const pending = addresses.filter((address) => !(address in cache))
    console.log(`対象 ${targets.length} 件 / 未取得の住所 ${pending.length} 件`)
    for (const address of pending) {
      if (queried >= limit) break
      await ask(address)
      if (queried % 25 === 0) {
        console.log(`  ${queried} / ${Math.min(pending.length, limit)} …`)
      }
    }

    // 2 段目: 信用できる結果が無い住所を、書き換えた候補で引き直す。
    const retry = addresses.filter((address) => resolveFromCache(address, cache) === null)
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

  // 3 段目: 店名で引く（Places API (New) / Text Search）。
  // **店名の結果を住所より優先する**ため、住所で解決できた店にも掛ける。
  // Geocoding より高い SKU なので、キャッシュに無いものだけを 1 回ずつ引く。
  const places = await readPlacesCache()
  try {
    const needsPlaces = targets.filter((row) => !(placeQuery(row) in places))
    if (needsPlaces.length > 0) {
      console.log(`\n店名で引く: ${needsPlaces.length} 件（Places API）`)
      for (const row of needsPlaces) {
        if (queried >= limit) break
        const query = placeQuery(row)
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

  console.log(`\n今回問い合わせ: ${queried} 件`)

  // 座標の決定と JSON の書き出しは取り込みと同じ経路を通す。
  printReport(await buildShops())
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
