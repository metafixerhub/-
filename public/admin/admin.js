/**
 * LiveAgent - Admin & Support Portal Logic
 * Handles real-time customer sessions, incoming alerts, audio chimes, and instant replies.
 */

(function () {
  'use strict';

  let socket = null;
  let activeCustomerId = null;
  let conversationsMap = new Map();
  let soundEnabled = true;

  // DOM Elements
  const connectionBadge = document.getElementById('connection-status');
  const connectionText = document.getElementById('connection-text');
  const convListEl = document.getElementById('conversations-list');
  const searchInput = document.getElementById('search-input');
  const chatWorkspace = document.getElementById('chat-workspace');
  const chatEmptyState = document.getElementById('chat-empty-state');
  const chatActiveView = document.getElementById('chat-active-view');
  const chatStream = document.getElementById('chat-stream');
  const agentInput = document.getElementById('agent-input');
  const btnSendMessage = document.getElementById('btn-send-message');
  const btnCloseChat = document.getElementById('btn-close-chat');
  const typingBar = document.getElementById('typing-bar');
  const currentUserName = document.getElementById('current-user-name');
  const currentUserStatus = document.getElementById('current-user-status');
  const toggleSoundBtn = document.getElementById('toggle-sound-btn');
  const testSoundBtn = document.getElementById('test-sound-btn');
  const soundStatusText = document.getElementById('sound-status-text');

  // Metadata Panel Elements
  const metaCustomerId = document.getElementById('meta-customer-id');
  const metaCustomerName = document.getElementById('meta-customer-name');
  const metaCustomerEmail = document.getElementById('meta-customer-email');
  const metaCustomerPage = document.getElementById('meta-customer-page');
  const metaCustomerStatus = document.getElementById('meta-customer-status');
  const metaCustomerStarted = document.getElementById('meta-customer-started');

  // Load sound preference
  const savedSound = localStorage.getItem('law_admin_sound');
  if (savedSound !== null) {
    soundEnabled = savedSound === 'true';
    updateSoundBtnUI();
  }

  function updateSoundBtnUI() {
    if (soundEnabled) {
      toggleSoundBtn.classList.add('active');
      soundStatusText.textContent = 'Sound: ON';
    } else {
      toggleSoundBtn.classList.remove('active');
      soundStatusText.textContent = 'Sound: OFF';
    }
  }

  toggleSoundBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('law_admin_sound', soundEnabled);
    updateSoundBtnUI();
  });

  // Audio Notification Synthesizer (Crystal clear chime using Web Audio API)
  function playAlertSound() {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Note 1 (E5 - 659.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.3);

      // Note 2 (A5 - 880 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.12);
      gain2.gain.setValueAtTime(0.35, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.6);
    } catch (e) {
      console.warn('Audio alert blocked by browser autoplay policy until clicked:', e);
    }
  }

  testSoundBtn.addEventListener('click', () => {
    playAlertSound();
  });

  // Connect to Socket.IO Server
  function initSocket() {
    socket = io(window.location.origin, {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      connectionText.textContent = 'Live Connected';
      connectionBadge.style.background = '#ecfdf5';
      connectionBadge.style.color = '#047857';
      socket.emit('join_admin', {});
    });

    socket.on('disconnect', () => {
      connectionText.textContent = 'Disconnected';
      connectionBadge.style.background = '#fef2f2';
      connectionBadge.style.color = '#b91c1c';
    });

    // Receive initial conversation list
    socket.on('conversations_list', (list) => {
      conversationsMap.clear();
      list.forEach((c) => conversationsMap.set(c.id, c));
      renderConversationsList();

      // If active conversation is open, refresh it
      if (activeCustomerId && conversationsMap.has(activeCustomerId)) {
        loadConversationDetails(activeCustomerId);
      }
    });

    // New or updated customer arrived
    socket.on('customer_joined', (summary) => {
      conversationsMap.set(summary.id, summary);
      renderConversationsList();
      if (activeCustomerId === summary.id) {
        updateMetaPanel(summary);
      }
    });

    // Customer message received
    socket.on('new_customer_message', ({ customerId, message, conversationSummary, playAudioNotification }) => {
      conversationsMap.set(customerId, conversationSummary);
      renderConversationsList();

      // Play audio notification chime for incoming customer message
      if (playAudioNotification) {
        playAlertSound();
      }

      // If currently chatting with this customer, append message immediately
      if (activeCustomerId === customerId) {
        appendMessage(message);
        // Mark as read on server
        socket.emit('mark_read', { customerId });
        conversationSummary.unreadForAdmin = 0;
        renderConversationsList();
      }
    });

    // Admin message confirmation
    socket.on('new_admin_message', ({ customerId, message, conversationSummary }) => {
      conversationsMap.set(customerId, conversationSummary);
      renderConversationsList();

      if (activeCustomerId === customerId) {
        appendMessage(message);
      }
    });

    // Customer typing indicator
    socket.on('customer_typing', ({ customerId, isTyping }) => {
      if (activeCustomerId === customerId) {
        if (isTyping) {
          const conv = conversationsMap.get(customerId);
          const name = conv ? conv.name : 'Customer';
          typingBar.textContent = `${name} is typing...`;
        } else {
          typingBar.textContent = '';
        }
      }
    });

    // Customer disconnected / offline
    socket.on('customer_offline', ({ customerId, summary }) => {
      conversationsMap.set(customerId, summary);
      renderConversationsList();
      if (activeCustomerId === customerId) {
        updateMetaPanel(summary);
      }
    });

    socket.on('conversation_updated', (summary) => {
      conversationsMap.set(summary.id, summary);
      renderConversationsList();
      if (activeCustomerId === summary.id) {
        updateMetaPanel(summary);
      }
    });
  }

  // Render left sidebar conversation items
  function renderConversationsList() {
    const query = searchInput.value.toLowerCase().trim();
    const sorted = Array.from(conversationsMap.values()).sort(
      (a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0)
    );

    const filtered = sorted.filter((c) => {
      if (!query) return true;
      return (
        (c.name && c.name.toLowerCase().includes(query)) ||
        (c.id && c.id.toLowerCase().includes(query)) ||
        (c.email && c.email.toLowerCase().includes(query)) ||
        (c.lastMessage && c.lastMessage.toLowerCase().includes(query))
      );
    });

    convListEl.innerHTML = '';

    if (filtered.length === 0) {
      convListEl.innerHTML = `
        <div class="empty-conversations">
          ${query ? 'No matching visitors found.' : 'No active visitors yet. Waiting for website traffic...'}
        </div>
      `;
      return;
    }

    filtered.forEach((conv) => {
      const li = document.createElement('li');
      li.className = `conv-item ${activeCustomerId === conv.id ? 'active' : ''}`;
      li.dataset.id = conv.id;

      const initials = (conv.name || 'Visitor')
        .split(' ')
        .map((p) => p[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();

      const timeStr = conv.lastMessageTime
        ? new Date(conv.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

      const unreadBadgeHtml = conv.unreadForAdmin > 0
        ? `<span class="conv-badge">${conv.unreadForAdmin}</span>`
        : '';

      li.innerHTML = `
        <div class="conv-avatar ${conv.status === 'online' ? 'online' : ''}">
          ${initials}
          <span class="indicator"></span>
        </div>
        <div class="conv-details">
          <div class="conv-top">
            <span class="conv-name">${escapeHtml(conv.name)}</span>
            <span class="conv-time">${timeStr}</span>
          </div>
          <div class="conv-bottom">
            <span class="conv-last-msg">${escapeHtml(conv.lastMessage || 'No messages')}</span>
            ${unreadBadgeHtml}
          </div>
        </div>
      `;

      li.addEventListener('click', () => selectConversation(conv.id));
      convListEl.appendChild(li);
    });
  }

  // Select and load a conversation
  async function selectConversation(customerId) {
    activeCustomerId = customerId;
    renderConversationsList();

    chatEmptyState.style.display = 'none';
    chatActiveView.classList.add('visible');

    // Mark as read
    socket.emit('mark_read', { customerId });
    const conv = conversationsMap.get(customerId);
    if (conv) {
      conv.unreadForAdmin = 0;
      updateMetaPanel(conv);
    }

    // Fetch full messages from REST API
    try {
      const res = await fetch(`/api/conversations/${customerId}`);
      if (res.ok) {
        const data = await res.json();
        renderMessagesStream(data.messages || []);
        updateMetaPanel(data);
      }
    } catch (err) {
      console.error('Failed to fetch conversation history:', err);
    }

    agentInput.focus();
  }

  function renderMessagesStream(messages) {
    chatStream.innerHTML = '';
    messages.forEach(appendMessage);
  }

  function appendMessage(msg) {
    // Avoid duplicates
    if (msg.id && document.getElementById(`admin-msg-${msg.id}`)) return;

    const wrap = document.createElement('div');
    if (msg.id) wrap.id = `admin-msg-${msg.id}`;

    if (msg.sender === 'system') {
      wrap.className = 'msg-system';
      wrap.textContent = msg.text;
    } else {
      wrap.className = `msg-bubble-wrap ${msg.sender}`;
      const timeStr = msg.timestamp
        ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

      wrap.innerHTML = `
        <div class="msg-bubble">${escapeHtml(msg.text)}</div>
        <div class="msg-time">${timeStr}</div>
      `;
    }

    chatStream.appendChild(wrap);
    chatStream.scrollTop = chatStream.scrollHeight;
  }

  function updateMetaPanel(data) {
    currentUserName.textContent = data.name || `Visitor #${data.id.slice(-4)}`;
    currentUserStatus.textContent = data.status === 'online' ? '🟢 Online now' : '⚪ Offline';

    metaCustomerId.textContent = data.id;
    metaCustomerName.textContent = data.name || 'Anonymous Visitor';
    metaCustomerEmail.textContent = data.email || 'Not provided';
    metaCustomerStatus.textContent = data.status ? data.status.toUpperCase() : 'UNKNOWN';

    if (data.pageUrl) {
      metaCustomerPage.innerHTML = `<a href="${escapeHtml(data.pageUrl)}" target="_blank" rel="noopener">${escapeHtml(data.pageUrl)}</a>`;
    } else {
      metaCustomerPage.textContent = 'Direct / Embedded';
    }

    if (data.createdAt) {
      metaCustomerStarted.textContent = new Date(data.createdAt).toLocaleString();
    }
  }

  // Send Admin Message
  function sendAdminMessage() {
    const text = agentInput.value.trim();
    if (!text || !activeCustomerId || !socket) return;

    socket.emit('admin_message', {
      customerId: activeCustomerId,
      text: text,
      agentName: 'Support Agent'
    });

    agentInput.value = '';
    agentInput.focus();

    // Cancel typing
    socket.emit('admin_typing', { customerId: activeCustomerId, isTyping: false });
  }

  btnSendMessage.addEventListener('click', sendAdminMessage);

  agentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAdminMessage();
    }
  });

  // Typing indicator broadcast to customer
  let adminTypingTimeout = null;
  agentInput.addEventListener('input', () => {
    if (activeCustomerId && socket) {
      socket.emit('admin_typing', { customerId: activeCustomerId, isTyping: true });
      clearTimeout(adminTypingTimeout);
      adminTypingTimeout = setTimeout(() => {
        socket.emit('admin_typing', { customerId: activeCustomerId, isTyping: false });
      }, 1500);
    }
  });

  // Quick canned responses
  document.querySelectorAll('.quick-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cannedText = chip.dataset.text;
      agentInput.value = cannedText;
      agentInput.focus();
    });
  });

  // Close / Resolve Chat
  btnCloseChat.addEventListener('click', () => {
    if (!activeCustomerId || !socket) return;
    if (confirm('Are you sure you want to resolve and end this chat session?')) {
      socket.emit('close_conversation', { customerId: activeCustomerId });
    }
  });

  // Search input handler
  searchInput.addEventListener('input', renderConversationsList);

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Init
  initSocket();
})();
