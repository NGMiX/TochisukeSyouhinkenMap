#!/usr/bin/env bun
/**
 * `out/` を本番と同じ `/tochisuke/` 配下に置いた状態でローカル配信する。
 *
 *   bun run preview
 *
 * basePath 絡みの不具合（素の `fetch` にパスが前置されず 404 になる等）は、
 * ルート直下で配信すると**再現しない**。転送前の確認は必ずこれを通すこと。
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../out')
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '/tochisuke'
const PORT = Number(process.env.PORT ?? 4000)

if (!existsSync(ROOT)) {
  console.error('out/ が無い。先に `bun run build` を実行すること。')
  process.exit(1)
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)

    // basePath の外は本番でも 404。ここで再現しておく。
    if (!url.pathname.startsWith(`${BASE_PATH}/`) && url.pathname !== BASE_PATH) {
      return new Response(
        `${url.pathname} は ${BASE_PATH}/ の外。本番でも 404 になる。`,
        { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      )
    }

    const relative = url.pathname.slice(BASE_PATH.length) || '/'
    // trailingSlash: true の出力に合わせ、ディレクトリは index.html を返す。
    const candidates = relative.endsWith('/')
      ? [`${relative}index.html`]
      : [relative, `${relative}/index.html`]

    for (const candidate of candidates) {
      const file = Bun.file(resolve(ROOT, `.${candidate}`))
      if (await file.exists()) return new Response(file)
    }

    const notFound = Bun.file(resolve(ROOT, './404.html'))
    if (await notFound.exists()) {
      return new Response(notFound, { status: 404 })
    }
    return new Response('Not Found', { status: 404 })
  },
})

console.log(`本番と同じ配置で配信中: http://localhost:${server.port}${BASE_PATH}/`)
console.log('（Ctrl+C で終了）')
