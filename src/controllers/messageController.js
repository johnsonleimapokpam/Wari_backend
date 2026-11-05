const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const messageService = require('../services/messageService');

const sendMessage = asyncHandler(async (req, res) => {
  const result = await messageService.sendMessage({
    conversationId: req.body.conversationId,
    senderId: req.user.id,
    body: req.body.body,
    clientMessageId: req.body.clientMessageId
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: result.isDuplicate ? 'Message already processed' : 'Message sent successfully',
    data: result.message,
    meta: {
      duplicate: result.isDuplicate
    }
  });
});

const getMessageHistory = asyncHandler(async (req, res) => {
  const messages = await messageService.getMessageHistory({
    conversationId: req.params.conversationId,
    userId: req.user.id,
    limit: req.query.limit,
    before: req.query.before
  });

  return sendSuccess(res, {
    statusCode: 200,
    message: 'Messages retrieved successfully',
    data: messages,
    meta: {
      count: messages.length
    }
  });
});

module.exports = {
  sendMessage,
  getMessageHistory
};
