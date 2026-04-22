import express from "express";
import path from "path";
import cron from "node-cron";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

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

// Function to fetch all data for cron jobs
async function loadData(): Promise<ServerData> {
  if (!supabaseUrl || !supabaseKey) return { users: {} };
  try {
    const { data, error } = await supabase.from('app_data').select('*');
    if (error) {
      console.error("Supabase loadData error:", error.message);
      return { users: {} };
    }
    const serverData: ServerData = { users: {} };
    if (data) {
      data.forEach(row => {
        serverData.users[row.user_id] = row.data;
      });
    }
    return serverData;
  } catch (e) {
    console.error(e);
    return { users: {} };
  }
}

// API to sync meetings and line settings from frontend
app.post("/api/sync", async (req, res) => {
  const { userId, lineToken, lineUserId, dailyReminderTime, meetings } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  try {
    // Fetch existing user data
    const { data: existingRow, error: fetchErr } = await supabase.from('app_data').select('data').eq('user_id', userId).single();
    let userData = existingRow?.data || { lineToken: "", lineUserId: "", meetings: [] };
    
    if (lineToken !== undefined) userData.lineToken = lineToken;
    if (lineUserId !== undefined) userData.lineUserId = lineUserId;
    if (dailyReminderTime !== undefined) userData.dailyReminderTime = dailyReminderTime;
    if (meetings !== undefined) userData.meetings = meetings;

    // Upsert back to Supabase
    const { error: upsertErr } = await supabase.from('app_data').upsert({ user_id: userId, data: userData });
    if (upsertErr) throw upsertErr;

    res.json({ success: true });
  } catch (error: any) {
    console.error("Supabase sync error:", error);
    res.status(500).json({ error: error.message });
  }
});

// API to load user data
app.get("/api/data/:userId", async (req, res) => {
  const { userId } = req.params;
  if (!supabaseUrl || !supabaseKey) {
    return res.json({ lineToken: "", lineUserId: "", dailyReminderTime: "08:00", meetings: [] });
  }

  try {
    const { data: existingRow } = await supabase.from('app_data').select('data').eq('user_id', userId).single();
    const user = existingRow?.data || { lineToken: "", lineUserId: "", dailyReminderTime: "08:00", meetings: [] };
    res.json(user);
  } catch (err) {
    console.error(err);
    res.json({ lineToken: "", lineUserId: "", dailyReminderTime: "08:00", meetings: [] });
  }
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
  const data = await loadData();
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
