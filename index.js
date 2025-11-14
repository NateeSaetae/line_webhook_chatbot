// index.js

require('dotenv').config(); // โหลดค่าจากไฟล์ .env

const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const axios = require('axios');

// --- 1. ตั้งค่า LINE Client ---
const config = {
    channelAccessToken: process.env.LINE_CHANNEL_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new Client(config);

// --- 2. ตั้งค่า watsonx Orchestrate ---
// URL และ Project ID (คุณต้องเปลี่ยนค่าเหล่านี้ให้ตรงกับ watsonx ของคุณ)
const WX_ORCHESTRATE_BASE_URL = 'https://dl.watson-orchestrate.ibm.com'; 
const WX_PROJECT_ID = 'b0c4b559-9aaa-4e2d-8574-248ff7cd19aa'; // ต้องใส่ Project ID จริงของคุณ
const WX_AGENT_ID = 'd880f3f0-9b4c-4be8-809b-1ce7edc8de23'; // ต้องใส่ Agent ID จริงของคุณ

// --- 3. ฟังก์ชันสำหรับเรียก watsonx Agent ---
async function getWatsonXResponse(userMessage) {
    console.log('Sending message to watsonx Orchestrate:', userMessage);

    const url = `${WX_ORCHESTRATE_BASE_URL}/projects/${WX_PROJECT_ID}/agent_runs`;

    try {
        const response = await axios.post(url, {
            // โครงสร้าง Payload สำหรับการรัน Agent อาจแตกต่างกันไป
            // ตรวจสอบเอกสาร API ของ watsonx Orchestrate สำหรับโครงสร้างที่ถูกต้อง
            agent_id: WX_AGENT_ID,
            input: {
                message: userMessage,
            },
            // เพิ่มการตั้งค่าอื่นๆ ตามต้องการ
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.WATSONX_API_KEY}`,
                'Content-Type': 'application/json',
                // อาจต้องมี Headers อื่นๆ เช่น IBM-Client-Id หากจำเป็น
            }
        });

        // ดึงข้อความตอบกลับจาก Response
        // ต้องปรับโค้ดนี้ตามโครงสร้าง Response ที่แท้จริงจาก API ของ watsonx
        const agentResponseText = response.data?.output?.response || "ไม่สามารถรับคำตอบจาก watsonx ได้";
        return agentResponseText;

    } catch (error) {
        console.error("Error calling watsonx Orchestrate API:", error.response ? error.response.data : error.message);
        return "ขออภัยค่ะ เกิดข้อผิดพลาดในการเชื่อมต่อกับ Agent";
    }
}


// --- 4. Webhook Handler ---
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userMessage = event.message.text;

    // 1. เรียก watsonx Agent เพื่อรับคำตอบ
    const replyText = await getWatsonXResponse(userMessage);

    // 2. ตอบกลับไปยัง LINE
    const replyMessage = {
        type: 'text',
        text: replyText,
    };

    return lineClient.replyMessage(event.replyToken, replyMessage);
}


// --- 5. ตั้งค่า Express Server ---
const app = express();
const PORT = process.env.PORT || 3000;

app.post('/webhook', middleware(config), (req, res) => {
    // req.body.events เป็น Array ของ Event ที่ส่งมาจาก LINE
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/webhook`);
});