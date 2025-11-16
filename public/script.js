const qrStatus = document.getElementById("qrStatus");
const qrImage = document.getElementById("qrImage");
const generateQRBtn = document.getElementById("generateQR");

// Generate QR and check status
generateQRBtn.addEventListener("click", async () => {
    generateQRBtn.disabled = true;
    qrStatus.innerText = "⏳ Generating QR...";
    qrImage.style.display = "none";
    try {
        const res = await fetch("/get-qr");
        const blob = await res.blob();
        qrImage.src = URL.createObjectURL(blob);
        qrImage.style.display = "block";
        qrStatus.innerText = "📲 Scan QR code using WhatsApp";

        const interval = setInterval(async () => {
            const statusRes = await fetch("/status");
            const data = await statusRes.json();
            if (data.authenticated) {
                clearInterval(interval);
                qrStatus.innerText = "✅ WhatsApp Connected!";
                qrImage.style.display = "none";
                generateQRBtn.disabled = false;
            }
        }, 3000);
    } catch {
        qrStatus.innerText = "❌ Failed to load QR";
        generateQRBtn.disabled = false;
    }
});

// Bulk text
document.getElementById("bulkForm").addEventListener("submit", async e => {
    e.preventDefault();
    const message = document.getElementById("bulkMessage").value.trim();
    if (!message) return;
    document.getElementById("bulkResponse").innerText = "⏳ Sending...";
    const res = await fetch("/send-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
    });
    const data = await res.json();
    document.getElementById("bulkResponse").innerText =
        `✅ Sent ${data.results.filter(r => r.status === "sent").length} of ${data.total}`;
});

// Bulk media
document.getElementById("mediaForm").addEventListener("submit", async e => {
    e.preventDefault();
    const filePath = document.getElementById("filePath").value.trim();
    const caption = document.getElementById("caption").value.trim();
    if (!filePath) return;
    document.getElementById("mediaResponse").innerText = "⏳ Sending media...";
    const res = await fetch("/send-bulk-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, caption })
    });
    const data = await res.json();
    document.getElementById("mediaResponse").innerText =
        `✅ Sent ${data.results.filter(r => r.status === "sent").length} of ${data.total}`;
});

// Specific numbers text
document.getElementById("sendSpecificForm").addEventListener("submit", async e => {
    e.preventDefault();
    const message = document.getElementById("specificMessage").value.trim();
    const numbers = document.getElementById("specificNumbers").value
        .split(",").map(n => n.trim()).filter(n => n.length > 0);
    if (!message || numbers.length === 0) {
        document.getElementById("specificResponse").innerText = "⚠️ Enter message and numbers";
        return;
    }
    document.getElementById("specificResponse").innerText = "⏳ Sending...";
    const res = await fetch("/send-specific", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, numbers })
    });
    const data = await res.json();
    document.getElementById("specificResponse").innerText =
        `✅ Sent ${data.results.filter(r => r.status === "sent").length} of ${data.total}`;
});

// Specific numbers media
document.getElementById("sendSpecificMediaForm").addEventListener("submit", async e => {
    e.preventDefault();
    const numbers = document.getElementById("mediaNumbers").value.trim();
    const caption = document.getElementById("mediaCaption").value.trim();
    const file = document.getElementById("mediaFile").files[0];
    if (!file || !numbers) {
        document.getElementById("mediaSpecificResponse").innerText = "⚠️ Select file and numbers";
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("caption", caption);
    formData.append("numbers", numbers);

    document.getElementById("mediaSpecificResponse").innerText = "⏳ Sending media...";
    const res = await fetch("/send-specific-media", {
        method: "POST",
        body: formData
    });
    const data = await res.json();
    document.getElementById("mediaSpecificResponse").innerText =
        `✅ Sent ${data.results.filter(r => r.status === "sent").length} of ${data.total}`;
});
