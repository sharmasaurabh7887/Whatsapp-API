// server.js (Baileys-based replacement, no Chromium)
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const qrcode = require("qrcode");

const { default: makeWASocket, useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser, makeCacheableSignalKeyStore } = require("@adiwajshing/baileys");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

let qrCodeData = null;
let isReady = false;

// --- AUTH STATE (single file)
const authFile = path.resolve(__dirname, "auth_info.json");
const { state, saveState } = useSingleFileAuthState(authFile);

// --- Create socket
async function startSock() {
  try {
    const { version } = await fetchLatestBaileysVersion().catch(()=>({ version: [2,2305,8] }));
    const sock = makeWASocket({
      version,
      printQRInTerminal: false,
      auth: state,
      // a tiny browser string
      browser: ["whatsapp-api", "nodejs", "1.0.0"],
      // logger: WABinaryLogger etc (default is fine)
    });

    // persist creds when updated
    sock.ev.on("creds.update", saveState);

    // connection updates (qr, open/close)
    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        qrCodeData = qr;
        console.log("🔑 QR received (Baileys).");
      }
      if (connection === "open") {
        isReady = true;
        console.log("✅ WhatsApp connection open.");
        qrCodeData = null;
      }
      if (connection === "close") {
        isReady = false;
        // try to reconnect if not logged out
        const reason = (lastDisconnect && lastDisconnect.error) ? lastDisconnect.error.output?.statusCode : null;
        console.log("❌ Connection closed:", reason || lastDisconnect);
        // Baileys will try to reconnect automatically by default
      }
    });

    // optional: log incoming messages
    sock.ev.on("messages.upsert", m => {
      // console.log("message upsert", m);
    });

    return sock;
  } catch (err) {
    console.error("Failed to start socket:", err);
    throw err;
  }
}

// start socket and hold reference
let sockPromise = startSock();
let sockRef = null;
sockPromise.then(s => sockRef = s).catch(e => console.error(e));

// ---------- API ENDPOINTS ----------

// Status
app.get("/status", (req, res) => {
  res.json({ authenticated: isReady });
});

// Get QR
app.get("/get-qr", async (req, res) => {
  try {
    if (!qrCodeData) return res.status(400).send("QR not generated yet");
    const qrImage = await qrcode.toBuffer(qrCodeData);
    res.setHeader("Content-Type", "image/png");
    res.send(qrImage);
  } catch (err) {
    console.error("QR Error:", err);
    res.status(500).send("Failed to generate QR");
  }
});

// Helper: ensure socket is ready
async function getSocket() {
  if (!sockRef) {
    sockRef = await sockPromise;
  }
  return sockRef;
}

// Send to specific numbers (text)
app.post("/send-specific", async (req, res) => {
  try {
    const { message, numbers } = req.body;
    if (!message || !numbers || numbers.length === 0)
      return res.status(400).json({ error: "message and numbers are required" });

    const socket = await getSocket();
    const results = [];

    for (const rawNum of numbers) {
      const num = rawNum.toString().replace(/\D/g, ""); // digits only
      const jid = num + "@s.whatsapp.net";
      try {
        await socket.sendMessage(jid, { text: message });
        results.push({ to: num, status: "sent" });
        // pause a bit
        await new Promise(r => setTimeout(r, 1200));
      } catch (err) {
        results.push({ to: num, status: "failed", error: err.message || err.toString() });
      }
    }

    res.json({ total: numbers.length, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send messages" });
  }
});

// Send media to specific numbers (file upload)
app.post("/send-specific-media", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File is required" });
    let { caption, numbers } = req.body;
    if (typeof numbers === "string") numbers = numbers.split(",").map(n => n.trim());
    if (!numbers || numbers.length === 0) return res.status(400).json({ error: "Numbers are required" });

    const socket = await getSocket();
    const buffer = fs.readFileSync(req.file.path);
    const mimeType = req.file.mimetype || "application/octet-stream";

    const results = [];
    for (const rawNum of numbers) {
      const num = rawNum.toString().replace(/\D/g, "");
      const jid = num + "@s.whatsapp.net";
      try {
        // choose type by mime
        let messagePayload = {};
        if (mimeType.startsWith("image/")) messagePayload.image = { buffer, caption: caption || "" };
        else if (mimeType.startsWith("video/")) messagePayload.video = { buffer, caption: caption || "" };
        else messagePayload.document = { url: req.file.path, mimetype: mimeType, fileName: req.file.originalname };

        await socket.sendMessage(jid, messagePayload);
        results.push({ to: num, status: "sent" });
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        results.push({ to: num, status: "failed", error: err.message || err.toString() });
      }
    }

    // cleanup file
    try { fs.unlinkSync(req.file.path); } catch(e){}

    res.json({ total: numbers.length, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upload or send media" });
  }
});

// Bulk text endpoint (accepts numbers array in body)
app.post("/send-bulk", async (req, res) => {
  try {
    if (!isReady) return res.status(400).json({ error: "WhatsApp not ready" });
    const { message, numbers, delayMs } = req.body;
    if (!message) return res.status(400).json({ error: "message is required" });
    if (!numbers || numbers.length === 0) return res.status(400).json({ error: "numbers array is required" });

    const socket = await getSocket();
    const delay = delayMs || 2000;
    const results = [];

    for (const rawNum of numbers) {
      const num = rawNum.toString().replace(/\D/g, "");
      const jid = num + "@s.whatsapp.net";
      try {
        await socket.sendMessage(jid, { text: message });
        results.push({ to: num, status: "sent" });
        await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        results.push({ to: num, status: "failed", error: err.message || err.toString() });
      }
    }

    res.json({ total: numbers.length, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send bulk messages" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
