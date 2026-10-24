const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Enable CORS for all external origins (Odoo, staging, local)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Serve static frontend assets (Admin portal, widget, demo)
app.use(express.static(path.join(__dirname, 'public')));

// Configure Socket.IO with permissive CORS for external website embedding
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

/**
 * In-Memory Conversation Store
 * Structure:
 * {
 *   [customerId]: {
 *     id: string,
 *     name: string,
 *     email: string,
 *     pageUrl: string,
 *     status: 'online' | 'offline',
 *     createdAt: string,
 *     lastActivity: string,
 *     socketId: string,
 *     unreadForAdmin: number,
 *     messages: Array<{ id, sender: 'customer'|'agent'|'system', text, timestamp, senderName }>
 *   }
 * }
 */
const conversations = new Map();

// Helper to sanitize customer payload for admin listing
function getConversationSummary(conv) {
  const lastMsg = conv.messages[conv.messages.length - 1];
  return {
    id: conv.id,
    name: conv.name || `Visitor #${conv.id.slice(-4)}`,
    email: conv.email || '',
    pageUrl: conv.pageUrl || '',
    status: conv.status,
    createdAt: conv.createdAt,
    lastActivity: conv.lastActivity,
    unreadForAdmin: conv.unreadForAdmin,
    lastMessage: lastMsg ? lastMsg.text : 'No messages yet',
    lastMessageTime: lastMsg ? lastMsg.timestamp : conv.createdAt
  };
}

function getAllConversationsSummary() {
  const list = [];
  for (const conv of conversations.values()) {
    list.push(getConversationSummary(conv));
  }
  // Sort by last activity descending
  return list.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
}

// REST Endpoints
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeConversations: conversations.size
  });
});

app.get('/api/conversations', (req, res) => {
  res.json(getAllConversationsSummary());
});

app.get('/api/conversations/:id', (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  res.json(conv);
});

// Socket.IO Real-Time Engine
io.on('connection', (socket) => {
  // console.log(`New socket connection: ${socket.id}`);

  // 1. ADMIN REGISTRATION
  socket.on('join_admin', (data) => {
    socket.join('admin_room');
    socket.isAdmin = true;
    // Send full conversation list to the admin
    socket.emit('conversations_list', getAllConversationsSummary());
  });

  // 2. CUSTOMER REGISTRATION / RECONNECT
  socket.on('join_customer', ({ customerId, name, email, pageUrl }) => {
    if (!customerId) return;

    socket.customerId = customerId;
    socket.isCustomer = true;
    socket.join(`customer_${customerId}`);

    let conv = conversations.get(customerId);
    const now = new Date().toISOString();

    if (!conv) {
      conv = {
        id: customerId,
        name: name || `Visitor #${customerId.slice(-4)}`,
        email: email || '',
        pageUrl: pageUrl || '',
        status: 'online',
        createdAt: now,
        lastActivity: now,
        socketId: socket.id,
        unreadForAdmin: 0,
        messages: [
          {
            id: 'sys_' + Date.now(),
            sender: 'system',
            text: 'Welcome! An agent will be with you shortly.',
            timestamp: now,
            senderName: 'System'
          }
        ]
      };
      conversations.set(customerId, conv);
    } else {
      // Existing visitor returning / reconnecting
      conv.status = 'online';
      conv.socketId = socket.id;
      conv.lastActivity = now;
      if (name) conv.name = name;
      if (email) conv.email = email;
      if (pageUrl) conv.pageUrl = pageUrl;
    }

    // Send chat history back to this customer
    socket.emit('chat_history', {
      customerId: conv.id,
      name: conv.name,
      messages: conv.messages
    });

    // Notify all admins of the updated/new customer
    io.to('admin_room').emit('customer_joined', getConversationSummary(conv));
  });

  // 3. CUSTOMER SENDS MESSAGE
  socket.on('customer_message', ({ customerId, text }) => {
    if (!customerId || !text || !text.trim()) return;

    const conv = conversations.get(customerId);
    if (!conv) return;

    const now = new Date().toISOString();
    const msg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      sender: 'customer',
      senderName: conv.name || `Visitor #${customerId.slice(-4)}`,
      text: text.trim(),
      timestamp: now
    };

    conv.messages.push(msg);
    conv.lastActivity = now;
    conv.unreadForAdmin = (conv.unreadForAdmin || 0) + 1;

    // Echo back to customer's room
    io.to(`customer_${customerId}`).emit('new_message', msg);

    // Send to admin room with audio notification signal & updated conversation summary
    io.to('admin_room').emit('new_customer_message', {
      customerId,
      message: msg,
      conversationSummary: getConversationSummary(conv),
      playAudioNotification: true
    });
  });

  // 4. ADMIN SENDS MESSAGE TO CUSTOMER
  socket.on('admin_message', ({ customerId, text, agentName }) => {
    if (!customerId || !text || !text.trim()) return;

    const conv = conversations.get(customerId);
    if (!conv) return;

    const now = new Date().toISOString();
    const msg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      sender: 'agent',
      senderName: agentName || 'Support Agent',
      text: text.trim(),
      timestamp: now
    };

    conv.messages.push(msg);
    conv.lastActivity = now;

    // Send to customer
    io.to(`customer_${customerId}`).emit('new_message', msg);

    // Send to all admins so dashboard remains synced across multiple tabs
    io.to('admin_room').emit('new_admin_message', {
      customerId,
      message: msg,
      conversationSummary: getConversationSummary(conv)
    });
  });

  // 5. ADMIN MARKS MESSAGES AS READ
  socket.on('mark_read', ({ customerId }) => {
    const conv = conversations.get(customerId);
    if (conv) {
      conv.unreadForAdmin = 0;
      io.to('admin_room').emit('conversation_updated', getConversationSummary(conv));
    }
  });

  // 6. TYPING INDICATORS
  socket.on('customer_typing', ({ customerId, isTyping }) => {
    io.to('admin_room').emit('customer_typing', { customerId, isTyping });
  });

  socket.on('admin_typing', ({ customerId, isTyping, agentName }) => {
    io.to(`customer_${customerId}`).emit('agent_typing', {
      isTyping,
      agentName: agentName || 'Agent'
    });
  });

  // 7. ADMIN CLOSES CHAT
  socket.on('close_conversation', ({ customerId }) => {
    const conv = conversations.get(customerId);
    if (conv) {
      const now = new Date().toISOString();
      const sysMsg = {
        id: 'sys_' + Date.now(),
        sender: 'system',
        text: 'This chat session has been closed by the support agent. Feel free to start a new message anytime.',
        timestamp: now,
        senderName: 'System'
      };
      conv.messages.push(sysMsg);
      io.to(`customer_${customerId}`).emit('new_message', sysMsg);
      io.to('admin_room').emit('conversation_updated', getConversationSummary(conv));
    }
  });

  // 8. DISCONNECTION HANDLING
  socket.on('disconnect', () => {
    if (socket.isCustomer && socket.customerId) {
      const conv = conversations.get(socket.customerId);
      if (conv && conv.socketId === socket.id) {
        conv.status = 'offline';
        io.to('admin_room').emit('customer_offline', {
          customerId: socket.customerId,
          summary: getConversationSummary(conv)
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Live Agent Customer Support Server is Running!`);
  console.log(`📡 Local Port: http://localhost:${PORT}`);
  console.log(`💬 Demo / Customer Test Page: http://localhost:${PORT}/`);
  console.log(`👨‍💼 Admin / Agent Portal: http://localhost:${PORT}/admin`);
  console.log(`📦 Embeddable Widget Script: http://localhost:${PORT}/widget/widget.js`);
  console.log(`====================================================`);
});
