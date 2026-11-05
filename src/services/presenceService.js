const ApiError = require('../utils/ApiError');
const userRepository = require('../repositories/userRepository');
const redisClient = require('../config/redis');

class RedisPresenceStore {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async registerConnection(userId, socketId) {
    const key = `user:${userId}:sockets`;
    const [added, count] = await this.redis.eval(
      `
        local added = redis.call('SADD', KEYS[1], ARGV[1])
        redis.call('SET', KEYS[2], 'online')
        return { added, redis.call('SCARD', KEYS[1]) }
      `,
      {
        keys: [key, `user:${userId}:presence`],
        arguments: [socketId]
      }
    );

    return {
      snapshot: await this.snapshot(userId),
      isNewOnlineTransition: Number(added) === 1 && Number(count) === 1,
      alreadyRegistered: Number(added) === 0
    };
  }

  async snapshot(userId) {
    const socketCount = await this.redis.sCard(
      `user:${userId}:sockets`
    );

    const lastSeen = await this.redis.get(
      `user:${userId}:lastSeen`
    );

    return {
      userId,
      isOnline: socketCount > 0,
      activeConnectionsCount :socketCount,
      lastSeen
    };
  }

  async registerHeartbeat(userId, socketId, occurredAt) {
    await this.redis.sAdd(
      `user:${userId}:sockets`,
      socketId
    )
    await this.redis.set(`user:${userId}:presence`, 'online');

    return {
      snapshot: await this.snapshot(userId),
      isNewOnlineTransition: false,
      alreadyRegistered: true
    };
  }

  async unregisterConnection(userId, socketId, occurredAt = new Date()) {
    const key = `user:${userId}:sockets`;
    const [removed, remainingConnections] = await this.redis.eval(
      `
        local removed = redis.call('SREM', KEYS[1], ARGV[1])
        local remaining = redis.call('SCARD', KEYS[1])
        if removed == 1 and remaining == 0 then
          redis.call('SET', KEYS[2], 'offline')
          redis.call('SET', KEYS[3], ARGV[2])
        end
        return { removed, remaining }
      `,
      {
        keys: [key, `user:${userId}:presence`, `user:${userId}:lastSeen`],
        arguments: [socketId, occurredAt.toISOString()]
      }
    );

    if (Number(removed) === 0) {
      return {
        snapshot: await this.snapshot(userId),
        wentOffline: false,
        shouldPersistLastSeen: false
      };
    }

    if (Number(remainingConnections) > 0){
      return {
        snapshot: await this.snapshot(userId),
        wentOffline: false,
        shouldPersistLastSeen: false
      };
    }

    return {
      snapshot: {
        userId,
        isOnline: false,
        activeConnectionsCount: 0,
        lastSeen:
          occurredAt.toISOString()
      },
      wentOffline: true,
      shouldPersistLastSeen: true
    };
  }

  async isOnline(userId) {
    const count = await this.redis.sCard(
      `user:${userId}:sockets`
    );

    return count > 0;
  }
}

const store = new RedisPresenceStore(redisClient);

const normalizeTimestamp = (occurredAt = new Date()) => {
  const timestamp = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);

  if (Number.isNaN(timestamp.getTime())) {
    throw new ApiError(400, 'Invalid presence timestamp', { code: 'INVALID_TIMESTAMP' });
  }

  return timestamp;
};

const getPresence = async (userId) => {
  const user = await userRepository.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found', { code: 'USER_NOT_FOUND' });
  }

  const onlineSnapshot = await store.snapshot(userId);

  return {
    ...onlineSnapshot,
    lastSeen: onlineSnapshot.lastSeen
      || (user.lastSeenAt ? new Date(user.lastSeenAt).toISOString() : null)
  };
};

const registerConnection = async ({ userId, socketId, occurredAt = new Date() }) => {
  const timestamp = normalizeTimestamp(occurredAt);
  return await store.registerConnection(userId, socketId, timestamp);
};

const recordHeartbeat = async ({ userId, socketId, occurredAt = new Date() }) => {
  const timestamp = normalizeTimestamp(occurredAt);
  return await store.registerHeartbeat(userId, socketId, timestamp);
};

const unregisterConnection = async ({ userId, socketId, occurredAt = new Date() }) => {
  const timestamp = normalizeTimestamp(occurredAt);
  const result = await store.unregisterConnection(userId, socketId, timestamp);

  if (result.shouldPersistLastSeen) {
    await userRepository.updateLastSeen(userId, timestamp);
  }

  return result;
};

const recordLogout = async ({ userId, occurredAt = new Date() }) => {
  const timestamp = normalizeTimestamp(occurredAt);
  await userRepository.updateLastSeen(userId, timestamp);

  return {
    userId,
    lastSeen: timestamp.toISOString(),
    isOnline: await store.isOnline(userId)
  };
};
 
module.exports = {
  getPresence,
  registerConnection,
  recordHeartbeat,
  recordLogout,
  unregisterConnection
};

module.exports.RedisPresenceStore = RedisPresenceStore;