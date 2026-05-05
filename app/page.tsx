"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Baby,
  Brain,
  Check,
  Clock3,
  Copy,
  Droplets,
  FileText,
  Home as HomeIcon,
  List,
  Mic,
  Moon,
  Package,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Utensils,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  deleteEvent,
  deleteMemory,
  getChildProfile,
  getEvents,
  getMemories,
  getSupplies,
  saveEvent,
  saveMemory,
  saveSupplies,
  updateMemory,
} from "@/lib/storage";
import { CareEvent, ChildMemory, EventType, Mood, SupplyItem, TinyState } from "@/lib/types";
import {
  calculateFluidTotals,
  calculateNapDuration,
  classifyAskTinyIntent,
  constipationWatch,
  describeEvent,
  detectMemoryCandidates,
  formatDate,
  formatTime,
  generateDashboardContext,
  generateDaycarePrep,
  generateDoctorSummary,
  generateHandoffSummary,
  getLast7DaysEvents,
  getLastEventByType,
  getTodayEvents,
  labels,
  parseNaturalCareEntry,
  suggestBedtimeWindow,
} from "@/lib/utils";

type Tab = "today" | "timeline" | "handoff" | "memory";
const eventTypes: EventType[] = ["wake", "nap_start", "nap_end", "meal", "milk", "water", "poop", "mood", "medicine", "note", "supply", "bedtime"];
const promptChips = [
  "What bedtime makes sense tonight?",
  "What should I tell daycare tomorrow?",
  "Any poop pattern this week?",
  "Generate a doctor summary.",
  "What should Dad know tonight?",
  "What should I pack tomorrow?",
];

const iconClass = "h-5 w-5";

function EventIcon({ type, className = iconClass }: { type: EventType; className?: string }) {
  const Icon = eventIcon(type);
  return <Icon className={className} strokeWidth={2.4} />;
}

function eventIcon(type: EventType): LucideIcon {
  const icons: Partial<Record<EventType, LucideIcon>> = {
    wake: Clock3,
    nap_start: Moon,
    nap_end: Clock3,
    meal: Utensils,
    milk: Droplets,
    water: Droplets,
    poop: AlertTriangle,
    diaper: Baby,
    medicine: AlertTriangle,
    mood: Sparkles,
    symptom: AlertTriangle,
    supply: Package,
    note: FileText,
    bedtime: Moon,
  };
  return icons[type] ?? Sparkles;
}

function IconBubble({ icon: Icon, tone = "neutral" }: { icon: LucideIcon; tone?: "pink" | "sage" | "warn" | "neutral" }) {
  const toneClass =
    tone === "pink"
      ? "bg-[#ff6fb1] text-black"
      : tone === "sage"
        ? "bg-sage text-black"
        : tone === "warn"
          ? "bg-[#ff8a65]/20 text-[#ffb49b]"
          : "bg-white/10 text-zinc-200";
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${toneClass}`}>
      <Icon className="h-5 w-5" strokeWidth={2.4} />
    </span>
  );
}

export default function Home() {
  const [profile, setProfile] = useState(getChildProfile);
  const [events, setEventState] = useState<CareEvent[]>([]);
  const [supplies, setSupplyState] = useState<SupplyItem[]>([]);
  const [memories, setMemoryState] = useState<ChildMemory[]>([]);
  const [tab, setTab] = useState<Tab>("today");
  const [modalType, setModalType] = useState<EventType | null>(null);
  const [toast, setToast] = useState("");
  const [showCapture, setShowCapture] = useState(false);

  const applyState = (state: TinyState) => {
    setProfile(state.profile);
    setEventState(state.events);
    setSupplyState(state.supplies);
    setMemoryState(state.memories);
  };

  const refresh = async () => {
    try {
      const response = await fetch("/api/state");
      if (!response.ok) throw new Error("State fetch failed");
      applyState((await response.json()) as TinyState);
    } catch {
      setProfile(getChildProfile());
      setEventState(getEvents());
      setSupplyState(getSupplies());
      setMemoryState(getMemories());
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const saveLog = async (event: CareEvent) => {
    await saveLogs([event]);
    setModalType(null);
  };

  const saveLogs = async (newEvents: CareEvent[]) => {
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: newEvents }),
      });
      if (!response.ok) throw new Error("Event save failed");
      const state = (await response.json()) as TinyState;
      const candidates = detectMemoryCandidates(state.profile, state.events, state.supplies, state.memories);
      for (const memory of candidates) {
        await fetch("/api/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memory }),
        });
      }
      await refresh();
    } catch {
      newEvents.forEach((event) => saveEvent(event));
      const nextEvents = getEvents();
      const candidates = detectMemoryCandidates(profile, nextEvents, supplies, getMemories());
      candidates.forEach((memory) => saveMemory(memory));
      setEventState(nextEvents);
      setMemoryState(getMemories());
    }
    setToast(`${newEvents.length} item${newEvents.length === 1 ? "" : "s"} saved`);
    window.setTimeout(() => setToast(""), 1800);
  };

  const removeEvent = async (id: string) => {
    try {
      const response = await fetch(`/api/events?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Event delete failed");
      applyState((await response.json()) as TinyState);
    } catch {
      deleteEvent(id);
      await refresh();
    }
  };

  const updateMemoryItem = async (memory: ChildMemory) => {
    const nextMemory = { ...memory, updatedAt: new Date().toISOString() };
    try {
      const response = await fetch("/api/memories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory: nextMemory }),
      });
      if (!response.ok) throw new Error("Memory update failed");
      applyState((await response.json()) as TinyState);
    } catch {
      updateMemory(nextMemory);
      await refresh();
    }
  };

  const removeMemory = async (id: string) => {
    try {
      const response = await fetch(`/api/memories?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Memory delete failed");
      applyState((await response.json()) as TinyState);
    } catch {
      deleteMemory(id);
      await refresh();
    }
  };

  const updateSupplies = async (items: SupplyItem[]) => {
    try {
      const response = await fetch("/api/supplies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplies: items }),
      });
      if (!response.ok) throw new Error("Supplies save failed");
      applyState((await response.json()) as TinyState);
    } catch {
      saveSupplies(items);
      await refresh();
    }
  };

  const bedtime = useMemo(() => suggestBedtimeWindow(events, profile, memories), [events, profile, memories]);

  return (
    <AppShell tab={tab} setTab={setTab} toast={toast} onTalk={() => setShowCapture(true)}>
      {tab === "today" && (
        <TodayDashboard
          profile={profile}
          events={events}
          memories={memories}
          supplies={supplies}
          bedtime={bedtime}
          onSmartSave={saveLogs}
          onViewDetails={() => setTab("timeline")}
        />
      )}
      {tab === "timeline" && <Timeline events={events} onDelete={(id) => void removeEvent(id)} />}
      {tab === "handoff" && <Handoff profile={profile} events={events} memories={memories} />}
      {tab === "memory" && (
        <MemoryScreen
          profileName={profile.name}
          memories={memories}
          onUpdate={(memory: ChildMemory) => void updateMemoryItem(memory)}
          onDelete={(id: string) => void removeMemory(id)}
          supplies={supplies}
          setSupplies={(items: SupplyItem[]) => void updateSupplies(items)}
        />
      )}
      {modalType && <EventModal type={modalType} childId={profile.id} onClose={() => setModalType(null)} onSave={saveLog} />}
      {showCapture && (
        <CaptureSheet onClose={() => setShowCapture(false)}>
          <AgentComposer profile={profile} events={events} memories={memories} supplies={supplies} onSave={saveLogs} expanded />
        </CaptureSheet>
      )}
    </AppShell>
  );
}

function AppShell({ children, tab, setTab, toast, onTalk }: { children: React.ReactNode; tab: Tab; setTab: (tab: Tab) => void; toast: string; onTalk: () => void }) {
  return (
    <main className="mx-auto min-h-screen max-w-md pb-28">
      <div className="px-4 pb-5 pt-4">{children}</div>
      {toast && <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-sage px-5 py-3 text-sm font-bold text-black shadow-soft">{toast}</div>}
      <BottomNav tab={tab} setTab={setTab} onTalk={onTalk} />
    </main>
  );
}

function BottomNav({ tab, setTab, onTalk }: { tab: Tab; setTab: (tab: Tab) => void; onTalk: () => void }) {
  const sideTabs: { id: Tab; label: string; icon: LucideIcon }[] = [
    { id: "today", label: "Today", icon: HomeIcon },
    { id: "timeline", label: "Timeline", icon: List },
    { id: "handoff", label: "Handoff", icon: FileText },
    { id: "memory", label: "Memory", icon: Brain },
  ];
  return (
    <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-white/10 bg-black/90 px-3 pb-4 pt-3 shadow-[0_-18px_45px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <div className="grid grid-cols-5 items-end gap-1">
        {sideTabs.slice(0, 2).map((item) => (
          <NavTab key={item.id} item={item} active={tab === item.id} onClick={() => setTab(item.id)} />
        ))}
        <button
          onClick={onTalk}
          className="tap -mt-10 flex h-20 w-20 flex-col items-center justify-center justify-self-center rounded-full bg-gradient-to-br from-[#ff6fb1] to-[#ffe1ef] font-bold text-black shadow-soft ring-4 ring-white/10 transition active:scale-95"
          aria-label="Talk to Tiny"
        >
          <Mic className="h-7 w-7" strokeWidth={2.7} />
          <span className="text-xs">Talk</span>
        </button>
        {sideTabs.slice(2).map((item) => (
          <NavTab key={item.id} item={item} active={tab === item.id} onClick={() => setTab(item.id)} />
        ))}
      </div>
    </nav>
  );
}

function CaptureSheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 p-3 backdrop-blur-sm">
      <div className="max-h-[92dvh] w-full overflow-hidden rounded-[34px] bg-[#101010] p-3 shadow-soft ring-1 ring-white/10">
        <div className="mb-2 flex shrink-0 justify-end">
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function cleanTinyReply(value: string) {
  return value
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function NavTab({ item, active, onClick }: { item: { id: Tab; label: string; icon: LucideIcon }; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button onClick={onClick} className={`tap rounded-2xl px-1 py-2 text-xs font-bold transition ${active ? "bg-white/10 text-white" : "text-zinc-500"}`}>
      <span className={`mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full ${active ? "bg-sage text-black" : "bg-white/[0.07]"}`}>
        <Icon className="h-4 w-4" strokeWidth={2.5} />
      </span>
      {item.label}
    </button>
  );
}

function TodayDashboard({ profile, events, memories, supplies, bedtime, onSmartSave, onViewDetails }: any) {
  return (
    <section className="space-y-4">
      <header className="rounded-[30px] bg-white/[0.06] p-4 shadow-soft ring-1 ring-white/10">
        <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconBubble icon={Baby} tone="pink" />
          <div>
          <p className="text-sm font-bold text-sage">{formatDate(new Date())}</p>
          <h1 className="text-4xl font-bold tracking-tight">{profile.name}</h1>
          <p className="mt-1 text-sm text-zinc-400">{profile.ageMonths} months - shared care memory</p>
          </div>
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-sage" aria-label="Growing memory">
          <Brain className="h-5 w-5" />
        </span>
        </div>
      </header>
      <NextStepsPanel profile={profile} events={events} supplies={supplies} bedtime={bedtime} />
      <AlertsOnly events={events} supplies={supplies} />
      <button onClick={onViewDetails} className="flex w-full items-center justify-center gap-2 rounded-full bg-white/[0.06] px-4 py-3 text-sm font-bold text-zinc-300 ring-1 ring-white/10">
        <List className="h-4 w-4" />
        View today details
      </button>
    </section>
  );
}

type NextStep = {
  title: string;
  detail: string;
  timing: string;
  tone: "primary" | "normal" | "warn";
};

function timeToday(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function hoursSince(value?: string) {
  if (!value) return Infinity;
  return (Date.now() - new Date(value).getTime()) / 36e5;
}

function buildNextSteps(profile: any, events: CareEvent[], supplies: SupplyItem[], bedtime: any): NextStep[] {
  const today = getTodayEvents(events);
  const wake = getLastEventByType(today, "wake");
  const napStart = getLastEventByType(today, "nap_start");
  const napEnd = getLastEventByType(today, "nap_end");
  const meal = getLastEventByType(today, "meal");
  const milk = getLastEventByType(today, "milk");
  const water = getLastEventByType(today, "water");
  const poop = getLastEventByType(today, "poop");
  const bedtimeLog = getLastEventByType(today, "bedtime");
  const unpacked = supplies.filter((item) => item.needed && !item.packed);
  const steps: NextStep[] = [];
  const now = new Date();
  const napStartTime = timeToday(profile.usualNapStart);

  if (!wake) {
    steps.push({ title: "Log wake-up", detail: "Tiny needs Emma's wake time to judge nap and bedtime timing.", timing: "Now", tone: "primary" });
  } else if (napStart && !napEnd) {
    steps.push({ title: "Watch nap end", detail: "When Emma wakes, tell Tiny so bedtime can update.", timing: "During nap", tone: "primary" });
  } else if (!napStart) {
    steps.push({
      title: "Next nap",
      detail: now > napStartTime ? "Usual nap time has passed. If she seems tired, start nap soon." : `Usual nap starts around ${profile.usualNapStart}.`,
      timing: now > napStartTime ? "Soon" : formatTime(napStartTime.toISOString()),
      tone: "primary",
    });
  } else if (!bedtimeLog) {
    steps.push({ title: "Bedtime window", detail: bedtime.reason, timing: bedtime.window, tone: "primary" });
  }

  const lastFoodHours = Math.min(hoursSince(meal?.timestamp), hoursSince(milk?.timestamp));
  if (!meal && !milk) {
    steps.push({ title: "First food log", detail: "No meal or milk has been logged today.", timing: "Next feeding", tone: "normal" });
  } else if (lastFoodHours >= 3) {
    steps.push({ title: "Meal or snack", detail: "It has been about 3+ hours since the last logged food or milk.", timing: "Soon", tone: "normal" });
  } else {
    steps.push({ title: "Next meal check", detail: "Food timing looks okay from the latest logs.", timing: "Later", tone: "normal" });
  }

  if (!water) {
    steps.push({ title: "Offer water", detail: "No water logged today. Useful to track, especially if poop is hard or missing.", timing: "Next cup", tone: poop ? "normal" : "warn" });
  }

  if (!poop) {
    steps.push({ title: "Poop watch", detail: "No poop logged today. Track status and discomfort if it happens.", timing: "Today", tone: "warn" });
  } else if (poop.status === "hard") {
    steps.push({ title: "Hard poop noted", detail: "Keep tracking water and discomfort. This is not a diagnosis.", timing: "Continue", tone: "warn" });
  }

  if (unpacked.length) {
    steps.push({ title: "Pack daycare bag", detail: `Still needed: ${unpacked.map((item) => item.name).join(", ")}.`, timing: "Before morning", tone: "warn" });
  }

  return steps.slice(0, 3);
}

function NextStepsPanel({ profile, events, supplies, bedtime }: { profile: any; events: CareEvent[]; supplies: SupplyItem[]; bedtime: any }) {
  const steps = buildNextSteps(profile, events, supplies, bedtime);
  const [primary, ...rest] = steps;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white">Recommendation</h2>
        <span className="text-xs font-bold uppercase tracking-[0.1em] text-zinc-500">Based on logs</span>
      </div>
      {primary && <NextStepCard step={primary} featured />}
      {rest.length > 0 && <div className="grid gap-2">
        {rest.map((step) => (
          <NextStepCard key={`${step.title}-${step.timing}`} step={step} />
        ))}
      </div>}
    </section>
  );
}

function NextStepCard({ step, featured = false }: { step: NextStep; featured?: boolean }) {
  const StepIcon = nextStepIcon(step.title);
  const toneClass =
    step.tone === "primary"
      ? "bg-[#ff6fb1]/16 ring-[#ff6fb1]/30"
      : step.tone === "warn"
        ? "bg-[#ff8a65]/12 ring-[#ff8a65]/25"
        : "bg-white/[0.055] ring-white/10";
  return (
    <article className={`rounded-[24px] p-4 shadow-soft ring-1 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <IconBubble icon={StepIcon} tone={step.tone === "warn" ? "warn" : featured ? "pink" : "neutral"} />
          <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-500">{step.timing}</p>
          <h3 className={`${featured ? "text-2xl" : "text-lg"} mt-1 font-bold leading-tight text-white`}>{step.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">{step.detail}</p>
          </div>
        </div>
        {featured && <span className="rounded-full bg-sage px-3 py-1 text-xs font-bold text-black">Next</span>}
      </div>
    </article>
  );
}

function nextStepIcon(title: string): LucideIcon {
  if (/bedtime|nap/i.test(title)) return Moon;
  if (/water/i.test(title)) return Droplets;
  if (/meal|food|snack/i.test(title)) return Utensils;
  if (/poop/i.test(title)) return AlertTriangle;
  if (/pack|daycare|supplies/i.test(title)) return Package;
  if (/wake/i.test(title)) return Clock3;
  return Sparkles;
}

type AlertItem = {
  title: string;
  detail: string;
  tone: "warn" | "danger";
  icon: LucideIcon;
};

function buildAlerts(events: CareEvent[], supplies: SupplyItem[]): AlertItem[] {
  const today = getTodayEvents(events);
  const napStart = getLastEventByType(today, "nap_start");
  const napEnd = getLastEventByType(today, "nap_end");
  const water = getLastEventByType(today, "water");
  const poop = getLastEventByType(today, "poop");
  const unpacked = supplies.filter((item) => item.needed && !item.packed);
  const symptomNotes = today.filter((event) => event.type === "symptom" || event.note?.match(/blood|fever|vomit|pain|dehydrat|breathing/i));
  const alerts: AlertItem[] = [];

  if (napStart && !napEnd) {
    alerts.push({ title: "Nap is open", detail: "Nap start is logged, but nap end is missing.", tone: "warn", icon: Moon });
  }
  if (!water) {
    alerts.push({ title: "No water logged", detail: "Offer water next time it is convenient.", tone: "warn", icon: Droplets });
  }
  if (!poop) {
    alerts.push({ title: "No poop today", detail: "Track status and discomfort if it happens.", tone: "warn", icon: AlertTriangle });
  } else if (poop.status === "hard") {
    alerts.push({ title: "Hard poop", detail: "Keep tracking water and discomfort. This is not a diagnosis.", tone: "warn", icon: AlertTriangle });
  }
  if (unpacked.length) {
    alerts.push({ title: "Supplies unpacked", detail: `Still needed: ${unpacked.map((item) => item.name).join(", ")}.`, tone: "warn", icon: Package });
  }
  symptomNotes.forEach((event) => {
    alerts.push({ title: "Symptom note", detail: event.note ?? "A symptom was logged today.", tone: "danger", icon: AlertTriangle });
  });

  return alerts;
}

function AlertsOnly({ events, supplies }: { events: CareEvent[]; supplies: SupplyItem[] }) {
  const alerts = buildAlerts(events, supplies);
  if (!alerts.length) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white">Alerts</h2>
        <span className="text-xs font-bold uppercase tracking-[0.1em] text-zinc-500">Only if needed</span>
      </div>
      <div className="space-y-2">
        {alerts.map((alert) => (
          <article key={`${alert.title}-${alert.detail}`} className={`flex gap-3 rounded-[22px] p-4 ring-1 ${alert.tone === "danger" ? "bg-coral/15 ring-coral/30" : "bg-[#ff8a65]/12 ring-[#ff8a65]/25"}`}>
            <IconBubble icon={alert.icon} tone="warn" />
            <div>
              <h3 className="font-bold text-white">{alert.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-300">{alert.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ContextCard({ profile, events, supplies, bedtime }: any) {
  const today = getTodayEvents(events);
  const napEnd = getLastEventByType(today, "nap_end");
  const poop = getLastEventByType(today, "poop");
  const unpacked = supplies.filter((item: SupplyItem) => item.needed && !item.packed);
  const status = poop ? "On track" : "Watch poop";
  return (
    <article className="overflow-hidden rounded-[30px] bg-[#181114] shadow-soft ring-1 ring-white/10">
      <div className="bg-gradient-to-r from-[#ff6fb1]/28 via-[#ff9bc9]/12 to-transparent px-5 pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#ff9bc9]">Today's context</p>
          <span className="rounded-full bg-[#ff6fb1] px-3 py-1 text-xs font-bold text-black">{status}</span>
        </div>
        <h2 className="mt-4 max-w-[18rem] text-2xl font-semibold leading-tight tracking-tight text-white">
          {profile.name} is mostly steady. Keep the evening simple.
        </h2>
      </div>
      <div className="space-y-3 p-5">
        <div className="grid grid-cols-2 gap-2">
          <ContextPill label="Nap ended" value={napEnd ? formatTime(napEnd.timestamp) : "Not logged"} />
          <ContextPill label="Bedtime" value={bedtime.window} />
          <ContextPill label="Poop" value={poop ? String(poop.status ?? "Logged") : "None today"} tone={poop ? "default" : "warn"} />
          <ContextPill label="Pack" value={unpacked.length ? unpacked.map((item: SupplyItem) => item.name).join(", ") : "Bag ready"} tone={unpacked.length ? "warn" : "default"} />
        </div>
        {!poop && (
          <p className="rounded-2xl bg-white/[0.06] p-3 text-sm leading-relaxed text-zinc-300">
            No poop logged today. Offer water and keep an eye on comfort notes.
          </p>
        )}
      </div>
    </article>
  );
}

function ContextPill({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warn" }) {
  return (
    <div className={`rounded-2xl p-3 ring-1 ${tone === "warn" ? "bg-[#ff6fb1]/12 ring-[#ff6fb1]/20" : "bg-white/[0.055] ring-white/10"}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-snug text-white">{value}</p>
    </div>
  );
}

function DashboardCard({ title, children, accent = "bg-white" }: { title: string; children: React.ReactNode; accent?: string }) {
  return <article className={`${accent === "bg-white" ? "bg-white/[0.06] text-white" : accent} rounded-[26px] p-5 shadow-soft ring-1 ring-white/10`}><h2 className="mb-2 text-xs font-bold uppercase tracking-[0.08em] opacity-65">{title}</h2>{children}</article>;
}

function Metric({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return <div className="min-h-28 rounded-[24px] bg-white/[0.055] p-4 shadow-soft ring-1 ring-white/10 transition active:scale-[0.98]"><p className="text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-500">{title}</p><p className="mt-2 text-lg font-semibold leading-tight text-white">{value}</p><p className="mt-1 text-sm text-zinc-400">{detail}</p></div>;
}

function AgentComposer({ profile, events, memories, supplies, onSave, expanded = false }: { profile: any; events: CareEvent[]; memories: ChildMemory[]; supplies: SupplyItem[]; onSave: (events: CareEvent[]) => void; expanded?: boolean }) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState<{ text: string; source?: string }>({
    text: `Tell me what you remember. I'll sort it out.`,
  });
  const [listening, setListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const localAnswer = (question: string) => {
    const intent = classifyAskTinyIntent(question);
    return intent === "bedtime" ? bedtimeResponse(profile, events, memories) : intent === "daycare" ? generateDaycarePrep(profile, supplies, events) : intent === "constipation" ? constipationWatch(events) : intent === "doctor" ? generateDoctorSummary(profile, events) : generateHandoffSummary(profile, events, memories, "spouse");
  };

  const answerQuestion = async (question: string, ruleAnswer: string) => {
    try {
      const response = await fetch("/api/ai/ask-tiny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          intent: classifyAskTinyIntent(question),
          profile,
          todayEvents: getTodayEvents(events),
          recentEvents: getLast7DaysEvents(events),
          memories,
          supplies,
          ruleAnswer,
          instruction: "Use web search for current context. Treat parent forums as anecdotal and pediatric sources as higher authority.",
        }),
      });
      const data = await response.json();
      return { text: data.answer || ruleAnswer, source: data.source || "openai" };
    } catch {
      return { text: ruleAnswer, source: "local-rules-fallback" };
    }
  };

  const submit = async (value = text) => {
    if (!value.trim()) return [];
    setLoading(true);
    try {
      const response = await fetch("/api/ai/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: value,
          childId: profile.id,
          profile,
          todayEvents: getTodayEvents(events),
          recentEvents: getLast7DaysEvents(events),
          memories,
          supplies,
          nowIso: new Date().toISOString(),
          source: "web",
        }),
      });
      const data = await response.json();
      if (data.mode === "log" && data.events?.length) {
        onSave(data.events);
        setReply({ text: cleanTinyReply(data.message || `Saved ${data.events.length} update${data.events.length === 1 ? "" : "s"} for ${profile.name}.`), source: data.source });
        setText("");
        return data.events;
      }
      if (data.mode === "ask") {
        const ruleAnswer = localAnswer(data.askQuestion || value);
        const answer = await answerQuestion(data.askQuestion || value, ruleAnswer);
        setReply({ text: cleanTinyReply(answer.text), source: answer.source });
        setText("");
        return [];
      }
      setReply({ text: cleanTinyReply(data.message || "What should I do with that?"), source: data.source });
      setText("");
      return [];
    } catch {
      const parsed = parseNaturalCareEntry(value, profile.id);
      onSave(parsed);
      setReply({ text: cleanTinyReply(`Saved ${parsed.length} update${parsed.length === 1 ? "" : "s"} using local rules.`), source: "local-rules-fallback" });
      setText("");
      return parsed;
    } finally {
      setLoading(false);
    }
  };

  const transcribeAudio = async (blob: Blob) => {
    setLoading(true);
    setVoiceMessage("Transcribing...");
    try {
      const formData = new FormData();
      formData.append("audio", blob, `tiny-handoff-${Date.now()}.webm`);
      const response = await fetch("/api/ai/transcribe", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok || !data.text) throw new Error(data.error ?? "No transcript");
      setText(data.text);
      setVoiceMessage(`Heard: "${data.text}"`);
      await submit(data.text);
    } catch {
      setVoiceMessage("I could not transcribe that. Try again or type it.");
    } finally {
      setLoading(false);
    }
  };

  const startVoice = async () => {
    if (listening) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceMessage("Voice recording is not available in this browser. Typing still works.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstart = () => {
        setListening(true);
        setVoiceMessage("Listening. Tap stop when done.");
      };
      recorder.onstop = () => {
        setListening(false);
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 0) void transcribeAudio(blob);
      };
      recorder.start();
    } catch (error) {
      setListening(false);
      const name = error instanceof DOMException ? error.name : "";
      setVoiceMessage(name === "NotAllowedError" ? "Microphone permission was blocked. Allow microphone access and try again." : "Could not start the microphone. Typing still works.");
    }
  };

  return (
    <article className="flex max-h-[82dvh] flex-col rounded-[30px] bg-white/[0.065] p-4 text-white ring-1 ring-white/10">
      <div className="mb-4 flex shrink-0 items-center gap-3">
        <TinyAvatar size="large" active={listening} />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Tiny</h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">Tell me what you remember. I will sort it out.</p>
        </div>
      </div>
      <div className="mb-3 flex min-h-0 gap-2">
        <TinyAvatar size="small" />
        <div className="max-h-44 max-w-[86%] overflow-y-auto rounded-2xl bg-black/30 px-3 py-2 text-sm leading-relaxed text-zinc-200">
          <p className="whitespace-pre-wrap break-words">{reply.text}</p>
          {reply.source && <p className="mt-1 text-[10px] font-bold uppercase opacity-60">{reply.source}</p>}
        </div>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={`Or type it here...`}
        className={`w-full shrink-0 resize-none rounded-[22px] border border-white/10 bg-black/35 p-4 text-base leading-relaxed text-white outline-none placeholder:text-zinc-500 focus:border-sage ${expanded ? "min-h-24" : "min-h-20"}`}
      />
      {voiceMessage && <p className="mt-2 text-sm text-white/70">{voiceMessage}</p>}
      <div className="mt-4 flex items-center gap-3">
        <button onClick={() => void startVoice()} className={`tap flex h-28 w-28 shrink-0 flex-col items-center justify-center rounded-full text-base font-bold shadow-soft ring-4 transition active:scale-95 ${listening ? "bg-coral text-white ring-coral/20" : "bg-sage text-black ring-sage/20"}`}>
          <Mic className="h-8 w-8" strokeWidth={2.8} />
          <span className="mt-1">{listening ? "Stop" : "Talk"}</span>
        </button>
        <button onClick={() => void submit()} disabled={loading || !text.trim()} className="tap flex min-h-14 flex-1 items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-3 font-bold text-white shadow-soft transition active:scale-95 disabled:opacity-40">
          <Send className="h-5 w-5" />
          {loading ? "Thinking" : "Send"}
        </button>
      </div>
    </article>
  );
}

function TinyAvatar({ size = "small", active = false }: { size?: "small" | "large"; active?: boolean }) {
  const dims = size === "large" ? "h-16 w-16" : "h-8 w-8";
  const mark = size === "large" ? "h-7 w-7" : "h-4 w-4";
  return (
    <div className={`${dims} relative shrink-0 rounded-full bg-gradient-to-br from-[#ff6fb1] via-[#ffa7cf] to-[#ffe1ef] p-[2px] shadow-soft ${active ? "animate-pulse" : ""}`}>
      <div className="flex h-full w-full items-center justify-center rounded-full bg-[#171014]">
        <Sparkles className={`${mark} text-[#ff9bc9]`} strokeWidth={2.6} />
      </div>
      {size === "large" && <span className="absolute -bottom-1 -right-1 rounded-full bg-sage px-2 py-1 text-[10px] font-bold text-black">Tiny</span>}
    </div>
  );
}

function QuickLog({ profile, events, memories, supplies, onSmartSave }: { profile: any; events: CareEvent[]; memories: ChildMemory[]; supplies: SupplyItem[]; onSmartSave: (events: CareEvent[]) => void }) {
  return <section className="space-y-4"><ScreenTitle title="Tell Tiny anything" subtitle="One messy update can become many logs, answers, or a quick clarification." /><AgentComposer profile={profile} events={events} memories={memories} supplies={supplies} onSave={onSmartSave} expanded /></section>;
}

function QuickLogButton({ type, onClick, large = false }: { type: EventType; onClick: () => void; large?: boolean }) {
  return (
    <button onClick={onClick} className={`tap rounded-[24px] bg-white/[0.06] text-left font-semibold text-white shadow-soft ring-1 ring-white/10 transition hover:bg-white/[0.09] active:scale-[0.98] ${large ? "min-h-24 p-5 text-lg" : "min-h-16 p-3 text-sm"}`}>
      <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-sage text-black">
        <EventIcon type={type} className="h-5 w-5" />
      </span>
      {labels[type]}
    </button>
  );
}

function EventModal({ type, childId, onClose, onSave }: { type: EventType; childId: string; onClose: () => void; onSave: (event: CareEvent) => void }) {
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [time, setTime] = useState(nowLocal);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState(type === "milk" || type === "water" ? "oz" : "");
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const save = () => {
    const timestamp = new Date(time).toISOString();
    onSave({ id: crypto.randomUUID(), childId, type, timestamp, amount: amount ? Number(amount) : undefined, unit: unit || undefined, status: status || undefined, mood: type === "mood" ? (status as Mood) : undefined, note: note || undefined, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/30 p-3">
      <div className="w-full rounded-[30px] bg-[#161616] p-5 text-white shadow-soft ring-1 ring-white/10">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-bold">{labels[type]}</h2><button onClick={onClose} className="rounded-full bg-white/10 px-4 py-2 font-bold">Close</button></div>
        <label className="text-sm font-bold text-zinc-300">Time<input type="datetime-local" value={time} onChange={(event) => setTime(event.target.value)} className="mt-1 w-full rounded-2xl border border-white/10 bg-black/35 p-3 text-white" /></label>
        {(type === "milk" || type === "water") && <div className="mt-3 grid grid-cols-2 gap-2"><input inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} className="rounded-2xl border border-white/10 bg-black/45 p-3 text-white" /><input placeholder="Unit" value={unit} onChange={(event) => setUnit(event.target.value)} className="rounded-2xl border border-white/10 bg-black/45 p-3 text-white" /></div>}
        {(type === "poop" || type === "mood" || type === "meal" || type === "supply") && (
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-3 w-full rounded-2xl border border-white/10 bg-black/45 p-3 text-white">
            <option value="">Status</option>
            {(type === "poop" ? ["soft", "normal", "hard", "watery"] : type === "mood" ? ["happy", "tired", "clingy", "fussy", "sick", "energetic"] : ["ate well", "ate some", "refused", "needed"]).map((item) => <option key={item}>{item}</option>)}
          </select>
        )}
        <textarea placeholder="Optional note" value={note} onChange={(event) => setNote(event.target.value)} className="mt-3 min-h-24 w-full rounded-2xl border border-white/10 bg-black/45 p-3 text-white placeholder:text-zinc-500" />
        <button onClick={save} className="mt-3 w-full rounded-full bg-sage p-4 text-lg font-bold text-black">Save</button>
      </div>
    </div>
  );
}

function Timeline({ events, onDelete }: { events: CareEvent[]; onDelete: (id: string) => void }) {
  const [range, setRange] = useState<"today" | "week">("today");
  const shown = (range === "today" ? getTodayEvents(events) : getLast7DaysEvents(events)).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return <section className="space-y-4"><ScreenTitle title="Timeline" subtitle="The day in order." /><Segment value={range} setValue={setRange} options={[["today", "Today"], ["week", "Last 7 days"]]} />{shown.length ? shown.map((event) => <TimelineEventCard key={event.id} event={event} onDelete={() => onDelete(event.id)} />) : <EmptyState text="No logs in this range yet." />}</section>;
}

function TimelineEventCard({ event, onDelete }: { event: CareEvent; onDelete: () => void }) {
  return (
    <article className="rounded-[24px] bg-white/[0.06] p-4 shadow-soft ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <IconBubble icon={eventIcon(event.type)} tone={event.type === "water" || event.type === "milk" ? "sage" : "neutral"} />
          <div>
            <p className="text-sm font-bold text-sage">{formatTime(event.timestamp)}</p>
            <h3 className="text-lg font-semibold text-white">{describeEvent(event)}</h3>
            {event.note && <p className="mt-1 text-sm text-zinc-400">{event.note}</p>}
          </div>
        </div>
        <button onClick={onDelete} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-coral" aria-label="Delete event">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

function Handoff({ profile, events, memories }: any) {
  const [mode, setMode] = useState<"spouse" | "nanny" | "daycare">("spouse");
  const [text, setText] = useState("");
  useEffect(() => setText(generateHandoffSummary(profile, events, memories, mode)), [profile, events, memories, mode]);
  return <section className="space-y-4"><ScreenTitle title="Handoff" subtitle="Ready-to-send context." /><Segment value={mode} setValue={setMode} options={[["spouse", "Spouse"], ["nanny", "Nanny"], ["daycare", "Daycare"]]} /><SummaryCard text={text} setText={setText} onCopy={() => navigator.clipboard?.writeText(text)} onRegenerate={() => setText(generateHandoffSummary(profile, events, memories, mode))} /></section>;
}

function SummaryCard({ text, setText, onCopy, onRegenerate }: { text: string; setText: (value: string) => void; onCopy: () => void; onRegenerate: () => void }) {
  return <article className="rounded-[26px] bg-white/[0.06] p-4 shadow-soft ring-1 ring-white/10"><textarea value={text} onChange={(event) => setText(event.target.value)} className="min-h-56 w-full resize-none rounded-[22px] border border-white/10 bg-black/35 p-4 text-lg leading-relaxed text-white" /><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={onCopy} className="flex items-center justify-center gap-2 rounded-full bg-sage p-3 font-bold text-black"><Copy className="h-4 w-4" />Copy</button><button onClick={onRegenerate} className="flex items-center justify-center gap-2 rounded-full bg-white/10 p-3 font-bold text-white"><RefreshCw className="h-4 w-4" />Regenerate</button></div></article>;
}

function MemoryScreen({ profileName, memories, onUpdate, onDelete, supplies, setSupplies }: any) {
  return <section className="space-y-4"><ScreenTitle title="Memory" subtitle="Tiny shows what it remembers and lets you edit it." /><DashboardCard title="How memory grows"><p className="text-sm leading-relaxed text-zinc-300">Tell Tiny what you remember whenever you can. Messy updates become logs, repeated patterns become proposed memories, and you stay in control.</p></DashboardCard><Supplies supplies={supplies} setSupplies={setSupplies} />{memories.map((memory: ChildMemory) => <MemoryCard key={memory.id} memory={memory} onUpdate={onUpdate} onDelete={() => onDelete(memory.id)} />)}{!memories.length && <EmptyState text={`${profileName}'s patterns will appear here after a few logs.`} />}</section>;
}

function Supplies({ supplies, setSupplies }: { supplies: SupplyItem[]; setSupplies: (items: SupplyItem[]) => void }) {
  const update = (item: SupplyItem) => setSupplies(supplies.map((current) => (current.id === item.id ? item : current)));
  return <DashboardCard title="Supplies">{supplies.map((item) => <SupplyItemRow key={item.id} item={item} onChange={update} />)}</DashboardCard>;
}

function SupplyItemRow({ item, onChange }: { item: SupplyItem; onChange: (item: SupplyItem) => void }) {
  return (
    <div className="border-t border-white/10 py-3 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <IconBubble icon={Package} tone={item.packed ? "sage" : item.needed ? "warn" : "neutral"} />
          <p className="font-semibold text-white">{item.name}</p>
        </div>
        <div className="flex gap-2">
          <Toggle label="Need" value={item.needed} onClick={() => onChange({ ...item, needed: !item.needed })} />
          <Toggle label="Packed" value={item.packed} onClick={() => onChange({ ...item, packed: !item.packed })} />
        </div>
      </div>
      <input value={item.note ?? ""} onChange={(event) => onChange({ ...item, note: event.target.value })} placeholder="Note" className="mt-2 w-full rounded-xl bg-black/35 p-2 text-sm text-white placeholder:text-zinc-500" />
    </div>
  );
}

function MemoryCard({ memory, onUpdate, onDelete }: { memory: ChildMemory; onUpdate: (memory: ChildMemory) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [statement, setStatement] = useState(memory.statement);
  return (
    <article className="rounded-[24px] bg-white/[0.06] p-4 shadow-soft ring-1 ring-white/10">
      <div className="flex items-start gap-3">
        <IconBubble icon={Brain} tone={memory.userConfirmed ? "sage" : "pink"} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-sage">{memory.type.replaceAll("_", " ")}</p>
          {editing ? <textarea value={statement} onChange={(event) => setStatement(event.target.value)} className="mt-2 w-full rounded-2xl bg-black/35 p-3 text-white" /> : <h3 className="mt-2 text-lg font-semibold text-white">{memory.statement}</h3>}
          <p className="mt-2 text-sm text-zinc-400">Confidence: {memory.confidence} - Evidence: {memory.evidenceCount} - {memory.userConfirmed ? "Confirmed" : "Proposed"}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button onClick={() => onUpdate({ ...memory, userConfirmed: true })} className="flex items-center justify-center gap-1 rounded-full bg-sage p-2 text-sm font-bold text-black"><Check className="h-4 w-4" />Confirm</button>
        <button onClick={() => editing ? (onUpdate({ ...memory, statement }), setEditing(false)) : setEditing(true)} className="flex items-center justify-center gap-1 rounded-full bg-white/10 p-2 text-sm font-bold text-white">{editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}{editing ? "Save" : "Edit"}</button>
        <button onClick={onDelete} className="flex items-center justify-center gap-1 rounded-full bg-white/10 p-2 text-sm font-bold text-coral"><Trash2 className="h-4 w-4" />Delete</button>
      </div>
    </article>
  );
}

function AskTiny({ profile, events, supplies, memories, onClose }: any) {
  const [question, setQuestion] = useState(promptChips[0]);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState("");
  const localAnswer = (text: string) => {
    const intent = classifyAskTinyIntent(text);
    return intent === "bedtime" ? bedtimeResponse(profile, events, memories) : intent === "daycare" ? generateDaycarePrep(profile, supplies, events) : intent === "constipation" ? constipationWatch(events) : intent === "doctor" ? generateDoctorSummary(profile, events) : generateHandoffSummary(profile, events, memories, "spouse");
  };
  const ask = async (text = question) => {
    setQuestion(text);
    const ruleAnswer = localAnswer(text);
    setAnswer(ruleAnswer);
    setSource("local-rules");
    setLoading(true);
    try {
      const response = await fetch("/api/ai/ask-tiny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          intent: classifyAskTinyIntent(text),
          profile,
          todayEvents: getTodayEvents(events),
          recentEvents: getLast7DaysEvents(events),
          memories,
          supplies,
          ruleAnswer,
          instruction: "Use web search for current context. Treat parent forums as anecdotal and pediatric sources as higher authority.",
        }),
      });
      const data = await response.json();
      setAnswer(data.answer || ruleAnswer);
      setSource(data.source || "openai");
    } catch {
      setAnswer(ruleAnswer);
      setSource("local-rules-fallback");
    } finally {
      setLoading(false);
    }
  };
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#101010] p-4 text-white"><div className="mx-auto max-w-md space-y-4 pb-8"><div className="flex items-center justify-between"><ScreenTitle title="Ask Tiny" subtitle="AI plus rules, with safety boundaries." /><button onClick={onClose} className="rounded-full bg-white/10 px-4 py-2 font-bold">Close</button></div><div className="flex flex-wrap gap-2">{promptChips.map((chip) => <button key={chip} onClick={() => void ask(chip)} className="rounded-full bg-white/[0.06] px-3 py-2 text-sm font-semibold text-white shadow-soft ring-1 ring-white/10">{chip}</button>)}</div><textarea value={question} onChange={(event) => setQuestion(event.target.value)} className="min-h-24 w-full rounded-[24px] border border-white/10 bg-black/35 p-4 text-white" /><button onClick={() => void ask()} className="w-full rounded-full bg-sage p-4 font-bold text-black">{loading ? "Searching..." : "Ask with AI"}</button>{answer && <SkillResponseCard answer={answer} source={source} />}</div></div>;
}

function bedtimeResponse(profile: any, events: CareEvent[], memories: ChildMemory[]) {
  const result = suggestBedtimeWindow(events, profile, memories);
  return `Suggested bedtime window: ${result.window}. ${result.reason} Confidence: ${result.confidence}.`;
}

function SkillResponseCard({ answer, source }: { answer: string; source?: string }) {
  return <article className="rounded-[26px] bg-white/[0.06] p-5 text-white shadow-soft ring-1 ring-white/10"><div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-lg font-bold">Tiny says</h3>{source && <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-zinc-300">{source}</span>}</div><p className="whitespace-pre-wrap leading-relaxed text-zinc-200">{answer}</p></article>;
}

function Segment({ value, setValue, options }: { value: string; setValue: (value: any) => void; options: string[][] }) {
  return <div className="grid grid-cols-3 gap-2 rounded-full bg-white/10 p-1">{options.map(([id, label]) => <button key={id} onClick={() => setValue(id)} className={`rounded-full p-2 text-sm font-bold transition ${value === id ? "bg-sage text-black shadow" : "text-zinc-400"}`}>{label}</button>)}</div>;
}

function Toggle({ label, value, onClick }: { label: string; value: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${value ? "bg-sage text-black" : "bg-white/10 text-zinc-400"}`}>{value && <Check className="h-3 w-3" />}{label}</button>;
}

function ScreenTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <header><p className="text-sm font-bold text-sage">Tiny Handoff</p><h1 className="text-4xl font-bold tracking-tight text-white">{title}</h1><p className="text-sm text-zinc-400">{subtitle}</p></header>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-3xl border border-dashed border-white/15 p-6 text-center font-semibold text-zinc-500">{text}</div>;
}
