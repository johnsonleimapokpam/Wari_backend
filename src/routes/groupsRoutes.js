const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const groupController = require('../controllers/groupController');
const groupMemberController = require('../controllers/groupMemberController');
const groupMessageController = require('../controllers/groupMessageController');
const { z } = require('zod');

const router = express.Router();

const createGroupSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(120),
    description: z.string().max(500).optional().nullable(),
    avatarUrl: z.string().url().max(2048).optional().nullable(),
    memberIds: z.array(z.string().uuid()).optional()
  }),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough()
});

const updateGroupSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(500).optional().nullable(),
    avatarUrl: z.string().url().max(2048).optional().nullable()
  }),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough()
});

const addMembersSchema = z.object({
  body: z.object({
    userIds: z.array(z.string().uuid()).min(1)
  }),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough()
});

const getGroupMessagesQuerySchema = z.object({
  body: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().datetime().optional()
  }).passthrough()
});

const groupMessageSchema = z.object({
  body: z.object({
    body: z.string().min(1).max(5000),
    clientMessageId: z.string().uuid()
  }),
  params: z.object({}).passthrough(),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().datetime().optional()
  }).passthrough()
});

router.post('/', authMiddleware, validate(createGroupSchema), groupController.createGroup);
router.get('/:id', authMiddleware, groupController.getGroup);
router.put('/:id', authMiddleware, validate(updateGroupSchema), groupController.renameGroup);
router.delete('/:id', authMiddleware, groupController.deleteGroup);

router.get('/:id/members', authMiddleware, groupController.listMembers);
router.post('/:id/members', authMiddleware, validate(addMembersSchema), groupMemberController.addMembers);
router.delete('/:id/members/:userId', authMiddleware, groupMemberController.removeMember);
router.post('/:id/leave', authMiddleware, groupMemberController.leaveGroup);

router.post('/:id/messages', authMiddleware, validate(groupMessageSchema), groupMessageController.sendGroupMessage);
router.get('/:id/messages', authMiddleware, validate(getGroupMessagesQuerySchema), groupMessageController.getGroupMessages);

module.exports = router;