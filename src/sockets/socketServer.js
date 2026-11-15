const { Server } = require('socket.io');
const { env } = require('../config/env');
const { socketAuth } = require('./socketAuth');
const { registerMessageHandlers } = require('./messageHandlers');
const { registerRoomHandlers } = require('./roomHandlers');
const { registerPresenceHandlers } = require('./presenceHandlers');
const { registerTypingHandlers } = require('./typingHandlers');
const { registerDeliveryHandlers } = require('./deliveryHandlers');
const { registerReadReceiptHandlers } = require('./readReceiptHandlers');

const presenceService = require('../services/presenceService');

const createSocketState = () => ({
  roomPresence: new Map()
});

const initializeSocketServer = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((origin) => origin.trim()) : true,
      credentials: true,
      methods: ['GET', 'POST']
    }
  });

  const state = createSocketState();

  io.use(socketAuth);

  io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    const userRoom = `user:${userId}`;

    console.log(
      `[SOCKET CONNECTED] user =${userId} socket=${socket.id} `
    );

    // Register handlers and join the private room before awaiting any I/O.
    // Socket.IO does not queue incoming events while a connection handler is
    // awaiting, so registering later can silently drop join_conversation and
    // send_message packets from fast clients or reconnects.
    registerPresenceHandlers(socket, io);
    registerTypingHandlers(socket, io);
    registerDeliveryHandlers(socket, io);
    registerReadReceiptHandlers(socket, io);
    registerMessageHandlers(socket, io, state);
    registerRoomHandlers(socket, io, state);

    socket.join(userRoom);

    console.log(`[ROOM JOINED] ${socket.id} -> ${userRoom}`);

    const initializePresence = async () => {
      try {
        const presenceResult = await presenceService.registerConnection({
          userId,
          socketId: socket.id
        });

        if (socket.disconnected) {
          await presenceService.unregisterConnection({ userId, socketId: socket.id });
          return;
        }

        if (presenceResult.isNewOnlineTransition) {
          io.emit('user_online', presenceResult.snapshot);
        }
      } catch (error) {
        console.error('Socket connection initialization failed', error);
        socket.disconnect(true);
      }
    };

    initializePresence();
  });

  return io;
};

module.exports = {
  initializeSocketServer
};