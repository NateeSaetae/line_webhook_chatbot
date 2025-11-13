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
  const tokenResp = await fetch("https://iam.cloud.ibm.com/identity/token", {
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
        const accessToken = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndhdHNvbl9vcmNoZXN0cmF0ZSJ9.eyJmYW1pbHlfbmFtZSI6IlNyaWNoYW5hIiwiZ2l2ZW5fbmFtZSI6IlRhcmF0aXAiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJ0YXJhdHNyaUBtZXRyb3N5c3RlbXMuY28udGgiLCJpYXQiOjE3NjMwMjI2MDcsImlibVVuaXF1ZUlkIjoiNjk4MDAwUlI3NSIsImlzdiI6Imh0dHBzOi8vd28taWJtLXByb2QudmVyaWZ5LmlibS5jb20vb2lkYy9lbmRwb2ludC9kZWZhdWx0IiwianRpIjoidlU0alF1YzlzZmQ3U3BmcGtRc0Z6OHlJR0xtYTZIIiwibmFtZSI6IlRhcmF0aXAgU3JpY2hhbmEiLCJ1c2VyRmluZ2VycHJpbnQiOiI0MmY1YTBkYzk2ZDVkMDZlOTA4NmIyNDcwYmIyYWNiMGZhMzUzZjMxZDYwMDliMjFiN2VmMDFlM2VhMDlhNDg0Iiwid29Vc2VySWQiOiI2NDMwMDVNV1VaIiwid29UZW5hbnRJZCI6IjIwMjUxMDAyLTA4MTItMDkxMy04MGU5LTM0MmJmYjI4ZWM4MV8yMDI1MTAwOS0wMzQ1LTA0ODctNTA3Yy0xNjBiM2ExNmM3NDciLCJ3b1RlbmFudFN0YXR1cyI6IkFDVElWRSIsInJlYWxtTmFtZSI6ImNsb3VkSWRlbnRpdHlSZWFsbSIsImVtYWlsIjoidGFyYXRzcmlAbWV0cm9zeXN0ZW1zLmNvLnRoIiwiZ3JvdXBzIjpbXSwicm9sZXMiOlsiYWRtaW4iXSwiZXhwIjoxNzYzMDIzNTA3LCJhdWQiOiJmMzY4MDgzMi0zODE5LTQxZmYtOWJkZC05YWY0MDc3ZDFhZmMiLCJpc3MiOiJodHRwczovL3dvLWlibS1wcm9kLnZlcmlmeS5pYm0uY29tL29pZGMvZW5kcG9pbnQvZGVmYXVsdCIsInN1YiI6IjY0MzAwNU1XVVoifQ.afTNpcaX7fChJrsck4OJmevqraNE22n4-rL3QFwVbd1EO6ZyXspnRIfKcZTdiivTkVHkJnkEn1c7HOYL949W2UlZ5dF3pZuoQbInPF9-RK--cnsQlqv5b0i0H2Xwq3OO7NpQSK0-qJnAfHCj6Jn2yCsDzx1t8guTkoADl2njmHfooJ903Wr2R-ym6Yfu-YFXH4cJpZt0YWLHbLPT3Pb5FHnrnTAAHYa7wfsUbKxgV0Tzn_fm-KcQSmSprOWY1m6AFg85gNlBaFNJm4nphJxyHR5wEBP19zwEIKx_CREVuckqagQ7eYOQ7NlklkBb6xxhlvoN0J7QoaNRizmUxedy3g"
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
