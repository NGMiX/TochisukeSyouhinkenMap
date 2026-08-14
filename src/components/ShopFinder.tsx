'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import { FilterBar } from '@/components/FilterBar'
import { ShopCard } from '@/components/ShopCard'
import { EMPTY_FILTERS, type Filters, filterShops, hasActiveFilters } from '@/lib/filter'
import { loadShops } from '@/lib/load-shops'
import type { Shop } from '@/lib/shop'

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

export function ShopFinder() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [tab, setTab] = useState<Tab>('list')

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

  const shops = state.status === 'ready' ? state.shops : []
  // 655 件の総当たりで体感遅延は無いが、タブ切り替えや再描画のたびに
  // 走らせる必要はないので条件が変わったときだけ計算する。
  const results = useMemo(() => filterShops(shops, filters), [shops, filters])

  return (
    <div className="page">
      <header className="header">
        <h1 className="title">
          とち介商品券 加盟店さがし
          {state.status === 'ready' && <span>{state.sourceLabel}</span>}
        </h1>

        <FilterBar filters={filters} onChange={setFilters} />

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

      {state.status === 'ready' && (
        <>
          <p className="count">
            <strong>{results.length}</strong> 件
            {hasActiveFilters(filters) && ` / 全 ${shops.length} 件`}
          </p>

          {tab === 'list' &&
            (results.length === 0 ? (
              <p className="notice">
                条件に合うお店がありません。
                <br />
                検索語を短くするか、絞り込みを外してみてください。
              </p>
            ) : (
              <ul className="list">
                {results.map((shop) => (
                  <ShopCard key={shop.id} shop={shop} />
                ))}
              </ul>
            ))}

          {tab === 'map' &&
            (results.length === 0 ? (
              <p className="notice">条件に合うお店がありません。</p>
            ) : (
              <ShopMap shops={results} />
            ))}
        </>
      )}
    </div>
  )
}
