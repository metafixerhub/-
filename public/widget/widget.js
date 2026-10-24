/**
 * LiveAgent - Customer Support Chat Widget
 * Embeddable on any website (Odoo, WordPress, Shopify, Custom HTML)
 */

(function () {
  'use strict';

  // Prevent multiple initializations
  if (window.__LiveAgentInitialized) return;
  window.__LiveAgentInitialized = true;

  // Find script element to extract config
  const scriptTag = document.currentScript || document.querySelector('script[src*="widget.js"]');
  const serverUrl = (scriptTag && scriptTag.getAttribute('data-server')) 
    || (window.LiveAgentConfig && window.LiveAgentConfig.serverUrl)
    || window.location.origin;

  const primaryColor = (scriptTag && scriptTag.getAttribute('data-color'))
    || (window.LiveAgentConfig && window.LiveAgentConfig.primaryColor)
    || '#0084ff';

  const widgetTitle = (scriptTag && scriptTag.getAttribute('data-title'))
    || (window.LiveAgentConfig && window.LiveAgentConfig.title)
    || 'Customer Support';

  // Inject CSS if not already present
  if (!document.getElementById('law-widget-css')) {
    const link = document.createElement('link');
    link.id = 'law-widget-css';
    link.rel = 'stylesheet';
    link.href = `${serverUrl}/widget/widget.css`;
    document.head.appendChild(link);
  }

  // Generate or retrieve customer ID
  function getCustomerId() {
    let id = localStorage.getItem('law_customer_id');
    if (!id) {
      id = 'cust_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
      localStorage.setItem('law_customer_id', id);
    }
    return id;
  }

  function getCustomerName() {
    return localStorage.getItem('law_customer_name') || '';
  }

  function getCustomerEmail() {
    return localStorage.getItem('law_customer_email') || '';
  }

  const customerId = getCustomerId();
  let customerName = getCustomerName() || `Visitor #${customerId.slice(-4)}`;
  let customerEmail = getCustomerEmail();
  let isOpen = false;
  let unreadCount = 0;
  let socket = null;
  let typingTimeout = null;

  // Sound generator using Web Audio API (Reliable, no external audio files needed)
  function playNotificationSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      const now = ctx.currentTime;
      // First tone (G5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(783.99, now);
      gain1.gain.setValueAtTime(0.2, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      // Second tone (C6)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1046.50, now + 0.12);
      gain2.gain.setValueAtTime(0.25, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.5);
    } catch (e) {
      // Audio autoplay policy might block before user interaction
    }
  }

  // Build Widget DOM elements
  function createWidgetElements() {
    // 1. Launcher button
    const launcher = document.createElement('div');
    launcher.id = 'law-launcher';
    launcher.setAttribute('aria-label', 'Open Live Support Chat');
    launcher.innerHTML = `
      <div id="law-badge">0</div>
      <svg class="law-icon-chat" viewBox="0 0 24 24">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/>
        <circle cx="8" cy="10" r="1.5"/>
        <circle cx="12" cy="10" r="1.5"/>
        <circle cx="16" cy="10" r="1.5"/>
      </svg>
      <svg class="law-icon-close" viewBox="0 0 24 24">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
      </svg>
    `;

    // 2. Chat Container
    const container = document.createElement('div');
    container.id = 'law-container';
    container.innerHTML = `
      <div class="law-header">
        <div class="law-agent-info">
          <div class="law-avatar-wrapper">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
            </svg>
            <span class="law-status-dot"></span>
          </div>
          <div class="law-title-wrap">
            <h4>${widgetTitle}</h4>
            <p>Active & Online • We reply instantly</p>
          </div>
        </div>
        <div class="law-header-actions">
          <button id="law-close-btn" title="Minimize chat">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 13H5v-2h14v2z"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="law-user-bar">
        <div>Chatting as: <span id="law-user-display">${customerName}</span></div>
        <button class="law-user-edit-btn" id="law-edit-info-btn">Edit info</button>
      </div>

      <div class="law-messages" id="law-messages-list">
        <!-- Messages will be injected here -->
      </div>

      <div class="law-typing" id="law-typing-indicator">
        <span class="law-typing-dot"></span>
        <span class="law-typing-dot"></span>
        <span class="law-typing-dot"></span>
      </div>

      <div class="law-footer">
        <textarea id="law-input" placeholder="Write a message..." rows="1"></textarea>
        <button id="law-send" class="law-send-btn" title="Send message">
          <svg viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>

      <!-- Info Modal -->
      <div class="law-modal-overlay" id="law-modal">
        <div class="law-modal-box">
          <h4>Your Information</h4>
          <input type="text" id="law-name-input" placeholder="Your Name" value="${customerName}">
          <input type="email" id="law-email-input" placeholder="Your Email Address" value="${customerEmail}">
          <div class="law-modal-actions">
            <button class="law-btn-cancel" id="law-modal-cancel">Cancel</button>
            <button class="law-btn-save" id="law-modal-save">Save</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(launcher);
    document.body.appendChild(container);

    setupEventListeners(launcher, container);
  }

  function setupEventListeners(launcher, container) {
    const closeBtn = document.getElementById('law-close-btn');
    const input = document.getElementById('law-input');
    const sendBtn = document.getElementById('law-send');
    const editInfoBtn = document.getElementById('law-edit-info-btn');
    const modal = document.getElementById('law-modal');
    const modalCancel = document.getElementById('law-modal-cancel');
    const modalSave = document.getElementById('law-modal-save');
    const nameInput = document.getElementById('law-name-input');
    const emailInput = document.getElementById('law-email-input');
    const userDisplay = document.getElementById('law-user-display');

    // Toggle widget open/close
    function toggleChat() {
      isOpen = !isOpen;
      if (isOpen) {
        container.classList.add('law-visible');
        launcher.classList.add('law-active');
        unreadCount = 0;
        updateBadge();
        input.focus();
        scrollToBottom();
      } else {
        container.classList.remove('law-visible');
        launcher.classList.remove('law-active');
      }
    }

    launcher.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);

    // Send message logic
    function sendMessage() {
      const text = input.value.trim();
      if (!text || !socket) return;

      socket.emit('customer_message', {
        customerId: customerId,
        text: text
      });

      input.value = '';
      input.style.height = 'auto';

      // Cancel typing indicator
      socket.emit('customer_typing', { customerId, isTyping: false });
    }

    sendBtn.addEventListener('click', sendMessage);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Handle typing events with debounce
    input.addEventListener('input', () => {
      // Auto resize height
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 90) + 'px';

      if (socket) {
        socket.emit('customer_typing', { customerId, isTyping: true });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          socket.emit('customer_typing', { customerId, isTyping: false });
        }, 1500);
      }
    });

    // Profile Edit Modal
    editInfoBtn.addEventListener('click', () => {
      modal.classList.add('law-modal-open');
    });

    modalCancel.addEventListener('click', () => {
      modal.classList.remove('law-modal-open');
    });

    modalSave.addEventListener('click', () => {
      const newName = nameInput.value.trim() || `Visitor #${customerId.slice(-4)}`;
      const newEmail = emailInput.value.trim();
      customerName = newName;
      customerEmail = newEmail;
      localStorage.setItem('law_customer_name', customerName);
      localStorage.setItem('law_customer_email', customerEmail);
      userDisplay.innerText = customerName;
      modal.classList.remove('law-modal-open');

      if (socket) {
        socket.emit('join_customer', {
          customerId: customerId,
          name: customerName,
          email: customerEmail,
          pageUrl: window.location.href
        });
      }
    });
  }

  function updateBadge() {
    const badge = document.getElementById('law-badge');
    if (!badge) return;
    if (unreadCount > 0 && !isOpen) {
      badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function appendMessage(msg) {
    const list = document.getElementById('law-messages-list');
    if (!list) return;

    // Check if message already rendered
    if (msg.id && document.getElementById(`law-msg-${msg.id}`)) return;

    const row = document.createElement('div');
    if (msg.id) row.id = `law-msg-${msg.id}`;
    row.className = `law-msg-row law-${msg.sender}`;

    if (msg.sender === 'system') {
      row.innerHTML = `<div class="law-msg-bubble">${escapeHtml(msg.text)}</div>`;
    } else {
      row.innerHTML = `
        <div class="law-msg-bubble">${escapeHtml(msg.text)}</div>
        <div class="law-msg-meta">${formatTime(msg.timestamp)}</div>
      `;
    }

    list.appendChild(row);
    scrollToBottom();
  }

  function scrollToBottom() {
    const list = document.getElementById('law-messages-list');
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize Socket Connection
  function initSocket() {
    if (typeof io === 'undefined') {
      console.error('LiveAgent: Socket.IO library not loaded.');
      return;
    }

    socket = io(serverUrl, {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      // Register this customer session
      socket.emit('join_customer', {
        customerId: customerId,
        name: customerName,
        email: customerEmail,
        pageUrl: window.location.href
      });
    });

    socket.on('chat_history', (data) => {
      const list = document.getElementById('law-messages-list');
      if (list) list.innerHTML = '';
      if (data && data.messages) {
        data.messages.forEach(appendMessage);
      }
    });

    socket.on('new_message', (msg) => {
      appendMessage(msg);
      if (msg.sender === 'agent') {
        playNotificationSound();
        if (!isOpen) {
          unreadCount++;
          updateBadge();
        }
      }
    });

    socket.on('agent_typing', (data) => {
      const typingEl = document.getElementById('law-typing-indicator');
      if (typingEl) {
        if (data.isTyping) {
          typingEl.classList.add('law-active');
          scrollToBottom();
        } else {
          typingEl.classList.remove('law-active');
        }
      }
    });
  }

  // Load Socket.IO client script if not already present
  function loadSocketIoAndInit() {
    createWidgetElements();

    if (typeof io !== 'undefined') {
      initSocket();
    } else {
      const script = document.createElement('script');
      script.src = `${serverUrl}/socket.io/socket.io.js`;
      script.onload = () => initSocket();
      script.onerror = () => {
        // Fallback to CDN if server path fails
        const cdnScript = document.createElement('script');
        cdnScript.src = 'https://cdn.socket.io/4.8.1/socket.io.min.js';
        cdnScript.onload = () => initSocket();
        document.head.appendChild(cdnScript);
      };
      document.head.appendChild(script);
    }
  }

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSocketIoAndInit);
  } else {
    loadSocketIoAndInit();
  }
})();
