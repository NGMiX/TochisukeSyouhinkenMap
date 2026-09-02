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

/** 読み込み中の置き換え。毎回 `[]` を作ると、そのたびに絞り込みが走り直す。 */
const EMPTY_SHOPS: Shop[] = []

/**
 * アプリが動き出した印。**`src/app/layout.tsx` の見張りがこれを見る。**
 *
 * 古すぎるブラウザではチャンクがパースできず、この行に到達しない。印が無ければ
 * 「読み込み中…」を非対応の知らせに差し替える。消すと古い端末で画面が固まったままになる。
 */
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__tochisukeAlive = true
}

export function ShopFinder() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [order, setOrder] = useState<SortOrder>('default')
  const [tab, setTab] = useState<Tab>('list')
  /**
   * 地図タブを一度でも開いたか。
   *
   * **遅延ロードは崩さない。** 開くまで地図のチャンクも Maps API も読み込まない
   * （課金対象の map load もそこで初めて発生する）。一度開いた後は
   * タブを戻しても `hidden` にするだけで、地図そのものは作り直さない。
   */
  const [mapOpened, setMapOpened] = useState(false)
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

  const shops = state.status === 'ready' ? state.shops : EMPTY_SHOPS
  // 655 件の総当たりで体感遅延は無いが、タブ切り替えや再描画のたびに
  // 走らせる必要はないので条件が変わったときだけ計算する。
  const results = useMemo(() => {
    return sortShops(filterShops(shops, filters), order, origin)
  }, [shops, filters, order, origin])

  /**
   * 表示件数を先頭に戻す条件を、1 本の文字列にまとめたもの。
   *
   * **配列やオブジェクトの同一性で比べてはいけない。** 開発時の StrictMode は描画を
   * 二度走らせ、そのとき `useMemo` の結果が作り直される。同一性で比べると毎回
   * 「変わった」と見なされ、描画中の更新が止まらずに落ちる（Too many re-renders）。
   */
  const resetKey = [
    filters.query,
    filters.yellowOnly,
    filters.categories.join(','),
    filters.areas.join(','),
    order,
    origin?.lat,
    origin?.lng,
    shops.length,
  ].join('|')

  // 条件や並び順が変わったら先頭から見せる。前の続きから始まると読み飛ばしになる。
  // effect ではなく描画中に直す（effect にすると一瞬だけ前の枚数で描かれる）。
  const [shownFor, setShownFor] = useState(resetKey)
  if (shownFor !== resetKey) {
    setShownFor(resetKey)
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
        {/* 版のラベルは同じ行の右端に置く。1 行を丸ごと使うほどの情報ではない。 */}
        <h1 className="title">
          <span className="title-name">とち介商品券マップ</span>
          {state.status === 'ready' && (
            <span className="title-version">{state.sourceLabel}</span>
          )}
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
            onClick={() => {
              setTab('map')
              setMapOpened(true)
            }}
          >
            地図
          </button>
        </div>
      </header>

      {/* id は layout.tsx の見張りが掴む。外すと古い端末に理由が出なくなる。 */}
      {state.status === 'loading' && (
        <p className="notice" id="boot-notice">
          読み込み中…
        </p>
      )}

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

          {/*
            **地図は一度開いたら外さない。** アンマウントすると `google.maps.Map` が捨てられ、
            戻ったときに作り直しになる。利用者が見ていた位置と倍率が失われる上、
            **課金対象の map load がタブを開くたびに発生する**。
            0 件のときも同じ理由で残し、通知だけを上に出す（条件を戻せばピンが戻る）。
          */}
          {mapOpened && (
            <div className="map-panel" hidden={tab !== 'map'}>
              {results.length === 0 && (
                <p className="notice">条件に合うお店がありません。</p>
              )}
              <ShopMap shops={results} origin={origin} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
