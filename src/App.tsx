import { useEffect, useState } from 'react'
import { seedIfEmpty } from './db'
import { BrowseScreen } from './features/browse/BrowseScreen'
import { DeckList, type DeckSummary } from './features/decks/DeckList'
import { ImportScreen } from './features/import/ImportScreen'
import { NoteEditor } from './features/notes/NoteEditor'
import { ReviewScreen } from './features/review/ReviewScreen'

type Screen =
  | { name: 'decks' }
  | { name: 'review'; deck: DeckSummary }
  | { name: 'add' }
  | { name: 'import' }
  | { name: 'browse'; query: string }

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'decks' })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // §9 bước 4: không gọi persist() thì iOS có thể dọn sạch IndexedDB.
    void navigator.storage?.persist?.()
    void seedIfEmpty().then(() => setReady(true))
  }, [])

  if (!ready) return null

  const back = () => setScreen({ name: 'decks' })

  switch (screen.name) {
    case 'review':
      return (
        <ReviewScreen
          deckId={screen.deck.id}
          deckName={screen.deck.name}
          onExit={back}
        />
      )
    case 'add':
      return <NoteEditor onExit={back} />
    case 'import':
      return <ImportScreen onExit={back} />
    case 'browse':
      return <BrowseScreen initialQuery={screen.query} onExit={back} />
    default:
      return (
        <DeckList
          onOpen={(deck) => setScreen({ name: 'review', deck })}
          onAdd={() => setScreen({ name: 'add' })}
          onImport={() => setScreen({ name: 'import' })}
          onBrowse={(query) => setScreen({ name: 'browse', query })}
        />
      )
  }
}
