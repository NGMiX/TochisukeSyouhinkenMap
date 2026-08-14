/**
 * 店名から座標を引く（Places API (New) の Text Search）。
 *
 * **住所で解決できなかった店だけに使う。** 提供 Excel の住所は Google の住所データに
 * 番地が無いことがあり（栃木市内では 20 件）、住所からはどうしても座標にならない。
 * 一方でそれらの多くは全国チェーンで、**店名なら Google 側が正確な位置を持っている**。
 *
 * 費用（2026-08 時点で確認）:
 * - 座標（`places.location`）を含めると **Text Search Pro** SKU。無料枠 5,000 件/月、
 *   超過分 $32 / 1,000。Geocoding（無料枠 10,000、$5 / 1,000）より 6 倍高い。
 * - 無料の IDs Only SKU では座標が返らないので、無料枠を当てにした設計はできない。
 * - **該当が無くても課金される**（0 件でも 1 リクエスト）。
 * → **数十件に留め、結果はキャッシュしてコミットする。** 全件をこれで引いてはいけない。
 *
 * 前提: Cloud Console で「Places API (New)」（`places.googleapis.com`）を有効化し、
 * 取り込み用キーの API 制限に追加しておくこと。旧「Places API」とは別サービス。
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { normalizeForSearch } from '../src/lib/normalize'
import type { ShopRecord } from '../src/lib/shop'
import { banchi, normalizeAddress } from './address'

const CACHE_PATH = resolve(import.meta.dir, '../data/places-cache.json')

/** 栃木市役所付近。検索を市の周辺に寄せるための中心。 */
const TOCHIGI_CITY_CENTER = { latitude: 36.3826, longitude: 139.7333 }

/** 検索を寄せる半径（メートル）。栃木市は南北に長いので広く取る。 */
const BIAS_RADIUS_M = 20_000

/** この距離より遠い結果は、同名の別の店と見なして捨てる。 */
const MAX_DISTANCE_KM = 30

export type PlaceEntry = {
  lat: number
  lng: number
  /** Google 側の店名。人が突き合わせられるように残す。 */
  name: string
  /** Google 側の住所。 */
  formatted: string
}

export type PlacesCache = Record<string, PlaceEntry | null>

export async function readPlacesCache(): Promise<PlacesCache> {
  if (!existsSync(CACHE_PATH)) return {}
  return JSON.parse(await readFile(CACHE_PATH, 'utf8')) as PlacesCache
}

export async function writePlacesCache(cache: PlacesCache): Promise<void> {
  await mkdir(dirname(CACHE_PATH), { recursive: true })
  // キー順を固定して冪等にする（差分レビューを可能にするため）。
  const sorted = Object.fromEntries(
    Object.entries(cache).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  await writeFile(CACHE_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
}

/**
 * 検索に使う文字列。**キャッシュのキーでもある**ので、店名と住所から一意に決まる形にする。
 *
 * 住所も添える。`セブンイレブン` のようなチェーン店は店名だけでは絞れない。
 */
export function placeQuery(shop: Pick<ShopRecord, 'name' | 'address'>): string {
  return `${normalizeForSearch(shop.name)} ${normalizeAddress(shop.address)}`
}

/** 法人格。Excel は省いているが Google 側には付くことがある（NFKC 後の形で書く）。 */
const LEGAL_ENTITY = /\((?:株|有|名|資|同)\)|(?:株式|有限|合同|合資|合名)会社/g

/** 店名の中の区切り。`セブン-イレブン` と `セブンイレブン` を同じものとして扱うため。 */
const NAME_SEPARATORS = /[-‐‑‒–—―−・･]/g

/**
 * 店名の比較用の正規化。
 *
 * Excel と Google で揺れるところだけを落とす。**表記の違いで取りこぼすと、
 * 番地が完全に一致していても採用されない**（実データでは 2 件がこれで落ちていた）。
 */
function compareName(name: string): string {
  return normalizeForSearch(name).replace(LEGAL_ENTITY, '').replace(NAME_SEPARATORS, '')
}

/**
 * この結果を店舗の位置として採用してよいか。
 *
 * **名前と住所の両方が合うことを要求する。** Text Search は曖昧一致なので、
 * 近所の別の店を返すことがある。誤った位置に店を出すのが最悪の結果なので、
 * 片方しか合わないものは採用せず、人が確認する材料として報告する。
 */
export function isTrustworthyPlace(
  entry: PlaceEntry,
  shop: Pick<ShopRecord, 'name' | 'address'>,
): boolean {
  const formatted = normalizeAddress(entry.formatted)
  if (!formatted.includes('栃木市')) return false

  // 番地が Google 側の住所に含まれること（住所側の判定と同じ規則）。
  const parts = banchi(shop.address)
  if (parts.length === 0) return false
  const banchiMatches = parts.every((part) =>
    new RegExp(`(?<!\\d)${part}(?!\\d)`).test(formatted),
  )
  if (!banchiMatches) return false

  // 店名がどちらかを含むこと（Excel は法人格や副題を省いていることがある）。
  const excelName = compareName(shop.name)
  const placeName = compareName(entry.name)
  if (!placeName.includes(excelName) && !excelName.includes(placeName)) return false

  return distanceKm(entry) <= MAX_DISTANCE_KM
}

/** 市の中心からの距離（km）。同名の別地域の店を弾く最後の網。 */
function distanceKm(entry: PlaceEntry): number {
  const dLat = entry.lat - TOCHIGI_CITY_CENTER.latitude
  const dLng = entry.lng - TOCHIGI_CITY_CENTER.longitude
  // この緯度では 1 度 ≒ 111km（経度は cos35° ≒ 0.82 を掛ける）。
  return Math.hypot(dLat * 111, dLng * 111 * 0.82)
}

/**
 * Text Search を 1 回叩く。該当が無ければ null。
 *
 * FieldMask が課金 SKU を決めるので、**必要な 3 つ以外を要求しない**。
 */
export async function searchPlace(
  query: string,
  key: string,
): Promise<PlaceEntry | null> {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.location,places.displayName,places.formattedAddress',
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'ja',
      regionCode: 'JP',
      // 1 件だけ見る。候補を並べて選ぶ仕組みは持たない（人が確認する前提）。
      pageSize: 1,
      locationBias: {
        circle: { center: TOCHIGI_CITY_CENTER, radius: BIAS_RADIUS_M },
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Places API が HTTP ${response.status} を返した: ${body.slice(0, 300)}`,
    )
  }

  const body = (await response.json()) as {
    places?: {
      displayName?: { text?: string }
      formattedAddress?: string
      location?: { latitude: number; longitude: number }
    }[]
  }

  // 該当が無いときはエラーではなく places が省かれる。
  const top = body.places?.[0]
  if (top?.location === undefined) return null

  return {
    lat: top.location.latitude,
    lng: top.location.longitude,
    name: top.displayName?.text ?? '',
    formatted: top.formattedAddress ?? '',
  }
}
