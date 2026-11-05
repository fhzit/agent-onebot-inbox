# AI classification persistence and read contract

Status: proposed contract only. This document does not claim that classification results are persisted or exposed today.

## Safety boundary

Persist only a validated advisory outcome, never the classifier request or message payload. The durable record may contain:

- stable result ID;
- account ID and message ID (for scoped association);
- allowlisted label;
- confidence in `[0, 1]`;
- classifier/model identifier and policy version, if available;
- created timestamp and optional expiry timestamp.

Do **not** persist message text, prompt/envelope, provider response/raw JSON, explanation/reason, generated summary, contact metadata, or arbitrary model fields. A reason string can quote or paraphrase private message content, so it is excluded even if bounded. Store neither credentials nor transport/provider tokens. Persist only after the existing classifier contract has validated the label and confidence against the configured label set; malformed output and classifier failures create no record. Abstentions need not be stored; if operationally needed, store a fixed enum reason only, never free text.

A classification is advisory metadata, not an instruction or action. It must not change inbox unread/processed/dismissed state, trigger sends, notifications, task creation, or other automation. Duplicate message ingestion must not create duplicate result rows; use a uniqueness rule keyed to the message and classification policy/version, with an explicit replacement/versioning policy before implementation.

## Read API

Any future endpoint must be authenticated with the existing administrative/API authorization model and enforce account scope on every query (including message-ID lookups). A minimal read surface should expose only records for a requested account and bounded time/order pagination, returning the fields above. It must not return message bodies, prompts, classifier raw output, or join to message content. Apply a conservative page-size cap, deterministic cursor/order, and retention/expiry behavior. Do not add a cross-account/global endpoint by default.

Before adding UI, ensure the underlying read API returns only the allowlisted metadata. The UI may show label, confidence, model/policy, and timestamp next to a message, but should not render generated reason/explanation or offer action controls. Missing result is normal and must display as “not classified,” not as a negative classification.

## Storage choice and migration guidance

The existing general `classifications` table in `migrations/0001_initial.sql` is not a safe drop-in for this contract: it includes `reason`, `summary`, `action_items`, and unrestricted `raw_result`, and its priority/task fields do not match the small advisory contract. Do not write AI outputs into those fields or expose that table wholesale. Prefer a dedicated AI advisory table with constrained label/confidence and a unique message/policy-version key, plus message/account foreign keys consistent with the repository's string IDs. Define retention and deletion behavior before shipping; avoid storing message content redundantly.

## Current implementation boundary

The current opt-in ingress hook attaches validated output transiently to an ingress message object. Existing ingress tests exercise that transient behavior; they do not establish durable storage or a user-visible API. This contract intentionally requires a separate persistence adapter, migration, authenticated account-scoped read endpoint, and tests before a UI can safely expose results. Do not modify ingress/idempotency behavior as part of this contract.
