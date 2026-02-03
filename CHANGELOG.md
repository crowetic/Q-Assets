# Changelog

## 0.9.4 - 2026-01-()

- Paused Q-Deck polling while any dialog is open to avoid interrupting active edits.
- Paused Q-Deck polling while any text input is focused to avoid disrupting in-progress typing.
- Switched Q-Deck polling to background checks with a “new changes” banner instead of auto-refreshing cards.
- Suppressed Q-Deck “new changes” notifications for updates published by the active user.
- Seeded Q-Deck poll state on board entry to avoid showing the update banner on first load.

## 0.9.3 - 2026-01-(29)

- Paused Q-Deck polling while batch publish queues have pending changes to prevent local edits from being overwritten.

## 0.9.2 - 2026-01-(27-29)

- Fixed Q-Deck board refreshes so they no longer blank the board while reloading data.
- Added 30-second Q-Deck polling to surface new cards, comments, and status updates without a full refresh.
- Reduced Q-Deck card primary-image reloads during refreshes to prevent layout jitter.
- Added Q-Deck task join/cancel-start actions and completion comments for better task attribution.
- Optimized Q-Deck polling to compare the latest cards index doc before reloading data.
- Seeded Q-Deck poll stamps on first pass to avoid an initial refresh burst.
- Stabilized Q-Deck polling by tracking cards index signatures to prevent repeated reload loops.
- Fixed CardDialog hook ordering to satisfy React hooks lint rules.
- Guarded CardDialog board usage to satisfy TypeScript nullability checks.

## 0.9.1 - 2026-01-22

- Improved header responsiveness on small screens to prevent horizontal scrolling in compact layouts.
- Adjusted Q-Mail notification publishing to default to a single queued publish so bulk sends need fewer confirmations.
- Fixed Q-Deck cards index repairs to publish under the active editor name instead of the board owner.
- Fixed asset management publishes so primary group updates are included even when no other fields change.
- Scoped group address caching per group ID to prevent admin/membership lookups from reusing unrelated group data.
- Aligned Xqlore admin gating with management manifest permissions to match the main admin panel.

## 0.9.0 - 2026-01-21

- Corrected the Xqlore stats aggregation so AT deposits are treated as sold QORT, AT payouts only count as buys for non-owner accounts, and refunds no longer skew the leaderboards.
- Removed the minted-block leaderboard from the Xqlore stats overview pending a rewrite of that feature.

## 0.8.9 - 2026-01-20

- Added a board rename action to the Q-Deck board menu.
- Sorted Q-Deck board overviews by most recently updated or created.
- Collapsed long board group lists in the Q-Deck overviews with a +N more expander.
- Added board rename actions to the My/All Boards menus and refreshed list titles after renames.
- Added a Q-Deck project permissions panel to manage project admins/editors and admin overrides.
- Enforced project edit rights so only authorized editors/admin overrides can publish project updates.
- Optimized project calendars by reading schedule metadata from cards indexes and skipping archived cards.
- Remembered per-board publish mode (immediate vs queued) for Q-Deck boards.
- Displayed group names alongside IDs in the My/All Boards permission chips.
- Fixed "create card already in progress" to place new cards into the In Progress list when available.
- Added completion timestamps to done cards in Q-Deck boards.
- Reordered Xqlore long-term stats to highlight QDN activity first and compacted account labels when names are missing.
- Adjusted Xqlore buy/sell stats to ignore AT cancellations and only count QORT sent into ATs as sells.
- Added minted-block leaders to the Xqlore stats overview using rewardshare minter lists and address snapshots.
- Added a long-term stat for total QORT accounts with balances over 25 QORT, shown in the top summary.
- Tucked Xqlore index tools behind an on-demand toggle and refreshed the stats layout.
- Renamed the consolidated QORT leaderboard to clarify it is a consolidation transaction count.
- Updated Xqlore incoming/bought QORT to treat AT payouts to their deployers as refunds, not buys.
- Updated Xqlore buy/sell logic to key ACCT trades off DEPLOY_AT metadata so sold QORT uses deploy amounts and excludes refunded ATs.
- Guarded Q-Deck card minimize state updates to prevent render loops when opening boards.
- Prevented publish-mode preference syncing from re-triggering state updates when toggling queued publishing.
- Fixed Q-Deck cards index typing to include card metadata fields.

## 0.8.8 - 2026-01-19

- Switched Xqlore long-term index builds to configurable 25k-block batch counts with sequential processing.
- Capped Xqlore index batches at 50k transactions and adjust batch end blocks when density is high.
- Added pagination to the Xqlore activity stream to keep large timeframes manageable.
- Removed the encrypted payloads metric from the Xqlore signal console.
- Updated Xqlore index head selection to prefer the largest coverage before timestamps, with allowlisted app publishers still preferred.
- Added aggregated Xqlore stats overview publishing with account activity leaders.
- Added a rebuild action to regenerate the Xqlore stats overview from all published index batches.
- Improved stats overview rebuild to fall back to the latest index when candidate lookup returns empty, with staged progress updates during aggregation.
- Sorted Xqlore index entries by block height before validation and skip publishing empty batch ranges.
- Added a rebuild action to republish existing Xqlore index batches using the latest normalization.
- Added fallback lookup when the latest Xqlore index or stats overview identifiers are missing.
- Streamed Xqlore index rebuilds in publish chunks (20 batches) to limit memory while reducing publish calls.
- Scoped Xqlore index rebuilds to the active publisher and reused existing identifiers, preferring the largest batch per range.
- Excluded the null account from Xqlore stats, raised leaderboards to the top 50, and expanded the overview with QORT flow leaders while keeping QDN publish and asset event leaderboards (excluding QORT-as-asset transfers from asset counts).
- Fixed Xqlore index batch publishing typing so the publish queue accepts batch resources.
- Improved link handling to open `qortal://` links in-app while reliably copying external links.
- Switched external link copy notices to use the in-app alert dialog.
- Fixed link handler capture so header buttons keep working.
- Allowed published content to retain `https://` links and linkified Qortal/external URLs on render.
- Preserved `mailto:` and `tel:` links during publish sanitization.
- Fixed announcement detail rendering to linkify URLs so links are clickable.
- Limited news/announcement loading to non-expired publications and removed archived toggles.
- Rehydrated anchor tags stripped of hrefs in published HTML so legacy links are clickable.

## 0.8.6 - 0.8.7 - 2026-1-17 - 2026-01-19

- Adjusted Data Explorer tombstone filtering to only apply deletion heuristics to small files and rely on explicit markers.
- Added the Xqlore explorer design with live activity layout, tag matrix, and app attribution panels.
- Wired Xqlore to live transaction searches with real activity data, click-through details, and a left-header link.
- Added Xqlore account/app/minting/trading pages plus an admin console for managing the app identifier registry.
- Added Xqlore index loaders and a new Xqlore-themed transaction details dialog.
- Switched Xqlore live activity searches to use block-range queries for deeper results.
- Tuned Xqlore live block ranges to align with time-window selections (24h uses ~1400 blocks).
- Simplified Xqlore live searches to avoid start-block offsets when scanning recent activity.
- Expanded Xqlore live-search fallback to page through larger batches until the selected timeframe is covered.
- Fixed current block height detection for Xqlore index builds and made long-term indexing start from genesis or the latest published range.
- Switched Xqlore long-term index builds to confirmed-only searches across all transaction types, storing raw tx payloads with optional creator names.
- Added build progress feedback while Xqlore long-term indexes are assembled.
- Centralized the Xqlore transaction type list so the main explorer and long-term indexing stay aligned.
- Re-normalized Xqlore live activity on app-index changes so app attribution updates immediately.
- Re-normalized Xqlore indexed entries on app-index updates to refresh attribution without refetching.
- Re-derived Xqlore attribution and signal stats directly from registry-aware tx normalization.
- Switched Xqlore activity list and identifier panels to render registry-updated tx data immediately.
- Added a loading indicator for the Xqlore app registry in the attribution panel.
- Stabilized Xqlore admin form updates to prevent update-depth errors and reduce input lag.
- Adjusted Xqlore activity labeling so only QDN publishes map to apps and other tx types show type-based details.
- Labeled the Qortal Null Account with an explainer and added balance lookup on Xqlore account pages.
- Defaulted Xqlore activity to 24h and moved identifier/tag panels under attribution on the right column.
- Defaulted Xqlore activity to 6h and adjusted available time ranges to hourly and weekly presets.
- Expanded Xqlore page layouts to use an 85vw responsive container with a soft max width.
- Defaulted Xqlore long-term index builds to 100k blocks per publish batch.
- Reduced Xqlore index validation noise and treat signature lookup failures as warnings to prevent false negatives.
- Added a long-term stats page with tx index build, validation, and publish controls.
- Added a Create board action on project pages that creates and attaches a board in one step.
- Updated project calendars to render tasks spanning multiple days across each day in the range.
- Hid deleted boards from the project add-board picker by requiring resolvable board metadata.

## 0.8.5 - 2026-1-14

- Added an All Projects view in Q-Deck to browse public projects alongside accessible private ones.
- Added My/All toggle buttons to the Q-Deck boards pages for quick switching.
- Expanded the project add-board picker to include all accessible boards, not just boards you created.
- Fixed the project add-board picker to populate public boards even when metadata hydration fails and show a loading state while scanning.
- Added asset selection from the cached Q-Assets index and switched project asset metadata to hydrate from the index without blocking.
- Fixed a project asset detail loader regression where asset names could remain stuck in a loading state.
- Improved Q-Deck project board details with labeled fields and group-name resolution, and moved the Add board action into the Boards section.
- Simplified project asset linking to use the selector only (removed the manual asset ID input).
- Added asset avatars to the project assets list.
- Added Start task/Complete actions on cards and in the card dialog to set start/end dates and mark work done.
- Improved Q-Deck drag-and-drop performance and kept priority ordering stable after moving cards.
- Filtered deleted (tombstone-sized) boards out of the project add-board search results.
- Updated LOW priority styling to use purple instead of green for clearer contrast with completed cards.
- Added a create-in-progress option when adding a new card to prefill start task status.
- Starting a task now moves the card into the In Progress list when one exists.
- Start task buttons now match card priority colors and show green outlines while in progress.
- Improved in-progress list detection to match labels like "IN-PROGRESS".
- Added in-board card search for quick filtering by title, tags, assignees, or list name.
- Updated Q-Deck card backgrounds to use subtle status tints, with stronger completed styling and muted text.
- Darkened completed card tint/text and added subtle priority-based background tints.
- Smoothed Q-Deck board search input by deferring heavy filtering work.
- Adjusted completed card styling to use grey outlines/tints with secondary text color.
- Optimized board search indexing to reduce input lag on large boards.

## 0.8.4 - 2026-01-12

- Deferred loading of the home news/promotions section until it enters view to improve initial load times.
- Added a notifications group join prompt below the header with a local "no thanks" dismissal cache.
- Added streaming audio previews in the Data Explorer with chunked-audio fallback playback.
- Extended chunked media previews to cover audio alongside existing video handling.
- Fixed Q-Deck cards index discovery to honor newest published indexes across editors, including direct-encrypted resources.
- Fixed Q-Deck board loads from direct links by retrying card loads when identity is ready or the first cards fetch comes back empty.
- Fixed Q-Deck create-board dialog so the private group selector only appears after enabling private mode.
- Refined the Q-Deck card dialog layout to a single readable column and corrected assignee name verification.
- Added a Q-Deck publish queue editor to review and remove queued publishes before batch publishing.
- Improved Q-Deck responsiveness by reducing unnecessary list/card re-renders.
- Added list ordering controls to the Q-Deck list manager.
- Added list color controls to the Q-Deck list manager.
- Improved Q-Deck list manager responsiveness by isolating its edits from the board render loop.
- Removed the nonfunctional Q-Deck clone board action from the board menu.
- Added Q-Deck projects with board and asset linking.
- Added card scheduling fields and calendar views for boards and projects.
- Allowed direct-encrypted private boards and projects without requiring a group ID.
- Fixed project index writes to use the resolved issuer name and added private fallback when public project lookups fail.
- Fixed project pages to open immediately after creation by falling back to locally cached project docs while QDN publishes finalize.
- Added readable board details with permission summaries on project pages.
- Added per-board color selection for project boards and used it in project calendars.
- Added asset name display and asset detail links for project assets.
- Fixed a project asset hydration loop that could trigger maximum update depth errors.
- Switched project edits to queued publishing with a publish-queue indicator and batch publish action.
- Added global top-bar loading tracking when project data is fetched.
- Added a Q-Deck overview landing page with quick links to boards and projects.
- Highlighted the project publish-queue action when there are pending publishes.
- Improved project asset name resolution with cached asset lookups and numeric ID parsing.
- Added cached avatar loading for Q-Deck comment authors and exposed comment counts in the header.
- Improved Q-Deck comment layout with top/bottom add buttons and name-first metadata placement.
- Enlarged Q-Deck comment author labels and moved timestamps beneath names.
- Matched Q-Deck reply headers to the name-first comment layout.
