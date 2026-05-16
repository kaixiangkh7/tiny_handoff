"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Baby,
  Brain,
  Camera,
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
  saveChildProfile,
  saveEvent,
  saveMemory,
  saveSupplies,
  updateMemory,
} from "@/lib/storage";
import { CareEvent, ChildMemory, ChildProfile, EventType, Mood, SupplyItem, TinyConversationMessage, TinyState } from "@/lib/types";
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
  generateDaycareDecisionSupport,
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
type CareMoment = {
  message: string;
  safetyLevel?: "normal" | "watch" | "call_pediatrician" | "urgent";
  nextSteps?: string[];
  eventsCount?: number;
  updatedAt: string;
};
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
  const [profile, setProfile] = useState<ChildProfile>(getChildProfile);
  const [events, setEventState] = useState<CareEvent[]>([]);
  const [supplies, setSupplyState] = useState<SupplyItem[]>([]);
  const [memories, setMemoryState] = useState<ChildMemory[]>([]);
  const [conversations, setConversations] = useState<TinyConversationMessage[]>([]);
  const [tab, setTab] = useState<Tab>("today");
  const [modalType, setModalType] = useState<EventType | null>(null);
  const [toast, setToast] = useState("");
  const [showCapture, setShowCapture] = useState(false);
  const [latestCareMoment, setLatestCareMoment] = useState<CareMoment | null>(null);

  const applyState = (state: TinyState) => {
    setProfile(state.profile);
    setEventState(state.events);
    setSupplyState(state.supplies);
    setMemoryState(state.memories);
    setConversations(state.conversations ?? []);
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
      setConversations([]);
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
    setToast("Ok");
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

  const updateProfile = async (nextProfile: ChildProfile) => {
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: nextProfile }),
      });
      if (!response.ok) throw new Error("Profile update failed");
      applyState((await response.json()) as TinyState);
    } catch {
      saveChildProfile(nextProfile);
      setProfile(nextProfile);
    }
    setToast("Photo updated");
    window.setTimeout(() => setToast(""), 1800);
  };

  const rememberConversation = async (message: TinyConversationMessage) => {
    setConversations((items) => [...items, message].slice(-200));
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) throw new Error("Conversation save failed");
      applyState((await response.json()) as TinyState);
    } catch {
      // Keep the in-memory context for this session even if server persistence fails.
    }
  };

  const clearConversation = async () => {
    setConversations([]);
    try {
      const response = await fetch(`/api/conversations?childId=${encodeURIComponent(profile.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Conversation clear failed");
      applyState((await response.json()) as TinyState);
    } catch {
      // Local clear is enough for the current preview session.
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
          latestCareMoment={latestCareMoment}
          onSmartSave={saveLogs}
          onProfileChange={(nextProfile: ChildProfile) => void updateProfile(nextProfile)}
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
          <AgentComposer
            profile={profile}
            events={events}
            memories={memories}
            supplies={supplies}
            conversations={conversations}
            onSave={saveLogs}
            onCareMoment={setLatestCareMoment}
            onConversation={rememberConversation}
            onClearConversation={clearConversation}
            expanded
          />
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
    .replace(/^Logged:\s*/gi, "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s*\((?:healthychildren|cdc|mayoclinic|mayo clinic|nhs|babycenter|whattoexpect|mumsnet|reddit)[^)]*\)/gi, "")
    .replace(/^Sources?:.*$/gim, "")
    .replace(/\bOk,\s*based on what you told me,\s*/gi, "Ok, ")
    .replace(/\bBased on what you told me,\s*/gi, "")
    .replace(/\bBased on logs,\s*/gi, "")
    .replace(/\bIf you want,\s*I can help\s*/gi, "I can ")
    .replace(/\bit may help to\b/gi, "try to")
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

function TodayDashboard({ profile, events, memories, supplies, bedtime, latestCareMoment, onProfileChange, onViewDetails }: any) {
  return (
    <section className="space-y-4">
      <header className="rounded-[30px] bg-white/[0.06] p-4 shadow-soft ring-1 ring-white/10">
        <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <ChildPhoto profile={profile} onChange={onProfileChange} />
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
      {latestCareMoment && <CareMomentCard moment={latestCareMoment} />}
      <NextStepsPanel profile={profile} events={events} supplies={supplies} bedtime={bedtime} />
      <AlertsOnly events={events} supplies={supplies} />
      <button onClick={onViewDetails} className="flex w-full items-center justify-center gap-2 rounded-full bg-white/[0.06] px-4 py-3 text-sm font-bold text-zinc-300 ring-1 ring-white/10">
        <List className="h-4 w-4" />
        View today details
      </button>
    </section>
  );
}

function CareMomentCard({ moment }: { moment: CareMoment }) {
  const safetyClass =
    moment.safetyLevel === "urgent" || moment.safetyLevel === "call_pediatrician"
      ? "bg-coral/15 ring-coral/30"
      : moment.safetyLevel === "watch"
        ? "bg-[#ff8a65]/12 ring-[#ff8a65]/25"
        : "bg-[#ff6fb1]/12 ring-[#ff6fb1]/25";
  return (
    <article className={`rounded-[26px] p-4 shadow-soft ring-1 ${safetyClass}`}>
      <div className="flex items-start gap-3">
        <IconBubble icon={Sparkles} tone={moment.safetyLevel === "watch" ? "warn" : "pink"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-white">Tiny is with you</h2>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{moment.message}</p>
          {moment.nextSteps?.length ? (
            <div className="mt-3 space-y-2">
              {moment.nextSteps.slice(0, 3).map((step) => (
                <p key={step} className="rounded-2xl bg-black/20 px-3 py-2 text-sm font-semibold text-white">{step}</p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ChildPhoto({ profile, onChange }: { profile: any; onChange: (profile: any) => void }) {
  const [error, setError] = useState("");

  const uploadPhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Use an image file.");
      return;
    }
    if (file.size > 2_000_000) {
      setError("Use a photo under 2 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setError("");
      onChange({ ...profile, photoUrl: String(reader.result) });
    };
    reader.onerror = () => setError("Could not read that photo.");
    reader.readAsDataURL(file);
  };

  return (
    <div className="relative shrink-0">
      <label className="group block cursor-pointer" aria-label={`Upload ${profile.name}'s photo`}>
        <input type="file" accept="image/*" className="sr-only" onChange={(event) => uploadPhoto(event.target.files?.[0])} />
        <span className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-[26px] bg-gradient-to-br from-[#ff6fb1] via-[#ffa7cf] to-[#ffe1ef] p-[2px] shadow-soft">
          <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-[24px] bg-[#171014]">
            {profile.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.photoUrl} alt={profile.name} className="h-full w-full object-cover" />
            ) : (
              <Baby className="h-8 w-8 text-[#ff9bc9]" strokeWidth={2.5} />
            )}
          </span>
          <span className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-sage text-black shadow-soft ring-2 ring-[#171014]">
            <Camera className="h-4 w-4" strokeWidth={2.6} />
          </span>
        </span>
      </label>
      {error && <p className="absolute left-0 top-full mt-1 w-32 text-[10px] font-bold text-coral">{error}</p>}
    </div>
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

function isNightContext(events: CareEvent[], profile: ChildProfile) {
  const now = new Date();
  const hour = now.getHours();
  const today = getTodayEvents(events);
  const bedtimeLog = getLastEventByType(today, "bedtime");
  const sleepNote = today.some((event) => event.note?.match(/fell back asleep|fall asleep|asleep right away|settled|night|overnight/i));
  const usualBedtime = timeToday(profile.usualBedtime);
  const nearOrAfterBedtime = now.getTime() >= usualBedtime.getTime() - 60 * 60 * 1000;
  return Boolean(bedtimeLog || sleepNote || nearOrAfterBedtime || hour >= 18 || hour < 5);
}

function buildNextSteps(profile: ChildProfile, events: CareEvent[], supplies: SupplyItem[], bedtime: any): NextStep[] {
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
  const nightContext = isNightContext(events, profile);

  if (nightContext) {
    const settled = today.some((event) => event.note?.match(/fell back asleep|fall asleep|asleep right away|settled/i));
    steps.push({
      title: settled ? "Let her sleep" : "Overnight watch",
      detail: settled
        ? "She settled back asleep, so keep things quiet and only watch for repeated wake-ups or concerning symptoms."
        : "It is evening/night, so focus on comfort, sleep, and any repeated wake-ups instead of nap timing.",
      timing: "Tonight",
      tone: "primary",
    });
  }

  if (!nightContext && !wake) {
    steps.push({ title: "Log wake-up", detail: "Tiny needs Emma's wake time to judge nap and bedtime timing.", timing: "Now", tone: "primary" });
  } else if (!nightContext && napStart && !napEnd) {
    steps.push({ title: "Watch nap end", detail: "When Emma wakes, tell Tiny so bedtime can update.", timing: "During nap", tone: "primary" });
  } else if (!nightContext && !napStart) {
    steps.push({
      title: "Next nap",
      detail: now > napStartTime ? "Usual nap time has passed. If she seems tired, start nap soon." : `Usual nap starts around ${profile.usualNapStart}.`,
      timing: now > napStartTime ? "Soon" : formatTime(napStartTime.toISOString()),
      tone: "primary",
    });
  } else if (!nightContext && !bedtimeLog) {
    steps.push({ title: "Bedtime window", detail: bedtime.reason, timing: bedtime.window, tone: "primary" });
  }

  const lastFoodHours = Math.min(hoursSince(meal?.timestamp), hoursSince(milk?.timestamp));
  if (!meal && !milk) {
    steps.push({ title: "First food note", detail: "Tiny has not heard about meal or milk yet today.", timing: "Next feeding", tone: "normal" });
  } else if (lastFoodHours >= 3) {
    steps.push({ title: "Meal or snack", detail: "It has been about 3+ hours since the last food or milk Tiny knows about.", timing: "Soon", tone: "normal" });
  } else {
    steps.push({ title: "Next meal check", detail: "Food timing looks okay from the latest logs.", timing: "Later", tone: "normal" });
  }

  if (!water) {
    steps.push({ title: "Offer water", detail: "Tiny has not heard about water today. Useful to track, especially if poop is hard or missing.", timing: "Next cup", tone: poop ? "normal" : "warn" });
  }

  if (!poop) {
    steps.push({ title: "Poop watch", detail: "Tiny has not heard about poop today. Track status and discomfort if it happens.", timing: "Today", tone: "warn" });
  } else if (poop.status === "hard") {
    steps.push({ title: "Hard poop noted", detail: "Keep tracking water and discomfort. This is not a diagnosis.", timing: "Continue", tone: "warn" });
  }

  if (unpacked.length) {
    steps.push({ title: "Pack daycare bag", detail: `Still needed: ${unpacked.map((item) => item.name).join(", ")}.`, timing: "Before morning", tone: "warn" });
  }

  return steps.slice(0, nightContext ? 2 : 3);
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
    alerts.push({ title: "Nap is open", detail: "Tiny heard nap started, but not when it ended.", tone: "warn", icon: Moon });
  }
  if (!water) {
    alerts.push({ title: "No water yet", detail: "Offer water next time it is convenient.", tone: "warn", icon: Droplets });
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
    alerts.push({ title: "Symptom note", detail: event.note ?? "A symptom came up today.", tone: "danger", icon: AlertTriangle });
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
          <ContextPill label="Nap ended" value={napEnd ? formatTime(napEnd.timestamp) : "Not heard yet"} />
          <ContextPill label="Bedtime" value={bedtime.window} />
          <ContextPill label="Poop" value={poop ? String(poop.status ?? "Noted") : "None today"} tone={poop ? "default" : "warn"} />
          <ContextPill label="Pack" value={unpacked.length ? unpacked.map((item: SupplyItem) => item.name).join(", ") : "Bag ready"} tone={unpacked.length ? "warn" : "default"} />
        </div>
        {!poop && (
          <p className="rounded-2xl bg-white/[0.06] p-3 text-sm leading-relaxed text-zinc-300">
            Tiny has not heard about poop today. Offer water and keep an eye on comfort notes.
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

function AgentComposer({
  profile,
  events,
  memories,
  supplies,
  conversations,
  onSave,
  onCareMoment,
  onConversation,
  onClearConversation,
  expanded = false,
}: {
  profile: any;
  events: CareEvent[];
  memories: ChildMemory[];
  supplies: SupplyItem[];
  conversations?: TinyConversationMessage[];
  onSave: (events: CareEvent[]) => void | Promise<void>;
  onCareMoment?: (moment: CareMoment) => void;
  onConversation?: (message: TinyConversationMessage) => void | Promise<void>;
  onClearConversation?: () => void | Promise<void>;
  expanded?: boolean;
}) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState<{ text: string; source?: string }>({
    text: `Talk to me like a friend. I'll sort it out.`,
  });
  const [listening, setListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [micBlocked, setMicBlocked] = useState(false);
  const [pendingTranscript, setPendingTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const allConversation = conversations ?? [];
  const recentConversation = allConversation.slice(-30);
  const longTermChatMemories = memories.filter((memory) => memory.type === "routine_note" && memory.id.startsWith("chat-summary-"));
  const visibleConversation = useMemo<TinyConversationMessage[]>(
    () =>
      allConversation.length
        ? allConversation
        : [
            {
              id: "tiny-welcome",
              childId: profile.id,
              source: "web",
              role: "assistant",
              text: `Talk to me like a friend. I'll sort it out.`,
              createdAt: new Date().toISOString(),
            },
          ],
    [profile.id, allConversation],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleConversation.length, loading, voiceMessage]);

  const rememberTurn = async (role: "user" | "assistant", turnText: string) => {
    const cleaned = turnText.trim();
    if (!cleaned) return;
    await onConversation?.({
      id: crypto.randomUUID(),
      childId: profile.id,
      source: "web",
      role,
      text: cleaned,
      createdAt: new Date().toISOString(),
    });
  };
  const intentFor = (value: string) => {
    const intent = classifyAskTinyIntent(value);
    const recentText = recentConversation.map((message) => message.text).join(" ").toLowerCase();
    const isFollowUp = /\b(there|that|this|it|her|him|keep sending|send her|send him|should i|should we|what about)\b/i.test(value);
    if (intent === "handoff" && isFollowUp && /daycare|day care|caregiver|teacher|refusing|crying/.test(recentText)) return "daycare_decision";
    return intent;
  };

  const chatFallback = (value: string) => {
    const lower = value.toLowerCase();
    if (/^hey|^hi|^hello/.test(lower)) return "Hey. What’s going on?";
    if (/fell asleep|fall asleep|asleep|sleeping/.test(lower)) return "Aww, good. Hope she gets a solid stretch.";
    if (/fine|nothing to worry|all good|seems okay|seems ok/.test(lower)) return "Good. Then I’d just let the day stay boring and easy.";
    if (/cry|cried|upset|rough/.test(lower)) return "Oh no. That sounds stressful. Tell me what happened.";
    if (/what do you mean|huh|confused|don't understand/.test(lower)) return "I mean: talk to me normally, and I’ll quietly keep Emma’s care log updated in the background.";
    return "Got it. I’m here.";
  };

  const answerQuestion = async (question: string) => {
    try {
      const response = await fetch("/api/ai/ask-tiny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          intent: intentFor(question),
          profile,
          todayEvents: getTodayEvents(events),
          recentEvents: getLast7DaysEvents(events),
          memories,
          supplies,
          conversationContext: recentConversation,
          memoryContext: longTermChatMemories,
        }),
      });
      const data = await response.json();
      return { text: data.answer || chatFallback(question), source: data.source || "openai" };
    } catch {
      return { text: chatFallback(question), source: "local-chat-fallback" };
    }
  };

  const submit = async (value = text) => {
    if (!value.trim()) return [];
    const userText = value.trim();
    setLoading(true);
    await rememberTurn("user", userText);
    try {
      const response = await fetch("/api/ai/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: userText,
          childId: profile.id,
          profile,
          todayEvents: getTodayEvents(events),
          recentEvents: getLast7DaysEvents(events),
          memories,
          supplies,
          conversationContext: recentConversation,
          nowIso: new Date().toISOString(),
          source: "web",
        }),
      });
      const data = await response.json();
      const extractedEvents = Array.isArray(data.events) ? data.events : [];
      const shouldSaveEvents = (data.mode === "log" || data.mode === "care_moment") && extractedEvents.length;
      if (shouldSaveEvents) {
        await onSave(extractedEvents);
      }

      const answer = await answerQuestion(userText);
      const message = cleanTinyReply(answer.text);

      if (data.mode === "care_moment" || data.mode === "ask" || data.mode === "clarify") {
        onCareMoment?.({
          message,
          safetyLevel: data.safetyLevel,
          nextSteps: data.nextSteps,
          eventsCount: extractedEvents.length,
          updatedAt: new Date().toISOString(),
        });
      }

      setReply({ text: message, source: answer.source });
      await rememberTurn("assistant", message);
      setText("");
      return extractedEvents;
    } catch {
      const parsed = parseNaturalCareEntry(userText, profile.id);
      await onSave(parsed);
      const message = cleanTinyReply(isConcernMessage(userText) ? localCareMomentResponse(userText, parsed.length) : chatFallback(userText));
      if (isConcernMessage(userText)) {
        onCareMoment?.({ message, safetyLevel: /blood|fever|vomit|breathing|dehydrat|letharg/i.test(userText) ? "call_pediatrician" : "watch", nextSteps: careMomentNextSteps(userText), eventsCount: parsed.length, updatedAt: new Date().toISOString() });
        setReply({ text: message, source: "local-rules-fallback" });
        await rememberTurn("assistant", message);
      } else {
        setReply({ text: message, source: "local-chat-fallback" });
        await rememberTurn("assistant", message);
      }
      setText("");
      return parsed;
    } finally {
      setLoading(false);
    }
  };

  const audioExtension = (mimeType: string) => {
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("ogg")) return "ogg";
    return "webm";
  };

  const transcribeAudio = async (blob: Blob) => {
    setLoading(true);
    setMicBlocked(false);
    setVoiceMessage("Transcribing...");
    try {
      const formData = new FormData();
      formData.append("audio", blob, `tiny-handoff-${Date.now()}.${audioExtension(blob.type)}`);
      const response = await fetch("/api/ai/transcribe", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok || !data.text) throw new Error(data.error ?? "No transcript");
      setText(data.text);
      setPendingTranscript(data.text);
      setVoiceMessage(`Heard: "${data.text}"`);
      if (looksLikeBadTranscript(data.text)) {
        setReply({ text: "That transcript looks off. Edit it if needed, then send.", source: "voice" });
      } else {
        await submit(data.text);
        setPendingTranscript("");
      }
    } catch {
      setVoiceMessage("I could not transcribe that. Try again or type it.");
    } finally {
      setLoading(false);
    }
  };

  const looksLikeBadTranscript = (value: string) => {
    const hasCjk = /[\u3040-\u30ff\u3400-\u9fff]/.test(value);
    const hasChildcareWord = /\b(emma|diaper|poop|pee|milk|water|nap|bed|sleep|cry|cried|fussy|rash|fever|daycare|wipes)\b/i.test(value);
    return hasCjk || value.trim().length < 3 || (!hasChildcareWord && value.trim().split(/\s+/).length <= 3);
  };

  const preferredAudioOptions = () => {
    const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
    return mimeType ? { mimeType } : undefined;
  };

  const stopVoice = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const startVoice = async () => {
    if (loading || listening) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicBlocked(true);
      setVoiceMessage("Voice recording is not available in this browser. Typing still works.");
      return;
    }
    try {
      setMicBlocked(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, preferredAudioOptions());
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstart = () => {
        startedAtRef.current = Date.now();
        setListening(true);
        setVoiceMessage("Listening...");
      };
      recorder.onerror = () => {
        setListening(false);
        stream.getTracks().forEach((track) => track.stop());
        setVoiceMessage("I could not keep the microphone open. Try again or type it.");
      };
      recorder.onstop = () => {
        setListening(false);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const duration = Date.now() - startedAtRef.current;
        if (duration < 350 || blob.size === 0) {
          setVoiceMessage("Hold a little longer so I can hear it.");
          return;
        }
        void transcribeAudio(blob);
      };
      recorder.start(250);
    } catch (error) {
      setListening(false);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const name = error instanceof DOMException ? error.name : "";
      const blocked = name === "NotAllowedError" || name === "SecurityError";
      setMicBlocked(blocked);
      setVoiceMessage(blocked ? "Microphone is blocked for this browser. Allow microphone access in site settings, then try again." : "Could not start the microphone. Typing still works.");
    }
  };

  return (
    <article className="flex h-[82dvh] flex-col overflow-hidden rounded-[30px] bg-[#111111] text-white ring-1 ring-white/10">
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-3">
        <TinyAvatar size="small" active={listening} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold tracking-tight">Tiny</h2>
          <p className="truncate text-xs font-semibold text-zinc-400">Knows Emma, remembers this chat, updates the log.</p>
        </div>
        <button
          type="button"
          onClick={() => void onClearConversation?.()}
          className="rounded-full bg-white/10 px-3 py-2 text-xs font-bold text-zinc-300"
        >
          Clear
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {visibleConversation.map((message) => (
          <ChatBubble key={message.id} message={message} />
        ))}
        {loading && (
          <div className="flex items-end gap-2">
            <TinyAvatar size="small" active />
            <div className="rounded-2xl rounded-bl-md bg-white/[0.08] px-4 py-3 text-sm font-semibold text-zinc-300">
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 border-t border-white/10 bg-[#171717] p-3">
        {voiceMessage && (
          <div className={`mb-2 rounded-2xl px-3 py-2 text-sm leading-relaxed ${micBlocked ? "bg-coral/15 text-white ring-1 ring-coral/25" : "text-white/70"}`}>
            <p>{voiceMessage}</p>
            {micBlocked && <p className="mt-1 text-xs text-white/60">In the browser address bar or site settings, set Microphone to Allow, then retry. Typing still works.</p>}
          </div>
        )}
        {pendingTranscript && (
          <button
            type="button"
            onClick={() => {
              void submit(pendingTranscript);
              setPendingTranscript("");
            }}
            className="mb-2 w-full rounded-full bg-sage px-4 py-3 text-sm font-bold text-black"
          >
            Send transcript
          </button>
        )}
        <div className="flex items-end gap-2 rounded-[26px] bg-black/35 p-2 ring-1 ring-white/10">
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              void startVoice();
            }}
            onPointerUp={stopVoice}
            onPointerCancel={stopVoice}
            onPointerLeave={() => {
              if (listening) stopVoice();
            }}
            disabled={loading}
            className={`tap flex h-14 w-14 shrink-0 touch-none select-none items-center justify-center rounded-full shadow-soft transition active:scale-95 disabled:opacity-50 ${listening ? "bg-coral text-white" : micBlocked ? "bg-white/10 text-white ring-1 ring-coral/30" : "bg-[#ff6fb1] text-black"}`}
            aria-label={listening ? "Release to send voice" : "Hold to talk"}
          >
            <Mic className="h-6 w-6" strokeWidth={2.8} />
          </button>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Message Tiny..."
            className="max-h-32 min-h-12 flex-1 resize-none bg-transparent px-1 py-3 text-base leading-relaxed text-white outline-none placeholder:text-zinc-500"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <button
            onClick={() => void submit()}
            disabled={loading || !text.trim()}
            className="tap flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-black transition active:scale-95 disabled:bg-white/10 disabled:text-white/30"
            aria-label="Send message"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] font-semibold text-zinc-500">{listening ? "Release to send" : "Hold mic to talk, or type messy details."}</p>
      </div>
    </article>
  );
}

function ChatBubble({ message }: { message: TinyConversationMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && <TinyAvatar size="small" />}
      <div
        className={`max-w-[82%] rounded-3xl px-4 py-3 text-sm leading-relaxed shadow-soft ${
          isUser
            ? "rounded-br-md bg-[#ff6fb1] font-semibold text-black"
            : "rounded-bl-md bg-white/[0.08] text-zinc-100 ring-1 ring-white/10"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
      </div>
    </div>
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

function localCareMomentResponse(text: string, eventsCount: number) {
  const serious = /blood|fever|vomit|breathing|dehydrat|letharg|severe pain/i.test(text);
  if (serious) {
    return "Ok, I see. Because that includes a potentially concerning symptom, consider contacting your pediatrician or urgent care depending on severity. If breathing, dehydration, unusual lethargy, repeated vomiting, or severe pain is happening, seek urgent care now.";
  }
  if (/cry|diaper|poop|stool|yellow|wet|watery/i.test(text)) {
    return "Ok, I see. Poor Emma. Wet or yellow poop can happen, but since she is crying, check comfort first: diaper fit, skin irritation, rash, and whether she settles after soothing. Track if this repeats or worsens.";
  }
  return "";
}

function isConcernMessage(text: string) {
  return /\b(concern|worried|anything to worry|should i|is this ok|is this okay|cry|cried|rash|blood|fever|vomit|breathing|dehydrat|letharg|pain|sick|urgent|doctor|pediatrician)\b/i.test(text);
}

function careMomentNextSteps(text: string) {
  if (/blood|fever|vomit|breathing|dehydrat|letharg|severe pain/i.test(text)) {
    return ["Contact a medical professional based on severity.", "Keep notes on timing, temperature, fluids, and symptoms.", "Seek urgent care for breathing trouble, dehydration, unusual lethargy, or severe symptoms."];
  }
  if (/cry|diaper|poop|stool|yellow|wet|watery/i.test(text)) {
    return ["Check diaper fit and skin for rash.", "Soothe her and watch whether she settles.", "Track fever, blood, vomiting, dehydration, or worsening pain."];
  }
  return ["Keep telling Tiny messy updates when you can.", "Tiny will sort logs and patterns for later."];
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
    return intent === "bedtime"
      ? bedtimeResponse(profile, events, memories)
      : intent === "daycare_decision"
        ? generateDaycareDecisionSupport(profile, events)
        : intent === "daycare"
          ? generateDaycarePrep(profile, supplies, events)
          : intent === "constipation"
            ? constipationWatch(events)
            : intent === "doctor"
              ? generateDoctorSummary(profile, events)
              : generateHandoffSummary(profile, events, memories, "spouse");
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
          instruction: "Be a warm friend first. Use web/search/source style only if the parent explicitly asks for research or medical evidence.",
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

