// ================================
// 📦 Import Libraries
// ================================
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

// ================================
// ⚙️ Config
// ================================
const app = express();
app.use(express.json());

const API_KEY = process.env.WATSONX_API_KEY;
const API_URL = "https://api.dl.watson-orchestrate.ibm.com";
const INSTANCE_ID = "20251009-0345-0487-507c-160b3a16c747";
const IAM_URL = "https://iam.cloud.ibm.com/identity/token";

// ================================
// 🧩 Function: Verify LINE Signature
// ================================
function verifySignature(req) {
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === req.headers["x-line-signature"];
}

// ================================
// 🔑 Function: Get IAM Token (เหมือน get_iam_token ใน Python)
// ================================
async function getIamToken() {
  console.log("🔹 Requesting IAM token...");
  const resp = await fetch(IAM_URL, {
    method: "POST",
    headers: { 
        // 1. 🔑 แก้ Content-Type ให้เป็น form-urlencoded
        "Content-Type": "application/x-www-form-urlencoded" 
    },
    // 2. 🔑 แก้ Body ให้เป็น String ในรูปแบบ form-urlencoded
    body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${API_KEY}`,
  });

  console.log("  Status:", resp.status);
  const data = await resp.json();
  console.log("  Response:", data);

  if (!resp.ok) throw new Error("Failed to get IAM token");
  if (!data.access_token) throw new Error("Token not found in IAM response");

  return data.access_token;
}

// ================================
// 🧠 Function: Disable Embed Security (เหมือน disable_embed_security ใน Python)
// ================================
async function disableEmbedSecurity(token) {
  console.log("\n🔹 Disabling embed security...");
  const url = `${API_URL}/instances/${INSTANCE_ID}/v1/embed/secure/config`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      public_key: "",
      client_public_key: "",
      is_security_enabled: false,
    }),
  });

  console.log("  Status:", resp.status);
  try {
    console.log("  Response JSON:", await resp.json());
  } catch {
    console.log("  Raw response:", await resp.text());
  }

  if (![200, 201].includes(resp.status)) {
    throw new Error("Failed to disable embed security");
  }
}

// ================================
// 💬 Function: Send message to Watsonx
// ================================
async function sendToWatsonx(token, userText) {
  const url = `${API_URL}/instances/${INSTANCE_ID}/v1/messages`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent: {
        id: "d880f3f0-9b4c-4be8-809b-1ce7edc8de23",
        environmentId: "b0c4b559-9aaa-4e2d-8574-248ff7cd19aa",
      },
      input: { type: "text", text: userText },
    }),
  });

  const data = await resp.json();
  console.log("🧠 Watsonx full response:", JSON.stringify(data, null, 2));
  return (
    data.output?.generic?.[0]?.text ||
    data.output?.text ||
    data.result?.message ||
    "ขออภัย ฉันไม่เข้าใจคำถามนี้ 😅"
  );
}

// ================================
// 🤖 LINE Webhook Endpoint
// ================================
app.post("/webhook", async (req, res) => {
  if (!verifySignature(req)) return res.status(403).send("Invalid signature");

  for (const event of req.body.events) {
    if (event.type === "message" && event.message.type === "text") {
      const userText = event.message.text;
      try {
        const token = await getIamToken();
        const watsonReply = await sendToWatsonx(token, userText);

        // ตอบกลับ LINE
        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}`,
          },
          body: JSON.stringify({
            replyToken: event.replyToken,
            messages: [{ type: "text", text: watsonReply }],
          }),
        });
      } catch (err) {
        console.error("❌ Error handling message:", err);
        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}`,
          },
          body: JSON.stringify({
            replyToken: event.replyToken,
            messages: [{ type: "text", text: "เกิดข้อผิดพลาดในการเชื่อมต่อ Watsonx 😢" }],
          }),
        });
      }
    }
  }

  res.status(200).send("OK");
});

// ================================
// 🚀 Start Server
// ================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`🚀 LINE webhook running on port ${PORT}`);

  // 🔹 ถ้าต้องการปิด security ตอน deploy (เหมือน Python)
  try {
    const token = await getIamToken();
    await disableEmbedSecurity(token);
    console.log("✅ Embed security disabled successfully.");
  } catch (err) {
    console.warn("⚠️ Could not disable embed security:", err.message);
  }
});
