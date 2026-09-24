# Verification evidence

Verified locally on September 23, 2026.

## Automated checks

`npm run check` completed with exit code 0:

- Backend syntax checks passed.
- 233 regression tests passed; 0 failed.
- Vite production build passed.
- 15 COO-specific tests cover setup, annual/quarterly links, metric calculation, historical cutoff, immutable reviews, follow-ups, validation, same-date corrections, archive integrity, dependency loops, CSV escaping, PostgreSQL persistence, permissions, concurrent writes, and record-version conflict protection.

The repository test runner uses isolated database fixtures and provider mocks. No production database migration or provider mutation was performed.

## Browser → API → PostgreSQL → UI

The localhost preview runs the real COO API against PGlite with a local test identity. Verified through browser interactions:

- A suggested Defect rate KPI saved with a manually entered owner, baseline, and target.
- A 3% actual against a 2% maximum target displayed Off track and appeared in the operating review agenda.
- A review saved its discussion, decision, lesson, and four-measure snapshot.
- An assigned supplier-audit follow-up appeared on the initiatives board with its owner and due date; the originating review reported one linked commitment.
- KPI values persisted across page reloads.
- A department objective aligned to the annual company objective; a decreasing key result appeared under it with explicit missing-data status.
- Two browser tabs made concurrent department edits. The stale save was rejected, its draft remained intact, and refresh/retry preserved both departments.
- Plan in another cycle copied a metric definition into a different cycle without copying its actuals or history.
- The final versioned handler accepted an owner edit and returned the persisted record to the interface.
- At a 390px requested mobile viewport, the rendered document had no horizontal page overflow. The tab strip and scorecard table use their own horizontal scrolling.
- No browser console errors were observed during the verified workflows.

Native date entry was exercised using the date control's keyboard interaction; synthetic browser-tool filling alone did not update React state in that control.

## Release boundary

This verifies the local implementation and database semantics. Hosted auth, production runtime grants, and the new production table must be verified during the normal release workflow. Actuals remain manual; existing Campfire reports are linked as sources, not automatically synchronized.

## Owner-only rollout update

The subsequent owner-only change passed `npm run check`: 234 tests, no failures, backend syntax checks, and production build. Tests explicitly reject GET and POST for every non-owner role, including a non-owner with wildcard/admin/analytics permissions, before any COO data query. The sidebar, performance-hub link, and direct COO component rendering use the same role predicate. This replaces the initial broader analytics-role access described in the original test run.
