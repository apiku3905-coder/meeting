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
      dailyReminderDays?: number[];
      meetings: any[];
      subscribers?: { [lineId: string]: string[] };
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
  const { userId, lineToken, lineUserId, dailyReminderTime, dailyReminderDays, meetings } = req.body;
  
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
    if (dailyReminderDays !== undefined) userData.dailyReminderDays = dailyReminderDays;
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

// LINE Webhook
app.post("/api/webhook", async (req, res) => {
  // Always respond to LINE immediately
  res.status(200).send("OK");
  
  const events = req.body.events;
  if (!events || !Array.isArray(events)) return;

  const data = await loadData();
  const uniqueTokens = new Set<string>();
  for (const uid in data.users) {
    if (data.users[uid].lineToken) {
      uniqueTokens.add(data.users[uid].lineToken);
    }
  }

  if (uniqueTokens.size === 0) return;

  for (const event of events) {
    if (event.type === "message" || event.type === "join") {
      const source = event.source;
      const id = source.groupId || source.userId;
      
      let replyText = "";
      if (event.type === "join") {
        replyText = `大家好！我是會議提醒機器人。\n請複製以下接收者 ID 並填入網站的設定中：\n\n${id}`;
      } else if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text.trim();
        if (text === "!id") {
          replyText = `您的接收者 ID 為：\n${id}\n\n請將此代碼填入網站的「接收者 ID」欄位中。`;
        } else if (text.startsWith("!綁定 ")) {
          const tag = text.replace("!綁定 ", "").trim();
          if (tag) {
            for (const uid in data.users) {
              const uData = data.users[uid];
              if (uData.lineToken) {
                if (!uData.subscribers) uData.subscribers = {};
                if (!uData.subscribers[id]) uData.subscribers[id] = [];
                if (!uData.subscribers[id].includes(tag)) {
                  uData.subscribers[id].push(tag);
                  await supabase.from('app_data').upsert({ user_id: uid, data: uData });
                }
              }
            }
            replyText = `✅ 成功綁定標籤：【${tag}】\n未來指定發送給【${tag}】的會議都會通知到這裡！`;
          }
        } else if (text.startsWith("!解除 ")) {
          const tag = text.replace("!解除 ", "").trim();
          if (tag) {
            for (const uid in data.users) {
              const uData = data.users[uid];
              if (uData.lineToken && uData.subscribers && uData.subscribers[id]) {
                uData.subscribers[id] = uData.subscribers[id].filter((t: string) => t !== tag);
                await supabase.from('app_data').upsert({ user_id: uid, data: uData });
              }
            }
            replyText = `✅ 成功解除標籤：【${tag}】`;
          }
        } else if (text === "!標籤") {
          // Find the first user that has this subscriber to read tags
          let tags: string[] = [];
          for (const uid in data.users) {
            if (data.users[uid].subscribers?.[id]) {
              tags = data.users[uid].subscribers[id];
              break;
            }
          }
          replyText = tags.length > 0 ? `目前此接收者綁定的標籤有：\n${tags.join("、")}` : "目前沒有綁定任何標籤。";
        }
      }

      if (replyText) {
        // Since we don't know which bot this webhook belongs to, 
        // we try replying with all available tokens. Only the correct one will succeed.
        for (const token of uniqueTokens) {
          fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
              replyToken: event.replyToken,
              messages: [{ type: "text", text: replyText }]
            })
          }).catch(() => {});
        }
      }
    }
  }
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
    const reminderDays = user.dailyReminderDays || [1, 2, 3, 4, 5, 6, 0];
    // Check if the current time matches the reminder time format HH:mm in Taiwan timezone (+08:00)
    // Convert current time to string "HH:mm"
    const localNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const currentHH = String(localNow.getUTCHours()).padStart(2, '0');
    const currentMM = String(localNow.getUTCMinutes()).padStart(2, '0');
    const currentDay = localNow.getUTCDay();
    
    if (reminderDays.includes(currentDay) && `${currentHH}:${currentMM}` === reminderTime) {
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
      
      const hasTags = Array.isArray(m.tags) && m.tags.length > 0;
      if (!hasTags) {
        // Send to default lineUserId if no tags specified
        await sendLineMessage(user.lineToken, user.lineUserId, msg);
      } else {
        // Option A: Send ONLY to subscribers matching the tags
        const sentIds = new Set<string>();
        if (user.subscribers) {
          for (const [subId, subTags] of Object.entries(user.subscribers)) {
            const isMatch = m.tags.some((tag: string) => subTags.includes(tag));
            if (isMatch && !sentIds.has(subId)) {
              await sendLineMessage(user.lineToken, subId, msg);
              sentIds.add(subId);
            }
          }
        }
      }
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
