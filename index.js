import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// ================================
// ⚙️ ENV ค่า config
// ================================
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_TOKEN = process.env.LINE_CHANNEL_TOKEN;
const WATSONX_API_KEY = process.env.WATSONX_API_KEY;
const PORT = process.env.PORT || 3000;

// Watsonx Orchestrate
const API_URL = "https://api.dl.watson-orchestrate.ibm.com";
const INSTANCE_ID = "20251009-0345-0487-507c-160b3a16c747";
const IAM_URL = "https://iam.platform.saas.ibm.com/siusermgr/api/1.0/apikeys/token";

// Agent ที่คุณใช้กับ Orchestrate
const AGENT_ID = "d880f3f0-9b4c-4be8-809b-1ce7edc8de23";
const AGENT_ENV_ID = "b0c4b559-9aaa-4e2d-8574-248ff7cd19aa";

// ================================
// 🧩 LINE Signature Verification
// ================================
function verifySignature(req) {
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === req.headers["x-line-signature"];
}

// ================================
// 🔑 Function: Get IAM Token
// ================================
async function getIamToken() {
  const response = await fetch(IAM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: WATSONX_API_KEY,
      grant_type: "urn:ibm:params:oauth:grant-type:apikey",
    }),
  });

  const data = await response.json();
  return data.access_token;
}

// ================================
// 💬 Function: Send text to Watsonx Agent
// ================================
async function sendToWatsonX(message) {
  const token = await getIamToken();

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
  const reply = data.output?.text || "❗ WatsonX ไม่สามารถตอบกลับได้";
  return reply;
}

// ================================
// 🚦 Start Express App
// ================================
const app = express();
app.use(express.json());

// ================================
// 📩 LINE Webhook
// ================================
app.post("/webhook", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(403).send("Invalid signature");
  }

  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;

      // 1) ส่งข้อความไป WatsonX
      const watsonReply = await sendToWatsonX(userMessage);

      // 2) ส่งกลับ LINE
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
    }
  }

  return res.status(200).send("OK");
});

// ================================
// 🟢 Start Server
// ================================
app.listen(PORT, () => {
  console.log("🚀 LINE bot server running on port " + PORT);
});
