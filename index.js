process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_TOKEN = process.env.LINE_CHANNEL_TOKEN;
const WATSONX_API_KEY = process.env.WATSONX_API_KEY;
const PORT = process.env.PORT || 3000;

// Watsonx Orchestrate
const API_URL = "https://api.dl.watson-orchestrate.ibm.com";
const INSTANCE_ID = "20251009-0345-0487-507c-160b3a16c747";
const IAM_URL = "https://iam.cloud.ibm.com/identity/token";

const AGENT_ID = "d880f3f0-9b4c-4be8-809b-1ce7edc8de23";
const AGENT_ENV_ID = "b0c4b559-9aaa-4e2d-8574-248ff7cd19aa";

// ================================
// 🧩 Verify LINE signature
// ================================
function verifySignature(req) {
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");

  const isValid = hash === req.headers["x-line-signature"];

  console.log("🔐 Verify Signature:", isValid ? "✅ VALID" : "❌ INVALID");

  return isValid;
}

// ================================
// 🔑 Get Watsonx IAM Token
// ================================
async function getIamToken() {
  console.log("🔑 Getting WatsonX DL IAM token...");

  try {
    const response = await fetch(
      "https://iam.platform.saas.ibm.com/siusermgr/api/1.0/apikeys/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          apikey: WATSONX_API_KEY
        })
      }
    );

    const data = await response.json();

    if (data.token) {
      console.log("✅ DL IAM Token retrieved successfully");
      return data.token;  // << ใช้ token ไม่ใช่ access_token
    }

    console.log("❌ Failed to get DL IAM token:", data);
    return null;

  } catch (error) {
    console.log("🔥 ERROR getting DL IAM token:", error);
    return null;
  }
}



// ================================
// 💬 Send user text to WatsonX Agent
// ================================
async function sendToWatsonX(message) {
  const token = await getIamToken();
  if (!token) {
    console.log("❌ Cannot send to WatsonX — no IAM token");
    return "⚠️ WatsonX authentication error";
  }

  console.log("📨 Sending to WatsonX:", message);

  try {
    const response = await fetch(
      `${API_URL}/api/v1/assistants/${INSTANCE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentId: AGENT_ID,
          agentEnvironmentId: AGENT_ENV_ID,
          input: { text: message },
        }),
      }
    );

    const data = await response.json();

    console.log("🤖 WatsonX Response:", JSON.stringify(data, null, 2));

    const reply = data.output?.text || "⚠️ WatsonX ไม่มีข้อความตอบกลับ";
    return reply;

  } catch (error) {
    console.log("🔥 ERROR sending to WatsonX:", error);
    return "⚠️ WatsonX error occurred";
  }
}

// ================================
// 📩 LINE Webhook Handler
// ================================
const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
  console.log("\n📥 Received webhook event");
  console.log(JSON.stringify(req.body, null, 2));

  if (!verifySignature(req)) {
    console.log("❌ Signature verification failed");
    return res.status(403).send("Invalid signature");
  }

  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;
      console.log("💬 User Message:", userMessage);

      // 1) Send text to WatsonX
      const watsonReply = await sendToWatsonX(userMessage);
      console.log("🤖 WatsonX Reply:", watsonReply);

      // 2) Reply back to LINE
      console.log("📤 Sending reply to LINE...");

      try {
        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LINE_CHANNEL_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            replyToken: event.replyToken,
            messages: [{ type: "text", text: watsonReply }],
          }),
        });

        console.log("✅ Reply sent to LINE successfully");

      } catch (error) {
        console.log("🔥 ERROR sending reply to LINE:", error);
      }
    }
  }

  res.status(200).send("OK");
});

// ================================
// 🟢 Start Server
// ================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
