// Nomi backend as a single Vercel serverless catch-all function.
// Auth is STATELESS (HMAC-signed codes, sessions, and OAuth state) so it
// survives cold starts with no database. User state (social-self, projects,
// page simulation) persists via Upstash Redis REST when configured, else a
// best-effort /tmp JSON file (per warm instance).
import crypto from "crypto";
import fs from "fs";
import tls from "tls";
import HIDDEN_PROMPT from "./_hiddenprompt.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const REGISTERS = ["guide", "review", "diary"];

function secret() {
  return process.env.AUTH_SECRET || crypto.createHash("sha256")
    .update("nomi-fallback:" + (process.env.GOOGLE_CLIENT_SECRET || "") + (process.env.OPENAI_API_KEY || "")).digest("hex");
}
function hmac(s) { return crypto.createHmac("sha256", secret()).update(s).digest("hex"); }
function b64u(s) { return Buffer.from(s).toString("base64url"); }
function unb64u(s) { try { return Buffer.from(s, "base64url").toString("utf8"); } catch { return ""; } }

/* ---------- stateless email codes ---------- */
const CODE_SLOT_MS = 5 * 60 * 1000;
function codeFor(email, slot) {
  const h = hmac("code:" + email + ":" + slot);
  return String(parseInt(h.slice(0, 12), 16) % 900000 + 100000);
}
function makeCode(email) { return codeFor(email, Math.floor(Date.now() / CODE_SLOT_MS)); }
function checkCode(email, code) {
  const slot = Math.floor(Date.now() / CODE_SLOT_MS);
  const c = String(code || "").trim();
  return c === codeFor(email, slot) || c === codeFor(email, slot - 1) || c === codeFor(email, slot - 2);
}

/* ---------- stateless sessions ---------- */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function makeSession(identity) {
  const exp = Date.now() + SESSION_TTL_MS;
  const body = b64u(identity) + "." + exp;
  return { token: body + "." + hmac("sess:" + body), identity, userId: userIdFor(identity) };
}
function sessionFromToken(token) {
  if (!token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const body = parts[0] + "." + parts[1];
  if (hmac("sess:" + body) !== parts[2]) return null;
  if (Number(parts[1]) < Date.now()) return null;
  const identity = unb64u(parts[0]);
  if (!identity) return null;
  return { identity, userId: userIdFor(identity) };
}
function userIdFor(identity) { return "u_" + crypto.createHash("sha256").update(identity.toLowerCase()).digest("hex").slice(0, 16); }
function tokenFrom(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

/* ---------- storage: Upstash REST or /tmp ---------- */
const TMP_DB = "/tmp/nomi-db.json";
let memDb = null;
function tmpLoad() {
  if (memDb) return memDb;
  try { memDb = JSON.parse(fs.readFileSync(TMP_DB, "utf8")); } catch { memDb = {}; }
  return memDb;
}
function tmpSave() { try { fs.writeFileSync(TMP_DB, JSON.stringify(memDb)); } catch {} }
async function kvGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && tok) {
    try {
      const r = await fetch(url + "/get/" + encodeURIComponent(key), { headers: { Authorization: "Bearer " + tok } });
      const d = await r.json();
      return d.result ? JSON.parse(d.result) : null;
    } catch { return null; }
  }
  const db = tmpLoad();
  return db[key] || null;
}
async function kvSet(key, val) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && tok) {
    try {
      const r = await fetch(url + "/set/" + encodeURIComponent(key), {
        method: "POST", headers: { Authorization: "Bearer " + tok }, body: JSON.stringify(val),
      });
      if (!r.ok) console.error("[kv] set failed", key.slice(0, 30), r.status);
      return r.ok;
    } catch (e) { console.error("[kv] set error", e.message); return false; }
  }
  const db = tmpLoad();
  db[key] = val; tmpSave();
  return true;
}

/* ---------- analytics (Airtable: Nomi Users / Nomi Events) ---------- */
const USER_FLAG_BY_EVENT = { self_saved: "profile_completed", generate: "generated_once", export: "exported_once", waitlist_join: "joined_waitlist" };
async function atPost(path, payload) {
  const base = process.env.AIRTABLE_BASE_ID, tok = process.env.AIRTABLE_TOKEN;
  if (!base || !tok) return;
  try {
    const r = await fetch(`https://api.airtable.com/v0/${base}/${path}`, {
      method: payload.performUpsert ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) console.error("[track]", path, r.status, (await r.text().catch(()=>"")).slice(0,150));
  } catch (e) { console.error("[track]", e.message); }
}
// uid: anonymous browser id that NEVER changes for a returning user; once the
// user registers, the same row also carries their email (registered=true).
async function track(uid, email, events) {
  if (!uid && !email) return;
  uid = String(uid || ("email:" + email)).slice(0, 64);
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const registered = !!email;
  const evs = (events || []).slice(0, 10).map(e => ({ fields: {
    event: String(e.event || "").slice(0, 50), uid,
    email: email || undefined,
    registered: registered || undefined,
    meta: e.meta ? JSON.stringify(e.meta).slice(0, 500) : undefined,
    day, ts: now.toISOString(),
  } }));
  const userFields = { uid, last_seen: now.toISOString() };
  if (email) { userFields.email = email; userFields.registered = true; }
  for (const e of (events || [])) {
    const flag = USER_FLAG_BY_EVENT[e.event]; if (flag) userFields[flag] = true;
    if (e.event === "welcome_choice" && e.meta && e.meta.exp) userFields.rednote_experience = e.meta.exp === "experienced" ? "experienced" : "new";
    if ((e.event === "register" || e.event === "sign_in") && e.meta && e.meta.method) userFields.auth_method = e.meta.method;
    if (e.event === "visit" && e.meta && e.meta.source) userFields.source = String(e.meta.source).slice(0, 80);
  }
  await Promise.all([
    evs.length ? atPost("Nomi%20Events", { records: evs }) : null,
    atPost("Nomi%20Users", { performUpsert: { fieldsToMergeOn: ["uid"] }, records: [{ fields: userFields }] }),
  ]);
}

/* ---------- email delivery ---------- */
function emailTransport() {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return "smtp";
  return "console";
}
function sendViaSmtp(to, subject, text) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = (process.env.EMAIL_FROM || user).replace(/^.*<|>.*$/g, "") || user;
  const fromHeader = process.env.EMAIL_FROM || user;
  const b64 = s => Buffer.from(s).toString("base64");
  const msg = [
    `From: ${fromHeader}`, `To: ${to}`, `Subject: ${subject}`,
    `MIME-Version: 1.0`, `Content-Type: text/plain; charset=utf-8`, ``, text, ``,
  ].join("\r\n");
  const steps = [
    { expect: /^220/, send: `EHLO nomi.zeyaai.com` },
    { expect: /^250/, send: `AUTH LOGIN` },
    { expect: /^334/, send: b64(user) },
    { expect: /^334/, send: b64(pass) },
    { expect: /^235/, send: `MAIL FROM:<${from}>` },
    { expect: /^250/, send: `RCPT TO:<${to}>` },
    { expect: /^250/, send: `DATA` },
    { expect: /^354/, send: msg + "\r\n." },
    { expect: /^250/, send: `QUIT` },
    { expect: /^221/, send: null },
  ];
  return new Promise((resolve, reject) => {
    let i = 0, buf = "";
    const sock = tls.connect({ host, port, servername: host }, () => {});
    const fail = err => { try { sock.destroy(); } catch {} reject(err); };
    sock.setTimeout(15000, () => fail(new Error("smtp timeout")));
    sock.on("error", fail);
    sock.on("data", chunk => {
      buf += chunk.toString();
      if (!/\r\n$/.test(buf)) return;
      const lines = buf.trim().split("\r\n");
      const last = lines[lines.length - 1];
      if (/^\d{3}-/.test(last)) return;
      buf = "";
      const step = steps[i];
      if (!step) return;
      if (!step.expect.test(last)) return fail(new Error(`smtp unexpected: ${last.slice(0, 120)}`));
      i += 1;
      if (step.send === null) { sock.end(); return resolve(); }
      sock.write(step.send + "\r\n");
      if (i >= steps.length) { sock.end(); resolve(); }
    });
  });
}
async function sendCodeEmail(to, code) {
  if (process.env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Nomi <onboarding@resend.dev>",
        to: [to], subject: "Your Nomi verification code",
        text: `Your Nomi verification code is: ${code}\n\nIt expires in 10 minutes.`,
      }),
    });
    if (!r.ok) throw new Error("resend " + r.status);
    return true;
  }
  if (emailTransport() === "smtp") {
    await sendViaSmtp(to, "Your Nomi verification code",
      `Your Nomi verification code is: ${code}\n\nIt expires in 10 minutes.`);
    return true;
  }
  console.log(`[nomi auth] code for ${to}: ${code}`);
  return false;
}

/* ---------- OpenAI ---------- */
async function callOpenAI(messages, opts = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  // Newer models reject max_tokens (want max_completion_tokens) and custom
  // temperature; retry adaptively so any configured model works.
  const payload = {
    model, messages,
    temperature: opts.temperature != null ? opts.temperature : 0.85,
    response_format: { type: "json_object" },
    max_completion_tokens: opts.maxTokens || 2200,
  };
  let res, errText = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
    if (res.ok) break;
    errText = (await res.text().catch(() => ""));
    if (res.status === 400 && /max_completion_tokens/.test(errText) === false && /max_tokens/.test(errText)) {
      payload.max_tokens = payload.max_completion_tokens; delete payload.max_completion_tokens; continue;
    }
    if (res.status === 400 && /temperature/.test(errText)) { delete payload.temperature; continue; }
    break;
  }
  if (!res.ok) throw new Error(`openai_error ${res.status}: ${errText.slice(0, 300)}`);
  const data = await res.json();
  let parsed;
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
  catch { throw new Error("model returned non-JSON output"); }
  return { parsed, usage: data.usage || null, model };
}

/* ---------- prompt composition ---------- */
// The fidelity contract sits ABOVE the craft rules: the creator's own material
// always outranks any platform formula or preset.
const PRIORITY_PREAMBLE = [
  "PRIORITY ORDER - ABSOLUTE, read before anything else:",
  "1. THE CREATOR'S MATERIAL - their idea, pasted text, extracted screenshots, facts, numbers, opinions, and lived experience. This is the single source of truth. If they gave you substance, your job is TRANSFORMATION and polish, not invention. Every concrete detail they provided must survive into the notes. Never replace their specifics with generic filler. Never contradict their stated experience or soften their opinions.",
  "2. THE RESEARCH BRIEF (when present) - verified, current facts about the topic. Use them to ground the notes with real names, versions, numbers, and dates.",
  "3. THE CRAFT RULES BELOW - a finishing filter for platform fit, applied ONLY where they do not distort 1 or 2. If a title formula, a structure template, an emoji habit, or any other rule would force out the creator's substance or flatten their voice, DROP THE RULE and keep the substance. The rules are defaults, not requirements.",
  "NEVER fabricate concrete facts - prices, product names, version numbers, dates, statistics - that are not in the creator's material or the research brief. If information is missing, stay honestly general or write from the creator's first-person perspective.",
  "THINK DEEPLY BEFORE WRITING: What is the creator actually saying? What is genuinely interesting or new in THEIR material? What would a sharp reader remember afterward? Build each note around that core, then polish for the platform.",
  "COMPREHEND THE REQUEST LIKE A TOP ASSISTANT: first decide what the note is ABOUT. If the creator asks to introduce, describe, review, or explain a SUBJECT (a building, a shop, a product, a place, a person, a concept), then the notes ARE that content - a real introduction of that building, a real review of that product, written with substantive knowledge of the subject. NEVER produce meta-content about how one could write it, tips for writing it, or advice about the topic of writing. The three registers are three VOICES delivering the SAME requested substance, never three different meta-interpretations.",
].join("\n");
function systemPrompt() { return PRIORITY_PREAMBLE + "\n\n" + HIDDEN_PROMPT; }

function pct(v) { return Math.max(0, Math.min(100, Number(v) || 0)); }
function describeSelf(self) {
  const s = self || {};
  const energy = pct(s.energy), closeness = pct(s.closeness), structure = pct(s.structure);
  const lines = [];
  lines.push(`- Energy ${energy}/100: ${energy >= 50 ? "high-key, expressive, exclamatory allowed" : "quiet, measured, understated"}`);
  lines.push(`- Closeness ${closeness}/100: ${closeness >= 50 ? "diary-close, first-person intimate, shares feelings" : "reader-useful, service-first, advice-forward"}`);
  lines.push(`- Structure ${structure}/100: ${structure >= 50 ? "structured, numbered lists, clear sections" : "off-the-cuff, flowing, conversational"}`);
  if (Array.isArray(s.traits) && s.traits.length) lines.push(`- Trait words chosen by the creator: ${s.traits.join(", ")}`);
  if (Array.isArray(s.categoriesNow) && s.categoriesNow.length) lines.push(`- What they share today: ${s.categoriesNow.join(", ")}`);
  if (Array.isArray(s.categoriesGoal) && s.categoriesGoal.length) lines.push(`- Where they are heading: ${s.categoriesGoal.join(", ")}`);
  if (Array.isArray(s.freeform) && s.freeform.length) lines.push(`- In their own words: ${s.freeform.join(" | ")}`);
  if (Array.isArray(s.learned) && s.learned.length) lines.push(`- Learned from their past edits (apply these preferences): ${s.learned.slice(-10).join(" | ")}`);
  if (s.seedText) lines.push(`- Sample of their existing writing (match its rhythm, never copy it): """${String(s.seedText).slice(0, 1500)}"""`);
  if (s.inspirationText) lines.push(`- Writing that inspires them, borrow the register only: """${String(s.inspirationText).slice(0, 800)}"""`);
  if (s.name) lines.push(`- The social-self is named "${s.name}".`);
  return lines.join("\n");
}
const LANG_INSTRUCTIONS = {
  en: "Write the note bodies and titles in natural, native-sounding creator English. Tags: MOSTLY English tags (3-4), plus exactly 1-2 Chinese niche tags matched to the topic (e.g. #穿搭 #美食 #海外生活).",
  zh: "Write the note bodies and titles in natural, native 简体中文 as used by real 小红书 creators (口语化, not formal written Chinese). Tags: mostly Chinese (4-6), plus 1-2 English tags.",
  bilingual: "Write bilingual (双语) notes with BLOCK-LEVEL structure: the full note in English, then a ✨ divider line, then a shorter natural 简体中文 re-telling (not a literal translation). Tags: mirrored pairs (#OOTD + #穿搭 style), 3 English + 3 Chinese.",
};
// Research pass: a Responses-API call that may use web search to gather
// CURRENT facts when the idea references real products, events, or news, and
// that extracts the creator's own claims so the writer must preserve them.
async function researchBrief(idea, category) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENAI_RESEARCH_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const body = {
    model,
    input: [
      { role: "system", content: "You are a meticulous research analyst preparing a brief for a RedNote/Xiaohongshu creator. Be factual and concise. Plain text only." },
      { role: "user", content: [
        `CREATOR'S MATERIAL (topic category: ${category || "lifestyle"}):`,
        `"""${String(idea || "").slice(0, 4000)}"""`,
        ``,
        `Produce a brief with exactly these three sections:`,
        `CREATOR'S OWN SUBSTANCE: list every concrete fact, number, claim, experience, and opinion already present in the material above. These must survive verbatim-faithfully into any content written from this brief.`,
        `VERIFIED CONTEXT: if the material references current products, tools, versions, events, news, prices, or anything time-sensitive - use web search and give 3-6 CURRENT, specific, verifiable facts (exact names, versions, dates, numbers). If nothing is time-sensitive, write "none needed" and do not search.`,
        `SHARPEST ANGLES: 2-3 short notes on what is genuinely interesting in this material for a reader - the hook worth building around.`,
        `Keep the whole brief under 350 words.`,
      ].join("\n") },
    ],
    tools: [{ type: "web_search" }],
    max_output_tokens: 900,
  };
  try {
    let res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (res.status === 400) {
      // model may not support web_search - retry as a pure reasoning pass
      delete body.tools;
      res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
    }
    if (!res.ok) return null;
    const d = await res.json();
    let text = d.output_text || "";
    if (!text && Array.isArray(d.output)) {
      for (const it of d.output) {
        if (it.type === "message" && Array.isArray(it.content)) {
          for (const c of it.content) if (c.type === "output_text") text += c.text;
        }
      }
    }
    return text.trim() || null;
  } catch { return null; }
}

function buildMessages({ idea, self, contentLang, category, brief }) {
  const lang = LANG_INSTRUCTIONS[contentLang] || LANG_INSTRUCTIONS.en;
  const user = [
    `THE CREATOR'S IDEA FOR TODAY'S NOTE:\n"""${String(idea || "").slice(0, 4000)}"""`,
    ``,
    brief ? `RESEARCH BRIEF (the creator's own substance MUST survive; verified context is trustworthy):\n"""${brief}"""\n` : ``,
    `THE SOCIAL-SELF (the version of themselves this creator wants to write as):`,
    describeSelf(self),
    ``,
    `PRIMARY CATEGORY: ${category || "lifestyle"}`,
    `CONTENT LANGUAGE: ${lang}`,
    ``,
    `FIRST, comprehend the request: decide what the notes are ABOUT (the subject and substance the creator wants delivered). Write THAT content itself - never advice about how to create such content.`,
    `Produce exactly three complete RedNote note drafts delivering that same substance, one per register (three voices, same subject):`,
    `1. "guide" - the useful structured voice: the substance organized as numbered, concrete, saveable points ABOUT THE SUBJECT`,
    `2. "review" - the honest first-person voice: the substance told through personal judgment, criteria, and verdicts ABOUT THE SUBJECT`,
    `3. "diary" - the intimate narrative voice: the substance told through lived moments and feeling ABOUT THE SUBJECT`,
    `All three must be recognizably the same person - the social-self above - delivering the same requested content three ways.`,
    ``,
    `Return JSON only, exactly this shape:`,
    `{"projectName":"...","drafts":[{"register":"guide","title":"...","body":"...","tags":["#...","#..."],"coverConcept":"...","firstComment":"..."},{"register":"review",...},{"register":"diary",...}]}`,
    `- projectName: a 2-5 word working name for this project, in the same language as the notes - a label for the creator's project list, not a note title.`,
    `- title: obeys the title rules in your instructions (hook first, length limit, casual creator register).`,
    `- body: plain text with line breaks as \\n, no markdown, obeys all structure and safety rules.`,
    `- tags: topic tags per the tag rules, mixed language, ordered niche-first.`,
    `- coverConcept: one concrete photographable shot plus a short overlay-text suggestion.`,
    `- firstComment: the creator's own first comment adding supplementary value, per the firstComment rules.`,
  ].join("\n");
  return [{ role: "system", content: systemPrompt() }, { role: "user", content: user }];
}
function buildRefineMessages({ draft, instruction, self, contentLang }) {
  const lang = LANG_INSTRUCTIONS[contentLang] || LANG_INSTRUCTIONS.en;
  const user = [
    `THE SOCIAL-SELF:`, describeSelf(self), ``,
    `CONTENT LANGUAGE: ${lang}`, ``,
    `CURRENT DRAFT (register: ${draft.register}):`,
    `TITLE: ${draft.title}`, `BODY:\n${draft.body}`, `TAGS: ${(draft.tags || []).join(" ")}`, ``,
    `REVISE THIS DRAFT according to the instruction below. Apply it VISIBLY and literally:`,
    `- "make it shorter" must cut length by at least a third`,
    `- "add prices" must add concrete prices, and so on`,
    `Keep the same register, the same social-self voice, and every safety rule.`, ``,
    `INSTRUCTION: """${String(instruction).slice(0, 300)}"""`, ``,
    `Return JSON only: {"title":"...","body":"...","tags":["#..."]}`,
  ].join("\n");
  return [{ role: "system", content: systemPrompt() }, { role: "user", content: user }];
}
function buildVoiceCheckMessages({ self, contentLang }) {
  const lang = LANG_INSTRUCTIONS[contentLang] || LANG_INSTRUCTIONS.en;
  const user = [
    `THE SOCIAL-SELF BEING TUNED RIGHT NOW:`, describeSelf(self), ``,
    `CONTENT LANGUAGE: ${lang}`, ``,
    `Write ONE tiny sample RedNote note (a voice check) on this fixed example topic: "a small neighborhood bakery I just found".`,
    `It exists only so the creator can HEAR their tuning: make every dial and every trait word audibly present in the words.`,
    `If trait words or freeform lines are listed above, let at least one visibly shape a sentence.`,
    `Keep it short: title + 3-5 short lines + 2 tags. Plain text, no markdown.`, ``,
    `Return JSON only: {"title":"...","body":"...","tags":["#...","#..."]}`,
  ].join("\n");
  return [{ role: "system", content: systemPrompt() }, { role: "user", content: user }];
}

/* ---------- best time (port of lib/besttime.js, condensed) ---------- */
const BASE_WINDOWS = [
  { key: "lunch", days: "Mon to Fri", window: "12-2pm", base: 8 },
  { key: "commute", days: "Mon to Fri", window: "5-8pm", base: 7 },
  { key: "evening", days: "Sun to Thu", window: "7-10pm", base: 9 },
  { key: "latenight", days: "Fri, Sat", window: "9pm-12am", base: 6 },
  { key: "wkndmorn", days: "Sat, Sun", window: "10am-12pm", base: 8 },
  { key: "wkndeve", days: "Sat, Sun", window: "7-10pm", base: 7 },
  { key: "morning", days: "Mon to Fri", window: "7-9am", base: 5 },
];
const CATEGORY_AFFINITY = {
  food: { lunch: 3, commute: 2, wkndmorn: 2 }, travel: { evening: 2, wkndmorn: 3 },
  beauty: { evening: 3, latenight: 2 }, fashion: { morning: 2, evening: 2, wkndmorn: 2 },
  home: { wkndmorn: 3, wkndeve: 2 }, career: { lunch: 3, morning: 2 },
  wellness: { morning: 3, wkndmorn: 2 }, tech: { lunch: 2, evening: 2 },
  study: { evening: 3, wkndeve: 2 }, default: { evening: 2, lunch: 1 },
};
const REGISTER_MOD = {
  guide: { wkndmorn: 2, lunch: 1 }, review: { evening: 2, latenight: 1 }, diary: { evening: 2, wkndeve: 1 },
};
const REASONS = {
  guide: "planning-mode readers save guides; post at the START of the window, since the first hours size the distribution pool",
  review: "evening browse is decision mode for reviews; post at the START of the window, since the first hours size the distribution pool",
  diary: "wind-down hours read diaries; post at the START of the window, since the first hours size the distribution pool",
};
function bestTime(category, register) {
  const aff = CATEGORY_AFFINITY[category] || CATEGORY_AFFINITY.default;
  const mod = REGISTER_MOD[register] || {};
  let best = null;
  for (const w of BASE_WINDOWS) {
    const score = w.base + (aff[w.key] || 0) + (mod[w.key] || 0);
    if (!best || score > best.score) best = { ...w, score };
  }
  return {
    days: best.days, window: best.window, timezone: "PT",
    label: `${best.days}, ${best.window} PT`,
    reason: `${category || "lifestyle"} notes in the ${register} register earn most in this window; ${REASONS[register] || REASONS.guide}`,
    score: best.score,
  };
}

/* ---------- draft validation (port of lib/generate.js) ---------- */
function stripMarkdown(s) {
  return String(s || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1").replace(/^#{1,4}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1").replace(/^\s*[-*]\s+/gm, "")
    .replace(/([0-9#*])⃣/g, "$1️⃣");
}
function validateDrafts(drafts) {
  if (!Array.isArray(drafts)) throw new Error("model output missing drafts array");
  const byRegister = {};
  for (const d of drafts) {
    if (!d || typeof d !== "object") continue;
    const reg = REGISTERS.includes(d.register) ? d.register : null;
    if (!reg || byRegister[reg]) continue;
    byRegister[reg] = {
      register: reg,
      title: stripMarkdown(d.title).slice(0, 120),
      body: stripMarkdown(d.body).slice(0, 4000),
      tags: Array.isArray(d.tags) ? d.tags.slice(0, 8).map(t => String(t).slice(0, 40)) : [],
      coverConcept: stripMarkdown(d.coverConcept).slice(0, 260),
      firstComment: stripMarkdown(d.firstComment).slice(0, 600),
    };
  }
  const out = REGISTERS.map(r => byRegister[r]).filter(Boolean);
  if (out.length < 3) throw new Error(`model produced ${out.length}/3 valid registers`);
  return out;
}
const ZH_TAG_BY_CATEGORY = {
  food: "#美食", travel: "#旅行", beauty: "#护肤", fashion: "#穿搭",
  home: "#家居", career: "#职场", wellness: "#健康生活", tech: "#数码",
  study: "#学习", lifestyle: "#生活方式",
};
const hasZh = t => /[一-鿿]/.test(t);
function ensureTagMix(tags, contentLang, category) {
  const out = tags.slice();
  const push = tag => { if (!out.some(x => x.toLowerCase() === tag.toLowerCase())) out.push(tag); };
  const zhTag = ZH_TAG_BY_CATEGORY[category] || ZH_TAG_BY_CATEGORY.lifestyle;
  if (contentLang === "en" && !out.some(hasZh)) { push(zhTag); push("#海外生活"); }
  if (contentLang === "zh" && out.every(hasZh)) { push("#lifestyle"); }
  if (contentLang === "bilingual") { if (!out.some(hasZh)) push(zhTag); if (out.every(hasZh)) push("#lifestyle"); }
  return out.slice(0, 8);
}
function localShorten(body, cap) {
  const lines = body.split("\n");
  if (lines.length <= 3) return body.slice(0, cap);
  const head = lines.slice(0, 2), tail = lines[lines.length - 1], middle = lines.slice(2, -1);
  const out = head.slice();
  for (const line of middle) {
    if ((out.join("\n") + "\n" + line + "\n" + tail).length > cap) break;
    out.push(line);
  }
  out.push(tail);
  return out.join("\n");
}
function clamp01(v) { const n = Number(v); return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }

/* ---------- google oauth (stateless state param) ---------- */
function makeOauthState(ctx, uid) {
  const exp = Date.now() + 10 * 60 * 1000;
  const body = (ctx === "g" ? "g" : "m") + "|" + String(uid || "").replace(/[^\w-]/g, "").slice(0, 40) + "." + exp;
  return body + "." + hmac("state:" + body);
}
function checkOauthState(state) {
  const parts = String(state || "").split(".");
  if (parts.length !== 3) return null;
  if (hmac("state:" + parts[0] + "." + parts[1]) !== parts[2]) return null;
  if (Number(parts[1]) < Date.now()) return null;
  const seg = parts[0].split("|");
  return { ctx: seg[0], uid: seg[1] || null };
}
function originOf(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "www.zeyaai.com";
  return `${proto}://${host}`;
}

/* ---------- per-user state ---------- */
// Any inline dataURL image in an incoming payload is moved into its own
// Redis entry and replaced by a stable /api/image URL, so state stays small.
async function externalizeImages(userId, obj) {
  async function store(v) {
    if (typeof v !== "string" || !v.startsWith("data:image") || v.length < 20000) return v;
    if (v.length > 950000) return null; // over the KV per-request limit: drop rather than poison the save
    const hash = crypto.createHash("sha1").update(v).digest("hex").slice(0, 20);
    const id = userId + ":" + hash;
    const ok = await kvSet("img:" + id, v);
    return ok ? "/api/image?id=" + id : null;
  }
  for (const p of (obj.projects || [])) {
    if (Array.isArray(p.covers)) for (let i = 0; i < p.covers.length; i++) p.covers[i] = await store(p.covers[i]);
  }
  const ps = obj.pageSim;
  if (ps && Array.isArray(ps.blocks)) for (const b of ps.blocks) if (b) b.img = await store(b.img);
  if (ps && Array.isArray(ps.cells)) for (const c of ps.cells) if (c) c.img = await store(c.img);
}
async function migrateGuestState(userId, guestState) {
  if (!guestState || typeof guestState !== "object") return;
  await externalizeImages(userId, guestState);
  const cur = (await kvGet("state:" + userId)) || {};
  const ps = guestState.pageSim;
  const psHasContent = ps && ((Array.isArray(ps.cells) && ps.cells.length) || (Array.isArray(ps.blocks) && ps.blocks.some(b => b && (b.title || b.img))) || (Array.isArray(ps.pageOrder) && ps.pageOrder.length));
  const next = {
    ...cur,
    self: guestState.self || cur.self || null,
    contentLang: guestState.contentLang || cur.contentLang || "en",
    redNoteExperience: guestState.redNoteExperience || cur.redNoteExperience || null,
    pageSim: psHasContent ? ps : (cur.pageSim || null),
    updatedAt: new Date().toISOString(),
  };
  if (Array.isArray(guestState.projects) && guestState.projects.length) {
    const existing = Array.isArray(cur.projects) ? cur.projects : [];
    const incoming = guestState.projects.filter(p => p && p.id).slice(0, 30);
    const ids = new Set(incoming.map(p => p.id));
    next.projects = incoming.concat(existing.filter(p => !ids.has(p.id))).slice(0, 30);
  } else {
    next.projects = Array.isArray(cur.projects) ? cur.projects : [];
  }
  // final guard: if state still exceeds the KV request limit, shed remaining
  // inline images before writing
  let js = JSON.stringify(next);
  if (js.length > 900000) {
    for (const p of (next.projects || [])) if (Array.isArray(p.covers)) p.covers = p.covers.map(c => (typeof c === "string" && c.startsWith("data:")) ? null : c);
    if (next.pageSim && Array.isArray(next.pageSim.blocks)) next.pageSim.blocks.forEach(b => { if (b && typeof b.img === "string" && b.img.startsWith("data:")) b.img = null; });
    js = JSON.stringify(next);
  }
  return await kvSet("state:" + userId, next);
}

/* ---------- rate limit (best effort, per warm instance) ---------- */
const genHits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const hits = (genHits.get(ip) || []).filter(t => now - t < 60_000);
  hits.push(now);
  genHits.set(ip, hits);
  return hits.length > 10;
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const u = new URL(req.url || "/", "http://x");
  const q = u.searchParams;
  // Rewrites deliver the original path via ?__path= (see vercel.json).
  const p = q.get("__path") ? "/api/" + q.get("__path") : u.pathname;
  const body = req.body || {};

  try {
    if (req.method === "GET" && p === "/api/health") {
      return res.status(200).json({
        ok: true, model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        hasKey: !!process.env.OPENAI_API_KEY,
        googleClientId: process.env.GOOGLE_CLIENT_ID || null,
        emailDelivery: emailTransport(),
        storage: (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) ? "redis" : "ephemeral",
      });
    }

    if (req.method === "POST" && p === "/api/auth/email/start") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "invalid_email" });
      const code = makeCode(email);
      let delivered = false;
      try { delivered = await sendCodeEmail(email, code); }
      catch (e) { console.error("email send failed:", e.message); }
      const echo = process.env.DEV_ECHO_CODES === "true";
      return res.status(200).json({ ok: true, delivered, devCode: echo && !delivered ? code : undefined });
    }

    if (req.method === "POST" && p === "/api/auth/email/verify") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!checkCode(email, body.code)) return res.status(400).json({ error: "wrong_code" });
      const session = makeSession(email);
      const existed = !!(await kvGet("state:" + session.userId));
      await migrateGuestState(session.userId, body.guestState);
      await track(body.uid, email, [{ event: existed ? "sign_in" : "register", meta: { method: "email" } }]);
      return res.status(200).json({ ok: true, session });
    }

    if (req.method === "GET" && p === "/api/auth/google/start") {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const redirect = process.env.GOOGLE_REDIRECT_URI || (originOf(req) + "/auth/google/callback");
      if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return res.status(500).json({ error: "google_not_configured" });
      const qp = new URLSearchParams({
        client_id: clientId, redirect_uri: redirect, response_type: "code",
        scope: "openid email profile", prompt: "select_account",
        state: makeOauthState(q.get("ctx"), q.get("uid")),
      });
      res.statusCode = 302;
      res.setHeader("Location", "https://accounts.google.com/o/oauth2/v2/auth?" + qp.toString());
      return res.end();
    }

    if (req.method === "GET" && p === "/api/auth/google/callback") {
      const origin = originOf(req);
      let payload;
      const st = checkOauthState(q.get("state"));
      const ctx = st && st.ctx;
      if (q.get("error") || !ctx) {
        payload = { type: "nomi-gauth-error", error: q.get("error") || "bad_state" };
      } else {
        const redirect = process.env.GOOGLE_REDIRECT_URI || (origin + "/auth/google/callback");
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: q.get("code") || "", client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: redirect, grant_type: "authorization_code",
          }).toString(),
        });
        if (!r.ok) {
          console.error("google exchange failed:", (await r.text().catch(() => "")).slice(0, 200));
          payload = { type: "nomi-gauth-error", error: "google_exchange_failed" };
        } else {
          const tok = await r.json();
          let claims = null;
          try {
            const part = String(tok.id_token).split(".")[1];
            claims = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
          } catch {}
          if (!claims || claims.aud !== process.env.GOOGLE_CLIENT_ID || !claims.email || claims.email_verified === false) {
            payload = { type: "nomi-gauth-error", error: "google_bad_token" };
          } else {
            const gmail = String(claims.email).toLowerCase();
            const session = makeSession(gmail);
            const existed = !!(await kvGet("state:" + session.userId));
            await track(st.uid, gmail, [{ event: existed ? "sign_in" : "register", meta: { method: "google" } }]);
            payload = { type: "nomi-gauth", token: session.token, identity: session.identity, ctx };
          }
        }
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;color:#46566A">
<script>
(function(){
  var data=${JSON.stringify(payload)};
  if(window.opener){
    ["https://www.zeyaai.com","https://zeyaai.com",${JSON.stringify(origin)}].forEach(function(o){
      try{window.opener.postMessage(data,o);}catch(e){}
    });
    window.close();
  }
  else if(data.type==="nomi-gauth"){ location.href="/nomi#gauth="+encodeURIComponent(data.token)+"&gid="+encodeURIComponent(data.identity); }
  else{ document.body.textContent="Sign-in failed: "+(data.error||"unknown")+". You can close this window."; }
})();
</script>
Signing you in… you can close this window.</body>`);
    }

    // Images are stored as individual Redis entries so account saves stay
    // small and photos always persist. GET serves raw bytes for <img src>.
    if (req.method === "POST" && p === "/api/image") {
      const sess = sessionFromToken(tokenFrom(req));
      if (!sess) return res.status(401).json({ error: "auth_required" });
      const img = String(body.img || "");
      if (!img.startsWith("data:image") || img.length > 950000) return res.status(400).json({ error: "bad_image" });
      const hash = crypto.createHash("sha1").update(img).digest("hex").slice(0, 20);
      const id = sess.userId + ":" + hash;
      const ok = await kvSet("img:" + id, img);
      if (!ok) return res.status(500).json({ error: "store_failed" });
      return res.status(200).json({ id });
    }

    if (req.method === "GET" && p === "/api/image") {
      const id = String(q.get("id") || "");
      if (!/^u_[0-9a-f]{16}:[0-9a-f]{20}$/.test(id)) return res.status(400).json({ error: "bad_id" });
      const img = await kvGet("img:" + id);
      if (!img) return res.status(404).json({ error: "not_found" });
      const m = String(img).match(/^data:(image\/[\w.+-]+);base64,(.*)$/s);
      if (!m) return res.status(500).json({ error: "bad_stored_image" });
      res.setHeader("Content-Type", m[1]);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.status(200).end(Buffer.from(m[2], "base64"));
    }

    if (req.method === "POST" && p === "/api/track") {
      const sess = sessionFromToken(tokenFrom(req));
      await track(body.uid, sess ? sess.identity : null, Array.isArray(body.events) ? body.events : []);
      return res.status(200).json({ ok: true });
    }

    if (req.method === "POST" && p === "/api/auth/signout") {
      return res.status(200).json({ ok: true }); // stateless tokens: client discards
    }

    if (req.method === "POST" && p === "/api/generate") {
      const ip = req.headers["x-forwarded-for"] || "?";
      if (rateLimited(String(ip))) return res.status(429).json({ error: "rate_limited" });
      if (!body.idea || String(body.idea).trim().length < 3) return res.status(400).json({ error: "idea_required" });
      const brief = await researchBrief(body.idea, body.category);
      const { parsed, usage, model } = await callOpenAI(buildMessages({
        idea: body.idea, self: body.self, contentLang: body.contentLang || "en", category: body.category, brief,
      }), { maxTokens: 3200 });
      const drafts = validateDrafts(parsed.drafts);
      const cat = body.category || "lifestyle";
      for (const d of drafts) {
        d.tags = ensureTagMix(d.tags, body.contentLang || "en", cat);
        d.bestTime = bestTime(cat, d.register);
      }
      const projectName = stripMarkdown(parsed.projectName || "").slice(0, 60) || String(body.idea).slice(0, 40);
      const researched = !!brief;
      const projectId = "p_" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
      const sess = sessionFromToken(tokenFrom(req));
      if (sess) {
        const cur = (await kvGet("state:" + sess.userId)) || {};
        const projects = Array.isArray(cur.projects) ? cur.projects : [];
        projects.unshift({
          id: projectId, name: projectName, idea: body.idea,
          contentLang: body.contentLang || "en", category: cat,
          drafts, covers: [null, null, null], ordList: [0, 1, 2],
          createdAt: new Date().toISOString(),
        });
        cur.projects = projects.slice(0, 30);
        await kvSet("state:" + sess.userId, cur);
      }
      await track(body.uid, sess ? sess.identity : null, [{ event: "generate", meta: { researched, category: cat, lang: body.contentLang || "en" } }]);
      return res.status(200).json({ drafts, projectName, projectId, model, usage, researched });
    }

    if (req.method === "POST" && p === "/api/refine") {
      const ip = req.headers["x-forwarded-for"] || "?";
      if (rateLimited(String(ip))) return res.status(429).json({ error: "rate_limited" });
      if (!body.draft || !body.instruction) return res.status(400).json({ error: "draft_and_instruction_required" });
      const draft = body.draft;
      const wantsShorter = /short|concise|trim|更短|精简|短一|简短/i.test(String(body.instruction));
      const cap = Math.max(120, Math.floor(String(draft.body || "").length * 0.6));
      let instruction = String(body.instruction);
      if (wantsShorter) instruction += ` (HARD CONSTRAINT: the revised body must be UNDER ${cap} characters total. Cut whole items or lines; do not compress by removing line breaks.)`;
      const { parsed, usage } = await callOpenAI(
        buildRefineMessages({ draft, instruction, self: body.self, contentLang: body.contentLang || "en" }),
        { maxTokens: 1200, temperature: 0.7 });
      if (wantsShorter && String(parsed.body || "").length > cap) parsed.body = localShorten(String(parsed.body || draft.body), cap);
      const out = {
        register: draft.register,
        title: stripMarkdown(parsed.title || draft.title).slice(0, 120),
        body: stripMarkdown(parsed.body || draft.body).slice(0, 4000),
        tags: ensureTagMix(
          Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags.slice(0, 8).map(t => String(t).slice(0, 40)) : draft.tags || [],
          body.contentLang || "en", body.category || "lifestyle"),
        coverConcept: draft.coverConcept || "",
        firstComment: draft.firstComment || "",
        bestTime: draft.bestTime || bestTime(body.category || "lifestyle", draft.register),
      };
      const sessR = sessionFromToken(tokenFrom(req));
      await track(body.uid, sessR ? sessR.identity : null, [{ event: "refine", meta: { instruction: String(body.instruction).slice(0, 60) } }]);
      return res.status(200).json({ draft: out, usage });
    }

    if (req.method === "POST" && p === "/api/voicecheck") {
      const ip = req.headers["x-forwarded-for"] || "?";
      if (rateLimited(String(ip))) return res.status(429).json({ error: "rate_limited" });
      const { parsed, usage } = await callOpenAI(
        buildVoiceCheckMessages({ self: body.self, contentLang: body.contentLang || "en" }),
        { maxTokens: 350, temperature: 0.9 });
      return res.status(200).json({
        title: stripMarkdown(parsed.title || "").slice(0, 90),
        body: stripMarkdown(parsed.body || "").slice(0, 700),
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 3).map(t => String(t).slice(0, 30)) : [],
        usage,
      });
    }

    if (req.method === "POST" && p === "/api/vision/page") {
      if (!body.image || !String(body.image).startsWith("data:image")) return res.status(400).json({ error: "image_required" });
      const messages = [
        { role: "system", content: "You analyze screenshots of Xiaohongshu/RedNote profile pages. Return JSON only." },
        { role: "user", content: [
          { type: "text", text: 'This is a screenshot of a Xiaohongshu/RedNote notes grid (profile page, explore feed, or search results). Work TITLE-FIRST, in this exact order: STEP 1 - find every note TITLE text in the grid, in reading order (left column top-to-bottom interleaved with right column by vertical position). A note title is a text line sitting directly BELOW a cover photo, usually with an author row or like-count beneath it. STEP 2 - for each title, the note cover photo is the image block DIRECTLY ABOVE that title, in the same column, same card width. STEP 3 - return, per note: the title text, the WHOLE card box, the COVER PHOTO box (the photo only - it must NOT include the title text, the author row, any status bar, tab header, or text strip; photo boxes in one column share the same x and w), the normalized y where the title text STARTS (ty), and "complete": true only if the cover photo is FULLY visible - set false if it is cut off by the screenshot edge, hidden behind headers/tabs, or only partially shown. STRICTLY EXCLUDE: the status bar, profile header, tab labels, the bottom navigation bar (Home/Market/Messages/Me icons), floating buttons, and any region without a note title. All boxes NORMALIZED to the full image: x, y = top-left (0-1), w, h = width/height (0-1). If the image contains no note cards, return an empty list. Return JSON exactly: {"cells":[{"title":"...","x":0.0,"y":0.0,"w":0.0,"h":0.0,"ix":0.0,"iy":0.0,"iw":0.0,"ih":0.0,"ty":0.0,"complete":true}]}' },
          { type: "image_url", image_url: { url: body.image, detail: "high" } },
        ]},
      ];
      const { parsed, usage } = await callOpenAI(messages, { maxTokens: 1200, temperature: 0.1 });
      const cells = Array.isArray(parsed.cells) ? parsed.cells.slice(0, 12).map(c => {
        const cell = {
          title: String(c.title || "").slice(0, 80),
          x: clamp01(c.x), y: clamp01(c.y), w: clamp01(c.w), h: clamp01(c.h),
          ix: clamp01(c.ix), iy: clamp01(c.iy), iw: clamp01(c.iw), ih: clamp01(c.ih),
          complete: c.complete !== false,
        };
        if (cell.iw < 0.03 || cell.ih < 0.03) { cell.ix = cell.x; cell.iy = cell.y; cell.iw = cell.w; cell.ih = cell.h * 0.8; }
        // Geometric discipline: the photo can never extend past the top of its
        // own title text, and edge-cut photos are not complete.
        const ty = clamp01(c.ty);
        if (ty > cell.iy + 0.02) cell.ih = Math.min(cell.ih, ty - cell.iy - 0.004);
        if (cell.ih < 0.04) cell.complete = false;
        if (cell.iy < 0.005 || cell.iy + cell.ih > 0.995) cell.complete = false;
        return cell;
      }).filter(c => c.w > 0.04 && c.h > 0.03 && c.title && c.title.trim().length > 0) : [];
      return res.status(200).json({ cells, usage });
    }

    if (req.method === "POST" && p === "/api/vision/text") {
      if (!body.image || !String(body.image).startsWith("data:image")) return res.status(400).json({ error: "image_required" });
      const messages = [
        { role: "system", content: "You transcribe text from social-media screenshots. Return JSON only." },
        { role: "user", content: [
          { type: "text", text: 'Transcribe the post text visible in this screenshot (title and body). Ignore UI labels, usernames, counts, and buttons. Return JSON exactly: {"text":"..."} with the transcription, or {"text":""} if no post text is readable.' },
          { type: "image_url", image_url: { url: body.image, detail: "high" } },
        ]},
      ];
      const { parsed, usage } = await callOpenAI(messages, { maxTokens: 700, temperature: 0 });
      return res.status(200).json({ text: String(parsed.text || "").slice(0, 2000), usage });
    }

    if (req.method === "POST" && p === "/api/waitlist") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "invalid_email" });
      const list = (await kvGet("waitlist")) || [];
      if (!list.some(e => e.email === email)) list.push({ email, joinedAt: new Date().toISOString(), source: body.source || "nomi" });
      await kvSet("waitlist", list);
      console.log(`[waitlist] ${email}`);
      const sessW = sessionFromToken(tokenFrom(req));
      await track(body.uid, (sessW && sessW.identity) || email, [{ event: "waitlist_join" }]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === "POST" && p === "/api/state/save") {
      const sess = sessionFromToken(tokenFrom(req));
      if (!sess) return res.status(401).json({ error: "auth_required" });
      const stored = await migrateGuestState(sess.userId, body);
      if (stored === false) return res.status(500).json({ error: "store_failed" });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "GET" && p === "/api/state") {
      const sess = sessionFromToken(tokenFrom(req));
      if (!sess) return res.status(401).json({ error: "auth_required" });
      const cur = (await kvGet("state:" + sess.userId)) || {};
      return res.status(200).json({
        ok: true, identity: sess.identity,
        redNoteExperience: cur.redNoteExperience || null,
        state: cur.self ? cur : null,
        projects: Array.isArray(cur.projects) ? cur.projects : [],
      });
    }

    return res.status(404).json({ error: "not_found" });
  } catch (err) {
    console.error(`[error] ${req.method} ${p}:`, err.message);
    return res.status(500).json({ error: "server_error", detail: err.message });
  }
}
