// Core domain types shared across the app.

export type SupportedLanguage = "ja" | "en" | "zh" | "de" | "ko" | "fr";

/**
 * Buddy Call languages: broader than the reservation stack (which needs
 * phrase packs, speech locales, and translation per language) because buddy
 * calls only need the ElevenLabs agent, which speaks all of these.
 */
export type BuddyLanguage = SupportedLanguage | "th" | "vi";

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
  /** Optional — lets the agents speak naturally (pronouns, forms of address). */
  gender?: "female" | "male" | "other";
  /** Set once the save-Agent-M-contact prompt has been shown */
  contactCardPromptedAt?: string;
  /** Call-credit balance. Absent = untouched starting grant. */
  credits?: number;
  /** Preferred Buddy Call language — prefills the buddy form. */
  buddyLanguage?: BuddyLanguage;
  /** Stored emergency contact — prefills Buddy Call's emergency section. */
  emergencyContact?: {
    name: string;
    phone?: string;
    email?: string;
    codeword: string;
    /** Language for the relay call/email */
    language?: BuddyLanguage;
  };
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

/**
 * Buddy Call: a scheduled friendly check-in call to the user's own phone —
 * a built-in excuse to step out of a date or meeting. The agent plays along
 * with any "situation" the user starts describing, and two codewords let
 * the user schedule a call-back (+30 or +60 minutes) mid-conversation.
 */
export interface BuddyCall {
  id: string;
  createdAt: string;
  /** Owning user (Google sub) — absent for guest-mode buddy calls */
  userId?: string;
  /** The user's own number to ring, E.164 */
  phoneNumber: string;
  /** What the buddy should call the user */
  name: string;
  /** Language the buddy call is conducted in */
  language: BuddyLanguage;
  /** When to ring (ISO) */
  callAt: string;
  /** Optional setting so the call sounds right (e.g. "first date at a wine bar") */
  scenario?: string;
  /** Worked into conversation → call back in 30 minutes */
  codeword30: string;
  /** Worked into conversation → call back in 60 minutes */
  codeword60: string;
  /**
   * Optional real-safety escape hatch: if the user says the emergency
   * codeword and confirms it by repeating it, the agent acknowledges and
   * hangs up, and the system calls (or emails) this contact.
   */
  emergencyContact?: {
    name: string;
    phone?: string;
    email?: string;
    codeword: string;
    /** Language for the relay call/email (defaults to the buddy call's) */
    language?: BuddyLanguage;
  };
  /** Set when the emergency codeword was said and confirmed on a call */
  emergencyTriggeredAt?: string;
  emergencyStatus?: "calling" | "notified" | "failed";
  /** Conversation id of the emergency-relay call (webhook matching) */
  emergencyConversationId?: string;
  emergencyAttempts?: number;
  status: "scheduled" | "calling" | "completed" | "failed" | "cancelled";
  /** Dial attempts for the current scheduled time (max 5, 30s apart) */
  attempts: number;
  /** Conversation id of the most recent dial (webhook matching) */
  lastConversationId?: string;
  /** Set when a codeword triggered a rescheduled call-back */
  rescheduledFor?: string;
  turns?: CallTurn[];
  summary?: string;
  error?: string;
}

/**
 * Affirmation Call: a warm, soothing call that delivers a personal message
 * to someone on the requester's behalf, at a time given in the DESTINATION
 * number's timezone. Retry policy on no-answer: +1 hour, then +2 more hours
 * (skipped if that lands past 10 PM local), then the next day at the
 * originally scheduled time — one extra day, then failed.
 */
export interface AffirmationCall {
  id: string;
  createdAt: string;
  /** Owning user (Google sub) — absent for guest-mode calls */
  userId?: string;
  /** The recipient's number to ring, E.164 */
  phoneNumber: string;
  /** Recipient's name (greeted by it) */
  recipientName: string;
  /** Who the message is from (the user, when signed in) */
  requesterName: string;
  /** Language the agent speaks when calling the recipient */
  language: BuddyLanguage;
  /**
   * Voice/persona for spoken (typed-message) delivery: the standard warm
   * female voice, or "ahbeng" — a male, heavily Singlish-accented character
   * (its own ElevenLabs agent; English and Chinese only).
   */
  persona?: "standard" | "ahbeng";
  /** True when Ah Beng's sweetheart mode was active for this call. */
  sweetheart?: boolean;
  /**
   * When something last HAPPENED on this call (placed, completed, failed).
   * The listing sorts by it, so a long-ago-scheduled or recurring call
   * rises to the top when it actually runs. Falls back to createdAt.
   */
  lastActivityAt?: string;
  /** Longer call: after delivering the message, keep chatting until the recipient hangs up */
  longChat?: boolean;
  /** The message to deliver (may be empty when a recording is attached) */
  message: string;
  /** Set when the message was AI-generated instead of typed */
  messageKind?: "joke" | "compliment" | "insult";
  /** No message at all — the agent just calls to check how they're doing */
  checkIn?: boolean;
  /** True = word-for-word delivery; false = the AI may warmly embellish */
  literal: boolean;
  /**
   * The requester's own recorded voice message (public audio URL). When set,
   * the call is placed via Twilio and REPLAYS this recording instead of the
   * AI agent speaking the message.
   */
  recordingUrl?: string;
  /** Synthesized intro clip URL for recorded-message calls */
  introUrl?: string;
  /** Synthesized outro clip URL for recorded-message calls */
  outroUrl?: string;
  /** Synthesized "hear it again?" prompt URL for recorded-message calls */
  replayPromptUrl?: string;
  /** Synthesized screening announcement URL ("call on behalf of…") */
  announceUrl?: string;
  /** Set once the missed-call heads-up SMS has been sent (max one per call) */
  smsSentAt?: string;
  /**
   * When the conversation the current summary/transcript describes actually
   * happened. Recurring calls reuse this record (callAt moves to the next
   * occurrence), so without this the summary's date is ambiguous.
   */
  summaryAt?: string;
  twilioCallSid?: string;
  /** Next scheduled attempt (UTC ISO) */
  callAt: string;
  /** The day-1 scheduled time — next-day retries land at this wall-clock time */
  originalCallAt: string;
  /** Repeat the call on a schedule (destination wall-clock preserved) */
  recurrence?: "daily" | "monthly" | "annual";
  status: "scheduled" | "calling" | "completed" | "failed" | "cancelled";
  /** Total dials across all days */
  attempts: number;
  /** Dials within the current day's cycle (max 3) */
  attemptsInCycle: number;
  /** 1 = original day, 2 = next-day retry */
  cycle: number;
  lastConversationId?: string;
  turns?: CallTurn[];
  summary?: string;
  error?: string;
}

/**
 * A friend saved on the user's account — selectable as the recipient of an
 * Affirmation Call, with the saved details applied.
 */
export interface Friend {
  /** Digits of the phone number (stable id) */
  id: string;
  name: string;
  phoneNumber: string;
  /** Preferred language for calls to this friend */
  language?: BuddyLanguage;
  timesCalled?: number;
  lastCalledAt?: string;
}

/**
 * What the agent remembers about one person across conversations — a
 * compact rolling summary, rewritten after every call/chat so it stays
 * small (bounded prompt cost) no matter how many conversations happen.
 * Scoped per app account: `memory:{userId}:{personKey}`.
 */
export interface PersonMemory {
  /** The memory file itself (~130 words max) */
  summary: string;
  personName: string;
  /** "self" (the account owner) or the person's phone digits */
  personKey: string;
  conversationCount: number;
  lastConversationAt: string;
}

/** One entry in a user's credit ledger (deductions and additions). */
export interface CreditTransaction {
  id: string;
  userId: string;
  at: string;
  /** Negative = deduction, positive = credits added */
  delta: number;
  balanceAfter: number;
  description: string;
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
