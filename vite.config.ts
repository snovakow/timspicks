import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// The book list the server reads too, in display order. The page shows every book that isn't off, so turning one
// off or on takes a build; a broken list fails it here rather than in the browser
const BOOK_MODES = ['direct', 'comparison', 'off']
const bookList: unknown = JSON.parse(readFileSync(new URL('./public/sportsbooks.json', import.meta.url), 'utf8'))
if (!Array.isArray(bookList)) throw new Error('public/sportsbooks.json must be a list of books')
const keys = new Set<string>()
const sportsbooks = bookList.map((book: { key?: unknown, title?: unknown, mode?: unknown }, index) => {
  const where = `Book ${index + 1} in public/sportsbooks.json`
  if (typeof book?.key !== 'string' || !/^bet\d+$/.test(book.key)) throw new Error(`${where} has no key of the form bet<n>`)
  if (keys.has(book.key)) throw new Error(`${where} repeats the key ${book.key}`)
  keys.add(book.key)
  if (typeof book.title !== 'string' || !book.title.trim()) throw new Error(`${where} (${book.key}) has no title`)
  if (typeof book.mode !== 'string' || !BOOK_MODES.includes(book.mode)) throw new Error(`${where} (${book.key}) has a mode other than ${BOOK_MODES.join(', ')}`)
  return { key: book.key, title: book.title, mode: book.mode }
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  base: "",
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __SPORTSBOOKS__: JSON.stringify(sportsbooks),
  },
})
