const test = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../src/config/db');

const rows = new Map();
let transactionTail = Promise.resolve();

const makeRow = ({ conversationId, senderId, body, clientMessageId }) => ({
  id: `${conversationId}-${clientMessageId}`,
  conversation_id: conversationId,
  sender_id: senderId,
  message_type: 'text',
  body,
  client_message_id: clientMessageId,
  status: 'SENT',
  delivered_at: null,
  read_at: null,
  metadata: {},
  edited_at: null,
  deleted_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
});

const createClient = () => ({
  async query(sql, params) {
    if (sql.includes('INSERT INTO messages')) {
      const [conversationId, senderId, body, clientMessageId] = params;
      const key = `${conversationId}:${clientMessageId}`;
      if (rows.has(key)) {
        return { rows: [] };
      }

      const row = makeRow({ conversationId, senderId, body, clientMessageId });
      rows.set(key, row);
      return { rows: [row] };
    }

    if (sql.includes('FROM messages') && sql.includes('client_message_id')) {
      const [conversationId, clientMessageId] = params;
      return { rows: [rows.get(`${conversationId}:${clientMessageId}`)].filter(Boolean) };
    }

    if (sql.includes('UPDATE conversations')) {
      return { rows: [] };
    }

    throw new Error(`Unexpected SQL in test client: ${sql}`);
  }
});

const withTransaction = async (work) => {
  const previous = transactionTail;
  let release;
  transactionTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;

  const snapshot = new Map(rows);
  try {
    const result = await work(createClient());
    release();
    return result;
  } catch (error) {
    rows.clear();
    for (const [key, row] of snapshot) rows.set(key, row);
    release();
    throw error;
  }
};

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { query: async () => ({ rows: [] }), withTransaction }
};

const { createMessage } = require('../src/repositories/messageRepository');

const request = (overrides = {}) => ({
  conversationId: 'conversation-1',
  senderId: 'sender-1',
  body: 'hello',
  clientMessageId: 'client-key-1',
  ...overrides
});

test.beforeEach(() => {
  rows.clear();
  transactionTail = Promise.resolve();
});

test('replaying the same request returns the original message', async () => {
  const first = await createMessage(request());
  const second = await createMessage(request());

  assert.equal(first.isDuplicate, false);
  assert.equal(second.isDuplicate, true);
  assert.equal(second.message.id, first.message.id);
  assert.equal(rows.size, 1);
});

test('concurrent requests with the same key create one message', async () => {
  const results = await Promise.all([
    createMessage(request()),
    createMessage(request())
  ]);

  assert.equal(rows.size, 1);
  assert.equal(results.filter((result) => !result.isDuplicate).length, 1);
  assert.equal(results.filter((result) => result.isDuplicate).length, 1);
});

test('reusing a key with a different payload is rejected', async () => {
  await createMessage(request());

  await assert.rejects(
    createMessage(request({ body: 'changed' })),
    (error) => error.code === 'IDEMPOTENCY_KEY_REUSED' && error.statusCode === 409
  );
  assert.equal(rows.size, 1);
});

test('a different sender cannot reuse an existing key', async () => {
  await createMessage(request());

  await assert.rejects(
    createMessage(request({ senderId: 'sender-2' })),
    (error) => error.code === 'IDEMPOTENCY_KEY_REUSED'
  );
  assert.equal(rows.size, 1);
});

test('a timed-out client retry receives the already committed result', async () => {
  const firstAttempt = createMessage({
    ...request({ clientMessageId: 'client-key-timeout' }),
    afterPersist: async () => new Promise((resolve) => setTimeout(resolve, 10))
  });
  await assert.rejects(
    Promise.race([
      firstAttempt,
      new Promise((_, reject) => setTimeout(() => reject(new Error('client timeout')), 0))
    ]),
    /client timeout/
  );

  await firstAttempt;
  const retry = await createMessage(request({ clientMessageId: 'client-key-timeout' }));
  assert.equal(retry.isDuplicate, true);
  assert.equal(rows.size, 1);
});

test('a failure in post-persistence work rolls the message back', async () => {
  await assert.rejects(
    createMessage({
      ...request(),
      afterPersist: async () => {
        throw new Error('simulated crash');
      }
    }),
    /simulated crash/
  );

  assert.equal(rows.size, 0);
});

test('separate application instances share the database uniqueness boundary', async () => {
  const instanceResults = await Promise.all([
    createMessage(request({ senderId: 'sender-1' })),
    createMessage(request({ senderId: 'sender-1' }))
  ]);

  assert.equal(rows.size, 1);
  assert.equal(new Set(instanceResults.map((result) => result.message.id)).size, 1);
});
