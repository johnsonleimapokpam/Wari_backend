const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const groupMessageService = require('../services/groupMessageService');

const sendGroupMessage = asyncHandler(async (req, res) => {
  const result = await groupMessageService.createMessage({
    groupId: req.params.id,
    senderId: req.user.id,
    body: req.body.body,
    clientMessageId: req.body.clientMessageId
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Group message sent successfully',
    data: result.message,
    meta: {
      deliveredCount: result.deliveredCount,
      recipientCount: result.recipientCount
    }
  });
});

const getGroupMessages = asyncHandler(async (req, res) => {
  const messages = await groupMessageService.getMessages({
    groupId: req.params.id,
    viewerUserId: req.user.id,
    limit: req.query.limit,
    before: req.query.before
  });

  return sendSuccess(res, {
    statusCode: 200,
    message: 'Group messages retrieved successfully',
    data: messages,
    meta: {
      count: messages.length
    }
  });
});

module.exports = {
  getGroupMessages,
  sendGroupMessage
};