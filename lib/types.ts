export type EventType =
  | "wake"
  | "nap_start"
  | "nap_end"
  | "meal"
  | "milk"
  | "water"
  | "poop"
  | "diaper"
  | "medicine"
  | "mood"
  | "symptom"
  | "supply"
  | "note"
  | "bedtime";

export type PoopStatus = "soft" | "normal" | "hard" | "watery";
export type Mood = "happy" | "tired" | "clingy" | "fussy" | "sick" | "energetic";
export type Confidence = "low" | "medium" | "high";
export type MemoryType =
  | "sleep_pattern"
  | "food_preference"
  | "poop_pattern"
  | "daycare_supply"
  | "caregiver_preference"
  | "routine_note";

export interface ChildProfile {
  id: string;
  name: string;
  birthDate?: string;
  ageMonths: number;
  daycareDays: string[];
  usualWakeTime: string;
  usualNapStart: string;
  usualNapEnd: string;
  usualBedtime: string;
  caregiverNames: string[];
}

export interface CareEvent {
  id: string;
  childId: string;
  type: EventType;
  timestamp: string;
  endTimestamp?: string;
  amount?: number;
  unit?: string;
  status?: PoopStatus | Mood | string;
  mood?: Mood;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplyItem {
  id: string;
  name: string;
  category: string;
  needed: boolean;
  packed: boolean;
  recurring: boolean;
  note?: string;
}

export interface ChildMemory {
  id: string;
  childId: string;
  type: MemoryType;
  statement: string;
  confidence: Confidence;
  evidenceCount: number;
  userConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BedtimeSuggestion {
  window: string;
  reason: string;
  confidence: Confidence;
}

export type IngestionSource = "web" | "telegram" | "whatsapp" | "sms" | "email";

export interface TinyInboundMessage {
  source: IngestionSource;
  childId: string;
  sender?: string;
  messageText?: string;
  audioUrl?: string;
  timestamp?: string;
}

export interface TinyConversationMessage {
  id: string;
  childId: string;
  source: IngestionSource;
  role: "user" | "assistant";
  text: string;
  sender?: string;
  externalChatId?: string;
  createdAt: string;
}

export interface TinyState {
  profile: ChildProfile;
  events: CareEvent[];
  supplies: SupplyItem[];
  memories: ChildMemory[];
  conversations: TinyConversationMessage[];
}
