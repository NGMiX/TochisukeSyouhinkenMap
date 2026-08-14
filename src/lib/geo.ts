/**
 * 現在地からの距離。
 *
 * 「近所のどの店で使えるか」に答えるための計算。栃木市内という狭い範囲でしか使わないので
 * 球面（ハバーサイン）近似で十分で、測地系の厳密さは要らない。
 *
 * **座標の無い店を落とさない。** 座標が無いのはジオコーディングが解決できなかっただけで、
 * その店で券が使えないわけではない。距離順にしたときは末尾にまとめる。
 */

import type { Shop } from './shop'

export type LatLng = { lat: number; lng: number }

/** 地球の半径（メートル）。 */
const EARTH_RADIUS_M = 6_371_000

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** 2 点間の距離（メートル）。 */
export function distanceMeters(from: LatLng, to: LatLng): number {
  const dLat = toRadians(to.lat - from.lat)
  const dLng = toRadians(to.lng - from.lng)
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 店舗までの距離（メートル）。座標が無ければ null。 */
export function shopDistance(shop: Shop, origin: LatLng | null): number | null {
  if (origin === null || shop.lat === null || shop.lng === null) return null
  return distanceMeters(origin, { lat: shop.lat, lng: shop.lng })
}

/**
 * 距離の表示。
 *
 * **10m 単位に丸める。** スマートフォンの測位誤差は数十 m あり、
 * 1m 単位で出すと持っていない精度を主張することになる。
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `約 ${Math.max(10, Math.round(meters / 10) * 10)} m`
  }
  if (meters < 10_000) {
    return `約 ${(meters / 1000).toFixed(1)} km`
  }
  return `約 ${Math.round(meters / 1000)} km`
}

export type SortOrder = 'default' | 'distance'

/**
 * 並び順を適用した新しい配列を返す。
 *
 * `default` は取り込み時の順（Excel の五十音順）。
 * `distance` は現在地が無いときは何もしない（許可待ち・許可拒否の間も表示が崩れないように）。
 */
export function sortShops(
  shops: Shop[],
  order: SortOrder,
  origin: LatLng | null,
): Shop[] {
  if (order !== 'distance' || origin === null) return shops

  return shops
    .map((shop) => ({ shop, distance: shopDistance(shop, origin) }))
    .sort((a, b) => {
      // 座標が無い店は末尾へ。互いの順は元のまま（Array#sort は安定）。
      if (a.distance === null) return b.distance === null ? 0 : 1
      if (b.distance === null) return -1
      return a.distance - b.distance
    })
    .map(({ shop }) => shop)
}
