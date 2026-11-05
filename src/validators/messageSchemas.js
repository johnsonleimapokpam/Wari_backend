const { z } = require('zod');

const sendMessageSchema = z.object({
  body: z.object({
    conversationId: z.string().uuid(),
    body: z.string().min(1).max(5000),
    clientMessageId: z.string().uuid()
  }),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough()
});

const messageHistorySchema = z.object({
  body: z.object({}).passthrough(),
  params: z.object({
    conversationId: z.string().uuid()
  }),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().datetime().optional()
  }).passthrough()
});

module.exports = {
  sendMessageSchema,
  messageHistorySchema
};
