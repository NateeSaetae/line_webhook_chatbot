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

// ✅ Webhook endpoint ที่ LINE จะเรียก
app.post("/webhook", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(403).send("Invalid signature");
  }

  const events = req.body.events;
  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userText = event.message.text;

      // 🔹 เรียก Watsonx Assistant API (ตัวอย่างแบบ assistant รุ่นเก่า)
      const watsonResp = await fetch(
  "https://api.dl.watson-orchestrate.ibm.com/instances/20251009-0345-0487-507c-160b3a16c747/v1/messages",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Basic " + Buffer.from("apikey:" + process.env.WATSONX_API_KEY).toString("base64"),
    },
    body: JSON.stringify({
      input: {
        text: userText
      }
    })
  }
);

const watsonData = await watsonResp.json();
console.log(watsonData);
const watsonReply =
  watsonData.output?.generic?.[0]?.text ||
  watsonData.output?.text ||
  watsonData.output?.message ||
  "ขออภัย ฉันไม่เข้าใจคำถามนี้ 😅";


      // 🔹 ตอบกลับไป LINE
      try {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.LINE_CHANNEL_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: watsonReply }],
    }),
  });
} catch (err) {
  console.error("LINE reply error:", err);
}

    }
  }

  res.status(200).send("OK");
});

app.listen(process.env.PORT, () =>
  console.log(`🚀 LINE webhook running on port ${process.env.PORT}`)
);
