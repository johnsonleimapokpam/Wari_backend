const { query } = require('../config/db');

const mapUser = (row) => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    isActive: row.is_active,
    lastSeenAt: row.last_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

const findAuthRecordByEmail = async (email) => {
  const result = await query(
    `
      SELECT id, email, password_hash, first_name, last_name, avatar_url, bio, is_active, last_seen, created_at, updated_at
      FROM users
      WHERE email = $1 AND deleted_at IS NULL
      LIMIT 1
    `,
    [email]
  );

  return result.rows[0] || null;
};

const findById = async (id) => {
  const result = await query(
    `
      SELECT id, email, first_name, last_name, avatar_url, bio, is_active, last_seen, created_at, updated_at
      FROM users
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1
    `,
    [id]
  );

  return mapUser(result.rows[0]);
};

const createUser = async ({ email, passwordHash, firstName, lastName }) => {
  const result = await query(
    `
      INSERT INTO users (email, password_hash, first_name, last_name)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, first_name, last_name, avatar_url, bio, is_active, last_seen, created_at, updated_at
    `,
    [email, passwordHash, firstName, lastName]
  );

  return mapUser(result.rows[0]);
};

const updateProfile = async (userId, updates) => {
  const fields = [];
  const values = [];
  let index = 1;

  if (updates.firstName !== undefined) {
    fields.push(`first_name = $${index++}`);
    values.push(updates.firstName);
  }

  if (updates.lastName !== undefined) {
    fields.push(`last_name = $${index++}`);
    values.push(updates.lastName);
  }

  if (updates.avatarUrl !== undefined) {
    fields.push(`avatar_url = $${index++}`);
    values.push(updates.avatarUrl);
  }

  if (updates.bio !== undefined) {
    fields.push(`bio = $${index++}`);
    values.push(updates.bio);
  }

  if (fields.length === 0) {
    return findById(userId);
  }

  values.push(userId);

  const result = await query(
    `
      UPDATE users
      SET ${fields.join(', ')}
      WHERE id = $${index} AND deleted_at IS NULL
      RETURNING id, email, first_name, last_name, avatar_url, bio, is_active, last_seen, created_at, updated_at
    `,
    values
  );

  return mapUser(result.rows[0]);
};

const updateLastSeen = async (userId, lastSeenAt = new Date()) => {
  const result = await query(
    `
      UPDATE users
      SET last_seen = $1
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING id, email, first_name, last_name, avatar_url, bio, is_active, last_seen, created_at, updated_at
    `,
    [lastSeenAt, userId]
  );

  return mapUser(result.rows[0]);
};

const searchUsers = async (searchTerm, currentUserId) => {
  const result = await query(
    `
    SELECT
      id,
      first_name,
      last_name,
      email
    FROM users
    WHERE (
      first_name ILIKE $1
      OR last_name ILIKE $1
      OR email ILIKE $1
    )
    AND id <> $2
    AND deleted_at IS NULL
    AND is_active = true
    LIMIT 20
    `,
    [`%${searchTerm}%`, currentUserId]
  );

  return result.rows;
};

module.exports = {
  createUser,
  findAuthRecordByEmail,
  findById,
  updateLastSeen,
  updateProfile,
  mapUser,
  searchUsers
};