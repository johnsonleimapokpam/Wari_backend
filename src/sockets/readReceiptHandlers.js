const ApiError = require('../utils/ApiError');
const messageRepository = require('../repositories/messageRepository');
const readReceiptService = require('../services/readReceiptService');
const { readReceiptEventSchema, conversationOpenedSchema } = require('./socketSchemas');
const conversationRepository = require('../repositories/conversationRepository');
const groupMessageService = require('../services/groupMessageService');
const { resolveConversationRoomName } = require('./roomHandlers');

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

const emitReadReceipt = (io, senderUserId, conversationId, readMessages) => {
  if (readMessages.length === 0) {
    return;
  }

  io.to(`user:${senderUserId}`).emit('message_read_receipt', {
    conversationId,
    messageIds: readMessages.map((message) => message.id),
    readAt: readMessages[0].readAt,
    status: 'READ'
  });

  io.to(`user:${senderUserId}`).emit('message_status_updated', {
    conversationId,
    messageIds: readMessages.map((message) => message.id),
    status: 'READ',
    messages: readMessages
  });
};

const registerReadReceiptHandlers = (socket, io) => {
  socket.on('message_read', async (payload, ack) => {
    try {
      const data = validatePayload(readReceiptEventSchema, payload);

      const roomName = await resolveConversationRoomName(data.conversationId);

      if (!socket.data.joinedConversationIds.has(roomName)) {
        throw new ApiError(403, 'You must join the conversation before sending read receipts', {
          code: 'NOT_JOINED_CONVERSATION_ROOM'
        });
      }

      const conversation = await conversationRepository.findConversationById(data.conversationId);

      if (!conversation) {
        throw new ApiError(404, 'Conversation not found', { code: 'CONVERSATION_NOT_FOUND' });
      }

      if (conversation.conversation_type === 'group') {
        if (!data.messageId) {
          throw new ApiError(400, 'messageId is required for group message receipts', {
            code: 'MESSAGE_ID_REQUIRED'
          });
        }

        const receipt = await groupMessageService.markMessageRead({
          groupId: data.conversationId,
          messageId: data.messageId,
          userId: socket.data.user.id
        });

        if (typeof ack === 'function') {
          ack({
            success: true,
            data: receipt,
            meta: {
              updated: Boolean(receipt)
            }
          });
        }

        return;
      }

      if (!data.messageId) {
        throw new ApiError(400, 'messageId is required for message_read', {
          code: 'MESSAGE_ID_REQUIRED'
        });
      }

      const result = await readReceiptService.markMessageRead({
        messageId: data.messageId,
        readerUserId: socket.data.user.id
      });

      if (result.isUpdated) {
        const senderUserId = result.message.senderId;
        io.to(`user:${senderUserId}`).emit('message_status_updated', {
          conversationId: data.conversationId,
          messageId: result.message.id,
          status: result.message.status,
          deliveredAt: result.message.deliveredAt,
          readAt: result.message.readAt,
          senderId: result.message.senderId,
          recipientId: socket.data.user.id
        });

        io.to(`user:${senderUserId}`).emit('message_read_receipt', {
          conversationId: data.conversationId,
          messageIds: [result.message.id],
          readAt: result.message.readAt,
          status: 'READ'
        });
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

  socket.on('conversation_opened', async (payload, ack) => {
    try {
      const data = validatePayload(conversationOpenedSchema, payload);

      const roomName = await resolveConversationRoomName(data.conversationId);

      if (!socket.data.joinedConversationIds.has(roomName)) {
        throw new ApiError(403, 'You must join the conversation before opening it', {
          code: 'NOT_JOINED_CONVERSATION_ROOM'
        });
      }

      const conversation = await conversationRepository.findConversationById(data.conversationId);

      if (!conversation) {
        throw new ApiError(404, 'Conversation not found', { code: 'CONVERSATION_NOT_FOUND' });
      }

      if (conversation.conversation_type === 'group') {
        const receipts = await groupMessageService.markConversationRead({
          groupId: data.conversationId,
          readerUserId: socket.data.user.id
        });

        const receiptBySender = new Map();

        for (const receipt of receipts) {
          const message = await messageRepository.findMessageById(receipt.message_id);

          if (!message) {
            continue;
          }

          if (!receiptBySender.has(message.senderId)) {
            receiptBySender.set(message.senderId, []);
          }

          receiptBySender.get(message.senderId).push({
            messageId: receipt.message_id,
            readAt: receipt.read_at,
            status: 'READ'
          });
        }

        for (const [senderUserId, senderReceipts] of receiptBySender.entries()) {
          io.to(`user:${senderUserId}`).emit('message_read_receipt', {
            conversationId: data.conversationId,
            receipts: senderReceipts
          });

          io.to(`user:${senderUserId}`).emit('message_status_updated', {
            conversationId: data.conversationId,
            status: 'READ',
            receipts: senderReceipts
          });
        }

        if (typeof ack === 'function') {
          ack({
            success: true,
            data: {
              readCount: receipts.length
            }
          });
        }

        return;
      }

      const result = await readReceiptService.markConversationRead({
        conversationId: data.conversationId,
        readerUserId: socket.data.user.id
      });

      const senderIds = new Set(result.readMessages.map((message) => message.senderId));

      for (const senderUserId of senderIds) {
        const senderMessages = result.readMessages.filter((message) => message.senderId === senderUserId);
        emitReadReceipt(io, senderUserId, data.conversationId, senderMessages);
      }

      if (typeof ack === 'function') {
        ack({
          success: true,
          data: {
            deliveredCount: result.deliveredMessages.length,
            readCount: result.readMessages.length
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
  registerReadReceiptHandlers
};