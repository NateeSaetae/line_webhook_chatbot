// index.js

require('dotenv').config(); 

const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const axios = require('axios');

// --- 1. ตั้งค่า LINE Client ---
const config = {
    channelAccessToken: process.env.LINE_CHANNEL_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new Client(config);

// --- 2. ตั้งค่า watsonx Orchestrate (แก้ไข URL ที่ถูกต้อง) ---
// *** ต้องใช้ URL นี้ (หรือ URL ที่ถูกต้องจาก IBM Cloud/AWS) แทน URL ก่อนหน้านี้ ***
const WX_ORCHESTRATE_BASE_URL = ' https://api.dl.watson-orchestrate.ibm.com/instances/20251009-0345-0487-507c-160b3a16c747'; 
const WX_PROJECT_ID = 'b0c4b559-9aaa-4e2d-8574-248ff7cd19aa';
const WX_AGENT_ID = 'd880f3f0-9b4c-4be8-809b-1ce7edc8de23';

// *** 💡 การจัดการ Session/Thread ID 💡 ***
// สำหรับ Chatbot ที่ต้องการจดจำบริบท เราควรเก็บ Thread ID แยกตาม User ID (source.userId)
// ในตัวอย่างนี้ ใช้ Map เพื่อเก็บ session ชั่วคราวใน Memory
const userSessionMap = new Map();

// --- 3. ฟังก์ชันสำหรับเรียก watsonx Agent ---
async function getWatsonXResponse(userId, userMessage) {
    console.log(`[User: ${userId}] Sending message to watsonx Orchestrate: ${userMessage}`);

    // 1. ดึง Thread ID ถ้ามี
    const threadId = userSessionMap.get(userId);
    
    // 2. กำหนด URL ปลายทาง
    // Endpoint สำหรับ Agent Run
    const url = `${WX_ORCHESTRATE_BASE_URL}/projects/${WX_PROJECT_ID}/agent_runs`;

    try {
        const response = await axios.post(url, {
            agent_id: WX_AGENT_ID,
            input: {
                message: userMessage,
                // หากมี threadId อยู่แล้ว ให้ส่งไปด้วยเพื่อรักษา Session 
                ...(threadId && { thread_id: threadId })
            },
            // เพิ่มการตั้งค่าอื่นๆ เช่น model_settings, tools_config
        }, {
            headers: {
                // ใช้ IAM Key ที่คุณมีเป็น Bearer Token
                'Authorization': `Bearer ${process.env.WATSONX_API_KEY}`, 
                'Content-Type': 'application/json',
                // หากคุณกำลังรันแบบ Stateless หรือสร้าง Thread ใหม่ คุณอาจต้องระบุ Thread ID ใน Header:
                // 'X-THREAD-ID': threadId || 'new'
            }
        });

        // 3. บันทึก Thread ID ใหม่เพื่อใช้ในครั้งต่อไป
        // watsonx จะส่ง thread_id กลับมาใน Response หากมีการสร้างหรือใช้ Thread นั้น
        const newThreadId = response.data?.thread_id; 
        if (newThreadId) {
            userSessionMap.set(userId, newThreadId);
            console.log(`[User: ${userId}] Session/Thread ID updated: ${newThreadId}`);
        }

        // 4. ดึงข้อความตอบกลับจาก Response
        // โครงสร้าง Response อาจแตกต่างกัน แต่ทั่วไปจะอยู่ใน output
        const agentResponseText = response.data?.output?.response 
                                  || response.data?.output?.messages?.[0]?.text 
                                  || "ไม่สามารถรับคำตอบจาก watsonx ได้";
                                  
        return agentResponseText;

    } catch (error) {
        // Log Error อย่างละเอียด
        console.error(`[User: ${userId}] Error calling watsonx Orchestrate API:`, error.response ? error.response.data : error.message);
        
        // หากเกิด 401/403 (Unauthorized/Forbidden) อาจต้อง Refresh Token หรือตรวจสอบ IAM Key
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
             return "ขออภัยค่ะ การยืนยันตัวตนกับ watsonx ล้มเหลว กรุณาตรวจสอบ API Key/Token และ Project ID";
        }
        
        return "ขออภัยค่ะ เกิดข้อผิดพลาดในการเชื่อมต่อกับ Agent";
    }
}


// --- 4. Webhook Handler ---
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }
    
    // ดึง User ID จาก Event Source
    const userId = event.source.userId;
    const userMessage = event.message.text;

    // 1. เรียก watsonx Agent เพื่อรับคำตอบ
    const replyText = await getWatsonXResponse(userId, userMessage);

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