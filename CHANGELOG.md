# Changelog

## 0.8.6 - 2026-1-17

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
- Switched Xqlore long-term index builds to configurable 100k-block batch counts with sequential processing.
- Fixed Xqlore index batch publishing typing so the publish queue accepts batch resources.
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
