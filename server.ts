import path from "path";
import app from "./api/index.js"; // Note: tsx will resolve this to api/index.ts

const PORT = process.env.PORT || 3000;

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
    // Note: Vercel does not use this block since it routes to static files directly,
    // but keeping it if someone runs `npm start` locally.
    const express = (await import("express")).default;
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Cron endpoint available at http://localhost:${PORT}/api/cron`);
  });
}

startServer();
