/**
 * §11: parser .apkg phải test bằng script Node TRƯỚC khi nối vào UI.
 *
 *   npm run inspect -- "D:/DOWNLOAD/deck.apkg"
 *
 * In ra schema phát hiện được, số notetype/deck/note/card/media và vài note đầu
 * để mắt thường kiểm tra text tiếng Nhật không vỡ encoding.
 */
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')

/** Bundle parser TS -> ESM tạm, để Node chạy được code dùng chung với app. */
async function loadParser() {
  const outfile = path.join(root, 'node_modules/.cache/apkg/parse.mjs')
  mkdirSync(path.dirname(outfile), { recursive: true })
  await build({
    entryPoints: [path.join(root, 'src/lib/apkg/parse.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    packages: 'external',
    logLevel: 'error',
  })
  return import(pathToFileURL(outfile).href)
}

function plain(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' / ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('Dùng: npm run inspect -- <file.apkg> [file2.apkg ...]')
    process.exit(1)
  }

  const { parseApkg } = await loadParser()
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs()

  let failed = false
  for (const file of files) {
    console.log(`\n=== ${path.basename(file)} ${'='.repeat(Math.max(0, 50 - path.basename(file).length))}`)
    const started = Date.now()
    try {
      const bytes = new Uint8Array(readFileSync(file))
      const col = parseApkg(bytes, SQL)

      console.log(`  schema     : ${col.schema}   (db: ${col.dbEntry})`)
      console.log(`  notetypes  : ${col.notetypes.length}`)
      console.log(`  decks      : ${col.decks.length}`)
      console.log(`  notes      : ${col.notes.length}`)
      console.log(`  cards      : ${col.cards.length}`)
      console.log(`  media      : ${col.media.length}`)
      console.log(`  thời gian  : ${Date.now() - started}ms`)

      for (const nt of col.notetypes.slice(0, 4)) {
        console.log(
          `    notetype "${nt.name}": ${nt.templates.length} template, fields = [${nt.fields.join(', ')}]`,
        )
      }
      for (const deck of col.decks.slice(0, 6)) {
        const n = col.cards.filter((c) => c.deckId === deck.id).length
        console.log(`    deck "${deck.name}": ${n} card`)
      }
      console.log('  --- 3 note đầu ---')
      for (const note of col.notes.slice(0, 3)) {
        const shown = note.fields.slice(0, 4).map(plain).filter(Boolean)
        console.log(`    · ${shown.join('  |  ')}`)
      }
      if (col.media.length > 0) {
        console.log(`  --- media đầu tiên ---`)
        for (const m of col.media.slice(0, 3)) {
          console.log(`    · ${m.name} (${m.data.length} bytes)`)
        }
      }
      for (const w of col.warnings) console.log(`  ⚠  ${w}`)

      const cardsPerNote = col.notes.length ? (col.cards.length / col.notes.length).toFixed(2) : '0'
      console.log(`  card/note  : ${cardsPerNote}`)
      // Chỉ là file mồi khi đã phải tụt xuống collection.anki2 (Bẫy 2 §6).
      if (col.notes.length === 1 && col.dbEntry === 'collection.anki2') {
        console.log('  ⚠  1 NOTE trong collection.anki2 — rất nhiều khả năng đây là file mồi')
      }
    } catch (err) {
      failed = true
      console.log(`  ✗ LỖI: ${err.stack ?? err}`)
    }
  }
  process.exit(failed ? 1 : 0)
}

main()
