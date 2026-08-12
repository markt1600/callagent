# CallAgent — AI phone reservations for Japan

An AI agent that places **live telephone calls in Japan** (e.g. "call XXX to reach Restaurant Y and book a table for 2 on the 20th at 19:00, in Japanese"). Built with Next.js and deployed on **Vercel**, using **ElevenLabs** for speech, **Twilio** for telephony, and **Claude** for phrase generation, intent matching, and live translation.

## The core idea: pre-generate everything, cache forever

Reservation calls are extremely predictable. So when a request comes in — *before dialing* — the system:

1. **Scripts the call with Claude** (`claude-opus-5`): every line the agent may need to say in natural, polite Japanese (greeting stating the full request, answers for party size / date / name / phone number, confirmations, corrections, "please repeat", hold phrases, fallbacks for "we're full", goodbyes), **plus** everything the restaurant is likely to say back, as intents with example phrasings and keywords (「何名様ですか」→ `ask_party_size` → answer phrase).
2. **Pre-renders all agent audio with ElevenLabs** (`eleven_multilingual_v2` — quality model, since latency doesn't matter before the call).
3. **Stores every clip in a persistent, content-addressed phrase library** — Vercel Blob for the MP3s, KV for metadata, keyed by `sha256(language | voice | model | text)`.

The library is **shared across all reservations and grows over time**. The prompt deliberately steers common phrases toward standard wording, so greetings, confirmations, number/date answers, etc. are synthesized **once, ever** — each new reservation only generates its handful of request-specific lines. The dashboard shows library size, hit counts, and reuse rate, so you can watch generation cost fall call over call.

During the call, replies are answered with cached audio via lookup — no LLM call, no TTS call, effectively zero generation latency on our side.

## Two calling modes (+ a human fallback)

### Mode A — Agent mode (recommended for natural conversation)

**ElevenLabs Conversational AI** with its **native Twilio integration**. One API call from Vercel starts the outbound call; ElevenLabs hosts the realtime loop — streaming STT → LLM → streaming TTS with built-in turn-taking/endpointing — which is what real sub-second conversational latency requires.

> **Why not run the realtime loop on Vercel?** Twilio media streams require a persistent WebSocket that holds raw audio for the whole call. Vercel serverless/edge functions can't hold that kind of long-lived stateful connection. Rather than adding a second host (Fly/Railway) just for a relay, Agent mode delegates the realtime leg to ElevenLabs — which also ships the hardest latency work (streaming ASR, endpointing, barge-in) already tuned. Vercel remains the control plane: triggering calls with per-reservation dynamic variables, receiving post-call transcript webhooks, and running the phrase/library pipeline.

Setup: create an agent in ElevenLabs Conversational AI (paste the prompt from `src/lib/elevenlabsAgent.ts` → `agentPromptTemplate()`, enable Japanese), import your Twilio number, and set `ELEVENLABS_AGENT_ID` + `ELEVENLABS_AGENT_PHONE_NUMBER_ID`. Point the post-call webhook at `/api/elevenlabs/webhook`.

### Mode B — Cached IVR mode (100% on Vercel, uses the phrase library directly)

A self-hosted turn-based loop using **Twilio TwiML webhooks** (plain HTTPS — works perfectly on serverless):

```
Twilio <Play> cached MP3 → <Gather input="speech" language="ja-JP"> →
POST /api/twilio/gather with transcript → pick next cached clip → repeat
```

Understanding what the restaurant said uses a **three-tier latency ladder**:

| Tier | Mechanism | Latency |
|---|---|---|
| 1 | Keyword/substring match against pre-generated expected utterances | ~0 ms |
| 2 | `claude-haiku-4-5` classifies into the known intent list | ~300–600 ms |
| 3 | Unmatched: generate a one-off reply (Haiku) + low-latency TTS (`eleven_flash_v2_5`) — result is cached in the library too, so it's instant if it ever recurs | ~1–2 s |

Two unmatched turns in a row automatically escalates to the **translation relay** (below). Tier 1 handles most turns because the phrase pack anticipated them.

### Fallback — live translation relay (both ways)

When automation can't cope (or when you click **Take over call**), the call parks on a polite hold loop while you drive it from the dashboard:

- Restaurant speech appears in the live transcript with **English translations** (translated lazily, off the hot path, so it never slows the call).
- You type a reply **in English** → Claude translates to polite Japanese → ElevenLabs synthesizes (flash model) → it's spoken into the call.
- **Resume automation** hands control back to the cached-phrase loop; **Send & hang up** ends the call politely.

## What else reduces latency on "what is said on the other end"?

Implemented here:

- **Precompute understanding, not just speech.** The phrase pack includes *expected utterances* with keywords, so most turns are resolved by string matching — the biggest single win, because the LLM is removed from the hot path entirely.
- **Fast/slow model split.** `claude-opus-5` does the heavy scripting before the call; `claude-haiku-4-5` handles anything inside the call loop (classification, dynamic replies, live translation).
- **Two-tier TTS.** Quality model for pre-rendered audio, `eleven_flash_v2_5` (~75 ms model latency) for anything synthesized mid-call.
- **Tight endpointing.** `<Gather speechTimeout="auto" speechModel="experimental_conversations">` ends capture as soon as the speaker stops rather than waiting a fixed timeout.
- **Lazy translation.** English glosses for the transcript are backfilled when the dashboard polls, never inside the call loop.
- **Instant hold phrases.** Cached 「少々お待ちください」 plays immediately whenever the system needs time, so silence never feels dead.

Worth adding as the project matures:

- **Streaming ASR with partial hypotheses** (start intent-matching before the speaker finishes) — requires the media-stream path, i.e. Agent mode or a small dedicated WebSocket relay.
- **Barge-in** (let the agent be interrupted mid-playback) — same requirement.
- **Region pinning** — put Vercel functions in `hnd1` (Tokyo) and use a Twilio JP number so audio doesn't cross the Pacific twice.
- **Anthropic prompt caching** on the intent-classification system prompt if Tier 2 volume grows.

## Project layout

```
src/
  lib/
    phrasegen.ts        Claude scripts the call (structured outputs, zod schema)
    phraseLibrary.ts    persistent content-addressed audio cache (the "database of phrases")
    tts.ts              ElevenLabs synthesis (prerender + realtime profiles)
    audioStorage.ts     Vercel Blob (prod) / .data/audio (dev)
    intent.ts           3-tier understanding ladder
    callEngine.ts       IVR conversation state machine
    translate.ts        EN⇄JA live translation
    elevenlabsAgent.ts  Agent-mode outbound calls (ElevenLabs × Twilio)
    twilioClient.ts     dialing, TwiML builders, signature validation
    store.ts            Vercel KV / Upstash (prod) or .data/store.json (dev)
  app/
    page.tsx            dashboard: create requests, place calls, live transcript,
                        operator relay, phrase library stats
    api/
      reservations/…            create / list / prepare / call
      calls/…                   transcripts (lazy-translated) / operator relay
      twilio/{voice,gather,relay,status}   IVR-mode webhooks
      elevenlabs/webhook        post-call transcripts (Agent mode)
      audio/[...key]            dev-mode audio serving
      library                   phrase-library stats
```

## Setup

1. `cp .env.example .env.local` and fill in keys (see comments in the file).
2. `npm install && npm run dev`
3. For IVR mode locally, expose the dev server (`ngrok http 3000`) and set `PUBLIC_BASE_URL` to the tunnel URL — Twilio must be able to reach the webhooks.
4. Deploy: `vercel`, add the env vars, attach a Blob store and a KV/Upstash database. Storage falls back to `.data/` files locally, so no external services are needed for development besides the three APIs.

### Calling Japan: compliance notes

- In the Twilio console, enable **Japan (+81)** under Voice Geographic Permissions before dialing.
- Buying a Japanese caller-ID number requires identity documentation under Japanese telecom rules; calls also work from a US/other number, but a JP number materially improves answer rates.
- Recording calls has consent requirements — this app stores transcripts, not audio recordings, of the counterparty.

## API quick reference

```bash
# Create a request
curl -X POST /api/reservations -d '{
  "restaurantName": "鮨 さいとう", "phoneNumber": "+81312345678",
  "partySize": 2, "date": "2026-08-20", "time": "19:00",
  "language": "ja", "callerName": "Tanaka",
  "specialRequests": "counter seats if possible"
}'

curl -X POST /api/reservations/{id}/prepare        # generate phrases + audio
curl -X POST /api/reservations/{id}/call -d '{"mode":"agent"}'   # or "ivr"
curl /api/calls/{callId}                           # transcript (EN-translated)
curl -X POST /api/calls/{callId}/operator -d '{"text":"Could we do 7:30 instead?"}'
curl /api/library                                  # phrase-library stats
```
