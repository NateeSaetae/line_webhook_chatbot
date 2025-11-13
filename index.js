const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const express = require("express");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(express.json());

// ✅ ตรวจสอบว่า request มาจาก LINE จริง
function verifySignature(req) {
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === req.headers["x-line-signature"];
}

// ✅ ดึง access token จาก IBM IAM API (ใช้กับ Watsonx)
async function getWatsonToken() {
  const tokenResp = await fetch("https://iam.us-east.cloud.ibm.com/identity/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  },
  body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${process.env.WATSONX_API_KEY}`,
});


  if (!tokenResp.ok) {
    console.error("❌ Failed to get Watson token:", tokenResp.status);
    return null;
  }

  const tokenData = await tokenResp.json();
  return tokenData.access_token;
}

// ✅ Webhook endpoint ที่ LINE จะเรียก
app.post("/webhook", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(403).send("Invalid signature");
  }

  const events = req.body.events;
  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userText = event.message.text;

      try {
        // 🔹 ขอ Bearer Token จาก IBM IAM
        const accessToken = await getWatsonToken();
        if (!accessToken) {
          throw new Error("No access token from IBM IAM");
        }

        // 🔹 เรียก Watsonx Orchestrate API ด้วย Bearer Token
        const watsonResp = await fetch(
        "https://api.dl.watson-orchestrate.ibm.com/instances/20251009-0345-0487-507c-160b3a16c747/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            agent: {
              id: "d880f3f0-9b4c-4be8-809b-1ce7edc8de23",
              environmentId: "b0c4b559-9aaa-4e2d-8574-248ff7cd19aa",
            },
            input: {
              type: "text",
              text: userText,
            },
          }),
        }
      );

        const watsonData = await watsonResp.json();
        console.log("🧠 Watsonx full response:", JSON.stringify(watsonData, null, 2));

        const watsonReply =
          watsonData.output?.generic?.[0]?.text ||
          watsonData.output?.text ||
          watsonData.result?.message ||
          "ขออภัย ฉันไม่เข้าใจคำถามนี้ 😅";

        // 🔹 ตอบกลับไป LINE
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
      }
    }
  }

  res.status(200).send("OK");
});

// ✅ รองรับ PORT จาก Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 LINE webhook running on port ${PORT}`));
