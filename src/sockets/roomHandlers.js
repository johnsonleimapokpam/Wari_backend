const ApiError = require('../utils/ApiError');
const conversationRepository = require('../repositories/conversationRepository');
const { joinConversationSchema, leaveConversationSchema } = require('./socketSchemas');

const roomNameForConversation = (conversationId) => `conversation:${conversationId}`;
const groupRoomNameForConversation = (conversationId) => `group:${conversationId}`;

const resolveConversationRoomName = async (conversationId) => {
  const conversation = await conversationRepository.findConversationById(conversationId);

  if (!conversation) {
    throw new ApiError(404, 'Conversation not found', { code: 'CONVERSATION_NOT_FOUND' });
  }

  return conversation.conversation_type === 'group'
    ? groupRoomNameForConversation(conversationId)
    : roomNameForConversation(conversationId);
};

const getRoomPresenceMap = (state, roomName) => {
  if (!state.roomPresence.has(roomName)) {
    state.roomPresence.set(roomName, new Map());
  }

  return state.roomPresence.get(roomName);
};

const serializeSocketUser = (socket) => ({
  id: socket.data.user.id,
  email: socket.data.user.email
});

const validatePayload = (schema, payload) => {
  const result = schema.safeParse(payload);

  if (!result.success) {
    throw new ApiError(400, 'Invalid socket payload', {
      code: 'SOCKET_VALIDATION_ERROR',
      details: result.error.errors
    });
  }

  return result.data;
};

const incrementRoomPresence = (state, roomName, userId) => {
  const roomPresence = getRoomPresenceMap(state, roomName);
  const nextCount = (roomPresence.get(userId) || 0) + 1;
  roomPresence.set(userId, nextCount);
  return nextCount;
};

const decrementRoomPresence = (state, roomName, userId) => {
  const roomPresence = getRoomPresenceMap(state, roomName);
  const currentCount = roomPresence.get(userId) || 0;

  if (currentCount <= 1) {
    roomPresence.delete(userId);
    return 0;
  }

  roomPresence.set(userId, currentCount - 1);
  return currentCount - 1;
};

const joinConversationRoom = async (socket, io, state, payload, ack) => {
  const { conversationId } = validatePayload(joinConversationSchema, payload);
  const membership = await conversationRepository.findConversationMember(conversationId, socket.data.user.id);

  if (!membership) {
    throw new ApiError(403, 'You are not a member of this conversation', {
      code: 'NOT_A_CONVERSATION_MEMBER'
    });
  }

  const roomName = await resolveConversationRoomName(conversationId);
  const isAlreadyJoined = socket.data.joinedConversationIds.has(roomName);

  if (!isAlreadyJoined) {
    socket.join(roomName);
    socket.data.joinedConversationIds.add(roomName);

    const nextPresenceCount = incrementRoomPresence(state, roomName, socket.data.user.id);

    if (nextPresenceCount === 1) {
      io.to(roomName).emit('user_connected', {
        conversationId,
        user: serializeSocketUser(socket)
      });
    }
  }

  if (typeof ack === 'function') {
    ack({
      success: true,
      conversationId,
      joined: true
    });
  }
};

const leaveConversationRoom = async (socket, io, state, payload, ack) => {
  const { conversationId } = validatePayload(leaveConversationSchema, payload);
  const roomName = await resolveConversationRoomName(conversationId);
  const isJoined = socket.data.joinedConversationIds.has(roomName);

  if (isJoined) {
    socket.leave(roomName);
    socket.data.joinedConversationIds.delete(roomName);

    const nextPresenceCount = decrementRoomPresence(state, roomName, socket.data.user.id);

    if (nextPresenceCount === 0) {
      io.to(roomName).emit('user_disconnected', {
        conversationId,
        user: serializeSocketUser(socket)
      });
    }
  }

  if (typeof ack === 'function') {
    ack({
      success: true,
      conversationId,
      left: true
    });
  }
};

const registerRoomHandlers = (socket, io, state) => {
  socket.on('join_conversation', (payload, ack) => {
    joinConversationRoom(socket, io, state, payload, ack).catch((error) => {
      socket.emit('error', {
        success: false,
        message: error.message,
        error: {
          code: error.code,
          details: error.details
        }
      });

      if (typeof ack === 'function') {
        ack({
          success: false,
          message: error.message,
          error: {
            code: error.code,
            details: error.details
          }
        });
      }
    });
  });

  socket.on('leave_conversation', (payload, ack) => {
    leaveConversationRoom(socket, io, state, payload, ack).catch((error) => {
      socket.emit('error', {
        success: false,
        message: error.message,
        error: {
          code: error.code,
          details: error.details
        }
      });

      if (typeof ack === 'function') {
        ack({
          success: false,
          message: error.message,
          error: {
            code: error.code,
            details: error.details
          }
        });
      }
    });
  });

  socket.on('disconnect', () => {
    for (const roomName of socket.data.joinedConversationIds) {
      const nextPresenceCount = decrementRoomPresence(state, roomName, socket.data.user.id);

      if (nextPresenceCount === 0) {
        const conversationId = roomName.replace(/^(conversation|group):/, '');
        io.to(roomName).emit('user_disconnected', {
          conversationId,
          user: serializeSocketUser(socket)
        });
      }
    }

    socket.data.joinedConversationIds.clear();
  });
};

module.exports = {
  registerRoomHandlers,
  groupRoomNameForConversation,
  resolveConversationRoomName,
  roomNameForConversation,
  serializeSocketUser
};