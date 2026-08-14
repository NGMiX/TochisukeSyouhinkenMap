'use client'

/**
 * 現在地の取得。ブラウザの Geolocation API を 1 回だけ叩く。
 *
 * - **利用者が明示的に押したときだけ要求する。** 画面を開いた瞬間に許可を求めるのは
 *   不親切で、iOS ではユーザー操作を伴わない要求が通らないこともある。
 * - `watchPosition` は使わない。買い物中に追従する必要は無く、電池を食うだけ。
 * - **HTTPS でないと動かない**（localhost は例外）。本番は HTTPS なので問題ないが、
 *   開発機を LAN の IP で開いて確認すると取得できない。
 */

import { useCallback, useState } from 'react'
import type { LatLng } from './geo'

export type PositionState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'ready'; position: LatLng; accuracy: number }
  | { status: 'error'; message: string }

/** 取得できなかった理由を利用者の言葉に直す。数字のエラーコードは見せない。 */
function messageFor(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return '位置情報の利用が許可されませんでした。ブラウザの設定で許可すると近い順に並べられます。'
    case error.POSITION_UNAVAILABLE:
      return '現在地を取得できませんでした。'
    case error.TIMEOUT:
      return '現在地の取得に時間がかかっています。電波の届く場所で試してください。'
    default:
      return '現在地を取得できませんでした。'
  }
}

export function useCurrentPosition(): {
  state: PositionState
  /** 現在地を要求する。利用者の操作から呼ぶ。 */
  request: () => void
  /** 取得済みの現在地を捨てる。 */
  clear: () => void
} {
  const [state, setState] = useState<PositionState>({ status: 'idle' })

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      setState({
        status: 'error',
        message: 'このブラウザでは現在地を使えません。',
      })
      return
    }

    setState({ status: 'locating' })
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          status: 'ready',
          position: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          accuracy: position.coords.accuracy,
        })
      },
      (error) => {
        setState({ status: 'error', message: messageFor(error) })
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        // 直前に取った位置があれば使い回す。店を探している間に何度も測位しない。
        maximumAge: 60_000,
      },
    )
  }, [])

  const clear = useCallback(() => setState({ status: 'idle' }), [])

  return { state, request, clear }
}
