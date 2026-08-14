'use client'

import { MarkerClusterer } from '@googlemaps/markerclusterer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadGoogleMaps, MAP_ID } from '@/components/map/loader'
import { CATEGORY_LABELS, type Shop } from '@/lib/shop'

/** 栃木市役所付近。座標が 1 件も無いときの初期表示に使う。 */
const TOCHIGI_CITY_CENTER = { lat: 36.3826, lng: 139.7333 }

type Props = {
  /** 絞り込み後の店舗。地図には常に絞り込み結果だけを描く。 */
  shops: Shop[]
}

export function ShopMap({ shops }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const clustererRef = useRef<MarkerClusterer | null>(null)
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 座標を持たない店は地図に出せない。件数は利用者に伝える。
  // useEffect の依存に渡すため、毎レンダー同じ配列になるようメモ化する
  // （しないとマーカーの再生成が無限に走る）。
  const plottable = useMemo(
    () =>
      shops.filter(
        (shop): shop is Shop & { lat: number; lng: number } =>
          shop.lat !== null && shop.lng !== null,
      ),
    [shops],
  )

  useEffect(() => {
    let cancelled = false

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || containerRef.current === null) return

        if (mapRef.current === null) {
          mapRef.current = new maps.Map(containerRef.current, {
            center: TOCHIGI_CITY_CENTER,
            zoom: 12,
            mapId: MAP_ID,
            // モバイルで地図を触りながら縦スクロールできなくなるのを防ぐ。
            gestureHandling: 'greedy',
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          })
          infoRef.current = new maps.InfoWindow()
        }

        const map = mapRef.current
        const info = infoRef.current

        const markers = plottable.map((shop) => {
          const marker = new maps.AdvancedMarkerElement({
            position: { lat: shop.lat, lng: shop.lng },
            title: shop.name,
          })
          // AdvancedMarkerElement では 'click' は非推奨で 'gmp-click' を使う。
          marker.addListener('gmp-click', () => {
            info?.setContent(
              `<div style="font-size:13px;line-height:1.5">
                 <strong>${escapeHtml(shop.name)}</strong><br>
                 ${escapeHtml(shop.address)}<br>
                 ${shop.isLarge ? '青色券のみ' : '黄色券・青色券'}
                 / ${escapeHtml(CATEGORY_LABELS[shop.category])}
               </div>`,
            )
            info?.open({ map, anchor: marker })
          })
          return marker
        })

        // 655 件を素で並べると市全域のズームで密集して読めない。
        clustererRef.current?.clearMarkers()
        clustererRef.current = new MarkerClusterer({ map, markers })

        // 絞り込み結果が収まる範囲に寄せる。1 件だけのときは寄りすぎないようにする。
        if (markers.length > 0) {
          const bounds = new maps.LatLngBounds()
          for (const shop of plottable) {
            bounds.extend({ lat: shop.lat, lng: shop.lng })
          }
          map.fitBounds(bounds, 32)
          if (markers.length === 1) map.setZoom(16)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })

    return () => {
      cancelled = true
      clustererRef.current?.clearMarkers()
    }
  }, [plottable])

  if (error !== null) {
    return <p className="notice notice-error">{error}</p>
  }

  return (
    <>
      <div ref={containerRef} className="map" />
      {plottable.length < shops.length && (
        <p className="map-note">
          {shops.length - plottable.length}{' '}
          件は所在地を特定できなかったため地図に出ていません。 リストからは探せます。
        </p>
      )}
    </>
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
