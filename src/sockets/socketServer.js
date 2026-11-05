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

  io.on('connection', async (socket) => {
    try{
      const userId = socket.data.user.id;

      console.log(
        `[SOCKET CONNECTED] user =${userId} socket=${socket.id} `
      );

      registerPresenceHandlers(socket, io);

      const presenceResult = await presenceService.registerConnection({userId, socketId: socket.id});

      if (socket.disconnected) {
        await presenceService.unregisterConnection({ userId, socketId: socket.id });
        return;
      }

      if(presenceResult.isNewOnlineTransition){
        io.emit('user_online', presenceResult.snapshot);
      }

      const userRoom = `user:${userId}`;

      socket.join(userRoom);

      console.log(`[ROOM JOINED] ${socket.id} -> ${userRoom}`);

      registerTypingHandlers(socket, io);
      registerDeliveryHandlers(socket, io);
      registerReadReceiptHandlers(socket, io);
      registerMessageHandlers(socket, io, state);
      registerRoomHandlers(socket, io, state);
    } catch (error){
      console.error('Socket connection initialization failed', error);

      socket.disconnect(true);
    }
  });

  return io;
};

module.exports = {
  initializeSocketServer
};