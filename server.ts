import express from "express";
import path from "path";
import cron from "node-cron";
import fs from "fs";

// Use built-in fetch if available (Node 18+), else you'd need node-fetch.
// Since we are in Node 22, global fetch is available.

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Path to store server-side data for crons
const dataDir = process.env.DATA_DIR || process.cwd();
const DATA_FILE = path.resolve(dataDir, "server-data.json");

interface ServerData {
  users: {
    [userId: string]: {
      lineToken: string;
      lineUserId: string;
      dailyReminderTime?: string;
      meetings: any[];
    };
  };
}

function loadData(): ServerData {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(content);
    } catch (e) {
      return { users: {} };
    }
  }
  return { users: {} };
}

function saveData(data: ServerData) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// API to sync meetings and line settings from frontend
app.post("/api/sync", (req, res) => {
  const { userId, lineToken, lineUserId, dailyReminderTime, meetings } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const data = loadData();
  if (!data.users[userId]) {
    data.users[userId] = { lineToken: "", lineUserId: "", meetings: [] };
  }
  
  if (lineToken !== undefined) data.users[userId].lineToken = lineToken;
  if (lineUserId !== undefined) data.users[userId].lineUserId = lineUserId;
  if (dailyReminderTime !== undefined) data.users[userId].dailyReminderTime = dailyReminderTime;
  if (meetings !== undefined) data.users[userId].meetings = meetings;

  saveData(data);
  res.json({ success: true });
});

// API to load user data
app.get("/api/data/:userId", (req, res) => {
  const { userId } = req.params;
  const data = loadData();
  const user = data.users[userId] || { lineToken: "", lineUserId: "", dailyReminderTime: "08:00", meetings: [] };
  res.json(user);
});

// Helper to send Line Message
async function sendLineMessage(token: string, to: string, text: string) {
  if (!token || !to) return;
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        to: to,
        messages: [{ type: "text", text }]
      })
    });
    if (!response.ok) {
      console.error("LINE API Error:", await response.text());
    }
  } catch (error) {
    console.error("LINE request failed:", error);
  }
}

// API to trigger tests manually
app.post("/api/test-line", async (req, res) => {
  const { lineToken, lineUserId } = req.body;
  await sendLineMessage(lineToken, lineUserId, "【測試訊息】系統連線成功！");
  res.json({ success: true });
});

// CRON: Every minute to check for dynamic reminders and daily summaries
cron.schedule("* * * * *", async () => {
  const data = loadData();
  const now = new Date();
  
  for (const userId in data.users) {
    const user = data.users[userId];
    if (!user.lineToken || !user.lineUserId) continue;

// Process daily summaries
    const reminderTime = user.dailyReminderTime || "08:00";
    // Check if the current time matches the reminder time format HH:mm in Taiwan timezone (+08:00)
    // Convert current time to string "HH:mm"
    const localNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const currentHH = String(localNow.getUTCHours()).padStart(2, '0');
    const currentMM = String(localNow.getUTCMinutes()).padStart(2, '0');
    
    if (`${currentHH}:${currentMM}` === reminderTime) {
      const dateStr = localNow.toISOString().split('T')[0];
      const todaysMeetings = user.meetings.filter(m => m.date === dateStr && !m.isCompleted);
      
      if (todaysMeetings.length > 0) {
        todaysMeetings.sort((a, b) => a.time.localeCompare(b.time));
        let msg = `📅 【本日會議清單】 ${dateStr}\n\n`;
        todaysMeetings.forEach(m => {
          msg += `⏰ 時間: ${m.time}\n🏢 單位: ${m.units}\n📝 大綱: ${m.outline || '無'}\n---\n`;
        });
        await sendLineMessage(user.lineToken, user.lineUserId, msg.trim());
      }
    }

    const upcomingMeetings = user.meetings.filter(m => {
      if (m.isCompleted) return false;
      const remindMins = m.remindMinutes || 10;
      
      // Combine date and time (Taiwan time +08:00) into a Unix timestamp
      const meetingTimeStr = `${m.date}T${m.time}:00+08:00`;
      const meetingTimeMs = new Date(meetingTimeStr).getTime();
      
      // If the date format was invalid, skip to avoid NaN
      if (isNaN(meetingTimeMs)) return false;

      const triggerTimeMs = meetingTimeMs - (remindMins * 60000);
      
      const truncateToMin = (ms: number) => Math.floor(ms / 60000);
      return truncateToMin(now.getTime()) === truncateToMin(triggerTimeMs);
    });

    for (const m of upcomingMeetings) {
      const remindMins = m.remindMinutes || 10;
      let msg = `⚠️ 【會議即將開始提醒】\n\n您有一個會議將在 ${remindMins} 分鐘後開始：\n⏰ 時間: ${m.time}\n🏢 單位: ${m.units}\n📝 大綱: ${m.outline}\n📂 準備資料: ${m.preparation || '無'}`;
      await sendLineMessage(user.lineToken, user.lineUserId, msg);
    }
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
