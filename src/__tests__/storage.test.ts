import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadIdentity,
  saveIdentity,
  loadContacts,
  saveContacts,
  loadRooms,
  saveRooms,
  loadMessages,
  saveMessages,
  loadUnread,
  saveUnread,
  saveLog,
  loadLogs,
  clearLogs,
  clearAll,
} from '../lib/storage'
import type { Identity, Contact, Room, Message } from '../store/useStore'

beforeEach(() => {
  localStorage.clear()
})

describe('storage', () => {
  describe('identity', () => {
    it('should return null when no identity saved', () => {
      expect(loadIdentity()).toBeNull()
    })

    it('should save and load identity', () => {
      const identity: Identity = {
        privkey: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]),
        pubkey: 'abc123',
        name: 'TestUser',
      }
      saveIdentity(identity)
      const loaded = loadIdentity()
      expect(loaded).not.toBeNull()
      expect(loaded!.pubkey).toBe('abc123')
      expect(loaded!.name).toBe('TestUser')
      expect(Array.from(loaded!.privkey)).toEqual(Array.from(identity.privkey))
    })

    it('should default name to "Ich" if missing', () => {
      localStorage.setItem('alina_identity', JSON.stringify({
        privkey: [1, 2, 3],
        pubkey: 'abc',
      }))
      const loaded = loadIdentity()
      expect(loaded!.name).toBe('Ich')
    })
  })

  describe('contacts', () => {
    it('should return empty object when no contacts saved', () => {
      expect(loadContacts()).toEqual({})
    })

    it('should save and load contacts', () => {
      const contacts: Record<string, Contact> = {
        abc: { pubkey: 'abc', name: 'Alice' },
        def: { pubkey: 'def', name: 'Bob' },
      }
      saveContacts(contacts)
      expect(loadContacts()).toEqual(contacts)
    })
  })

  describe('rooms', () => {
    it('should save and load rooms', () => {
      const rooms: Record<string, Room> = {
        hash1: { name: 'General', hash: 'hash1', members: [] },
      }
      saveRooms(rooms)
      expect(loadRooms()).toEqual(rooms)
    })
  })

  describe('messages', () => {
    it('should save and load messages', () => {
      const messages: Record<string, Message[]> = {
        'dm:abc': [
          { type: 'text', content: 'hello', pubkey: 'abc', ts: 1000 },
        ],
      }
      saveMessages(messages)
      expect(loadMessages()).toEqual(messages)
    })
  })

  describe('unread', () => {
    it('should save and load unread counts', () => {
      const unread = { 'dm:abc': 3, 'room:xyz': 1 }
      saveUnread(unread)
      expect(loadUnread()).toEqual(unread)
    })
  })

  describe('logs', () => {
    it('should save and load logs', () => {
      saveLog('test', 'hello world')
      const logs = loadLogs()
      expect(logs.length).toBe(1)
      expect(logs[0].type).toBe('test')
      expect(logs[0].message).toBe('hello world')
    })

    it('should limit logs to 100 entries', () => {
      for (let i = 0; i < 110; i++) {
        saveLog('test', `log ${i}`)
      }
      const logs = loadLogs()
      expect(logs.length).toBe(100)
    })

    it('should clear logs', () => {
      saveLog('test', 'hello')
      clearLogs()
      expect(loadLogs()).toEqual([])
    })
  })

  describe('clearAll', () => {
    it('should clear everything', () => {
      saveContacts({ abc: { pubkey: 'abc', name: 'Test' } })
      saveLog('test', 'data')
      clearAll()
      expect(loadContacts()).toEqual({})
      expect(loadLogs()).toEqual([])
    })
  })

  describe('corrupted data handling', () => {
    it('should return defaults for corrupted JSON', () => {
      localStorage.setItem('alina_identity', 'not-json')
      localStorage.setItem('alina_contacts', '{broken')
      localStorage.setItem('alina_messages', 'null')
      expect(loadIdentity()).toBeNull()
      expect(loadContacts()).toEqual({})
    })
  })
})
