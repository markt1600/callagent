// Core domain types shared across the app.

export type SupportedLanguage = "ja" | "en" | "zh";

/**
 * Additional reservation options.
 * REACTIVE preferences are only voiced if the restaurant raises the topic.
 * PROACTIVE ones are raised by the agent itself during the call.
 */
export interface ReservationPreferences {
  // ── Reactive (answered only if asked) ────────────────────────────────────
  /** Preferred seating, mentioned only if the restaurant asks */
  seating?: "indoor" | "outdoor" | "counter";
  /** Whether the guest accepts a minimum spend if one is mentioned */
  minimumSpendOk?: boolean;
  /** Smoking-section preference if asked (common in Japan) */
  smoking?: "non_smoking" | "smoking";
  /** Whether the guest accepts a seating time limit if one is mentioned */
  timeLimitOk?: boolean;
  // ── Proactive (raised by the agent) ──────────────────────────────────────
  /** A private room is REQUIRED for the booking */
  privateRoom?: boolean;
  /** A quieter table / more privacy is preferred (softer than privateRoom) */
  quietTable?: boolean;
  /** Number of children in the party (0/undefined = none) */
  kidsCount?: number;
  /** Children's seats / high chairs needed */
  kidsSeating?: boolean;
  /** Occasion to mention when booking */
  occasion?: "birthday" | "anniversary" | "business" | "date";
  /** Name of the person celebrating (e.g. the birthday person) */
  occasionName?: string;
  /** Birthday only: ask if the restaurant can prepare a cake */
  birthdayCake?: boolean;
  /** Allergies / dietary restrictions — always stated proactively (safety) */
  allergies?: string;
  /** Wheelchair or stroller access needed */
  accessibility?: boolean;
  /** Ask about the corkage policy and report it back in the confirmation */
  askCorkage?: boolean;
}

/** A signed-in user (Google account). Guests have no profile. */
export interface UserProfile {
  /** Google account subject (stable unique id) */
  id: string;
  email: string;
  /** Display name from Google */
  name?: string;
  picture?: string;
  /** Pre-populated booking name for new reservations (editable in Account) */
  bookingName?: string;
  /** Pre-populated guest contact number for new reservations */
  contactPhone?: string;
  /** Set once the save-Agent-M-contact prompt has been shown */
  contactCardPromptedAt?: string;
  /** Call-credit balance. Absent = untouched starting grant. */
  credits?: number;
  createdAt: string;
}

/**
 * A restaurant a signed-in user has booked before, with the last-used
 * details so a repeat reservation only needs a date and time.
 */
export interface SavedRestaurant {
  /** Digits of the phone number (stable id per restaurant) */
  id: string;
  name: string;
  phoneNumber: string;
  language: SupportedLanguage;
  partySize?: number;
  specialRequests?: string;
  preferences?: ReservationPreferences;
  notifyEmail?: string;
  timesBooked: number;
  lastBookedAt: string;
}

export interface ReservationRequest {
  id: string;
  createdAt: string;
  /** Owning user (Google sub) — absent for guest-mode reservations */
  userId?: string;
  /** Phone number to dial, E.164 (e.g. +81312345678) */
  phoneNumber: string;
  restaurantName: string;
  partySize: number;
  /** ISO date, e.g. 2026-08-20 */
  date: string;
  /** Preferred seating time, e.g. 19:00 */
  time: string;
  /** Earliest acceptable seating time (defaults to 1h before preferred) */
  timeWindowStart?: string;
  /** Latest acceptable seating time (defaults to 1h after preferred) */
  timeWindowEnd?: string;
  /** Language the call should be conducted in */
  language: SupportedLanguage;
  callerName: string;
  /**
   * The guest's contact number for the booking — the ONLY number the agent
   * gives out when the restaurant asks for a phone number.
   */
  contactPhone?: string;
  /** Where to email the confirmation + transcript once the call completes. */
  notifyEmail?: string;
  /** Set when the confirmation email has been sent (prevents duplicates). */
  confirmationSentAt?: string;
  specialRequests?: string;
  preferences?: ReservationPreferences;
  /** Lifecycle status */
  status:
    | "created"
    | "scheduled"
    | "generating_phrases"
    | "ready"
    | "calling"
    | "completed"
    | "cancelled"
    | "failed";
  /** When to place the call (ISO). Absent = call immediately on creation. */
  callAt?: string;
  /** Number of call attempts made so far (max 3 on no-answer). */
  attempts?: number;
  phrasePack?: PhrasePack;
  /**
   * Fallback language the callee might answer in (e.g. Mandarin for
   * Singapore). Auto-set for +65 English calls; a second phrase pack is
   * prepared so the agent can switch mid-call.
   */
  altLanguage?: SupportedLanguage;
  altPhrasePack?: PhrasePack;
  /** Result summary once a call finishes */
  outcome?: {
    success: boolean;
    summary: string;
    confirmedDate?: string;
    confirmedTime?: string;
    /** What the restaurant said about corkage, when the agent asked */
    corkagePolicy?: string;
  };
  error?: string;
}

/** A single thing WE might say during the call, with pre-rendered audio. */
export interface Phrase {
  id: string;
  /** Text in the call language (e.g. Japanese) */
  text: string;
  /** English gloss so the operator can follow along */
  english: string;
  category: PhraseCategory;
  /** URL of pre-synthesized audio (Vercel Blob or local dev route) */
  audioUrl?: string;
  /** Library hash — set when audio came from the shared phrase library */
  libraryKey?: string;
}

export type PhraseCategory =
  | "greeting"
  | "request"
  | "confirm"
  | "deny"
  | "clarify"
  | "answer_party_size"
  | "answer_date_time"
  | "answer_name"
  | "answer_contact"
  | "special_request"
  | "hold"
  | "fallback"
  | "thanks"
  | "goodbye";

/** An utterance we EXPECT to hear from the restaurant, mapped to responses. */
export interface ExpectedUtterance {
  intent: string;
  /** Example phrasings in the call language, used for fast matching */
  examples: string[];
  /** Keywords that strongly signal this intent */
  keywords: string[];
  /** Phrase ids (from Phrase[]) that are valid responses, in preference order */
  responsePhraseIds: string[];
  /** If true, hearing this means the reservation was accepted */
  signalsSuccess?: boolean;
  /** If true, hearing this means the reservation was declined */
  signalsFailure?: boolean;
  /** If true, the call should end after responding */
  endsCall?: boolean;
}

export interface PhrasePack {
  language: SupportedLanguage;
  /** One-line scenario description used in prompts */
  scenario: string;
  phrases: Phrase[];
  expectedUtterances: ExpectedUtterance[];
  generatedAt: string;
  /** How many phrases were served from the persistent library vs newly synthesized */
  cacheStats?: { libraryHits: number; newlySynthesized: number };
}

/** One conversational turn recorded during a live call. */
export interface CallTurn {
  ts: string;
  speaker: "agent" | "restaurant" | "operator";
  /** What was said, in the call language */
  text: string;
  /** English translation (filled lazily to keep the call loop fast) */
  english?: string;
  /** How the agent produced its reply */
  source?: "cached" | "generated" | "operator_relay";
  intent?: string;
  confidence?: number;
}

export interface CallSession {
  id: string;
  reservationId: string;
  mode: "agent" | "ivr";
  /** What this call is for: making the booking (default) or cancelling it */
  purpose?: "book" | "cancel";
  twilioCallSid?: string;
  elevenLabsConversationId?: string;
  status: "dialing" | "in_progress" | "completed" | "failed" | "no_answer";
  startedAt: string;
  endedAt?: string;
  turns: CallTurn[];
  /** When true, the IVR loop hands control to the human operator (translation relay) */
  relayActive: boolean;
  /** Operator reply queued for playback: audio URL + text */
  pendingOperator?: {
    audioUrl: string;
    text: string;
    english: string;
    hangupAfter?: boolean;
  } | null;
  /** Count of consecutive unmatched utterances (drives relay escalation) */
  unmatchedStreak: number;
  /**
   * Language the call is currently being conducted in. Starts as the
   * reservation language; may switch to altLanguage mid-call (e.g. the
   * restaurant answers in Mandarin).
   */
  activeLanguage?: SupportedLanguage;
  /** True once we've tried switching to the alt language */
  languageProbed?: boolean;
}

/** Persistent phrase-library entry: one synthesized audio file, reused forever. */
export interface LibraryEntry {
  /** sha256 of language|voiceId|modelId|normalizedText */
  key: string;
  text: string;
  language: SupportedLanguage;
  voiceId: string;
  modelId: string;
  audioUrl: string;
  createdAt: string;
  hits: number;
  lastUsedAt: string;
}
