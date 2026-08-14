'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import { FilterBar } from '@/components/FilterBar'
import { ShopCard } from '@/components/ShopCard'
import { EMPTY_FILTERS, type Filters, filterShops, hasActiveFilters } from '@/lib/filter'
import { type LatLng, type SortOrder, shopDistance, sortShops } from '@/lib/geo'
import { loadShops } from '@/lib/load-shops'
import type { Shop } from '@/lib/shop'
import { useCurrentPosition } from '@/lib/use-current-position'

/**
 * 地図は**タブが開かれるまで読み込まない**。
 *
 * 地図関連のコードは別チャンクに切り出され、リストだけを見る利用者には配信されない。
 * Google Maps 本体の読み込み（課金対象の map load が発生する）も同様に、
 * 実際に地図を表示する段になって初めて走る。
 */
const ShopMap = dynamic(() => import('@/components/map/ShopMap').then((m) => m.ShopMap), {
  ssr: false,
  loading: () => <p className="notice">地図を読み込み中…</p>,
})

type Tab = 'list' | 'map'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; shops: Shop[]; sourceLabel: string }

/**
 * 一度に描くカードの枚数。
 *
 * 655 件を一度に組むと、スマートフォンでは初回表示と絞り込みの反応が目に見えて遅れる。
 * 利用者は上から順に見るので、続きは「さらに表示」で足す。
 */
const PAGE_SIZE = 50

export function ShopFinder() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [order, setOrder] = useState<SortOrder>('default')
  const [tab, setTab] = useState<Tab>('list')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [shown, setShown] = useState(PAGE_SIZE)
  const position = useCurrentPosition()

  useEffect(() => {
    let cancelled = false
    loadShops()
      .then(({ shops, sourceLabel }) => {
        if (!cancelled) setState({ status: 'ready', shops, sourceLabel })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const origin: LatLng | null =
    position.state.status === 'ready' ? position.state.position : null

  // 現在地が取れなかったら並び順を戻す。押した状態のまま何も起きないと理由が分からない。
  useEffect(() => {
    if (position.state.status === 'error') setOrder('default')
  }, [position.state.status])

  const shops = state.status === 'ready' ? state.shops : []
  // 655 件の総当たりで体感遅延は無いが、タブ切り替えや再描画のたびに
  // 走らせる必要はないので条件が変わったときだけ計算する。
  const results = useMemo(() => {
    return sortShops(filterShops(shops, filters), order, origin)
  }, [shops, filters, order, origin])

  // 条件や並び順が変わったら先頭から見せる。前の続きから始まると読み飛ばしになる。
  // effect ではなく描画中に直す（effect にすると一瞬だけ前の枚数で描かれる）。
  const [shownFor, setShownFor] = useState(results)
  if (shownFor !== results) {
    setShownFor(results)
    setShown(PAGE_SIZE)
  }

  function changeOrder(next: SortOrder) {
    setOrder(next)
    // 現在地がまだ無ければ取りに行く。取れた時点で並びが変わる。
    if (next === 'distance' && position.state.status !== 'ready') position.request()
  }

  return (
    <div className="page">
      <header className="header">
        <h1 className="title">
          とち介商品券 加盟店さがし
          {state.status === 'ready' && <span>{state.sourceLabel}</span>}
        </h1>

        <FilterBar
          filters={filters}
          onChange={setFilters}
          order={order}
          onOrderChange={changeOrder}
          positionStatus={position.state.status}
          detailsOpen={detailsOpen}
          onDetailsOpenChange={setDetailsOpen}
        />

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === 'list'}
            onClick={() => setTab('list')}
          >
            リスト
          </button>
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === 'map'}
            onClick={() => setTab('map')}
          >
            地図
          </button>
        </div>
      </header>

      {state.status === 'loading' && <p className="notice">読み込み中…</p>}

      {state.status === 'error' && (
        <p className="notice notice-error">
          加盟店データを読み込めませんでした。
          <br />
          {state.message}
        </p>
      )}

      {position.state.status === 'error' && (
        <p className="notice notice-warn">{position.state.message}</p>
      )}

      {state.status === 'ready' && (
        <>
          <p className="count">
            <strong>{results.length}</strong> 件
            {hasActiveFilters(filters) && ` / 全 ${shops.length} 件`}
            {order === 'distance' && origin !== null && (
              <span className="count-note">現在地から近い順</span>
            )}
          </p>

          {tab === 'list' &&
            (results.length === 0 ? (
              <p className="notice">
                条件に合うお店がありません。
                <br />
                検索語を短くするか、絞り込みを外してみてください。
              </p>
            ) : (
              <>
                <ul className="list">
                  {results.slice(0, shown).map((shop) => (
                    <ShopCard
                      key={shop.id}
                      shop={shop}
                      distance={shopDistance(shop, origin)}
                    />
                  ))}
                </ul>
                {results.length > shown && (
                  <button
                    type="button"
                    className="more"
                    onClick={() => setShown((n) => n + PAGE_SIZE)}
                  >
                    さらに表示（残り {results.length - shown} 件）
                  </button>
                )}
              </>
            ))}

          {tab === 'map' &&
            (results.length === 0 ? (
              <p className="notice">条件に合うお店がありません。</p>
            ) : (
              <ShopMap shops={results} origin={origin} />
            ))}
        </>
      )}
    </div>
  )
}
