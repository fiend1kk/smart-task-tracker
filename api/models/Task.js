import { Schema, model } from "mongoose";

const taskSchema = new Schema(
  {
    title: { type: String, required: true },
    notes: { type: String, default: "" },
    status: { type: String, enum: ["todo", "doing", "done"], default: "todo" },
    priority: { type: Number, enum: [1, 2, 3], default: 2 },
    dueDate: { type: Date, default: null },
    tags: { type: [String], default: [] },
    completedAt: { type: Date, default: null } // 👈 NEW
  },
  { timestamps: true }
);

export default model("Task", taskSchema);
