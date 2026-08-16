/**
 * すでに引いてある結果から座標を決める。**ここでは API を叩かない。**
 *
 * `bun run geocode`（問い合わせる）と `bun run import:csv`（CSV から JSON を作る）の
 * 両方が使う。同じ規則で決まらないと、取り込み直すたびに地図上の店の位置が変わる。
 *
 * 判定の方針は「誤った位置に店を出すのが最悪の結果」。
 * 精度が足りない結果は座標を付けずに残し、人が確認できるよう報告に回す。
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { distanceMeters } from '../src/lib/geo'
import { addressVariants, banchi, normalizeAddress } from './address'
import {
  isTrustworthyPlace,
  type PlaceEntry,
  type PlacesCache,
  placeQuery,
} from './places'

export const CACHE_PATH = resolve(import.meta.dir, '../data/geocode-cache.json')

/** Google が返す精度。店舗の位置として信用できるのは上位 2 つまで。 */
export type LocationType =
  | 'ROOFTOP'
  | 'RANGE_INTERPOLATED'
  | 'GEOMETRIC_CENTER'
  | 'APPROXIMATE'

export type CacheEntry = {
  lat: number
  lng: number
  locationType: LocationType
  /** Google 側が解釈した住所。ずれの確認用に残す。 */
  formatted: string
  /** 入力住所の一部しか一致しなかった場合に true */
  partialMatch: boolean
}

export type Cache = Record<string, CacheEntry | null>

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
 */
export function isTrustworthy(entry: CacheEntry, address: string): boolean {
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

export async function readCache(): Promise<Cache> {
  if (!existsSync(CACHE_PATH)) return {}
  return JSON.parse(await readFile(CACHE_PATH, 'utf8')) as Cache
}

export async function writeCache(cache: Cache): Promise<void> {
  await mkdir(dirname(CACHE_PATH), { recursive: true })
  // キー順を固定して冪等にする（差分レビューを可能にするため）。
  const sorted = Object.fromEntries(
    Object.entries(cache).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  await writeFile(CACHE_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
}

/**
 * 住所のキャッシュから信用できる座標を探す。
 *
 * 元の住所と、書き換えた候補の住所を順に見る。**判定は実際に問い合わせた住所に対して行う**
 * （候補側の方が番地が明確なため、そちらを基準にする方が厳しくなる）。
 */
export function resolveFromCache(
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

export type Shop = { name: string; address: string }

/** 座標をどこから得たか。報告の分類と、どこを直せばよいかの手掛かりになる。 */
export type CoordSource = 'human' | 'address' | 'variant' | 'place'

/**
 * CSV の「座標の出どころ」列に書く値。
 *
 * **`人` の行だけは機械が座標を書き換えない。** 人が地図を見て決めた座標は、
 * API の結果より確かで、消すと失われる。手で座標を入れたらこの列を `人` にすること。
 */
export const SOURCE_LABELS: Record<CoordSource, string> = {
  human: '人',
  address: '住所',
  variant: '住所を書き換え',
  place: '店名',
}

/** CSV の「座標の出どころ」列から、人が入れた座標かどうかを見る。 */
export function isHumanSource(value: string): boolean {
  return value.trim() === SOURCE_LABELS.human
}

export type Resolution = {
  lat: number
  lng: number
  source: CoordSource
  /** 人が確認するための説明（実際に問い合わせた住所や、Google 側の店名）。 */
  detail: string
}

export type Caches = { geocode: Cache; places: PlacesCache }

/**
 * 1 店舗の座標を決める。確かな順に見て、決まった時点で打ち切る。
 *
 *   1. CSV に人が入れた座標（`座標の出どころ` が `人` の行）
 *   2. 店名で引いた結果（Google Places。店名と番地の両方が一致したときだけ）
 *   3. 住所をそのまま引いた結果
 *   4. 住所を書き換えて引いた結果
 *
 * **店名の結果を住所より優先する。** Places が返すのは店そのものの位置で、
 * 住所のジオコーディングが返すのは「その番地の代表点」。同じ番地に複数の建物があれば
 * 前者の方が実際の店に近い。ただし別の店を掴んでいないことが前提なので、
 * `isTrustworthyPlace`（店名と番地の両方が一致）を通ったものだけを採る。
 */
export function resolveCoords(
  shop: Shop,
  manual: { lat: number; lng: number } | null,
  caches: Caches,
): Resolution | null {
  if (manual !== null) {
    return { ...manual, source: 'human', detail: 'CSV に人が入れた座標' }
  }

  const place = placeCoords(shop, caches)
  if (place !== null) {
    return {
      lat: place.lat,
      lng: place.lng,
      source: 'place',
      detail: `${place.name}（${place.formatted}）`,
    }
  }

  const hit = resolveFromCache(shop.address, caches.geocode)
  if (hit !== null) {
    return {
      lat: hit.entry.lat,
      lng: hit.entry.lng,
      source: hit.queried === shop.address ? 'address' : 'variant',
      detail: `「${hit.queried}」 → ${hit.entry.formatted}`,
    }
  }

  return null
}

/** 店名で引いた結果のうち、店舗の位置として採れるもの。 */
export function placeCoords(shop: Shop, caches: Caches): PlaceEntry | null {
  const place = caches.places[placeQuery(shop)]
  if (place === undefined || place === null) return null
  return isTrustworthyPlace(place, shop) ? place : null
}

/**
 * 店名で得た座標と、住所で得た座標のずれ（メートル）。片方しか無ければ null。
 *
 * **両方が近ければ、人が見に行く必要はない。** 離れているときだけ確認に回すための物差し。
 */
export function crossCheckMeters(shop: Shop, caches: Caches): number | null {
  const place = placeCoords(shop, caches)
  const hit = resolveFromCache(shop.address, caches.geocode)
  if (place === null || hit === null) return null
  return distanceMeters(
    { lat: place.lat, lng: place.lng },
    { lat: hit.entry.lat, lng: hit.entry.lng },
  )
}

/**
 * 座標が決まらなかった店について、人が確認する材料を返す。
 *
 * 「見つからなかった」だけでは次の一手が分からない。Google が何を返したのかを見せる。
 */
export function unresolvedDetail(
  shop: Shop,
  caches: Caches,
): { geocode: string | null; place: PlaceEntry | null } {
  const entry = caches.geocode[shop.address]
  const geocode =
    entry === undefined
      ? null
      : entry === null
        ? '該当なし（ZERO_RESULTS）'
        : `${entry.formatted} (${entry.locationType}${entry.partialMatch ? ', partial_match' : ''})`
  return { geocode, place: caches.places[placeQuery(shop)] ?? null }
}
