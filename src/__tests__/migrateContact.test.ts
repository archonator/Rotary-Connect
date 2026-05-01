/**
 * Tests für die Store-Aktion migrateContact.
 *
 * Wenn ein Kontakt seinen Schlüssel rotiert, MUSS empfängerseitig
 * folgendes umgezogen werden:
 *
 *   • Kontakt-Eintrag (Name bleibt, Pubkey wechselt)
 *   • Chat-History (chatId und pubkey-Felder einzelner Nachrichten)
 *   • Ungelesen-Counter (addiert, falls beide Seiten welche hatten)
 *   • activeChat (falls genau dieser Chat geöffnet ist)
 *
 * Edge-Cases:
 *   • Migration eines unbekannten Kontakts → No-Op
 *   • old === new → No-Op (würde sonst Daten löschen)
 *   • Ziel-chatId hat schon Nachrichten → mergen statt überschreiben
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store/useStore'

beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    identity: null,
    contacts: {},
    rooms: {},
    messages: {},
    unread: {},
    activeChat: null,
    relayCount: 0,
    openModal: null,
    sidebarOpen: true,
  })
})

describe('migrateContact', () => {
  it('moves a contact from oldPubkey to newPubkey', () => {
    useStore.getState().addContact('OLD', 'Alice')
    useStore.getState().migrateContact('OLD', 'NEW')
    const c = useStore.getState().contacts
    expect(c.OLD).toBeUndefined()
    expect(c.NEW).toEqual({ pubkey: 'NEW', name: 'Alice' })
  })

  it('carries chat history under the new chatId', () => {
    useStore.getState().addContact('OLD', 'Alice')
    useStore.getState().addMessage('dm:OLD', { type: 'text', content: 'hi from old', pubkey: 'OLD', ts: 1000 })
    useStore.getState().migrateContact('OLD', 'NEW')

    const msgs = useStore.getState().messages
    expect(msgs['dm:OLD']).toBeUndefined()
    expect(msgs['dm:NEW']).toHaveLength(1)
    expect(msgs['dm:NEW']?.[0]?.pubkey).toBe('NEW')
    expect(msgs['dm:NEW']?.[0]?.content).toBe('hi from old')
  })

  it('merges history if the new chat already had messages', () => {
    useStore.getState().addContact('OLD', 'Alice')
    useStore.getState().addMessage('dm:OLD', { type: 'text', content: 'old-1', pubkey: 'OLD', ts: 1000 })
    useStore.getState().addMessage('dm:NEW', { type: 'text', content: 'new-1', pubkey: 'NEW', ts: 2000 })
    useStore.getState().migrateContact('OLD', 'NEW')

    const msgs = useStore.getState().messages['dm:NEW'] || []
    expect(msgs.length).toBe(2)
  })

  it('is a no-op when oldPubkey is unknown', () => {
    useStore.getState().migrateContact('UNKNOWN', 'NEW')
    expect(useStore.getState().contacts).toEqual({})
  })

  it('updates activeChat if the migrated chat was active', () => {
    useStore.getState().addContact('OLD', 'Alice')
    useStore.getState().setActiveChat({ type: 'dm', id: 'OLD', name: 'Alice', chatId: 'dm:OLD' })
    useStore.getState().migrateContact('OLD', 'NEW')
    const ac = useStore.getState().activeChat
    expect(ac?.id).toBe('NEW')
    expect(ac?.chatId).toBe('dm:NEW')
  })

  it('carries unread counts to the new chatId', () => {
    useStore.getState().addContact('OLD', 'Alice')
    useStore.getState().incrementUnread('dm:OLD')
    useStore.getState().incrementUnread('dm:OLD')
    useStore.getState().migrateContact('OLD', 'NEW')
    const u = useStore.getState().unread
    expect(u['dm:OLD']).toBeUndefined()
    expect(u['dm:NEW']).toBe(2)
  })
})
