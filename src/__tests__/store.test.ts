import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store/useStore'

beforeEach(() => {
  localStorage.clear()
  // Reset store to initial state
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

describe('useStore', () => {
  describe('identity', () => {
    it('should create a new identity', () => {
      useStore.getState().createIdentity('Alice')
      const { identity } = useStore.getState()
      expect(identity).not.toBeNull()
      expect(identity!.name).toBe('Alice')
      expect(identity!.pubkey).toMatch(/^[0-9a-f]{64}$/)
      expect(identity!.privkey).toBeInstanceOf(Uint8Array)
    })

    it('should update name', () => {
      useStore.getState().createIdentity('Alice')
      useStore.getState().updateName('Bob')
      expect(useStore.getState().identity!.name).toBe('Bob')
    })

    it('should logout and clear state', () => {
      useStore.getState().createIdentity('Alice')
      useStore.getState().addContact('abc123def456abc123def456abc123def456abc123def456abc123def456abc123de', 'Bob')
      useStore.getState().logout()
      const state = useStore.getState()
      expect(state.identity).toBeNull()
      expect(state.contacts).toEqual({})
      expect(state.messages).toEqual({})
    })
  })

  describe('contacts', () => {
    it('should add a contact', () => {
      useStore.getState().addContact('pubkey123', 'Alice')
      expect(useStore.getState().contacts['pubkey123']).toEqual({ pubkey: 'pubkey123', name: 'Alice' })
    })

    it('should rename a contact', () => {
      useStore.getState().addContact('pubkey123', 'Alice')
      useStore.getState().renameContact('pubkey123', 'Alina')
      expect(useStore.getState().contacts['pubkey123'].name).toBe('Alina')
    })

    it('should delete a contact and its messages', () => {
      useStore.getState().addContact('pubkey123', 'Alice')
      useStore.getState().addMessage('dm:pubkey123', { type: 'text', content: 'hi', pubkey: 'pubkey123', ts: 1000 })
      useStore.getState().deleteContact('pubkey123')
      expect(useStore.getState().contacts['pubkey123']).toBeUndefined()
      expect(useStore.getState().messages['dm:pubkey123']).toBeUndefined()
    })

    it('should not overwrite existing contact with ensureContact', () => {
      useStore.getState().addContact('pubkey123', 'Alice')
      useStore.getState().ensureContact('pubkey123', 'Unknown')
      expect(useStore.getState().contacts['pubkey123'].name).toBe('Alice')
    })
  })

  describe('messages', () => {
    it('should add a message', () => {
      const added = useStore.getState().addMessage('dm:abc', { type: 'text', content: 'hello', pubkey: 'abc', ts: 1000 })
      expect(added).toBe(true)
      expect(useStore.getState().messages['dm:abc']).toHaveLength(1)
    })

    it('should reject duplicate messages by ts+pubkey', () => {
      useStore.getState().addMessage('dm:abc', { type: 'text', content: 'hello', pubkey: 'abc', ts: 1000 })
      const added = useStore.getState().addMessage('dm:abc', { type: 'text', content: 'hello again', pubkey: 'abc', ts: 1000 })
      expect(added).toBe(false)
      expect(useStore.getState().messages['dm:abc']).toHaveLength(1)
    })

    it('should reject duplicate messages by eventId', () => {
      useStore.getState().addMessage('dm:abc', { type: 'text', content: 'hello', pubkey: 'abc', ts: 1000, eventId: 'evt-1' })
      const added = useStore.getState().addMessage('dm:abc', { type: 'text', content: 'hello', pubkey: 'abc', ts: 2000, eventId: 'evt-1' })
      expect(added).toBe(false)
      expect(useStore.getState().messages['dm:abc']).toHaveLength(1)
    })

    it('should cap messages at MAX_MESSAGES_PER_CHAT', () => {
      for (let i = 0; i < 210; i++) {
        useStore.getState().addMessage('dm:abc', { type: 'text', content: 'msg ' + i, pubkey: 'abc', ts: i })
      }
      expect(useStore.getState().messages['dm:abc'].length).toBeLessThanOrEqual(200)
    })
  })

  describe('unread', () => {
    it('should increment and clear unread', () => {
      useStore.getState().incrementUnread('dm:abc')
      useStore.getState().incrementUnread('dm:abc')
      expect(useStore.getState().unread['dm:abc']).toBe(2)
      useStore.getState().clearUnread('dm:abc')
      expect(useStore.getState().unread['dm:abc']).toBe(0)
    })
  })

  describe('rooms', () => {
    it('should add a room', () => {
      useStore.getState().addRoom('hash123', 'General')
      expect(useStore.getState().rooms['hash123']).toEqual({ name: 'General', hash: 'hash123', members: [] })
    })
  })

  describe('UI state', () => {
    it('should manage modal state', () => {
      useStore.getState().setOpenModal('settings')
      expect(useStore.getState().openModal).toBe('settings')
      useStore.getState().setOpenModal(null)
      expect(useStore.getState().openModal).toBeNull()
    })

    it('should manage sidebar state', () => {
      useStore.getState().setSidebarOpen(true)
      expect(useStore.getState().sidebarOpen).toBe(true)
    })
  })
})
