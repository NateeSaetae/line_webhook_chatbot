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

const WX_ORCHESTRATE_BASE_URL = 'https://api.dl.watson-orchestrate.ibm.com/instances/20251009-0345-0487-507c-160b3a16c747'; 
const WX_PROJECT_ID = 'b0c4b559-9aaa-4e2d-8574-248ff7cd19aa';
const WX_AGENT_ID = 'd880f3f0-9b4c-4be8-809b-1ce7edc8de23';

const userSessionMap = new Map();

let IAM_ACCESS_TOKEN = null;
let TOKEN_EXPIRY_TIME = 0; // Unix Timestamp

// --- ฟังก์ชัน 1: สร้างหรือ Refresh Access Token ---
async function getValidAccessToken() {
    // 1. ตรวจสอบว่า Token ยังไม่หมดอายุ (เช่น ยังเหลือเวลาใช้งาน > 5 นาที)
    if (IAM_ACCESS_TOKEN && Date.now() < TOKEN_EXPIRY_TIME - 300000) { // 300000 ms = 5 นาที
        return IAM_ACCESS_TOKEN;
    }

    console.log("Refreshing IAM Access Token...");
    const IAM_URL = 'https://iam.cloud.ibm.com/identity/token';

    try {
        const response = await axios.post(IAM_URL, 
            new URLSearchParams({
                'grant_type': 'urn:ibm:params:oauth:grant-type:apikey',
                'apikey': process.env.WATSONX_API_KEY
            }).toString(), 
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                }
            }
        );

        IAM_ACCESS_TOKEN = response.data.access_token;
        TOKEN_EXPIRY_TIME = Date.now() + (response.data.expires_in * 1000); // แปลงเป็น ms

        console.log("Access Token refreshed successfully.");
        return IAM_ACCESS_TOKEN;

    } catch (error) {
        console.error("CRITICAL ERROR: Failed to refresh IAM Access Token:", error.response ? error.response.data : error.message);
        throw new Error("Authentication failed with IBM IAM Service.");
    }
}


// --- ฟังก์ชัน 2: เรียก watsonx Agent โดยใช้ Token ที่ถูกต้อง ---
async function getWatsonXResponse(userId, userMessage) {
    // 1. รับ Access Token ที่ถูกต้องก่อน
    const accessToken = await getValidAccessToken();

    // ... (ส่วนการดึง threadId และ URL เหมือนเดิม) ...
    
    try {
        const response = await axios.post(url, {
            // ... (Payload เหมือนเดิม) ...
        }, {
            headers: {
                // *** ใช้ Access Token ที่แลกมาแทน API Key โดยตรง ***
                'Authorization': `Bearer ${accessToken}`, 
                'Content-Type': 'application/json',
            }
        });

        // ... (ส่วนการจัดการ Response และ Session เหมือนเดิม) ...

    } catch (error) {
        // ... (ส่วนจัดการ Error) ...
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