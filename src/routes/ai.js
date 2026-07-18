import { Router } from "express";
import pool from "../config/database.js";
import { verifyFirebaseToken } from "../middleware/auth.js";
import {
  assertCanSendAiMessage,
  handleFreeLimitError,
  incrementAiMessagesUsed,
} from "../utils/freeTierLimit.js";

const router = Router();
router.use(verifyFirebaseToken);

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

const resolveProvider = () => {
  const configured = process.env.AI_PROVIDER?.toLowerCase();
  if (configured === "groq" || configured === "gemini") return configured;
  if (GROQ_API_KEY) return "groq";
  if (GEMINI_API_KEY) return "gemini";
  return "groq";
};

const formatDate = (value) => {
  if (!value) return "unknown";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
};

const formatDateShort = (value) => {
  if (!value) return "unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 16).replace("T", " ");
};

const ageInWeeks = (birthDate) => {
  const bd = new Date(birthDate);
  if (Number.isNaN(bd.getTime())) return null;
  const days = Math.floor((Date.now() - bd.getTime()) / (1000 * 60 * 60 * 24));
  const weeks = Math.floor(days / 7);
  const remDays = days % 7;
  if (weeks < 1) return `${days} day${days === 1 ? "" : "s"} old`;
  return `${weeks} week${weeks === 1 ? "" : "s"}${remDays ? ` and ${remDays} day${remDays === 1 ? "" : "s"}` : ""} old`;
};

const sleepMinutes = (start, end) => {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms > 0 ? Math.round(ms / 60000) : 0;
};

async function loadBabyContext(userId) {
  const [
    babyRes,
    profileRes,
    feedingsRes,
    sleepRes,
    diapersRes,
    growthRes,
    vaxRes,
    milestonesRes,
    appointmentsRes,
    notesRes,
    countsRes,
    todayFeedingsRes,
    todaySleepRes,
    todayDiapersRes,
  ] = await Promise.all([
    pool.query(
      `SELECT name, birth_date, gender, birth_weight FROM babies WHERE user_id = $1`,
      [userId],
    ),
    pool.query(`SELECT name FROM user_profiles WHERE user_id = $1`, [userId]),
    pool.query(
      `SELECT timestamp, type, side, duration, amount, notes
       FROM feeding_entries WHERE user_id = $1
       ORDER BY timestamp DESC LIMIT 20`,
      [userId],
    ),
    pool.query(
      `SELECT start_time, end_time, type, notes
       FROM sleep_entries WHERE user_id = $1
       ORDER BY start_time DESC LIMIT 20`,
      [userId],
    ),
    pool.query(
      `SELECT timestamp, type
       FROM diaper_entries WHERE user_id = $1
       ORDER BY timestamp DESC LIMIT 20`,
      [userId],
    ),
    pool.query(
      `SELECT date, weight, height, head_circ
       FROM growth_entries WHERE user_id = $1
       ORDER BY date DESC LIMIT 10`,
      [userId],
    ),
    pool.query(
      `SELECT name, scheduled_date, done, completed_date
       FROM vaccinations WHERE user_id = $1
       ORDER BY scheduled_date ASC`,
      [userId],
    ),
    pool.query(
      `SELECT title, expected_weeks, done, achieved_date
       FROM milestones WHERE user_id = $1
       ORDER BY id ASC`,
      [userId],
    ),
    pool.query(
      `SELECT doctor, specialty, date, time, type
       FROM appointments WHERE user_id = $1
       ORDER BY date ASC LIMIT 10`,
      [userId],
    ),
    pool.query(
      `SELECT date, title, content
       FROM medical_notes WHERE user_id = $1
       ORDER BY date DESC LIMIT 8`,
      [userId],
    ),
    pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM feeding_entries WHERE user_id = $1) AS feedings,
         (SELECT COUNT(*)::int FROM sleep_entries WHERE user_id = $1) AS sleep,
         (SELECT COUNT(*)::int FROM diaper_entries WHERE user_id = $1) AS diapers,
         (SELECT COUNT(*)::int FROM growth_entries WHERE user_id = $1) AS growth`,
      [userId],
    ),
    pool.query(
      `SELECT timestamp, type, side, duration, amount
       FROM feeding_entries
       WHERE user_id = $1 AND timestamp >= CURRENT_DATE
       ORDER BY timestamp ASC`,
      [userId],
    ),
    pool.query(
      `SELECT start_time, end_time, type
       FROM sleep_entries
       WHERE user_id = $1 AND start_time >= CURRENT_DATE
       ORDER BY start_time ASC`,
      [userId],
    ),
    pool.query(
      `SELECT timestamp, type
       FROM diaper_entries
       WHERE user_id = $1 AND timestamp >= CURRENT_DATE
       ORDER BY timestamp ASC`,
      [userId],
    ),
  ]);

  const baby = babyRes.rows[0];
  if (!baby) {
    return { baby: null, contextText: "No baby profile on file yet." };
  }

  const parentName = profileRes.rows[0]?.name || "Parent";
  const counts = countsRes.rows[0] || {};
  const age = ageInWeeks(baby.birth_date);

  const todayFeedings = todayFeedingsRes.rows;
  const todaySleep = todaySleepRes.rows;
  const todayDiapers = todayDiapersRes.rows;
  const todaySleepMins = todaySleep.reduce(
    (sum, s) => sum + sleepMinutes(s.start_time, s.end_time),
    0,
  );

  const feedings = feedingsRes.rows
    .map(
      (f) =>
        `- ${formatDateShort(f.timestamp)}: ${f.type}${f.side ? ` (${f.side})` : ""}${f.duration ? `, ${f.duration}min` : ""}${f.amount ? `, ${f.amount}ml` : ""}${f.notes ? ` — ${f.notes}` : ""}`,
    )
    .join("\n");

  const sleep = sleepRes.rows
    .map((s) => {
      const mins = sleepMinutes(s.start_time, s.end_time);
      return `- ${formatDateShort(s.start_time)} → ${formatDateShort(s.end_time)} (${s.type}, ${mins}min)${s.notes ? ` — ${s.notes}` : ""}`;
    })
    .join("\n");

  const diapers = diapersRes.rows
    .map((d) => `- ${formatDateShort(d.timestamp)}: ${d.type}`)
    .join("\n");

  const growth = growthRes.rows
    .map(
      (g) =>
        `- ${g.date}: weight ${g.weight ?? "?"}kg, height ${g.height ?? "?"}cm, head ${g.head_circ ?? "?"}cm`,
    )
    .join("\n");

  const vaccinations = vaxRes.rows
    .map(
      (v) =>
        `- ${v.name} (due ${v.scheduled_date}): ${v.done ? `done ${v.completed_date || ""}` : "pending"}`,
    )
    .join("\n");

  const upcomingVax = vaxRes.rows
    .filter((v) => !v.done)
    .slice(0, 3)
    .map((v) => `- ${v.name} on ${v.scheduled_date}`)
    .join("\n");

  const milestones = milestonesRes.rows
    .map(
      (m) =>
        `- ${m.title} (${m.expected_weeks}): ${m.done ? `achieved ${m.achieved_date || ""}` : "not yet"}`,
    )
    .join("\n");

  const pendingMilestones = milestonesRes.rows
    .filter((m) => !m.done)
    .slice(0, 5)
    .map((m) => `- ${m.title} (expected ${m.expected_weeks})`)
    .join("\n");

  const appointments = appointmentsRes.rows
    .map(
      (a) =>
        `- ${a.date} ${a.time}: ${a.type} with ${a.doctor} (${a.specialty})`,
    )
    .join("\n");

  const notes = notesRes.rows
    .map((n) => `- ${n.date} — ${n.title}: ${n.content}`)
    .join("\n");

  const todayFeedingSummary =
    todayFeedings.length > 0
      ? todayFeedings
          .map(
            (f) =>
              `${formatDateShort(f.timestamp)} ${f.type}${f.duration ? ` ${f.duration}min` : ""}${f.amount ? ` ${f.amount}ml` : ""}`,
          )
          .join("; ")
      : "None logged today";

  const contextText = `
Parent/caregiver: ${parentName}
Baby name: ${baby.name} (always refer to the baby as "${baby.name}" in your replies)
Age: ${age || "unknown"}
Birth date: ${baby.birth_date}
Gender: ${baby.gender}
Birth weight: ${baby.birth_weight} kg

=== TODAY'S SUMMARY ===
Feedings today: ${todayFeedings.length} total — ${todayFeedingSummary}
Sleep today: ${todaySleep.length} session(s), ${todaySleepMins} minutes total
Diapers today: ${todayDiapers.length} total (${todayDiapers.filter((d) => d.type === "wet" || d.type === "both").length} wet, ${todayDiapers.filter((d) => d.type === "dirty" || d.type === "both").length} dirty)

=== ALL-TIME COUNTS ===
Total feedings logged: ${counts.feedings ?? 0}
Total sleep sessions logged: ${counts.sleep ?? 0}
Total diapers logged: ${counts.diapers ?? 0}
Total growth measurements: ${counts.growth ?? 0}

=== RECENT FEEDINGS (newest first, up to 20) ===
${feedings || "None logged"}

=== RECENT SLEEP (newest first, up to 20) ===
${sleep || "None logged"}

=== RECENT DIAPERS (newest first, up to 20) ===
${diapers || "None logged"}

=== GROWTH HISTORY ===
${growth || "None logged"}

=== VACCINATIONS ===
${vaccinations || "None scheduled"}
Upcoming/pending:
${upcomingVax || "None"}

=== MILESTONES ===
${milestones || "None set"}
Next pending:
${pendingMilestones || "None"}

=== APPOINTMENTS ===
${appointments || "None scheduled"}

=== MEDICAL NOTES ===
${notes || "None"}
`.trim();

  return { baby, contextText };
}

function buildSystemPrompt(contextText, babyName) {
  return `You are Bebio, a warm and knowledgeable baby-care assistant inside the Bebio parenting app.

IMPORTANT:
- The baby's name is "${babyName}". Always use this name in your replies (never say "your baby" if you know the name).
- You have access to ${babyName}'s real logged tracking data below. ALWAYS check this data before answering.
- If data exists, reference specific numbers, dates, and patterns from the logs (e.g. "${babyName} had 3 feedings today" or "last sleep was 45 minutes").
- If a category shows "None logged" or zero today, say so honestly and give age-appropriate general guidance for ${babyName}'s age.
- Always remind parents to consult their pediatrician for medical emergencies, fever, breathing issues, or dehydration.
- Bebio is not a medical service. Do not diagnose conditions or prescribe treatment.
- When giving health, sleep, feeding, vaccination, or development guidance, cite reputable sources (AAP, CDC, WHO) by name.
- End health-related answers with a "Sources:" line listing 1–2 relevant links, for example:
  - Sleep: https://www.aap.org/en/patient-care/safe-sleep/
  - Feeding: https://www.aap.org/en/patient-care/newborn-and-infant-nutrition/
  - Vaccines: https://www.cdc.gov/vaccines/hcp/imz-schedules/child-adolescent.html
  - Milestones: https://www.cdc.gov/act-early/milestones/index.html
- Keep answers concise (2–4 short paragraphs), friendly, and actionable.

${babyName}'s complete tracking data:
${contextText}`;
}

function buildChatMessages({ message, history, contextText, babyName }) {
  const messages = [{ role: "system", content: buildSystemPrompt(contextText, babyName) }];

  for (const item of history.slice(-10)) {
    messages.push({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.text,
    });
  }

  messages.push({ role: "user", content: message });
  return messages;
}

async function callGroq({ message, history, contextText, babyName }) {
  if (!GROQ_API_KEY) {
    throw new Error(
      "GROQ_API_KEY is not configured. Get a free key at https://console.groq.com/keys",
    );
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: buildChatMessages({ message, history, contextText, babyName }),
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.message || `Groq API error (${response.status})`;
    throw new Error(errMsg);
  }

  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error("No response from AI model");
  }

  return reply;
}

async function callGemini({ message, history, contextText, babyName }) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured on the server");
  }

  const systemPrompt = buildSystemPrompt(contextText, babyName);
  const contents = [];

  for (const item of history.slice(-10)) {
    contents.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.text }],
    });
  }

  contents.push({
    role: "user",
    parts: [{ text: message }],
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.message || `Gemini API error (${response.status})`;
    throw new Error(errMsg);
  }

  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!reply) {
    throw new Error("No response from AI model");
  }

  return reply;
}

async function callAI(params) {
  const provider = resolveProvider();
  if (provider === "gemini") {
    return callGemini(params);
  }
  return callGroq(params);
}

router.post("/chat", async (req, res) => {
  const client = await pool.connect();
  try {
    const message = String(req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    if (message.length > 2000) {
      return res.status(400).json({ error: "message is too long (max 2000 characters)" });
    }

    await assertCanSendAiMessage(client, req.user.id);

    const sanitizedHistory = history
      .filter(
        (item) =>
          item &&
          (item.role === "user" || item.role === "assistant") &&
          typeof item.text === "string" &&
          item.text.trim(),
      )
      .map((item) => ({
        role: item.role,
        text: item.text.trim().slice(0, 2000),
      }));

    const { baby, contextText } = await loadBabyContext(req.user.id);

    if (!baby) {
      return res.status(400).json({
        error: "Complete baby setup before using the AI assistant",
      });
    }

    const reply = await callAI({
      message,
      history: sanitizedHistory,
      contextText,
      babyName: baby.name,
    });

    await incrementAiMessagesUsed(client, req.user.id);

    return res.json({ reply, babyName: baby.name });
  } catch (error) {
    const limit = handleFreeLimitError(error, res);
    if (limit) return limit;
    console.error("[POST /api/ai/chat] Error:", error);
    const message = String(error.message);
    const isConfig =
      message.includes("GROQ_API_KEY") || message.includes("GEMINI_API_KEY");
    return res.status(isConfig ? 503 : 500).json({
      error: message,
    });
  } finally {
    client.release();
  }
});

export default router;
