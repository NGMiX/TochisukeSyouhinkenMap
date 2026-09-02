import type { Metadata, Viewport } from 'next'
import './globals.css'

/**
 * 公開 URL。OG 画像などの相対パスはここを基準に絶対 URL へ展開される。
 * 末尾のスラッシュを外すと `og.png` が `/og.png`（サイト直下）に化けるので消さないこと。
 */
const SITE_URL = 'https://www.ngmix.com/tochisuke/'

/** 検索結果と SNS カードの両方で使う短い説明。 */
const SUMMARY =
  '栃木市の「とち介商品券2026」が使えるお店を、店名・住所・業種から検索できます。地図でも探せます。'

/**
 * 検索エンジン向けの情報。
 *
 * **`keywords` は入れない。** Google は 2009 年に順位の要素として使わないと明言しており、
 * Bing も同様。入れても効かず、文言が古びるだけになる。
 * 効くのは `title` と本文なので、実際に使われている検索語をそこに入れる。
 *
 * **狙う語**: 「とち介商品券 どこで使える」（実際にこの語で流入していた実績がある）、
 * 「とちすけ商品券」（かな表記のゆれ）、「栃木市 商品券」「とち介商品券2026」。
 *
 * **`canonical` を明示する。** `/tochisuke` と `/tochisuke/` のように末尾スラッシュの
 * 有無で別 URL と見なされるのを防ぐ。
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'とち介商品券マップ｜栃木市の加盟店はどこで使える？',
  description:
    '栃木市の「とち介商品券2026」がどこで使えるかを調べられる加盟店マップ。とちすけ商品券（栃木市商品券）の取扱店を店名・住所・業種で検索し、地図でも確認できます。黄色券が使えるお店だけに絞り込み、現在地から近い順にも並べ替えられます。',
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    locale: 'ja_JP',
    url: SITE_URL,
    siteName: 'とち介商品券マップ',
    title: 'とち介商品券マップ｜栃木市の加盟店はどこで使える？',
    description: SUMMARY,
    // metadataBase からの相対。先頭に / を付けるとサイト直下を指してしまう。
    images: [{ url: 'og.png', width: 1200, height: 630, alt: 'とち介商品券マップ' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'とち介商品券マップ｜栃木市の加盟店はどこで使える？',
    description: SUMMARY,
    images: ['og.png'],
  },
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
