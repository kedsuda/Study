import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

import { GoogleGenerativeAI } from "@google/generative-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = Array.from(new Set([
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "backend", ".env"),
  path.resolve(__dirname, ".env"),
  path.resolve(__dirname, "..", ".env")
]));

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false, quiet: true });
  }
}

const app = express();
const PORT = process.env.BACKEND_PORT || 3000;
const projectRoot = path.resolve(process.cwd(), "..");
let schedulerProcess = null;

app.use(express.json());

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  methods: ["GET","POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// =======================
// Upload Config
// =======================

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// =======================
// Gemini
// =======================

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const geminiModel = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || "gemini-2.0-flash"
});

// =======================
// Helpers
// =======================

const stripCodeFences = (text) => {
  if (!text) return "";
  return text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
};

const extractFirstJsonObject = (text) => {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const jsonText = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
};

const readFileAsBase64 = (filepath) => {
  return fs.readFileSync(filepath).toString("base64");
};

const geminiTranscribeAudio = async ({ filepath, mimeType, language = "th" }) => {
  const audioBase64 = readFileAsBase64(filepath);
  const prompt = `
ถอดเสียงเป็นข้อความภาษาไทยให้ถูกต้องและคงความหมายเดิมที่สุด

รูปแบบผลลัพธ์ (JSON เท่านั้น):
{
  "transcript": "..."
}
`;

  const geminiResponse = await geminiModel.generateContent([
    prompt,
    {
      inlineData: {
        data: audioBase64,
        mimeType: mimeType || "audio/wav"
      }
    }
  ]);

  const parsed = extractFirstJsonObject(geminiResponse.response.text());
  if (!parsed || !parsed.transcript) {
    throw new Error("Gemini transcription failed");
  }
  return parsed.transcript;
};

const normalizeScores = (scoresInput) => {
  if (!scoresInput) return [];
  if (Array.isArray(scoresInput)) {
    return scoresInput
      .map((item) => ({
        subject: String(item.subject || "").trim(),
        score: Number(item.score)
      }))
      .filter((item) => item.subject && Number.isFinite(item.score));
  }
  if (typeof scoresInput === "object") {
    return Object.entries(scoresInput)
      .map(([subject, score]) => ({
        subject: String(subject).trim(),
        score: Number(score)
      }))
      .filter((item) => item.subject && Number.isFinite(item.score));
  }
  return [];
};

const startLaravelScheduler = () => {
  if (schedulerProcess) return;

  schedulerProcess = spawn("php", ["artisan", "schedule:work"], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
    env: process.env,
    windowsHide: true
  });

  schedulerProcess.on("error", (error) => {
    console.error("[scheduler] failed to start:", error.message);
    schedulerProcess = null;
  });

  schedulerProcess.on("exit", (code) => {
    console.warn(`[scheduler] stopped with code ${code ?? "unknown"}`);
    schedulerProcess = null;
  });
};

const stopLaravelScheduler = () => {
  if (!schedulerProcess) return;
  schedulerProcess.kill();
  schedulerProcess = null;
};


// =======================
// API
// =======================

app.post("/ai/summarize/audio", upload.single("audio"), async (req,res)=>{

  let filepath = null;

  try{

    if(!req.file){
      return res.status(400).json({
        error:"No audio file uploaded"
      });
    }

    filepath = req.file.path;

    // =======================
    // Speech Recognition (Gemini)
    // =======================
    const transcript = await geminiTranscribeAudio({
      filepath,
      mimeType: req.file.mimetype,
      language: "th"
    });

    if(!transcript || transcript.trim().length === 0){

      return res.status(400).json({
        error:"Speech recognition failed"
      });

    }

    // =======================
    // Gemini Summary
    // =======================

    const prompt = `
สรุปเนื้อหาการเรียนจากข้อความต่อไปนี้ให้เป็น bullet points เข้าใจง่าย

ข้อความ:
${transcript}

รูปแบบผลลัพธ์:
- หัวข้อสำคัญ
- แนวคิดหลัก
- เนื้อหาที่ต้องจำ
`;

    const geminiResponse = await geminiModel.generateContent(prompt);

    const summary = geminiResponse.response.text();

    // =======================

    res.json({
      transcript,
      summary
    });

  }
  catch(error){

    console.error("AI ERROR:",error);

    res.status(500).json({
      error:"AI processing failed",
      detail:error.message
    });

  }
  finally{

    if(filepath && fs.existsSync(filepath)){
      fs.unlinkSync(filepath);
    }

  }

});


app.post("/ai/analyze/career/audio", upload.single("audio"), async (req, res) => {
  let filepath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    filepath = req.file.path;

    // Speech Recognition (Gemini)
    const transcript = await geminiTranscribeAudio({
      filepath,
      mimeType: req.file.mimetype,
      language: "th"
    });

    if (!transcript || transcript.trim().length === 0) {
      return res.status(400).json({ error: "Speech recognition failed" });
    }

    // Gemini Career Analysis
    const prompt = `
คุณคือผู้เชี่ยวชาญด้านการให้คำปรึกษาอาชีพ (Career Counselor) จากข้อความต่อไปนี้ ซึ่งเป็นเสียงสนทนาของนักเรียน/นักศึกษา ให้คุณทำการวิเคราะห์และแนะนำอาชีพที่เหมาะสม

ข้อความ:
"${transcript}"

**คำสั่ง:**
1.  **วิเคราะห์บุคลิกภาพ (Personality Analysis):** จากบทสนทนา ให้วิเคราะห์ลักษณะนิสัย บุคลิกภาพ และทัศนคติของผู้พูด
2.  **วิเคราะห์ทักษะและความสนใจ (Skill and Interest Analysis):** ระบุทักษะ (Hard Skills/Soft Skills) และความสนใจที่ผู้พูดแสดงออกมา
3.  **แนะนำอาชีพ (Career Recommendations):** จากการวิเคราะห์ข้างต้น ให้แนะนำอาชีพที่เหมาะสม 3-5 อาชีพ พร้อมทั้งให้เหตุผลโดยละเอียดว่าทำไมอาชีพเหล่านั้นจึงเหมาะสมกับผู้พูด โดยอ้างอิงจากบุคลิกภาพและทักษะที่วิเคราะห์ได้

**รูปแบบผลลัพธ์ (Markdown):**

### **การวิเคราะห์เพื่อแนะนำอาชีพ**

**1. การวิเคราะห์บุคลิกภาพ:**
*   (สิ่งที่คุณวิเคราะห์ได้จากบทสนทนา)
*   ...

**2. การวิเคราะห์ทักษะและความสนใจ:**
*   **ทักษะ:**
    *   (ระบุทักษะที่พบ)
*   **ความสนใจ:**
    *   (ระบุความสนใจที่พบ)

**3. อาชีพที่แนะนำ:**
*   **1. [ชื่ออาชีพ]:**
    *   **เหตุผล:** (อธิบายว่าทำไมอาชีพนี้จึงเหมาะสม)
*   **2. [ชื่ออาชีพ]:**
    *   **เหตุผล:** (อธิบายว่าทำไมอาชีพนี้จึงเหมาะสม)
*   ...
`;

    const geminiResponse = await geminiModel.generateContent(prompt);
    const analysis = geminiResponse.response.text();

    res.json({
      transcript,
      analysis
    });

  } catch (error) {
    console.error("AI CAREER ANALYSIS ERROR:", error);
    res.status(500).json({
      error: "AI career analysis failed",
      detail: error.message
    });
  } finally {
    if (filepath && fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  }
});

app.post("/ai/analyze/career/scores", async (req, res) => {
  try {
    const scores = normalizeScores(req.body?.scores);

    if (!scores.length) {
      return res.status(400).json({
        error: "No scores provided",
        detail: "Expected scores as an array or object"
      });
    }

    const scoreLines = scores
      .map((item) => `- ${item.subject}: ${item.score}`)
      .join("\n");

    const prompt = `
คุณคือผู้เชี่ยวชาญด้านการให้คำปรึกษาอาชีพ (Career Counselor)
จากคะแนนสอบรายวิชาของนักเรียน/นักศึกษา ให้ทำการวิเคราะห์จุดแข็ง
และแนะนำอาชีพที่เหมาะสม 3-5 อาชีพ พร้อมเหตุผล

คะแนนสอบ:
${scoreLines}

รูปแบบผลลัพธ์ (JSON เท่านั้น):
{
  "strengths": ["จุดแข็งที่สรุปได้"],
  "gaps": ["สิ่งที่ควรพัฒนาเพิ่มเติม"],
  "recommendations": [
    {
      "career": "ชื่ออาชีพ",
      "reason": "เหตุผลโดยสรุป",
      "score": 0-100
    }
  ]
}
`;

    const geminiResponse = await geminiModel.generateContent(prompt);
    const parsed = extractFirstJsonObject(geminiResponse.response.text());

    if (!parsed || !Array.isArray(parsed.recommendations)) {
      return res.status(500).json({
        error: "AI career analysis failed",
        detail: "Invalid JSON response from Gemini"
      });
    }

    res.json(parsed);
  } catch (error) {
    console.error("AI CAREER SCORE ANALYSIS ERROR:", error);
    res.status(500).json({
      error: "AI career analysis failed",
      detail: error.message
    });
  }
});

// =======================

app.get("/",(req,res)=>{
  res.send("AI Voice Summary API Running");
});

// =======================

const server = app.listen(PORT,()=>{
  console.log(`AI Server running on port ${PORT}`);
});

const shutdown = () => {
  stopLaravelScheduler();
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
