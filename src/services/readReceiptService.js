const ApiError = require('../utils/ApiError');
const conversationRepository = require('../repositories/conversationRepository');
const messageRepository = require('../repositories/messageRepository');
const deliveryService = require('./deliveryService');
const { MESSAGE_STATUSES, assertValidTransition } = require('../utils/messageStatus');

const ensureReaderConversationAccess = async (conversationId, readerUserId) => {
  const membership = await conversationRepository.findConversationMember(conversationId, readerUserId);

  if (!membership) {
    throw new ApiError(403, 'You are not a member of this conversation', {
      code: 'NOT_A_CONVERSATION_MEMBER'
    });
  }
};

const markMessageRead = async ({ messageId, readerUserId, readAt = new Date() }) => {
  const message = await messageRepository.findMessageById(messageId);

  if (!message) {
    throw new ApiError(404, 'Message not found', { code: 'MESSAGE_NOT_FOUND' });
  }

  await ensureReaderConversationAccess(message.conversationId, readerUserId);

  if (message.senderId === readerUserId) {
    return { message, isUpdated: false };
  }

  if (message.status === MESSAGE_STATUSES.SENT) {
    await deliveryService.markMessageDelivered({
      messageId,
      recipientUserId: readerUserId,
      deliveredAt: readAt
    });
    message.status = MESSAGE_STATUSES.DELIVERED;
    message.deliveredAt = readAt;
  }

  assertValidTransition(message.status, MESSAGE_STATUSES.READ);

  if (message.status === MESSAGE_STATUSES.READ) {
    return { message, isUpdated: false };
  }

  const updatedMessage = await messageRepository.updateMessageStatus({
    messageId,
    status: MESSAGE_STATUSES.READ,
    deliveredAt: message.deliveredAt || readAt,
    readAt
  });

  return {
    message: updatedMessage,
    isUpdated: Boolean(updatedMessage)
  };
};

const markConversationRead = async ({ conversationId, readerUserId, readAt = new Date() }) => {
  await ensureReaderConversationAccess(conversationId, readerUserId);

  const deliveredMessages = await deliveryService.markConversationDelivered({
    conversationId,
    recipientUserId: readerUserId,
    deliveredAt: readAt
  });

  const readMessages = await messageRepository.markConversationMessagesRead({
    conversationId,
    readerUserId,
    readAt
  });

  return {
    deliveredMessages,
    readMessages
  };
};

module.exports = {
  markConversationRead,
  markMessageRead
};