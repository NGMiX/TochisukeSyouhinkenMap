import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'とち介商品券2026 マップ',
  description:
    '栃木市のとち介商品券が使えるお店を、店名・住所・業種から探せます。黄色券が使えるお店だけに絞り込めます。',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

/**
 * 古すぎるブラウザに理由を出すための見張り。
 *
 * **このスクリプトだけは ES5 で書く。** 配信するチャンクは Next.js の既定で
 * Safari 12 以上向けにコンパイルされ、オブジェクトスプレッド（ES2018）が残る。
 * それより古いエンジン（実例: iOS 10.3.4 の iPhone 5c）は**パースの時点で落ちるため
 * チャンクが 1 行も実行されず**、静的 HTML に焼かれた「読み込み中…」が永久に残る。
 * 何も起きない画面が最悪なので、静的 HTML 側から文言を差し替える。
 *
 * 判定は個別の機能検出ではなく **「アプリが動き出したか」** で行う。
 * `ShopFinder` が読み込まれた時点で `window.__tochisukeAlive` が立つので、
 * 立っていなければ理由は何であれ（構文エラー・チャンクの転送漏れ・JS 無効）
 * アプリは動いていない。個別の API を並べて検出するより漏れがない。
 *
 * `load` の後に待つのは、`async` スクリプトの取得が遅い回線を誤判定しないため。
 * 誤って出しても、あとで React が動き出せばこの要素ごと描き替わる。
 */
const BOOT_WATCHDOG = `!function(){
  var GRACE_MS = 5000;
  function tell() {
    var el = document.getElementById('boot-notice');
    if (!el) return;
    if (window.__tochisukeAlive) return;
    el.className = 'notice notice-error';
    el.textContent =
      'お使いのブラウザでは表示できません。iPhone は iOS 12 以上、Android は Chrome 84 以上でお試しください。地図の表示にはさらに新しい端末が必要です。';
  }
  function arm() { setTimeout(tell, GRACE_MS); }
  if (document.readyState === 'complete') arm();
  else window.addEventListener('load', arm);
}();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 静的な文字列のみ。古いブラウザに文言を出す唯一の手段 */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_WATCHDOG }} />
        {children}
      </body>
    </html>
  )
}
