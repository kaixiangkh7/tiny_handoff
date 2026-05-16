import { CareEvent, ChildMemory, ChildProfile, SupplyItem } from "./types";

const todayAt = (time: string, offsetDays = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const [hours, minutes] = time.split(":").map(Number);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};

export const seedProfile: ChildProfile = {
  id: "emma",
  name: "Emma",
  photoUrl: "https://images.unsplash.com/photo-1694605735529-8d60f23a30b6?auto=format&fit=crop&fm=jpg&q=80&w=500&h=500",
  ageMonths: 16,
  daycareDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  usualWakeTime: "06:30",
  usualNapStart: "12:45",
  usualNapEnd: "14:15",
  usualBedtime: "19:20",
  caregiverNames: ["Mom", "Dad", "Nana"],
};

export const seedEvents: CareEvent[] = [
  {
    id: "wake-today",
    childId: "emma",
    type: "wake",
    timestamp: todayAt("06:25"),
    note: "Woke calm.",
    createdAt: todayAt("06:25"),
    updatedAt: todayAt("06:25"),
  },
  {
    id: "milk-am",
    childId: "emma",
    type: "milk",
    timestamp: todayAt("07:05"),
    amount: 6,
    unit: "oz",
    note: "Morning cup.",
    createdAt: todayAt("07:05"),
    updatedAt: todayAt("07:05"),
  },
  {
    id: "nap-start",
    childId: "emma",
    type: "nap_start",
    timestamp: todayAt("12:54"),
    createdAt: todayAt("12:54"),
    updatedAt: todayAt("12:54"),
  },
  {
    id: "nap-end",
    childId: "emma",
    type: "nap_end",
    timestamp: todayAt("14:22"),
    createdAt: todayAt("14:22"),
    updatedAt: todayAt("14:22"),
  },
  {
    id: "meal-pasta",
    childId: "emma",
    type: "meal",
    timestamp: todayAt("17:25"),
    status: "ate well",
    note: "Pasta and peas, ate well.",
    createdAt: todayAt("17:25"),
    updatedAt: todayAt("17:25"),
  },
  {
    id: "milk-pm",
    childId: "emma",
    type: "milk",
    timestamp: todayAt("18:20"),
    amount: 6,
    unit: "oz",
    note: "Evening milk.",
    createdAt: todayAt("18:20"),
    updatedAt: todayAt("18:20"),
  },
  {
    id: "poop-yesterday",
    childId: "emma",
    type: "poop",
    timestamp: todayAt("16:40", -1),
    status: "hard",
    note: "Cried a little.",
    createdAt: todayAt("16:40", -1),
    updatedAt: todayAt("16:40", -1),
  },
  {
    id: "supply-wipes",
    childId: "emma",
    type: "supply",
    timestamp: todayAt("17:45"),
    status: "wipes",
    note: "Wipes needed for daycare.",
    createdAt: todayAt("17:45"),
    updatedAt: todayAt("17:45"),
  },
];

export const seedSupplies: SupplyItem[] = [
  "Diapers",
  "Wipes",
  "Extra clothes",
  "Water bottle",
  "Blanket",
  "Sunscreen",
  "Hat",
  "Medication",
  "Shoes",
  "Bib",
].map((name) => ({
  id: name.toLowerCase().replaceAll(" ", "-"),
  name,
  category: name === "Medication" ? "Health" : "Daycare",
  needed: name === "Wipes",
  packed: false,
  recurring: ["Diapers", "Wipes", "Water bottle"].includes(name),
  note: name === "Wipes" ? "Bring a refill pack tomorrow." : "",
}));

export const seedMemories: ChildMemory[] = [
  {
    id: "sleep-window",
    childId: "emma",
    type: "sleep_pattern",
    statement: "Emma usually does well with bedtime 5-5.5 hours after nap ends.",
    confidence: "medium",
    evidenceCount: 5,
    userConfirmed: false,
    createdAt: todayAt("08:00", -3),
    updatedAt: todayAt("08:00", -3),
  },
  {
    id: "poop-watch",
    childId: "emma",
    type: "poop_pattern",
    statement: "Hard stools have shown up recently, so it is worth tracking water intake and discomfort notes.",
    confidence: "low",
    evidenceCount: 2,
    userConfirmed: false,
    createdAt: todayAt("08:00", -1),
    updatedAt: todayAt("08:00", -1),
  },
];
