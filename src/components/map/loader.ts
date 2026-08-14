/**
 * Google Maps JavaScript API の読み込み。
 *
 * **地図タブが最初に開かれたときだけ呼ぶ。** 初期表示で読み込むと、
 * 地図を見ない利用者にもモバイル回線で数百 KB を負わせることになり、
 * 課金対象の map load もそこで発生する。
 *
 * Maps API への依存はこのディレクトリ（`components/map/`）の中だけに閉じ込める。
 * リスト側・絞り込み側が Maps の型を知らない状態を保つこと。
 */

declare global {
  interface Window {
    google?: typeof google
  }
}

/** 地図の描画に必要なクラス一式。 */
export type MapsApi = {
  Map: typeof google.maps.Map
  InfoWindow: typeof google.maps.InfoWindow
  LatLngBounds: typeof google.maps.LatLngBounds
  AdvancedMarkerElement: typeof google.maps.marker.AdvancedMarkerElement
}

let loading: Promise<MapsApi> | null = null

/**
 * Advanced Markers には Map ID が要る。
 * 本番では Cloud Console で作った ID を `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` に設定する。
 * 未設定のときは Google が用意している開発用 ID を使う（本番では使わないこと）。
 */
function mapId(): string {
  const configured = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
  return configured !== undefined && configured !== '' ? configured : 'DEMO_MAP_ID'
}

export const MAP_ID = mapId()

/** コールバック関数を載せるためのグローバル名。 */
const CALLBACK_NAME = '__tochisukeInitGoogleMaps'

/**
 * スクリプトを読み込み、API が使える状態になるまで待つ。
 *
 * **`script.onload` では足りない。** `loading=async` を付けた場合、onload の時点では
 * `google.maps` の名前空間はあってもクラス（`Map` など）がまだ生えていない。
 * 準備完了を知る手段は `callback` パラメータで、これが呼ばれて初めて使える。
 */
function injectScript(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const globals = window as unknown as Record<string, unknown>
    globals[CALLBACK_NAME] = () => {
      delete globals[CALLBACK_NAME]
      resolve()
    }

    const script = document.createElement('script')
    const params = new URLSearchParams({
      key,
      libraries: 'marker',
      language: 'ja',
      region: 'JP',
      loading: 'async',
      v: 'weekly',
      callback: CALLBACK_NAME,
    })
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`
    script.async = true
    script.onerror = () => {
      delete globals[CALLBACK_NAME]
      reject(
        new Error(
          '地図の読み込みに失敗しました。通信状況か API キーの制限設定を確認してください。',
        ),
      )
    }
    document.head.appendChild(script)
  })
}

export function loadGoogleMaps(): Promise<MapsApi> {
  // 同じタブを何度も開き直しても読み込みは 1 回で済ませる。
  if (loading !== null) return loading

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (key === undefined || key === '') {
    return Promise.reject(
      new Error(
        'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY が未設定です。.env.local.example を参照してください。',
      ),
    )
  }

  loading = (async () => {
    if (window.google?.maps?.Map === undefined) {
      await injectScript(key)
    }
    const maps = window.google?.maps
    if (maps?.Map === undefined || maps.marker?.AdvancedMarkerElement === undefined) {
      throw new Error('Google Maps を読み込めませんでした。')
    }

    return {
      Map: maps.Map,
      InfoWindow: maps.InfoWindow,
      LatLngBounds: maps.LatLngBounds,
      AdvancedMarkerElement: maps.marker.AdvancedMarkerElement,
    }
  })().catch((error: unknown) => {
    // 次に開いたときに再試行できるよう、失敗した Promise を残さない。
    loading = null
    throw error
  })

  return loading
}
