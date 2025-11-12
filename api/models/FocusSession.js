// api/models/FocusSession.js
import { Schema, model } from "mongoose";

const focusSchema = new Schema(
  {
    // If you add auth later, you can store a userId here.
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: false },
    startedAt: { type: Date, required: true },
    endedAt:   { type: Date, required: true },
    durationMin: { type: Number, required: true }
  },
  { timestamps: true }
);

export default model("FocusSession", focusSchema);
