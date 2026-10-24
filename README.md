# LiveAgent - Real-Time Customer Live Chat System

A complete real-time live agent customer support system featuring:
1. **Embeddable Customer Chat Widget**: Lightweight, responsive floating chat bubble designed for easy embedding in external sites (like **Odoo**, WordPress, Shopify, Urdu audio websites, or custom HTML).
2. **Admin / Agent Support Portal**: Dedicated dashboard where support agents receive instant push notifications (with audible chimes), see active visitors, monitor visited page URLs, and chat back in real-time.
3. **Backend Server (Node.js + Express + Socket.IO)**: High-speed bidirectional event pushing and pulling with full Cross-Origin (CORS) support.

---

## 🏗️ System Architecture & Workflow

```text
+-------------------------+                     +---------------------------+
|   Customer on Website   |                     |    Live Agent Portal      |
|     (e.g., ODOO Site)   |                     |      (/admin dashboard)   |
+-------------------------+                     +---------------------------+
             |                                                ^
             | 1. Customer types message                     | 2. Real-time push + Audio chime
             v                                                |
       +-------------------------------------------------------------+
       |            LiveAgent Backend (Node.js & Socket.IO)          |
       |                   http://localhost:3000                     |
       +-------------------------------------------------------------+
             ^                                                |
             | 4. Customer receives message instantly        | 3. Agent replies
             +------------------------------------------------+
```

---

## 🚀 Quick Start (Run Locally)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
node server.js
```
or
```bash
npm start
```

### 3. Open in Browser
- **Customer Demo Website**: [http://localhost:3000](http://localhost:3000)
- **Live Agent Admin Portal**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Chat Widget Script**: [http://localhost:3000/widget/widget.js](http://localhost:3000/widget/widget.js)

---

## 🧪 How to Test Side-by-Side

1. Open **[http://localhost:3000/admin](http://localhost:3000/admin)** in one browser window (this is your Admin Portal).
2. Open **[http://localhost:3000](http://localhost:3000)** in a second browser window (this simulates a customer visiting your website).
3. On the customer page, click the blue chat bubble in the bottom right corner and send a message (e.g. *"Hello, I need pricing information"*).
4. Watch the Admin window:
   - An **audible notification chime** plays instantly.
   - The customer session appears in the left sidebar with an unread badge.
   - The customer's visited page URL and details are shown in the right panel.
5. Reply in the Admin Portal — the message appears instantly on the customer's chat widget!

---

## 🌐 Hosting the Backend (To Get Your Public URL)

To embed the widget in your live **Odoo website** or external website, host this backend on any free or paid cloud provider:

### Option 1: Render.com (Recommended & Free)
1. Push this project folder to your GitHub repository.
2. Sign in to [Render.com](https://render.com) and click **"New +" -> "Web Service"**.
3. Connect your GitHub repository.
4. Set:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Click **"Deploy"**. Render will give you a public HTTPS URL (e.g. `https://liveagent-abc.onrender.com`).

### Option 2: Railway.app
1. Go to [Railway.app](https://railway.app), create a new project and select your repository.
2. Railway detects Node.js automatically and deploys it with a public URL.

### Option 3: VPS / Ubuntu Server
```bash
git clone <your-repo>
cd liveagent
npm install
npm install -g pm2
pm2 start server.js --name "liveagent"
```

---

## 🔌 Embedding into Odoo Website

Once hosted, add this single code snippet to your Odoo website:

```html
<!-- LiveAgent Customer Support Widget -->
<script 
  src="https://YOUR-HOSTED-BACKEND-URL/widget/widget.js" 
  data-server="https://YOUR-HOSTED-BACKEND-URL"
  data-title="Customer Support"
  data-color="#0084ff"
  async>
</script>
```

*(For testing on your local machine, replace `https://YOUR-HOSTED-BACKEND-URL` with `http://localhost:3000`)*.

### How to paste in Odoo:
1. Log into your **Odoo Admin** dashboard.
2. Navigate to: **Website** ➔ **Configuration** ➔ **Settings**.
3. Under the **Custom Code** section, paste the script inside **"Header Code"** or **"Body Code"**.
4. Click **Save**. The floating chat bubble will immediately appear across your entire Odoo website!

---

## 📁 Project File Structure

```text
liveagent/
│
├── server.js                        # Express & Socket.IO backend engine
├── package.json                     # Dependencies (express, socket.io, cors)
│
├── public/                          # Static web files
│   ├── index.html                   # Customer demo page simulating external site
│   │
│   ├── admin/                       # Admin Portal (Agent Dashboard)
│   │   ├── index.html               # Admin portal HTML
│   │   ├── style.css                # Modern responsive dashboard styling
│   │   └── admin.js                 # Real-time WebSocket logic & audio alerts
│   │
│   └── widget/                      # Embeddable Chat Widget
│       ├── widget.js                # Self-loading chat widget script
│       └── widget.css               # Namespaced widget CSS styles
│
└── odoo-integration/                # Ready-to-use snippets for Odoo
    └── odoo-embed-code.html         # Odoo embed code & integration guide
```

---

## ⚙️ REST API Endpoints

- `GET /api/health` - Server health status and active conversation count.
- `GET /api/conversations` - List summary of all conversations for admin dashboard.
- `GET /api/conversations/:id` - Full message history and metadata for a specific customer.
