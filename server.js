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

// Track connected admin sockets
const adminSockets = new Set();

// Track 1-minute unanswered customer message timers: Map<customerId, NodeJS.Timeout>
const unansweredTimers = new Map();

function sendAutoNotice(customerId, text) {
  const conv = conversations.get(customerId);
  if (!conv) return;

  const now = new Date().toISOString();
  const notice = {
    id: 'sys_' + Date.now(),
    sender: 'system',
    text: text,
    timestamp: now,
    senderName: 'System'
  };

  conv.messages.push(notice);
  conv.lastActivity = now;

  io.to(`customer_${customerId}`).emit('new_message', notice);
  io.to('admin_room').emit('new_customer_message', {
    customerId,
    message: notice,
    conversationSummary: getConversationSummary(conv),
    playAudioNotification: false
  });
}

// Socket.IO Real-Time Engine
io.on('connection', (socket) => {
  // 1. ADMIN REGISTRATION
  socket.on('join_admin', (data) => {
    socket.join('admin_room');
    socket.isAdmin = true;
    adminSockets.add(socket.id);

    // Broadcast updated agent status to all connected visitors
    io.emit('agent_status', {
      isOnline: adminSockets.size > 0,
      activeAdmins: adminSockets.size
    });

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
            text: 'Welcome! Make it a good day. How can we help you today?',
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

    // Send chat history and current agent presence back to this customer
    socket.emit('chat_history', {
      customerId: conv.id,
      name: conv.name,
      messages: conv.messages,
      isAgentOnline: adminSockets.size > 0
    });

    // Send agent presence state
    socket.emit('agent_status', {
      isOnline: adminSockets.size > 0,
      activeAdmins: adminSockets.size
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

    // Clear previous timer for this customer if any
    if (unansweredTimers.has(customerId)) {
      clearTimeout(unansweredTimers.get(customerId));
      unansweredTimers.delete(customerId);
    }

    // Check agent online status
    if (adminSockets.size === 0) {
      // All agents are offline! Send prompt notice after 2.5 seconds
      const timer = setTimeout(() => {
        const c = conversations.get(customerId);
        if (!c) return;
        const last = c.messages[c.messages.length - 1];
        if (last && (last.sender === 'customer' || last.id === msg.id)) {
          sendAutoNotice(
            customerId,
            "Notice: Our agents are currently offline. Please leave your message and email address, or try again in a few minutes later. Have a good day!"
          );
        }
        unansweredTimers.delete(customerId);
      }, 2500);
      unansweredTimers.set(customerId, timer);
    } else {
      // Agents are online: Start 1-minute (60 seconds) timer
      // If no agent reply arrives within 1 minute, notify customer to try again later
      const timer = setTimeout(() => {
        const c = conversations.get(customerId);
        if (!c) return;
        // Check if last message was customer or if unread
        const last = c.messages[c.messages.length - 1];
        if (last && last.sender === 'customer') {
          sendAutoNotice(
            customerId,
            "Notice: Our agents are currently busy assisting other visitors. If you haven't received a response in 1 minute, please try again in a few minutes later, or share your email address so we can follow up with you. Thank you for your patience and make it a good day!"
          );
        }
        unansweredTimers.delete(customerId);
      }, 60000); // 1 minute (60,000 ms)

      unansweredTimers.set(customerId, timer);
    }
  });

  // 4. ADMIN SENDS MESSAGE TO CUSTOMER
  socket.on('admin_message', ({ customerId, text, agentName }) => {
    if (!customerId || !text || !text.trim()) return;

    const conv = conversations.get(customerId);
    if (!conv) return;

    // Clear unanswered timer since agent responded!
    if (unansweredTimers.has(customerId)) {
      clearTimeout(unansweredTimers.get(customerId));
      unansweredTimers.delete(customerId);
    }

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
    // If admin disconnected, update admin count and notify all visitors
    if (socket.isAdmin) {
      adminSockets.delete(socket.id);
      io.emit('agent_status', {
        isOnline: adminSockets.size > 0,
        activeAdmins: adminSockets.size
      });
    }

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
