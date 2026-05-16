import { BedtimeSuggestion, CareEvent, ChildMemory, ChildProfile, EventType, SupplyItem } from "./types";

export const labels: Record<EventType, string> = {
  wake: "Wake",
  nap_start: "Nap start",
  nap_end: "Nap end",
  meal: "Meal",
  milk: "Milk",
  water: "Water",
  poop: "Poop",
  diaper: "Diaper",
  medicine: "Medicine",
  mood: "Mood",
  symptom: "Symptom",
  supply: "Supply",
  note: "Note",
  bedtime: "Bedtime",
};

export function formatTime(value?: string) {
  if (!value) return "Not logged";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(value);
}

export function getTodayEvents(events: CareEvent[]) {
  const now = new Date();
  return events.filter((event) => {
    const date = new Date(event.timestamp);
    return date.toDateString() === now.toDateString();
  });
}

export function getLast7DaysEvents(events: CareEvent[]) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  return events.filter((event) => new Date(event.timestamp) >= cutoff);
}

export function getLastEventByType(events: CareEvent[], type: EventType) {
  return [...events]
    .filter((event) => event.type === type)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
}

export function calculateFluidTotals(events: CareEvent[]) {
  return events.reduce(
    (totals, event) => {
      if ((event.type === "milk" || event.type === "water") && event.amount) totals[event.type] += event.amount;
      return totals;
    },
    { milk: 0, water: 0 },
  );
}

export function calculateNapDuration(events: CareEvent[]) {
  const start = getLastEventByType(events, "nap_start");
  const end = getLastEventByType(events, "nap_end");
  if (!start || !end) return "";
  const minutes = Math.max(0, Math.round((new Date(end.timestamp).getTime() - new Date(start.timestamp).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function addMinutes(value: Date, minutes: number) {
  const next = new Date(value);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

export function suggestBedtimeWindow(events: CareEvent[], profile: ChildProfile, memories: ChildMemory[] = []): BedtimeSuggestion {
  const napEnd = getLastEventByType(getTodayEvents(events), "nap_end");
  const sleepMemory = memories.find((memory) => memory.type === "sleep_pattern");
  if (!napEnd) {
    return {
      window: profile.usualBedtime,
      reason: "Tiny has not heard when nap ended today, so this uses the usual bedtime from Emma's profile.",
      confidence: "low",
    };
  }

  const end = new Date(napEnd.timestamp);
  const hour = end.getHours() + end.getMinutes() / 60;
  const early = hour > 14.5 ? 315 : 300;
  const late = hour > 14.5 ? 345 : 330;
  return {
    window: `${formatTime(addMinutes(end, early).toISOString())}-${formatTime(addMinutes(end, late).toISOString())}`,
    reason:
      hour > 14.5
        ? "Nap ended after 2:30 PM, so bedtime can slide later while watching tired signs."
        : sleepMemory?.statement ?? "Nap ended in the early afternoon, so 5-5.5 hours of wake time is a reasonable target.",
    confidence: sleepMemory ? sleepMemory.confidence : "medium",
  };
}

export function describeEvent(event: CareEvent) {
  const parts = [labels[event.type]];
  if (event.amount) parts.push(`${event.amount} ${event.unit ?? ""}`.trim());
  if (event.status) parts.push(String(event.status));
  if (event.mood) parts.push(event.mood);
  return parts.join(" - ");
}

export function generateDashboardContext(profile: ChildProfile, events: CareEvent[], memories: ChildMemory[], supplies: SupplyItem[]) {
  const today = getTodayEvents(events);
  const napEnd = getLastEventByType(today, "nap_end");
  const poop = getLastEventByType(today, "poop");
  const bedtime = suggestBedtimeWindow(events, profile, memories);
  const unpacked = supplies.filter((item) => item.needed && !item.packed);
  const poopText = poop ? `Poop was around ${formatTime(poop.timestamp)}.` : "Tiny has not heard about poop today, so offer water and keep an eye on it.";
  return `${profile.name} is mostly on track today. Nap ended ${napEnd ? `at ${formatTime(napEnd.timestamp)}` : "not heard yet"}. Suggested bedtime: ${bedtime.window}. ${poopText}${unpacked.length ? ` Pack ${unpacked.map((item) => item.name.toLowerCase()).join(", ")} tomorrow.` : ""}`;
}

export function generateHandoffSummary(
  profile: ChildProfile,
  events: CareEvent[],
  memories: ChildMemory[],
  recipient: "spouse" | "nanny" | "daycare",
) {
  const today = getTodayEvents(events);
  const wake = getLastEventByType(today, "wake");
  const napStart = getLastEventByType(today, "nap_start");
  const napEnd = getLastEventByType(today, "nap_end");
  const meal = getLastEventByType(today, "meal");
  const poop = getLastEventByType(today, "poop");
  const mood = getLastEventByType(today, "mood");
  const totals = calculateFluidTotals(today);
  const bedtime = suggestBedtimeWindow(events, profile, memories);

  if (recipient === "daycare") {
    const poopConcern = getLast7DaysEvents(events).filter((event) => event.type === "poop" && event.status === "hard").length >= 1;
    return `Hi! ${profile.name} ${poopConcern ? "has had some hard poop recently, so could you please offer extra water and note any discomfort?" : "is doing well today."} ${meal ? `Last meal note: ${meal.note ?? meal.status}.` : ""} ${totals.water ? `Water today: ${totals.water} oz.` : ""} Thank you!`;
  }

  const base = `${profile.name} woke ${wake ? `around ${formatTime(wake.timestamp)}` : "with no wake time shared"}, napped ${napStart && napEnd ? `from ${formatTime(napStart.timestamp)}-${formatTime(napEnd.timestamp)}` : "with nap details incomplete"}, drank ${totals.milk} oz milk${totals.water ? ` and ${totals.water} oz water` : ""}, and ${poop ? `had a ${poop.status ?? ""} poop` : "has no poop note today"}.`;
  const ending = ` ${mood ? `Mood: ${mood.mood ?? mood.status}. ` : ""}I'd aim for bedtime around ${bedtime.window}.`;
  return recipient === "spouse" ? base + ending : `${base} Please offer water, watch tired signs, and use bedtime around ${bedtime.window}.`;
}

export function generateDaycarePrep(profile: ChildProfile, supplies: SupplyItem[], events: CareEvent[]) {
  const needed = supplies.filter((item) => item.needed && !item.packed);
  const supplyNotes = getTodayEvents(events).filter((event) => event.type === "supply");
  if (!needed.length) return `${profile.name}'s daycare bag looks ready. Check water bottle in the morning.`;
  return `Pack ${needed.map((item) => item.name).join(", ")}. ${supplyNotes.map((event) => event.note).filter(Boolean).join(" ")} Morning reminder: check recurring items before leaving.`;
}

export function generateDaycareDecisionSupport(profile: ChildProfile, events: CareEvent[]) {
  const recent = getLast7DaysEvents(events);
  const daycareDistress = recent.filter((event) => event.note?.match(/daycare|caregiver|teacher/i) && event.note?.match(/cry|refus|not eat|upset|distress|rough/i));
  const concerning = recent.some((event) => event.note?.match(/injury|bruise|unsafe|neglect|left alone|blood|dehydrat|letharg|breathing|severe pain/i));

  if (concerning) {
    return `Trust your gut. If daycare feels unsafe or ${profile.name} has concerning symptoms or unexplained injuries, pause and contact the daycare director, your pediatrician, or urgent care depending on severity. Ask for exactly what happened today, when she ate, how long she cried, and who was with her.`;
  }

  if (daycareDistress.length >= 2) {
    return `I would not decide from panic alone, but this is enough to take seriously. Ask daycare for a clear timeline tomorrow: crying length, food offered, naps, diaper, and what helped. If this keeps repeating or they cannot explain it clearly, consider a short break or backup care while you investigate.`;
  }

  return `One rough daycare day does not automatically mean you should stop sending her. For tomorrow, ask the teachers what changed, how long she cried, whether she ate anything, and what helped. If she is still very distressed after pickup, refusing fluids, feverish, unusually sleepy, or daycare cannot give clear answers, keep her home and check with your pediatrician.`;
}

export function generateDoctorSummary(profile: ChildProfile, events: CareEvent[]) {
  const recent = getLast7DaysEvents(events);
  const symptoms = recent.filter((event) => event.type === "symptom" || event.note?.match(/blood|fever|vomit|pain|dehydrat/i));
  const hardPoops = recent.filter((event) => event.type === "poop" && event.status === "hard");
  const fluids = calculateFluidTotals(recent);
  const escalation = symptoms.length ? " There were concerning notes in the log, so please advise whether she should be seen." : "";
  return `Hi Doctor, ${profile.name} has had ${hardPoops.length} hard stool log(s) in the last week. Recent fluid logs total ${fluids.water} oz water and ${fluids.milk} oz milk across logged entries. Notes: ${[...hardPoops, ...symptoms].map((event) => event.note).filter(Boolean).join("; ") || "none"}.${escalation}`;
}

export function constipationWatch(events: CareEvent[]) {
  const recent = getLast7DaysEvents(events);
  const hard = recent.filter((event) => event.type === "poop" && event.status === "hard");
  const serious = recent.some((event) => event.note?.match(/blood|severe pain|vomit|fever|breathing|dehydrat/i));
  return `${hard.length ? `${hard.length} hard poop log(s) in the last 7 days. ` : "No hard poop pattern in the last 7 days. "}Based on logs, this is worth tracking with water intake, stool status, and discomfort notes. ${serious ? "Because a concerning symptom is mentioned, consider contacting your pediatrician or urgent care depending on severity." : "This is not a diagnosis; consider asking your pediatrician if it continues or worsens."}`;
}

export function detectMemoryCandidates(profile: ChildProfile, events: CareEvent[], supplies: SupplyItem[], memories: ChildMemory[]) {
  const existing = new Set(memories.map((memory) => memory.statement));
  const candidates: ChildMemory[] = [];
  const now = new Date().toISOString();
  const napEnds = events.filter((event) => event.type === "nap_end");
  const bedtimes = events.filter((event) => event.type === "bedtime");
  const hardPoops = getLast7DaysEvents(events).filter((event) => event.type === "poop" && event.status === "hard");

  const push = (statement: string, type: ChildMemory["type"], evidenceCount: number, confidence: ChildMemory["confidence"]) => {
    if (!existing.has(statement)) {
      candidates.push({ id: crypto.randomUUID(), childId: profile.id, type, statement, confidence, evidenceCount, userConfirmed: false, createdAt: now, updatedAt: now });
    }
  };

  if (napEnds.length >= 3) push(`${profile.name}'s nap often ends near ${formatTime(napEnds.at(-1)?.timestamp)}.`, "sleep_pattern", napEnds.length, "medium");
  if (bedtimes.length >= 3) push(`${profile.name}'s bedtime is usually close to ${profile.usualBedtime}.`, "sleep_pattern", bedtimes.length, "medium");
  if (hardPoops.length >= 2) push("Hard poop appeared 2+ times this week, so it is worth tracking water and discomfort.", "poop_pattern", hardPoops.length, "medium");
  supplies.filter((item) => item.needed && item.recurring).forEach((item) => push(`${item.name} is a recurring daycare bag check.`, "daycare_supply", 2, "low"));
  return candidates;
}

export function classifyAskTinyIntent(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("bedtime")) return "bedtime";
  if ((lower.includes("daycare") || lower.includes("day care")) && lower.match(/keep sending|send her|send him|stop|pull|safe|okay|ok|should i|there/i)) return "daycare_decision";
  if (lower.includes("daycare") || lower.includes("pack")) return "daycare";
  if (lower.includes("poop") || lower.includes("constipation")) return "constipation";
  if (lower.includes("doctor") || lower.includes("pediatrician")) return "doctor";
  return "handoff";
}

function timestampForMention(text: string, fallback = new Date()) {
  const lower = text.toLowerCase();
  const match = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!match) return fallback.toISOString();
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const suffix = match[3];
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (!suffix && hour >= 1 && hour <= 5 && lower.match(/nap|meal|dinner|bed|evening/)) hour += 12;
  const date = new Date(fallback);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function amountFor(text: string) {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(oz|ounce|ounces|ml|cup|cups)\b/i);
  if (!match) return {};
  const unit = match[2].toLowerCase().startsWith("ounce") ? "oz" : match[2].toLowerCase();
  return { amount: Number(match[1]), unit };
}

function makeParsedEvent(childId: string, type: EventType, text: string, timestamp?: string): CareEvent {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    childId,
    type,
    timestamp: timestamp ?? timestampForMention(text),
    note: text.trim(),
    createdAt: now,
    updatedAt: now,
  };
}

export function parseNaturalCareEntry(text: string, childId: string) {
  const normalized = text
    .replace(/\band then\b/gi, ",")
    .replace(/\bthen\b/gi, ",")
    .replace(/\n/g, ",");
  const chunks = normalized
    .split(/[,;.]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const source = chunks.length ? chunks : [text.trim()];
  const events: CareEvent[] = [];

  source.forEach((chunk) => {
    const lower = chunk.toLowerCase();
    const timestamp = timestampForMention(chunk);
    if (lower.match(/\b(woke|wake|woke up)\b/)) events.push(makeParsedEvent(childId, "wake", chunk, timestamp));
    if (lower.includes("nap")) {
      const times = [...chunk.matchAll(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/gi)].map((match) => match[1]);
      const firstNapTime = times[0];
      const lastNapTime = times[times.length - 1];
      if (lower.match(/start|down|began|from/) || times.length >= 2) events.push(makeParsedEvent(childId, "nap_start", `Nap start: ${chunk}`, firstNapTime ? timestampForMention(firstNapTime, new Date(timestamp)) : timestamp));
      if (lower.match(/end|up|woke|to|until/) || times.length >= 2) events.push(makeParsedEvent(childId, "nap_end", `Nap end: ${chunk}`, lastNapTime ? timestampForMention(lastNapTime, new Date(timestamp)) : timestamp));
    }
    if (lower.match(/\b(milk|bottle|formula|nursed|nursing)\b/)) events.push({ ...makeParsedEvent(childId, "milk", chunk, timestamp), ...amountFor(chunk), unit: amountFor(chunk).unit ?? "oz" });
    if (lower.match(/\b(water|hydration)\b/)) events.push({ ...makeParsedEvent(childId, "water", chunk, timestamp), ...amountFor(chunk), unit: amountFor(chunk).unit ?? "oz" });
    if (lower.match(/\b(ate|meal|breakfast|lunch|dinner|snack|food|pasta|refused)\b/)) {
      const status = lower.includes("refused") ? "refused" : lower.includes("well") ? "ate well" : lower.includes("some") ? "ate some" : undefined;
      events.push({ ...makeParsedEvent(childId, "meal", chunk, timestamp), status });
    }
    if (lower.match(/\b(poop|stool|bm)\b/)) {
      const status = lower.match(/hard|constipat/) ? "hard" : lower.match(/watery|wet|loose|runny/) ? "watery" : lower.includes("soft") ? "soft" : lower.includes("normal") ? "normal" : undefined;
      events.push({ ...makeParsedEvent(childId, "poop", chunk, timestamp), status });
    }
    if (lower.match(/\b(diaper|nappy)\b/) && lower.match(/\b(changed|change|just changed|new)\b/)) events.push(makeParsedEvent(childId, "diaper", chunk, timestamp));
    if (lower.match(/\b(crying|cried|upset|unsettled)\b/)) events.push({ ...makeParsedEvent(childId, "mood", chunk, timestamp), mood: "fussy", status: "fussy" });
    if (lower.match(/\b(happy|tired|clingy|fussy|sick|energetic)\b/)) {
      const mood = (["happy", "tired", "clingy", "fussy", "sick", "energetic"] as const).find((item) => lower.includes(item));
      events.push({ ...makeParsedEvent(childId, "mood", chunk, timestamp), mood, status: mood });
    }
    if (lower.match(/\b(medicine|meds|tylenol|motrin|dose)\b/)) events.push(makeParsedEvent(childId, "medicine", chunk, timestamp));
    if (lower.match(/\b(wipes|diapers|clothes|bottle|blanket|sunscreen|hat|shoes|bib).*\b(need|needed|low|pack|bring)\b/)) events.push({ ...makeParsedEvent(childId, "supply", chunk, timestamp), status: "needed" });
    if (lower.match(/\b(bedtime|bed|asleep|sleep|settled)\b/) && !lower.includes("nap")) events.push(makeParsedEvent(childId, "bedtime", chunk, timestamp));
    if (lower.match(/\b(fever|vomit|blood|rash|cough|pain|dehydrat|breathing)\b/)) events.push(makeParsedEvent(childId, "symptom", chunk, timestamp));
  });

  if (!events.length && text.trim()) events.push(makeParsedEvent(childId, "note", text));
  return events;
}
