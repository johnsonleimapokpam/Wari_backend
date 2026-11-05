const test = require('node:test');
const assert = require('node:assert/strict');

const { RedisPresenceStore } = require('../src/services/presenceService');

class FakeRedis {
  constructor() {
    this.sets = new Map();
    this.values = new Map();
  }

  setMembers(key) {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    return this.sets.get(key);
  }

  async sCard(key) {
    return this.setMembers(key).size;
  }

  async sAdd(key, value) {
    const members = this.setMembers(key);
    const previousSize = members.size;
    members.add(value);
    return members.size > previousSize ? 1 : 0;
  }

  async sRem(key, value) {
    return this.setMembers(key).delete(value) ? 1 : 0;
  }

  async get(key) {
    return this.values.get(key) || null;
  }

  async set(key, value) {
    this.values.set(key, value);
  }

  async eval(_script, { keys, arguments: args }) {
    const [socketKey, presenceKey, lastSeenKey] = keys;
    const socketId = args[0];
    const members = this.setMembers(socketKey);

    if (keys.length === 2) {
      const added = members.has(socketId) ? 0 : 1;
      members.add(socketId);
      this.values.set(presenceKey, 'online');
      return [added, members.size];
    }

    const removed = members.delete(socketId) ? 1 : 0;
    if (removed && members.size === 0) {
      this.values.set(presenceKey, 'offline');
      this.values.set(lastSeenKey, args[1]);
    }
    return [removed, members.size];
  }
}

test('duplicate disconnect does not emit a second offline transition', async () => {
  const store = new RedisPresenceStore(new FakeRedis());
  await store.registerConnection('user-1', 'socket-1');

  const first = await store.unregisterConnection('user-1', 'socket-1', new Date('2026-01-01T00:00:00.000Z'));
  const duplicate = await store.unregisterConnection('user-1', 'socket-1', new Date('2026-01-01T00:01:00.000Z'));

  assert.equal(first.wentOffline, true);
  assert.equal(first.shouldPersistLastSeen, true);
  assert.equal(duplicate.wentOffline, false);
  assert.equal(duplicate.shouldPersistLastSeen, false);
});

test('multiple sockets only transition offline after the final socket leaves', async () => {
  const store = new RedisPresenceStore(new FakeRedis());
  await store.registerConnection('user-1', 'socket-1');
  await store.registerConnection('user-1', 'socket-2');

  const first = await store.unregisterConnection('user-1', 'socket-1');
  const final = await store.unregisterConnection('user-1', 'socket-2');

  assert.equal(first.wentOffline, false);
  assert.equal(final.wentOffline, true);
});
