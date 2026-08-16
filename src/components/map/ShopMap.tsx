'use client'

import { MarkerClusterer } from '@googlemaps/markerclusterer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadGoogleMaps, MAP_ID, type MapsApi } from '@/components/map/loader'
import type { LatLng } from '@/lib/geo'
import { CATEGORY_LABELS, type Shop } from '@/lib/shop'

/** 栃木市役所付近。座標が 1 件も無いときの初期表示に使う。 */
const TOCHIGI_CITY_CENTER = { lat: 36.3826, lng: 139.7333 }

/**
 * ピンの色。**券種と対応させる**（既定の赤のままでは、地図から券種が読み取れない）。
 *
 * 店頭ののぼり旗の色、カードのバッジの色と揃えてある。
 * 黄と青は色覚特性のある人にも見分けやすい組み合わせで、この用途に都合がよい。
 * 地図の上に載るので、暗い配色に切り替わっても読めるよう固定値にする。
 */
const PIN_COLORS = {
  /** 中小店舗。黄色券・青色券の両方が使える。 */
  small: { background: '#f2b200', borderColor: '#8a6400', glyphColor: '#6b4e00' },
  /** 大型店舗。青色券のみ。 */
  large: { background: '#1f6feb', borderColor: '#0f3d85', glyphColor: '#ffffff' },
} as const

type Props = {
  /** 絞り込み後の店舗。地図には常に絞り込み結果だけを描く。 */
  shops: Shop[]
  /** 現在地。取得していなければ null。 */
  origin: LatLng | null
}

/**
 * クラスタの見た目。
 *
 * **既定の描画は件数に応じて青→赤に変わる。** 券種の色分けと混ざって読めなくなるので
 * （黄色券だけに絞ったのに赤い丸が並ぶ）、中身の券種で塗り分ける。
 * 混在しているクラスタは、どちらの色でもない灰色にする。
 */
function clusterContent(count: number, kind: 'small' | 'large' | 'mixed'): HTMLElement {
  const element = document.createElement('div')
  element.className = `map-cluster map-cluster-${kind}`
  element.textContent = String(count)
  // 件数が多いほど大きく。密度の手掛かりになり、桁が増えても文字が収まる。
  const size = count < 10 ? 34 : count < 100 ? 42 : 50
  element.style.width = `${size}px`
  element.style.height = `${size}px`
  return element
}

export function ShopMap({ shops, origin }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // 現在地のマーカーを別の effect で作るため、読み込んだ API を持っておく。
  const mapsRef = useRef<MapsApi | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const clustererRef = useRef<MarkerClusterer | null>(null)
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const originMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null)
  const [ready, setReady] = useState(false)
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
          mapsRef.current = maps
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
          setReady(true)
        }

        const map = mapRef.current
        const info = infoRef.current

        // クラスタを塗り分けるために、マーカーから券種を引けるようにしておく。
        const isLargeOf = new WeakMap<object, boolean>()

        const markers = plottable.map((shop) => {
          const pin = new maps.PinElement(
            shop.isLarge ? PIN_COLORS.large : PIN_COLORS.small,
          )
          const marker = new maps.AdvancedMarkerElement({
            position: { lat: shop.lat, lng: shop.lng },
            title: shop.name,
            // PinElement 自体が要素。`pin.element` は非推奨（警告が出る）。
            content: pin,
          })
          // AdvancedMarkerElement では 'click' は非推奨で 'gmp-click' を使う。
          marker.addListener('gmp-click', () => {
            // 電話番号が非公開（Excel 上は 000-0000-0000）の店では行ごと出さない。
            // 出すときは発信できるようにする。地図から直接かけられるのが自然。
            const tel =
              shop.tel === null
                ? ''
                : `<a href="tel:${escapeHtml(shop.tel)}">${escapeHtml(shop.tel)}</a><br>`
            info?.setContent(
              `<div style="font-size:13px;line-height:1.5">
                 <strong>${escapeHtml(shop.name)}</strong><br>
                 ${escapeHtml(shop.address)}<br>
                 ${tel}
                 ${shop.isLarge ? '青色券のみ' : '黄色券・青色券'}
                 / ${escapeHtml(CATEGORY_LABELS[shop.category])}
               </div>`,
            )
            info?.open({ map, anchor: marker })
          })
          isLargeOf.set(marker, shop.isLarge)
          return marker
        })

        // 655 件を素で並べると市全域のズームで密集して読めない。
        clustererRef.current?.clearMarkers()
        clustererRef.current = new MarkerClusterer({
          map,
          markers,
          renderer: {
            render: ({ count, position, markers: inCluster }) => {
              const kinds = new Set(
                (inCluster ?? []).map((member) => isLargeOf.get(member) === true),
              )
              const kind = kinds.size > 1 ? 'mixed' : kinds.has(true) ? 'large' : 'small'
              return new maps.AdvancedMarkerElement({
                position,
                content: clusterContent(count, kind),
                title: `${count} 件`,
              })
            },
          },
        })

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

  /**
   * 現在地のマーカー。
   *
   * 店舗のマーカーとは別の effect にする。現在地は店舗の絞り込みとは無関係に
   * 後から届くため、同じ effect に入れると 655 件のマーカーを作り直すことになる。
   * クラスタにも入れない（現在地が店舗と一緒に丸められると意味を失う）。
   */
  useEffect(() => {
    const maps = mapsRef.current
    const map = mapRef.current
    if (!ready || maps === null || map === null) return

    // 地図から外すのは map に null を入れる（AdvancedMarkerElement の作法）。
    if (originMarkerRef.current !== null) {
      originMarkerRef.current.map = null
      originMarkerRef.current = null
    }

    if (origin === null) return

    const dot = document.createElement('div')
    dot.className = 'map-origin'
    originMarkerRef.current = new maps.AdvancedMarkerElement({
      map,
      position: origin,
      title: '現在地',
      content: dot,
      // 店舗のマーカーより手前に出す。
      zIndex: 1000,
    })

    return () => {
      if (originMarkerRef.current !== null) {
        originMarkerRef.current.map = null
        originMarkerRef.current = null
      }
    }
  }, [ready, origin])

  if (error !== null) {
    return <p className="notice notice-error">{error}</p>
  }

  return (
    <>
      {/*
        色に意味がある以上、凡例が要る。ピンの色だけでは券種と結び付かない。
        **地図より上に置く。** 地図は画面高の 7 割を占めるので、下に置くと
        スクロールしないと見えず、凡例の用をなさない。
      */}
      <p className="map-legend">
        <span className="legend-pin legend-pin-small" aria-hidden="true" />
        黄色券・青色券
        <span className="legend-pin legend-pin-large" aria-hidden="true" />
        青色券のみ
      </p>

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
