const ApiError = require('../utils/ApiError');
const deliveryService = require('../services/deliveryService');
const messageRepository = require('../repositories/messageRepository');
const conversationRepository = require('../repositories/conversationRepository');
const { deliveryEventSchema } = require('./socketSchemas');
const { resolveConversationRoomName } = require('./roomHandlers');

const validatePayload = (payload) => {
  const result = deliveryEventSchema.safeParse(payload);

  if (!result.success) {
    throw new ApiError(400, 'Invalid socket payload', {
      code: 'SOCKET_VALIDATION_ERROR',
      details: result.error.errors
    });
  }

  return result.data;
};

const emitDeliveryStatus = (io, recipientUserId, senderUserId, message) => {
  const payload = {
    conversationId: message.conversationId,
    messageId: message.id,
    status: message.status,
    deliveredAt: message.deliveredAt,
    readAt: message.readAt,
    senderId: senderUserId,
    recipientId: recipientUserId
  };

  io.to(`user:${senderUserId}`).emit('message_status_updated', payload);
};

const registerDeliveryHandlers = (socket, io) => {
  socket.on('message_delivered', async (payload, ack) => {
    try {
      const data = validatePayload(payload);

      const roomName = await resolveConversationRoomName(data.conversationId);

      if (!socket.data.joinedConversationIds.has(roomName)) {
        throw new ApiError(403, 'You must join the conversation before sending delivery acknowledgements', {
          code: 'NOT_JOINED_CONVERSATION_ROOM'
        });
      }

      const message = await messageRepository.findMessageById(data.messageId);

      if (!message) {
        throw new ApiError(404, 'Message not found', { code: 'MESSAGE_NOT_FOUND' });
      }

      const otherMember = await conversationRepository.findOtherConversationMemberUserId(data.conversationId, socket.data.user.id);

      if (!otherMember) {
        throw new ApiError(403, 'Conversation recipient not found', { code: 'RECIPIENT_NOT_FOUND' });
      }

      const result = await deliveryService.markMessageDelivered({
        messageId: data.messageId,
        recipientUserId: socket.data.user.id
      });

      if (result.isUpdated) {
        emitDeliveryStatus(io, socket.data.user.id, message.senderId, result.message);
      }

      if (typeof ack === 'function') {
        ack({
          success: true,
          data: result.message,
          meta: {
            updated: result.isUpdated
          }
        });
      }
    } catch (error) {
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
    }
  });
};

module.exports = {
  registerDeliveryHandlers
};