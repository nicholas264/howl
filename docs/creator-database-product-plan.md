# Creator Database Product Plan

## Goal

Make the creator database the operating system for UGC: clean creator records, connected assets, historical performance, and two-way creator communication in one place. ClickUp should become an ingest source, not the product's source of truth.

## Product Principles

- Treat imported ClickUp data as raw source evidence. Never let custom ClickUp statuses or one-off fields directly drive the product workflow.
- Maintain a canonical creator profile that UGC managers can trust: identity, contact, social proof, rates, shipping, contract state, briefs, deliverables, assets, and performance.
- Preserve source history for audit and repair. Messy fields should be inspectable without cluttering the daily operator UI.
- Make the default action obvious. Every creator record should answer: who is this, where are they in the relationship, what are we waiting on, and what should happen next?

## Fresh ClickUp Pipeline

### Phase 1: Raw Landing Zone

Create raw import tables instead of writing ClickUp directly into `creators`:

- `creator_source_runs`: provider, list/view id, started_at, completed_at, actor, status, counts, errors.
- `creator_source_records`: run_id, provider, external_id, external_url, raw_status, raw_payload, raw_fields, payload_hash, observed_at.
- `creator_source_field_map`: provider, raw_field_name, canonical_field, transform, confidence, reviewed_by, reviewed_at.
- `creator_source_status_map`: provider, raw_status, canonical_stage, canonical_status, confidence, reviewed_by, reviewed_at.

This gives the team a full copy of ClickUp without letting bad statuses pollute workflow state.

### Phase 2: Normalize Into Staging

Build a deterministic normalizer that emits `creator_staging_profiles`:

- identity: name, email, phone, location, timezone.
- socials: platform, handle, profile_url, followers, views, engagement.
- commercial: rate notes, usage notes, availability.
- fit: niche, activities, strengths, audience demographics, audience psychographics.
- operations: shipping, product need, source status, mapped stage/status.
- quality flags: missing_email, duplicate_candidate, unmapped_status, conflicting_email, weak_social_url, stale_record.

Staging records should be reviewable before promotion. The current `source_metadata.custom_fields` remains useful, but it should become supporting evidence rather than the main escape hatch.

### Phase 3: Promote To Canonical Creator

Promotion rules:

- Match by ClickUp task id first, then verified email, then social handle, then duplicate-review queue.
- Do not overwrite human-owned canonical fields with blank or lower-confidence source values.
- Only update `creators.stage` automatically when the status mapping is reviewed or high confidence.
- Store every promotion decision in `creator_activity` and keep the source record id in metadata.

### Phase 4: Asset And History Association

Creator assets should associate through stable ids:

- `creative_assets.creator_id` for source footage and finished assets.
- `creator_deliverables` for expected and received outputs.
- `launch_history.creator_id` for launched ads.
- `creative_creator_assignments` for planning and concept attribution.

Add a creator asset reconciliation job that backfills `creator_id` from historical `launch_history.creator`, file names, deliverables, source labels, and explicit user mapping.

## Two-Way Communication Plan

### Current Foundation

The app already has:

- Gmail OAuth via `/api/auth/google` with `creator_email` purpose.
- Sending through `/api/creator-email`.
- Reply sync by Gmail thread id into `creator_outreach`.
- Manual outreach status, outcome, and follow-up tracking.

### Next Product Layer

Make `Comms` a real inbox:

- Add a creator-level conversation timeline grouped by `external_thread_id`.
- Show inbound and outbound messages as message bubbles with sender, time, status, and attachments/links.
- Add reply compose from an existing thread using Gmail `threadId` and `In-Reply-To` headers.
- Add "Sync all creator replies" for managers, not only per creator.
- Add unread/replied flags and surface them in Operations.
- Add email templates for intro, follow-up, assignment, agreement, overdue footage, and rebooking.
- Add a "last touch / next touch" summary to the creator database row and drawer signal strip.

### Schema Extensions

Add:

- `creator_email_threads`: creator_id, provider, external_thread_id, subject, last_message_at, last_direction, status, unread, assigned_user_id.
- `creator_email_messages`: thread_id, outreach_id, external_message_id, direction, from_email, to_email, cc, subject, body_text, snippet, sent_at, received_at, raw_metadata.
- `creator_email_templates`: name, purpose, subject_template, body_template, status, version.

Keep `creator_outreach` as the relationship action log, but let the email tables be the durable message store.

## Drawer UX Direction

The drawer should be an operator record, not a data dump:

- Header: creator identity, stage/status controls, signal strip.
- Next action: lifecycle and one recommended action.
- Tabs: Profile, Products, Terms, Briefs, Comms, Assets, Results.
- Profile: social intelligence, fit facts, raw application details collapsed by default.
- Comms: conversation-first view with send, draft, sync, and follow-up controls.
- Assets: deliverable progress and upload links.
- Results: historical launched creative and performance.

## Implementation Order

1. Clean up drawer hierarchy and communication UX.
2. Add raw ClickUp landing tables and stop direct ClickUp-to-canonical writes for new syncs.
3. Build staging review UI inside Data Health.
4. Add reviewed field/status mapping controls.
5. Add email thread/message tables and thread-aware replies.
6. Add global inbox sync and Operations queue signals.
7. Backfill creator asset associations and expose confidence/review queues.

## Success Metrics

- UGC manager can process new creators without opening ClickUp.
- Fewer than 5% of imported creators land in "needs review" after mapping review.
- Every active creator has a next action, last touch, and owner.
- Every launched creator asset can be traced back to creator, deliverable, brief, and performance.
- Replies show up in the app without manual copy/paste from Gmail.
