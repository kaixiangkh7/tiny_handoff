import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedEvents, seedMemories, seedProfile, seedSupplies } from "@/lib/seed";
import { CareEvent, ChildMemory, ChildProfile, SupplyItem, TinyConversationMessage, TinyState } from "@/lib/types";

const dataDir = path.join(process.cwd(), ".data");
const dataPath = path.join(dataDir, "tiny-handoff-store.json");
const previousDemoPhotoUrl = "https://images.pexels.com/photos/13247629/pexels-photo-13247629.jpeg?auto=compress&cs=tinysrgb&w=400";
const maxStoredConversations = 1000;
const chatMemoryThreshold = 80;
const directChatWindow = 40;

let writeQueue = Promise.resolve();

function seedState(): TinyState {
  return {
    profile: seedProfile,
    events: seedEvents,
    supplies: seedSupplies,
    memories: seedMemories,
    conversations: [],
  };
}

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

export async function getTinyState(): Promise<TinyState> {
  await ensureDataDir();
  try {
    const raw = await readFile(dataPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TinyState>;
    const parsedPhotoUrl = parsed.profile?.photoUrl;
    const profile = {
      ...seedProfile,
      ...parsed.profile,
      photoUrl: !parsedPhotoUrl || parsedPhotoUrl === previousDemoPhotoUrl ? seedProfile.photoUrl : parsedPhotoUrl,
    };
    return {
      profile,
      events: parsed.events ?? seedEvents,
      supplies: parsed.supplies ?? seedSupplies,
      memories: parsed.memories ?? seedMemories,
      conversations: parsed.conversations ?? [],
    };
  } catch {
    const initial = seedState();
    await writeTinyState(initial);
    return initial;
  }
}

export async function writeTinyState(state: TinyState) {
  await ensureDataDir();
  writeQueue = writeQueue.then(() => writeFile(dataPath, JSON.stringify(state, null, 2), "utf8"));
  await writeQueue;
}

export async function appendEvents(events: CareEvent[]) {
  const state = await getTinyState();
  const existingIds = new Set(state.events.map((event) => event.id));
  state.events = [...state.events, ...events.filter((event) => !existingIds.has(event.id))];
  await writeTinyState(state);
  return state;
}

export async function saveStoredProfile(profile: ChildProfile) {
  const state = await getTinyState();
  state.profile = profile;
  await writeTinyState(state);
  return state;
}

export async function deleteStoredEvent(id: string) {
  const state = await getTinyState();
  state.events = state.events.filter((event) => event.id !== id);
  await writeTinyState(state);
  return state;
}

export async function saveStoredSupplies(supplies: SupplyItem[]) {
  const state = await getTinyState();
  state.supplies = supplies;
  await writeTinyState(state);
  return state;
}

export async function upsertStoredMemory(memory: ChildMemory) {
  const state = await getTinyState();
  const exists = state.memories.some((item) => item.id === memory.id);
  state.memories = exists ? state.memories.map((item) => (item.id === memory.id ? memory : item)) : [...state.memories, memory];
  await writeTinyState(state);
  return state;
}

export async function deleteStoredMemory(id: string) {
  const state = await getTinyState();
  state.memories = state.memories.filter((memory) => memory.id !== id);
  await writeTinyState(state);
  return state;
}

export async function appendConversation(message: TinyConversationMessage) {
  const state = await getTinyState();
  state.conversations = [...state.conversations, message].slice(-maxStoredConversations);
  compileOldConversationIntoMemory(state, message.childId);
  await writeTinyState(state);
  return state;
}

function compileOldConversationIntoMemory(state: TinyState, childId: string) {
  const childMessages = state.conversations.filter((message) => message.childId === childId);
  const eligible = childMessages.slice(0, Math.max(0, childMessages.length - directChatWindow));
  if (eligible.length < chatMemoryThreshold) return;

  const memoryId = `chat-summary-${childId}`;
  const existing = state.memories.find((memory) => memory.id === memoryId);
  const alreadyCompiled = existing?.evidenceCount ?? 0;
  if (eligible.length <= alreadyCompiled + 20) return;

  const userMessages = eligible.filter((message) => message.role === "user").map((message) => message.text);
  const themeDefs: Array<[string, RegExp]> = [
    ["sleep", /sleep|asleep|bed|bedtime|nap|wake|woke/i],
    ["daycare", /daycare|day care|teacher|caregiver|nanny|grandparent/i],
    ["food and fluids", /eat|food|meal|milk|water|snack|bottle/i],
    ["poop and diapers", /poop|stool|diaper|pee|wet|rash/i],
    ["comfort", /cry|cried|fussy|upset|clingy|sick|pain/i],
    ["supplies", /wipes|diapers|clothes|pack|suppl/i],
  ];
  const themes = themeDefs
    .filter(([, pattern]) => userMessages.some((text) => pattern.test(text)))
    .map(([label]) => label);

  const recentUserNotes = userMessages
    .slice(-8)
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4);

  const now = new Date().toISOString();
  const statement = [
    `Older Tiny chat summary: family has talked about ${themes.length ? themes.join(", ") : "daily care"} in prior messages.`,
    recentUserNotes.length ? `Representative parent notes: ${recentUserNotes.join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const memory: ChildMemory = {
    id: memoryId,
    childId,
    type: "routine_note",
    statement,
    confidence: "medium",
    evidenceCount: eligible.length,
    userConfirmed: existing?.userConfirmed ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  state.memories = existing ? state.memories.map((item) => (item.id === memoryId ? memory : item)) : [...state.memories, memory];
}

export async function clearStoredConversations(childId?: string) {
  const state = await getTinyState();
  state.conversations = childId ? state.conversations.filter((message) => message.childId !== childId) : [];
  await writeTinyState(state);
  return state;
}
