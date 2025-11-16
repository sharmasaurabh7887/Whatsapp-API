const express = require("express");
const { Client, MessageMedia, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
app.use(express.json());
app.use(express.static("public"));

let qrCodeData = null;
let isReady = false;

// File upload setup
const upload = multer({ dest: "uploads/" });

// WhatsApp Client Setup
const client = new Client({
    puppeteer: {
        headless: false, // important for QR code stability
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--single-process",
            "--disable-gpu"
        ],
    },
    authStrategy: new LocalAuth(),
});

client.on("qr", (qr) => {
    qrCodeData = qr;
    console.log("🔑 QR received, scan using WhatsApp");
});

client.on("ready", () => {
    isReady = true;
    console.log("✅ WhatsApp is ready!");
});

client.on("authenticated", () => console.log("🔐 Authenticated"));
client.on("auth_failure", (msg) => console.error("❌ Auth failed:", msg));
client.on("disconnected", () => {
    isReady = false;
    console.log("❌ WhatsApp disconnected!");
});

client.initialize();

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

// Bulk text
app.post("/send-bulk", async (req, res) => {
    if (!isReady) return res.status(400).json({ error: "WhatsApp not ready" });
    const { message, delayMs } = req.body;
    if (!message) return res.status(400).json({ error: "message is required" });

    const contacts = await client.getContacts();
    const users = contacts.filter((c) => c.isUser);
    const delay = delayMs || 2000;

    const results = [];
    for (const c of users) {
        try {
            await client.sendMessage(c.id._serialized, message);
            results.push({ to: c.id.user, status: "sent" });
            await new Promise((r) => setTimeout(r, delay));
        } catch (err) {
            results.push({ to: c.id.user, status: "failed", error: err.message });
        }
    }

    res.json({ total: users.length, results });
});

// Bulk media
app.post("/send-bulk-media", async (req, res) => {
    if (!isReady) return res.status(400).json({ error: "WhatsApp not ready" });
    const { caption, filePath, delayMs } = req.body;
    if (!filePath) return res.status(400).json({ error: "filePath is required" });

    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) return res.status(400).json({ error: "File not found" });

    const media = MessageMedia.fromFilePath(absPath);
    const contacts = await client.getContacts();
    const users = contacts.filter((c) => c.isUser);
    const delay = delayMs || 2000;

    const results = [];
    for (const c of users) {
        try {
            await client.sendMessage(c.id._serialized, media, { caption: caption || "" });
            results.push({ to: c.id.user, status: "sent" });
            await new Promise((r) => setTimeout(r, delay));
        } catch (err) {
            results.push({ to: c.id.user, status: "failed", error: err.message });
        }
    }

    res.json({ total: users.length, results });
});

// Send to specific numbers (text)
app.post("/send-specific", async (req, res) => {
    if (!isReady) return res.status(400).json({ error: "WhatsApp not ready" });
    const { message, numbers } = req.body;
    if (!message || !numbers || numbers.length === 0)
        return res.status(400).json({ error: "message and numbers are required" });

    const results = [];
    for (const num of numbers) {
        const id = `${num}@c.us`;
        try {
            await client.sendMessage(id, message);
            results.push({ to: num, status: "sent" });
            await new Promise((r) => setTimeout(r, 1500));
        } catch (err) {
            results.push({ to: num, status: "failed", error: err.message });
        }
    }
    res.json({ total: numbers.length, results });
});

// Send media to specific numbers (file upload)
app.post("/send-specific-media", upload.single("file"), async (req, res) => {
    if (!isReady) return res.status(400).json({ error: "WhatsApp not ready" });

    try {
        const { caption, numbers } = req.body;
        let parsedNumbers = numbers;
        if (typeof numbers === "string") parsedNumbers = numbers.split(",").map(n => n.trim());

        if (!req.file) return res.status(400).json({ error: "File is required" });
        if (!parsedNumbers || parsedNumbers.length === 0)
            return res.status(400).json({ error: "Numbers are required" });

        const media = MessageMedia.fromFilePath(req.file.path);
        const results = [];

        for (const num of parsedNumbers) {
            const id = `${num}@c.us`;
            try {
                await client.sendMessage(id, media, { caption: caption || "" });
                results.push({ to: num, status: "sent" });
                await new Promise(r => setTimeout(r, 1500));
            } catch (err) {
                results.push({ to: num, status: "failed", error: err.message });
            }
        }

        // Delete uploaded file after sending
        fs.unlinkSync(req.file.path);

        res.json({ total: parsedNumbers.length, results });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to upload or send media to specific numbers." });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});