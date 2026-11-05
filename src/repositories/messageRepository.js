const { query, withTransaction } = require('../config/db');
const { MESSAGE_STATUSES } = require('../utils/messageStatus');
const ApiError = require('../utils/ApiError');

const mapMessage = (row) => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    messageType: row.message_type,
    body: row.body,
    clientMessageId: row.client_message_id,
    status: row.status,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    metadata: row.metadata,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

const selectMessageColumns = `
  id, conversation_id, sender_id, message_type, body, client_message_id,
  status, delivered_at, read_at, metadata, edited_at, deleted_at,
  created_at, updated_at
`;

const assertIdempotencyMatch = ({ existing, conversationId, senderId, body, clientMessageId }) => {
  if (
    existing.sender_id !== senderId ||
    existing.body !== body ||
    existing.conversation_id !== conversationId
  ) {
    throw new ApiError(409, 'Idempotency key was already used with a different request', {
      code: 'IDEMPOTENCY_KEY_REUSED'
    });
  }

  return clientMessageId;
};

const createMessage = async ({ conversationId, senderId, body, clientMessageId, afterPersist = null }) => {
  return withTransaction(async (client) => {
    let insertResult;

    if (clientMessageId) {
      insertResult = await client.query(
        `
          INSERT INTO messages (conversation_id, sender_id, body, client_message_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
          RETURNING ${selectMessageColumns}
        `,
        [conversationId, senderId, body, clientMessageId]
      );
    } else {
      insertResult = await client.query(
        `
          INSERT INTO messages (conversation_id, sender_id, body)
          VALUES ($1, $2, $3)
            RETURNING ${selectMessageColumns}
        `,
        [conversationId, senderId, body]
      );
    }

    let row = insertResult.rows[0] || null;
    let isDuplicate = false;

    if (!row && clientMessageId) {
      const existingResult = await client.query(
        `
          SELECT ${selectMessageColumns}
          FROM messages
          WHERE conversation_id = $1
            AND client_message_id = $2
          LIMIT 1
        `,
        [conversationId, clientMessageId]
      );

      row = existingResult.rows[0] || null;
      isDuplicate = Boolean(row);
    }

    if (!row) {
      throw new Error('Failed to persist message');
    }

    if (isDuplicate) {
      assertIdempotencyMatch({ existing: row, conversationId, senderId, body, clientMessageId });
    }

    await client.query(
      `
        UPDATE conversations
        SET last_message_id = $1
        WHERE id = $2
      `,
      [row.id, conversationId]
    );

    const result = {
      message: mapMessage(row),
      isDuplicate
    };

    if (afterPersist) {
      const afterPersistResult = await afterPersist({ client, ...result });
      if (afterPersistResult?.message) {
        result.message = mapMessage(afterPersistResult.message);
      }
      if (afterPersistResult?.delivery) {
        result.delivery = afterPersistResult.delivery;
      }
    }

    return result;
  });
};

const findMessageById = async (messageId) => {
  const result = await query(
    `
      SELECT ${selectMessageColumns}
      FROM messages
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1
    `,
    [messageId]
  );

  return mapMessage(result.rows[0]) || null;
};

const updateMessageStatus = async ({ client = null, messageId, status, deliveredAt, readAt }) => {
  const executor = client || { query };
  const result = await executor.query(
    `
      UPDATE messages
        SET status = CASE
              WHEN status = $2 THEN status
              WHEN status = 'READ' THEN status
              WHEN status = 'DELIVERED' AND $2 = 'SENT' THEN status
              ELSE $2
            END,
            delivered_at = COALESCE($3, delivered_at),
            read_at = COALESCE($4, read_at)
      WHERE id = $1
        AND deleted_at IS NULL
      RETURNING ${selectMessageColumns}
    `,
    [messageId, status, deliveredAt || null, readAt || null]
  );

  return mapMessage(result.rows[0]) || null;
};

const markConversationMessagesDelivered = async ({ conversationId, recipientUserId, deliveredAt = new Date() }) => {
  const result = await query(
    `
      UPDATE messages
      SET status = $3,
          delivered_at = COALESCE(delivered_at, $4)
      WHERE conversation_id = $1
        AND sender_id <> $2
        AND status = $5
        AND deleted_at IS NULL
      RETURNING ${selectMessageColumns}
    `,
    [conversationId, recipientUserId, MESSAGE_STATUSES.DELIVERED, deliveredAt, MESSAGE_STATUSES.SENT]
  );

  return result.rows.map(mapMessage);
};

const markConversationMessagesRead = async ({ conversationId, readerUserId, readAt = new Date() }) => {
  const result = await query(
    `
      UPDATE messages
      SET status = $3,
          delivered_at = COALESCE(delivered_at, $4),
          read_at = COALESCE(read_at, $4)
      WHERE conversation_id = $1
        AND sender_id <> $2
        AND status IN ($5, $6)
        AND deleted_at IS NULL
      RETURNING ${selectMessageColumns}
    `,
    [conversationId, readerUserId, MESSAGE_STATUSES.READ, readAt, MESSAGE_STATUSES.SENT, MESSAGE_STATUSES.DELIVERED]
  );

  return result.rows.map(mapMessage);
};

const listMessagesByConversation = async ({ conversationId, limit = 50, before = null }) => {
  const result = await query(
    `
      SELECT ${selectMessageColumns}
      FROM messages
      WHERE conversation_id = $1
        AND deleted_at IS NULL
        AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [conversationId, before, limit]
  );

  return result.rows.map(mapMessage).reverse();
};

module.exports = {
  assertIdempotencyMatch,
  createMessage,
  findMessageById,
  listMessagesByConversation,
  markConversationMessagesDelivered,
  markConversationMessagesRead,
  updateMessageStatus,
  mapMessage
};