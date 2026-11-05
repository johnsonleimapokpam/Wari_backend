const ApiError = require('../utils/ApiError');
const groupRepository = require('../repositories/groupRepository');
const messageRepository = require('../repositories/messageRepository');
const receiptRepository = require('../repositories/messageReceiptRepository');
const presenceService = require('./presenceService');
const { MESSAGE_STATUSES } = require('../utils/messageStatus');

const roomName = (groupId) => `group:${groupId}`;

const ensureGroupMember = async (groupId, userId) => {
  const member = await groupRepository.getMemberRow(groupId, userId);

  if (!member || member.left_at) {
    throw new ApiError(403, 'You are not a member of this group', { code: 'NOT_A_GROUP_MEMBER' });
  }

  return member;
};

const createMessage = async ({ groupId, senderId, body, clientMessageId = null }) => {
  await ensureGroupMember(groupId, senderId);

  const group = await groupRepository.findGroupById(groupId);

  if (!group) {
    throw new ApiError(404, 'Group not found', { code: 'GROUP_NOT_FOUND' });
  }

  const members = await groupRepository.listGroupMembers(groupId);
  const recipientIds = members.filter((member) => member.user_id !== senderId && !member.left_at).map((member) => member.user_id);
  const onlineStatuses = await Promise.all(recipientIds.map(id => presenceService.isOnline(id)));
  const onlineRecipientIds = recipientIds.filter((_,i) => onlineStatuses[i]);

  const result = await messageRepository.createMessage({
    conversationId: groupId,
    senderId,
    body,
    clientMessageId,
    afterPersist: async ({ client, message, isDuplicate }) => {
      if (isDuplicate) {
        return { message };
      }

      await receiptRepository.createReceipts({
        client,
        messageId: message.id,
        recipientIds,
        deliveredAt: null,
        readAt: null
      });

      if (onlineRecipientIds.length === 0) {
        return {
          message,
          delivery: {
            recipientCount: recipientIds.length,
            deliveredCount: 0
          }
        };
      }

      const deliveredAt = new Date();

      for (const recipientId of onlineRecipientIds) {
        await receiptRepository.markReceiptDelivered({
          client,
          messageId: message.id,
          userId: recipientId,
          deliveredAt
        });
      }

      const updatedMessage = await messageRepository.updateMessageStatus({
        client,
        messageId: message.id,
        status: MESSAGE_STATUSES.DELIVERED,
        deliveredAt,
        readAt: null
      });

      return {
        message: updatedMessage || message,
        delivery: {
          recipientCount: recipientIds.length,
          deliveredCount: onlineRecipientIds.length
        }
      };
    }
  });

  if (result.isDuplicate) {
    return {
      group,
      message: result.message,
      isDuplicate: true,
      deliveredCount: 0,
      recipientCount: recipientIds.length
    };
  }

  return {
    group,
    message: result.message,
    isDuplicate: result.isDuplicate,
    deliveredCount: result.delivery.deliveredCount,
    recipientCount: result.delivery.recipientCount
  };
};

const markMessageDelivered = async ({ groupId, messageId, userId, deliveredAt = new Date() }) => {
  await ensureGroupMember(groupId, userId);

  const message = await messageRepository.findMessageById(messageId);

  if (!message || message.conversationId !== groupId) {
    throw new ApiError(404, 'Group message not found', { code: 'MESSAGE_NOT_FOUND' });
  }

  if (message.senderId === userId) {
    return null;
  }

  return receiptRepository.markReceiptDelivered({ messageId, userId, deliveredAt });
};

const markMessageRead = async ({ groupId, messageId, userId, readAt = new Date() }) => {
  await ensureGroupMember(groupId, userId);

  const message = await messageRepository.findMessageById(messageId);

  if (!message || message.conversationId !== groupId) {
    throw new ApiError(404, 'Group message not found', { code: 'MESSAGE_NOT_FOUND' });
  }

  if (message.senderId === userId) {
    return null;
  }

  return receiptRepository.markReceiptRead({ messageId, userId, readAt });
};

const markConversationRead = async ({ groupId, readerUserId, readAt = new Date() }) => {
  await ensureGroupMember(groupId, readerUserId);

  const receipts = await receiptRepository.markConversationRead({
    conversationId: groupId,
    userId: readerUserId,
    readAt
  });

  return receipts;
};

const getMessages = async ({ groupId, viewerUserId, limit = 50, before = null }) => {
  await ensureGroupMember(groupId, viewerUserId);

  const messages = await messageRepository.listMessagesByConversation({
    conversationId: groupId,
    limit,
    before
  });

  const enriched = await Promise.all(messages.map(async (message) => {
    const summary = await receiptRepository.getMessageReceiptSummary(message.id);
    const totalRecipients = Number(summary.total_recipients || 0);
    const deliveredCount = Number(summary.delivered_count || 0);
    const readCount = Number(summary.read_count || 0);

    let aggregateStatus = MESSAGE_STATUSES.SENT;
    if (readCount > 0 && readCount === totalRecipients) {
      aggregateStatus = MESSAGE_STATUSES.READ;
    } else if (deliveredCount > 0) {
      aggregateStatus = MESSAGE_STATUSES.DELIVERED;
    }

    return {
      ...message,
      status: aggregateStatus,
      deliveredCount,
      readCount,
      readByUserIds: summary.read_by_user_ids || []
    };
  }));

  return enriched;
};

module.exports = {
  createMessage,
  getMessages,
  markConversationRead,
  markMessageDelivered,
  markMessageRead,
  roomName
};