import express from "express";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const BEARER_TOKEN = process.env.X_BEARER_TOKEN || "";

// CORS — needed only when frontend is on a different origin (local dev)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Proxy all /2/* requests to api.x.com
app.get("/2/*", async (req, res) => {
  const token = BEARER_TOKEN || req.headers["authorization"]?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "No bearer token. Set X_BEARER_TOKEN env var or pass Authorization header." });
  }

  const target = `https://api.x.com/2/${req.params[0]}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;

  try {
    const upstream = await fetch(target, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const body = await upstream.text();
    res.status(upstream.status).set("Content-Type", "application/json").send(body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// Serve built frontend
const distPath = join(__dirname, "../dist");
app.use(express.static(distPath));

// SPA fallback — serve index.html for all non-API routes
app.get("*", (_req, res) => {
  res.sendFile(join(distPath, "index.html"));
});

createServer(app).listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!BEARER_TOKEN) {
    console.warn("Warning: X_BEARER_TOKEN not set. Token must be passed from the frontend settings.");
  }
});
