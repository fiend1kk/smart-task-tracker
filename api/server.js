import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import Task from "./models/Task.js";
import FocusSession from "./models/FocusSession.js";

const app = express();

// Security / JSON
app.use(helmet());
app.use(express.json());

// CORS: allow localhost/127.0.0.1 on any port (3000/3001/etc)
app.use(
  cors({
    origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
    credentials: true,
  })
);

// Simple request logger to debug "failed to fetch"
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Mongoose: fail fast instead of buffering
mongoose.set("bufferCommands", false);

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log("✅ Connected to MongoDB");

    // Root + Health
    app.get("/", (_req, res) => {
      res.send("Smart Task Tracker API is running. Try GET /health or /tasks.");
    });
    app.get("/health", (_req, res) => {
      res.json({ ok: true, service: "smart-task-tracker-api" });
    });

    // List tasks with filters & sorting
    app.get("/tasks", async (req, res) => {
      const { status, priority, tag, q, sort = "createdAt", dir = "desc" } =
        req.query;

      const where = {};
      if (status && ["todo", "doing", "done"].includes(String(status)))
        where.status = status;
      if (priority && [1, 2, 3].includes(Number(priority)))
        where.priority = Number(priority);
      if (tag && String(tag).trim()) where.tags = String(tag).trim();
      if (q && String(q).trim())
        where.title = { $regex: String(q).trim(), $options: "i" };

      const sortMap = {
        createdAt: "createdAt",
        priority: "priority",
        dueDate: "dueDate",
        title: "title",
      };
      const sortField = sortMap[sort] ?? "createdAt";
      const sortDir = String(dir).toLowerCase() === "asc" ? 1 : -1;

      const tasks = await Task.find(where).sort({ [sortField]: sortDir, _id: -1 });
      res.json(tasks);
    });

    // Create task
    app.post("/tasks", async (req, res) => {
      try {
        const {
          title,
          notes = "",
          priority = 2,
          dueDate = null,
          tags = [],
          status = "todo",
        } = req.body || {};
        if (!title || typeof title !== "string")
          return res.status(400).json({ error: "title is required" });

        const doc = await Task.create({
          title,
          notes,
          status,
          priority: Number(priority),
          dueDate: dueDate ? new Date(dueDate) : null,
          tags: Array.isArray(tags) ? tags : [],
        });
        res.status(201).json(doc);
      } catch (err) {
        console.error("create error:", err);
        res
          .status(400)
          .json({ error: err instanceof Error ? err.message : "bad request" });
      }
    });

    // Update task (handles completedAt transitions)
    app.patch("/tasks/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id))
          return res.status(400).json({ error: "invalid id" });

        const allowed = [
          "title",
          "notes",
          "status",
          "priority",
          "dueDate",
          "tags",
        ];
        const update = {};
        for (const k of allowed) if (k in req.body) update[k] = req.body[k];

        if ("priority" in update) update.priority = Number(update.priority);
        if ("dueDate" in update)
          update.dueDate = update.dueDate ? new Date(update.dueDate) : null;

        if ("status" in update) {
          const current = await Task.findById(id).select("status");
          if (!current) return res.status(404).json({ error: "not found" });
          const nextStatus = update.status;
          if (current.status !== "done" && nextStatus === "done") {
            update.completedAt = new Date();
          } else if (current.status === "done" && nextStatus !== "done") {
            update.completedAt = null;
          }
        }

        const updated = await Task.findByIdAndUpdate(id, update, {
          new: true,
          runValidators: true,
        });
        if (!updated) return res.status(404).json({ error: "not found" });
        res.json(updated);
      } catch (err) {
        console.error("patch error:", err);
        res
          .status(400)
          .json({ error: err instanceof Error ? err.message : "bad request" });
      }
    });

    // Delete task
    app.delete("/tasks/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id))
          return res.status(400).json({ error: "invalid id" });
        const deleted = await Task.findByIdAndDelete(id);
        if (!deleted) return res.status(404).json({ error: "not found" });
        res.json({ ok: true });
      } catch (err) {
        console.error("delete error:", err);
        res
          .status(400)
          .json({ error: err instanceof Error ? err.message : "bad request" });
      }
    });

    app.listen(PORT, () => {
      console.log(`API running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}

// ------- Stats helpers & route (wrapped in try/catch) -------
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfNDaysAgo(n) {
  const d = startOfDay();
  d.setDate(d.getDate() - n);
  return d;
}

app.get("/stats/overview", async (_req, res) => {
  try {
    const todayStart = startOfDay();
    const todayCompleted = await Task.countDocuments({
      status: "done",
      completedAt: { $gte: todayStart },
    });

    const since = startOfNDaysAgo(60);
    const completions = await Task.aggregate([
      { $match: { status: "done", completedAt: { $gte: since } } },
      {
        $project: {
          day: { $dateToString: { format: "%Y-%m-%d", date: "$completedAt" } },
        },
      },
      { $group: { _id: "$day", count: { $sum: 1 } } },
    ]);
    const daysWith = new Set(completions.map((c) => c._id));

    let streak = 0;
    for (let i = 0; i < 60; i++) {
      const dayStr = startOfNDaysAgo(i).toISOString().slice(0, 10);
      if (daysWith.has(dayStr)) streak++;
      else break;
    }

    const weekStart = startOfNDaysAgo(6);
    const weeklyAgg = await FocusSession.aggregate([
      { $match: { startedAt: { $gte: weekStart } } },
      { $group: { _id: null, minutes: { $sum: "$durationMin" } } },
    ]);
    const weeklyFocusMinutes = weeklyAgg[0]?.minutes ?? 0;

    res.json({ todayCompleted, streak, weeklyFocusMinutes });
  } catch (err) {
    console.error("stats error:", err);
    res.status(500).json({ error: "stats failed" });
  }
});

start();

// ---- Focus Mode endpoints ----

// Start a focus session
app.post("/focus/start", async (req, res) => {
  try {
    const { taskId } = req.body || {};
    const now = new Date();

    const doc = await FocusSession.create({
      taskId: taskId && mongoose.Types.ObjectId.isValid(taskId) ? taskId : undefined,
      startedAt: now,
      endedAt: now,            // temp equal; real end on stop
      durationMin: 0           // computed on stop
    });

    res.status(201).json(doc);
  } catch (err) {
    console.error("focus start error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "bad request" });
  }
});

// Stop a focus session
app.post("/focus/stop", async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ error: "sessionId required" });
    }

    const session = await FocusSession.findById(sessionId);
    if (!session) return res.status(404).json({ error: "session not found" });

    const endedAt = new Date();
    const ms = endedAt.getTime() - new Date(session.startedAt).getTime();
    const minutes = Math.max(0, Math.round(ms / 60000)); // whole minutes

    session.endedAt = endedAt;
    session.durationMin = minutes;
    await session.save();

    res.json(session);
  } catch (err) {
    console.error("focus stop error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "bad request" });
  }
});

// (Optional) list recent sessions
app.get("/focus/sessions", async (req, res) => {
  try {
    const limit = Math.min(100, Number(req.query.limit ?? 20));
    const sessions = await FocusSession.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate({ path: "taskId", select: "title" });
    res.json(sessions);
  } catch (err) {
    console.error("focus list error:", err);
    res.status(400).json({ error: "bad request" });
  }
});
