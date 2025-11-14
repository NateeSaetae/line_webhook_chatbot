// index.js

// โค้ด Node.js สำหรับเชื่อมต่อ LINE OA กับ watsonx Orchestrate Agent
// โดยมีการจัดการ Authentication (Token Exchange) และ Session (Thread ID)

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

// --- 2. ตั้งค่า watsonx Orchestrate ---
// *** แก้ไข: ลบช่องว่างที่อยู่หน้า URL ออกเพื่อให้ Request ถูกต้อง ***
const WX_ORCHESTRATE_BASE_URL = 'https://api.dl.watson-orchestrate.ibm.com/instances/20251009-0345-0487-507c-160b3a16c747'; 
const WX_PROJECT_ID = 'b0c4b559-9aaa-4e2d-8574-248ff7cd19aa';
const WX_AGENT_ID = 'd880f3f0-9b4c-4be8-809b-1ce7edc8de23';

// ตัวแปรสำหรับจัดการ Session และ Token
const userSessionMap = new Map();
let IAM_ACCESS_TOKEN = null;
let TOKEN_EXPIRY_TIME = 0; // Unix Timestamp (ms)
const TOKEN_REFRESH_LEEWAY = 300000; // 5 นาที (300,000 ms) ก่อนหมดอายุจริงจะ Refresh

// --- ฟังก์ชัน 1: สร้างหรือ Refresh Access Token (Token Exchange) ---
async function getValidAccessToken() {
    // 1. ตรวจสอบว่า Token ยังไม่หมดอายุ
    if (IAM_ACCESS_TOKEN && Date.now() < TOKEN_EXPIRY_TIME - TOKEN_REFRESH_LEEWAY) {
        return IAM_ACCESS_TOKEN;
    }

    console.log("[AUTH] Refreshing IAM Access Token...");
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
        TOKEN_EXPIRY_TIME = Date.now() + (response.data.expires_in * 1000);

        console.log("[AUTH] Access Token refreshed successfully. Expires in:", response.data.expires_in, "seconds.");
        return IAM_ACCESS_TOKEN;

    } catch (error) {
        console.error("[AUTH] CRITICAL ERROR: Failed to refresh IAM Access Token:", error.response ? error.response.data : error.message);
        throw new Error("Authentication failed with IBM IAM Service. Please check WATSONX_API_KEY.");
    }
}


// --- ฟังก์ชัน 2: เรียก watsonx Agent โดยใช้ Token ที่ถูกต้อง ---
async function getWatsonXResponse(userId, userMessage) {
    // 1. รับ Access Token ที่ถูกต้องก่อน
    let accessToken;
    try {
        accessToken = await getValidAccessToken();
    } catch (e) {
        return e.message;
    }

    const threadId = userSessionMap.get(userId);
    const url = `${WX_ORCHESTRATE_BASE_URL}/projects/${WX_PROJECT_ID}/agent_runs`;

    console.log(`[USER: ${userId}] Sending message to watsonx Orchestrate. Thread ID: ${threadId || 'New'}`);
    
    try {
        // เพิ่ม Timeout 10 วินาทีเพื่อจัดการ Request ที่ค้าง
        const response = await axios.post(url, { 
            agent_id: WX_AGENT_ID,
            input: {
                message: userMessage,
                ...(threadId && { thread_id: threadId }) // ส่ง thread_id ไปด้วยหากมี
            },
        }, {
            timeout: 10000, // 10 วินาที
            headers: {
                // ใช้ Access Token ที่แลกมา
                'Authorization': `Bearer ${accessToken}`, 
                'Content-Type': 'application/json',
            }
        });

        // 2. บันทึก Thread ID ใหม่เพื่อใช้ในครั้งต่อไป
        const newThreadId = response.data?.thread_id; 
        if (newThreadId) {
            userSessionMap.set(userId, newThreadId);
            console.log(`[USER: ${userId}] Session/Thread ID updated: ${newThreadId}`);
        }

        // 3. ดึงข้อความตอบกลับจาก Response
        const agentResponseText = response.data?.output?.response 
                                  || response.data?.output?.messages?.[0]?.text 
                                  || "ไม่สามารถรับคำตอบจาก watsonx ได้ (รูปแบบ Response ผิดปกติ)";
        
        console.log(`[AGENT] Response Text: ${agentResponseText.substring(0, 100)}...`);
        return agentResponseText;

    } catch (error) {
        // Log Error อย่างละเอียดมากยิ่งขึ้นเพื่อหาสาเหตุที่ไม่ทราบ
        const status = error.response?.status || 'N/A';
        let errorMessage = 'Network or Request failed.';

        if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
             errorMessage = 'Request timed out after 10 seconds (ECONNABORTED)';
        } else if (error.response) {
            // Error มาจาก Server (4xx, 5xx)
            const data = JSON.stringify(error.response.data);
            console.error(`[API ERROR] Status: ${status}. Data: ${data}`);
            errorMessage = `watsonx API responded with status ${status}. Check console log for data.`;
        } else {
            // Error อื่นๆ (DNS, Network, etc.)
            console.error(`[API ERROR] Code: ${error.code || 'N/A'}. Message: ${error.message}`);
            errorMessage = `A low-level error occurred: ${error.message}`;
        }
        
        // จัดการ Error Code ที่เป็นไปได้
        if (status === 404) {
            return "ขออภัยค่ะ API Endpoint หรือ Project ID/Agent ID ที่ระบุไม่ถูกต้อง (404)";
        }
        if (status === 403) {
             return "ขออภัยค่ะ Access Token มีสิทธิ์ไม่เพียงพอในการเข้าถึง Project นี้ (403)";
        }
        if (status === 401) {
            IAM_ACCESS_TOKEN = null; 
            return "การยืนยันตัวตนล้มเหลวอีกครั้ง กรุณาตรวจสอบสิทธิ์ของ API Key (401)";
        }
        
        // ส่งข้อความ Error ที่ละเอียดขึ้นกลับไป
        return `ขออภัยค่ะ เกิดข้อผิดพลาดในการเชื่อมต่อกับ Agent: ${errorMessage}`;
    }
}


// --- 3. Webhook Handler ---
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }
    
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


// --- 4. ตั้งค่า Express Server ---
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