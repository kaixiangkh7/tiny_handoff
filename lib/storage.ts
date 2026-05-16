import { seedEvents, seedMemories, seedProfile, seedSupplies } from "./seed";
import { CareEvent, ChildMemory, ChildProfile, SupplyItem } from "./types";

const keys = {
  profile: "tiny-handoff:profile",
  events: "tiny-handoff:events",
  supplies: "tiny-handoff:supplies",
  memories: "tiny-handoff:memories",
};
const previousDemoPhotoUrl = "https://images.pexels.com/photos/13247629/pexels-photo-13247629.jpeg?auto=compress&cs=tinysrgb&w=400";

const isBrowser = () => typeof window !== "undefined";

function read<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback));
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (isBrowser()) window.localStorage.setItem(key, JSON.stringify(value));
}

export const getChildProfile = () => {
  const profile = read<ChildProfile>(keys.profile, seedProfile);
  const photoUrl = !profile.photoUrl || profile.photoUrl === previousDemoPhotoUrl ? seedProfile.photoUrl : profile.photoUrl;
  return { ...seedProfile, ...profile, photoUrl };
};
export const saveChildProfile = (profile: ChildProfile) => write(keys.profile, profile);
export const getEvents = () => read<CareEvent[]>(keys.events, seedEvents);
export const setEvents = (events: CareEvent[]) => write(keys.events, events);
export const saveEvent = (event: CareEvent) => setEvents([...getEvents(), event]);
export const updateEvent = (event: CareEvent) =>
  setEvents(getEvents().map((item) => (item.id === event.id ? event : item)));
export const deleteEvent = (id: string) => setEvents(getEvents().filter((event) => event.id !== id));
export const getSupplies = () => read<SupplyItem[]>(keys.supplies, seedSupplies);
export const saveSupplies = (items: SupplyItem[]) => write(keys.supplies, items);
export const getMemories = () => read<ChildMemory[]>(keys.memories, seedMemories);
export const saveMemory = (memory: ChildMemory) => write(keys.memories, [...getMemories(), memory]);
export const updateMemory = (memory: ChildMemory) =>
  write(
    keys.memories,
    getMemories().map((item) => (item.id === memory.id ? memory : item)),
  );
export const deleteMemory = (id: string) =>
  write(
    keys.memories,
    getMemories().filter((memory) => memory.id !== id),
  );
