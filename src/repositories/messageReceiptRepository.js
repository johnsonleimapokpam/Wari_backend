const { query, withTransaction } = require('../config/db');

const createReceipts = async ({ client = null, messageId, recipientIds, deliveredAt = null, readAt = null }) => {
  if (!recipientIds || recipientIds.length === 0) {
    return [];
  }

  const values = [];
  const placeholders = [];

  recipientIds.forEach((recipientId, index) => {
    const base = index * 4;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    values.push(messageId, recipientId, deliveredAt, readAt);
  });

  const executor = client || { query };
  const result = await executor.query(
    `
      INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (message_id, user_id) DO UPDATE
      SET delivered_at = COALESCE(EXCLUDED.delivered_at, message_receipts.delivered_at),
          read_at = COALESCE(EXCLUDED.read_at, message_receipts.read_at),
          updated_at = NOW()
      RETURNING message_id, user_id, delivered_at, read_at
    `,
    values
  );

  return result.rows;
};

const markReceiptDelivered = async ({ client = null, messageId, userId, deliveredAt = new Date() }) => {
  const executor = client || { query };
  const result = await executor.query(
    `
      UPDATE message_receipts
      SET delivered_at = COALESCE(delivered_at, $3),
          updated_at = NOW()
      WHERE message_id = $1
        AND user_id = $2
      RETURNING message_id, user_id, delivered_at, read_at
    `,
    [messageId, userId, deliveredAt]
  );

  return result.rows[0] || null;
};

const markReceiptRead = async ({ client = null, messageId, userId, readAt = new Date() }) => {
  const executor = client || { query };
  const result = await executor.query(
    `
      UPDATE message_receipts
      SET delivered_at = COALESCE(delivered_at, $3),
          read_at = COALESCE(read_at, $3),
          updated_at = NOW()
      WHERE message_id = $1
        AND user_id = $2
      RETURNING message_id, user_id, delivered_at, read_at
    `,
    [messageId, userId, readAt]
  );

  return result.rows[0] || null;
};

const markConversationRead = async ({ client = null, conversationId, userId, readAt = new Date() }) => {
  const executor = client || { query };
  const result = await executor.query(
    `
      UPDATE message_receipts mr
      SET delivered_at = COALESCE(mr.delivered_at, $3),
          read_at = COALESCE(mr.read_at, $3),
          updated_at = NOW()
      FROM messages m
      WHERE mr.message_id = m.id
        AND m.conversation_id = $1
        AND mr.user_id = $2
        AND m.sender_id <> $2
      RETURNING mr.message_id, mr.user_id, mr.delivered_at, mr.read_at
    `,
    [conversationId, userId, readAt]
  );

  return result.rows;
};

const getMessageReceiptSummary = async (messageId) => {
  const result = await query(
    `
      SELECT
        COUNT(*) AS total_recipients,
        COUNT(delivered_at) AS delivered_count,
        COUNT(read_at) AS read_count,
        ARRAY_REMOVE(ARRAY_AGG(CASE WHEN read_at IS NOT NULL THEN user_id END), NULL) AS read_by_user_ids
      FROM message_receipts
      WHERE message_id = $1
    `,
    [messageId]
  );

  return result.rows[0] || {
    total_recipients: '0',
    delivered_count: '0',
    read_count: '0',
    read_by_user_ids: []
  };
};

module.exports = {
  createReceipts,
  getMessageReceiptSummary,
  markConversationRead,
  markReceiptDelivered,
  markReceiptRead
};