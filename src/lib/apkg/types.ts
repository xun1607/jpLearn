export interface ParsedTemplate {
  name: string
  qfmt: string
  afmt: string
}

export interface ParsedNotetype {
  id: number
  name: string
  fields: string[]
  css: string
  templates: ParsedTemplate[]
}

export interface ParsedDeck {
  id: number
  /** đã chuẩn hoá về "::" */
  name: string
}

export interface ParsedNote {
  id: number
  guid: string
  notetypeId: number
  fields: string[]
  tags: string[]
}

export interface ParsedCard {
  id: number
  noteId: number
  deckId: number
  ord: number
}

export interface ParsedMedia {
  name: string
  data: Uint8Array
}

export interface ParsedCollection {
  /** schema phát hiện được */
  schema: 'v11' | 'v18'
  /** tên entry trong zip đã dùng làm database */
  dbEntry: string
  notetypes: ParsedNotetype[]
  decks: ParsedDeck[]
  notes: ParsedNote[]
  cards: ParsedCard[]
  media: ParsedMedia[]
  /** cảnh báo không chặn import (vd: không đọc được map media) */
  warnings: string[]
}

export type ProgressFn = (phase: string, done?: number, total?: number) => void
