import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedEvents, seedMemories, seedProfile, seedSupplies } from "@/lib/seed";
import { CareEvent, ChildMemory, SupplyItem, TinyConversationMessage, TinyState } from "@/lib/types";

const dataDir = path.join(process.cwd(), ".data");
const dataPath = path.join(dataDir, "tiny-handoff-store.json");

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
    return {
      profile: parsed.profile ?? seedProfile,
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
  state.conversations = [...state.conversations, message].slice(-200);
  await writeTinyState(state);
  return state;
}
