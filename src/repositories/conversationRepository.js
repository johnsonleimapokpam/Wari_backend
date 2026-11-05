const { query, withTransaction, pool } = require('../config/db');

const mapConversation = (row) => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    conversationType: row.conversation_type,
    directKey: row.direct_key,
    title: row.title,
    description: row.description,
    avatarUrl: row.avatar_url,
    ownerUserId: row.owner_user_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
    lastMessage: row.last_message_id
      ? {
          id: row.last_message_id,
          body: row.last_message_body,
          createdAt: row.last_message_created_at,
          senderId: row.last_message_sender_id
        }
      : null,
    otherParticipant: row.other_user_id
      ? {
          id: row.other_user_id,
          email: row.other_user_email,
          firstName: row.other_user_first_name,
          lastName: row.other_user_last_name,
          avatarUrl: row.other_user_avatar_url
        }
      : null
  };
};

const findConversationById = async (conversationId) => {
  const result = await query(
    `
      SELECT id, conversation_type, direct_key, title, description, avatar_url, owner_user_id, created_by_user_id, last_message_id, created_at, updated_at, archived_at, deleted_at
      FROM conversations
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1
    `,
    [conversationId]
  );

  return result.rows[0] || null;
};

const findConversationMember = async (conversationId, userId) => {
  const result = await query(
    `
      SELECT conversation_id, user_id, joined_at, last_read_message_id, last_read_at, is_muted, is_archived, role, left_at, added_by_user_id
      FROM conversation_members
      WHERE conversation_id = $1
        AND user_id = $2
        AND left_at IS NULL
      LIMIT 1
    `,
    [conversationId, userId]
  );

  return result.rows[0] || null;
};

const findOtherConversationMemberUserId = async (conversationId, userId) => {
  const result = await query(
    `
      SELECT user_id
      FROM conversation_members
      WHERE conversation_id = $1
        AND user_id <> $2
        AND left_at IS NULL
      LIMIT 1
    `,
    [conversationId, userId]
  );

  return result.rows[0] || null;
};

const findDirectConversationByKey = async (directKey) => {
  const result = await query(
    `
      SELECT id, conversation_type, direct_key, title, description, avatar_url, owner_user_id, created_by_user_id, last_message_id, created_at, updated_at, archived_at, deleted_at
      FROM conversations
      WHERE direct_key = $1 AND deleted_at IS NULL
      LIMIT 1
    `,
    [directKey]
  );

  return result.rows[0] || null;
};

const createDirectConversation = async ({ createdByUserId, directKey, memberIds }) => {

  try{

  return  await withTransaction(async (client) => {
    const conversationResult = await client.query(
      `
        INSERT INTO conversations (conversation_type, direct_key, created_by_user_id)
        VALUES ('direct', $1, $2)
        RETURNING id, conversation_type, direct_key, created_by_user_id, last_message_id, created_at, updated_at, archived_at
      `,
      [directKey, createdByUserId]
    );

    const conversation = conversationResult.rows[0];

    await client.query(
      `
        INSERT INTO conversation_members (conversation_id, user_id)
        VALUES ($1, $2), ($1, $3)
      `,
      [conversation.id, memberIds[0], memberIds[1]]
    );

    const fullConversationResult =
          await client.query(
            `
            SELECT
              c.id,
              c.conversation_type,
              c.direct_key,
              c.title,
              c.description,
              c.avatar_url,
              c.owner_user_id,
              c.created_by_user_id,
              c.last_message_id,
              c.created_at,
              c.updated_at,
              c.archived_at,
              c.deleted_at,

              u.id AS other_user_id,
              u.email AS other_user_email,
              u.first_name AS other_user_first_name,
              u.last_name AS other_user_last_name,
              u.avatar_url AS other_user_avatar_url

            FROM conversations c

            JOIN conversation_members cm
              ON cm.conversation_id = c.id

            JOIN users u
              ON u.id = cm.user_id

            WHERE c.id = $1
              AND u.id <> $2

            LIMIT 1
            `,
            [
              conversation.id,
              createdByUserId
            ]
          );

        return mapConversation(
          fullConversationResult.rows[0]
        );
      }
    );
} catch (error) {

  console.error(error);

  console.log(
    "Constraint:",
    error.constraint
  );

  console.log(
    "Detail:",
    error.detail
  );

  throw error;
}
};

const listConversationsForUser = async (userId) => {
  const result = await query(
    `
      SELECT
        c.id,
        c.conversation_type,
        c.direct_key,
        c.title,
        c.description,
        c.avatar_url,
        c.owner_user_id,
        c.created_by_user_id,
        c.last_message_id,
        c.created_at,
        c.updated_at,
        c.archived_at,
        c.deleted_at,
        lm.body AS last_message_body,
        lm.created_at AS last_message_created_at,
        lm.sender_id AS last_message_sender_id,
        other_user.id AS other_user_id,
        other_user.email AS other_user_email,
        other_user.first_name AS other_user_first_name,
        other_user.last_name AS other_user_last_name,
        other_user.avatar_url AS other_user_avatar_url
      FROM conversations c
      INNER JOIN conversation_members me
        ON me.conversation_id = c.id
       AND me.user_id = $1
       AND me.is_archived = false
       AND me.left_at IS NULL
      INNER JOIN conversation_members other_member
        ON other_member.conversation_id = c.id
       AND other_member.user_id <> $1
      INNER JOIN users other_user
        ON other_user.id = other_member.user_id
      LEFT JOIN messages lm
        ON lm.id = c.last_message_id
      WHERE c.archived_at IS NULL
        AND c.deleted_at IS NULL
      ORDER BY COALESCE(lm.created_at, c.updated_at) DESC
    `,
    [userId]
  );

  return result.rows.map(mapConversation);
};

const findDirectConversation =
  async (
    userId1,
    userId2
  ) => {

    const result =
      await pool.query(
        `
        SELECT c.*
        FROM conversations c
        JOIN conversation_members cm1
          ON cm1.conversation_id = c.id
        JOIN conversation_members cm2
          ON cm2.conversation_id = c.id
        WHERE
          c.conversation_type = 'direct'
          AND cm1.user_id = $1
          AND cm2.user_id = $2
        LIMIT 1
        `,
        [userId1, userId2]
      );

    return result.rows[0];
};

module.exports = {
  createDirectConversation,
  findConversationById,
  findConversationMember,
  findDirectConversationByKey,
  findOtherConversationMemberUserId,
  listConversationsForUser,
  mapConversation,
  findDirectConversation
};
