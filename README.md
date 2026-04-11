# Q-Assets - Asset Issuance, Management, Trading, and Documentation

Q-Assets is an asset issuance, management, trading, and information Q-App for the Qortal Blockchain.

- Improve startup reliability by bundling core pages eagerly and deferring background startup tasks.
- Reduce startup request spikes by batching notification refreshes and staggering background scanner boot timing.

## News & Notifications

- Browse announcements, asset news, and promotions from the home page.
- Load the news feed on demand so the home page stays snappy.
- Join the Q-Assets notifications group from the prompt below the header to receive updates.
- Send Q-Mail notifications in one queued publish to reduce confirmation prompts for large updates.
- Refresh notification scopes in smaller batches for steadier performance on accounts with many group scopes.

## QDN Data Explorer

- Browse published QDN data by service, name, and folder structure.
- Preview images, text, audio, and video; audio/video stream when available with chunked-file fallback.
- Manage files and sharing without leaving the app.
- Show small QDN files that are not deleted tombstones.

## Asset Explorer

- Open the main asset explorer at `/assetexplorer`, with older `/assets` links still redirecting for backward compatibility.

## Name-Based Assets

- Open the workflow directly from Manage or jump into it from the top of Data Explorer after selecting a name.
- Open separate send and receive NBA transfer flows for preparing or completing a name handoff.
- Transfer a name even when no private QDN data needs to be migrated.
- Optionally re-encrypt a selected private QDN resource for the future owner before the handoff.
- Choose between recovery-friendly re-encryption and full-ownership-transfer re-encryption modes.
- Resolve a future owner by Qortal name or address inside the app.
- Warn before transfer creation when the receiving account has no on-chain public key yet, which usually means it still needs its first outbound transaction.
- Create and sign the sell-name transaction without processing it yet, then publish the signed transfer package privately from your primary name by default, or from the active name when you explicitly opt into that mode.
- Notify the transferee through Q-Mail with a direct link into the receive flow while keeping the same primary-name-by-default publishing behavior.
- Complete the transfer from the receive flow by processing the seller transaction first, polling for its confirmation, and then repeatedly creating/signing/processing the buyer transaction until it succeeds or the retry window expires.
- Cancel a still-pending outbound NBA package by publishing a tombstone over its identifier, which removes it from Q-Assets while still warning that a recipient may already have kept the signed sale transaction.
- Review previous NBA transfer packages created by the current account and see whether matching `SELL_NAME`, `BUY_NAME`, or only a partial chain handoff has been detected yet.
- Fall back to the name's actual current owner when showing NBA transfer state, so completed transfers stop appearing as pending and suspicious owner changes can be flagged.
- Keep a submitted buyer transaction visible on the receive page while Q-Assets polls for confirmation, so freshly submitted completions do not disappear into an empty inbox.
- Open an in-app NBA info modal that outlines the current transfer model plus upcoming TrueNBA and marketplace plans.

## Link Handling

- Open `qortal://` links inside Q-Assets, including popup renders for external Q-Apps.
- Copy external internet links to your clipboard with a browser-open reminder.
- Linkify `qortal://` and `https://` URLs in published content.

## Xqlore Explorer

- Scan a live, full-spectrum overview of Qortal activity across assets, names, and QDN data.
- See ARBITRARY activity with identifiers and app attribution for fast context.
- Track active apps, tags, and identifiers to understand where chain activity is coming from.
- Follow a live transaction stream with search, time-range filtering, and click-through details.
- Jump into dedicated Xqlore pages for accounts, apps, minting, and trading insights.
- Use the long-term stats page to build and publish block-range transaction indexes.
- Rebuild and republish existing index batches when the indexing logic changes.
- Publish aggregated Xqlore stats overviews with QORT flow, QDN, and asset activity leaderboards.
- Rebuild the stats overview from all published index batches when needed.
- Surface QDN-first long-term stats with minted-block leaders, QORT balance thresholds, and compact account labels when names are missing.
- Toggle index tools on demand from the long-term stats page.
- Manage the Xqlore app-identifier registry from the admin console when you have access.
- Highlight the Qortal Null Account with an explainer and balance lookup on account pages.

## Q-Deck Boards

- Create and manage collaborative boards with cards, comments, and attachments.
- Switch between My Boards and All Boards with quick links on the boards page.
- Queue publishes in batch mode and review/remove queued items before publishing.
- Start tasks and complete them directly from cards to set start/end dates and mark work done.
- Join in-progress tasks, cancel your start, and add completion notes that appear on hover.
- Optionally create cards already in progress to prefill the start task status.
- Search within a board to quickly find cards by title, tags, assignees, or list name.
- Keep multi-publisher board statuses consistent by merging authorized card indexes, so in-progress/completed changes stay aligned across different users and views.
- Prevent publishing a new card before board hydration finishes, avoiding partial indexes when opening busy boards.
- Show list-level loading placeholders while board cards hydrate for faster perceived load feedback.
- Reduce duplicate board/index lookups with short-lived request caching and deduplication so Q-Deck stays smoother on busy nodes.
- Keep board/project/admin lookups responsive by reusing cached name/account lookups across repeated actions.
- Enable optional Q-Deck load timing diagnostics (`?qdeckPerf=1`) to show phase timings in-board (including initial opens) and log summaries in the console, with a hidden toggle in Board Actions.
- Check for new board updates in the background and show a “new changes” banner so you can load them on demand.
- Ignore your own publishes when deciding whether to show the “new changes” banner.
- Pause Q-Deck polling while batch publish queues have pending changes to avoid overwriting local edits.
- Pause Q-Deck polling while dialogs are open so active edits aren't interrupted.
- Pause Q-Deck polling while text inputs are focused to avoid disrupting typing.
- Board overviews prioritize recent activity and collapse long group lists with a +N more expander.
- Reorder lists and customize list colors from the board manager to match your workflow.
- Rename boards from the board view or the My/All Boards menus.
- Use a cleaner comment view with avatars, quick add buttons, and comment counts at a glance.
- Speed up board loads by using board-level comment discovery for card comment chips, loading full comment threads only when opened.
- Highlight cards with comments newer than your last board visit using a per-board local timestamp baseline.
- Remember per-board publish mode (immediate vs queued) the next time you open a board.
- Show group names (not just IDs) in the My/All Boards permission chips.
- Show completed timestamps on done cards in Q-Deck boards.
- Organize boards into projects, view board permissions and asset links, display scheduled cards across multi-day spans in project calendars with per-board colors, and queue project edits for batch publishing.
- Add boards to projects from all accessible boards (not just ones you created).
- Create new boards directly from a project and auto-attach them.
- Pick assets from the Q-Assets index when linking them to projects, with non-blocking metadata hydration.
- Show asset avatars alongside project asset links for quicker scanning.
- Manage project admins/editors and admin override permissions from the Q-Deck project permissions panel.
- Show clear effective permission summaries (view/edit/admin rules) in the board and project permissions panels.
- Enforce project edit rights so only authorized editors or admin overrides can publish project updates.
- Load project calendars faster by reading schedule metadata from card indexes and skipping archived cards.
- Switch between My Projects and All Projects to discover public projects (and accessible private ones).
- Use the Q-Deck overview page for quick navigation to boards and projects.

## Asset Issuance

Create new assets on Qortal. Not nonsense not-tokens on EVM chains. A Native, QORT-like asset running on the Qortal chain, validated every block by every node.

### Asset Issuer / Newly Created / Not in Circulation

Assets that are created, are issued by the 'issuer' account. Any assets that are still in the issuer account, may be considered 'out of circulation.

- Assets are issued by the issuer with their 'total supply' up front.
- Any assets that are not sent anywhere from issuance, are 'out of circulation', technically.
- Any assets that ARE distributed from the issuer to any other account on Qortal, are 'in circulation'.

## Asset Definition and Use Cases

Assets in their original design concept, were meant to be utilized for things like 'stocks', or 'tracking ownership in something'. The 'tokens' of today are utilized in many fashions they were not designed for, and as such, are scammy.

Assets are CENTRALIZED by nature, due to being issued by a single party. Regardless of the fact that they are on a decentralized network, and actually validated by Qortal consensus, the ISSUANCE METHOD MAKES THEM A CENTRALIZED THING.

The only difference between QORT and other assets on the Qortal Chain, are that non-QORT assets (aside from having a different 'asset ID', are NOT created BY the Qortal Consensus). Minting, on Qortal, is what actually CREATES the QORT coins, which is what makes QORT a 'coin' and not a 'token' (or 'asset'). While, technically, 'assets', 'tokens', and 'coins' are the 'same thing' on Qortal, this one differentiating factor is the key here.

- 'coins' are created BY CONSENSUS, I.E. on Qortal, they are created by the MINTERS, and created EACH BLOCK. The Qortal chain was STARTED WITH 0 QORT, and MINTED into CREATION from there.
- ASSETS or TOKENS on the other hand, are created by someone issuing an 'ISSUE_ASSET' transaction, with the FULL MAX SUPPLY ISSUED AT THAT POINT. The only difference between 'circulating' and 'non-ciruculating' assets, are those that have been SENT FROM THE ISSUER ACCOUNT.
- Non-QORT-Assets on Qortal were NOT meant to be utilized as 'coins', but instead meant to be a 'stock' or a 'representation of ownership' in some concept, project, or other such thing.

### Utilizing Tokens (non-QORT assets) on Qortal

As described above, the best use case for non-QORT assets (or 'tokens') on Qortal, is to replace the concept of 'stocks'. Since stocks are MEANT TO BE CENTRALIZED, and controlled by the issuing entity.

Any use case that claims to be 'completely decentralized' (and doesn't implement some as-of-yet non-existent functionality to accomplish this) is LYING, at least at the base level. ASSETS ARE ISSUED BY A SINGLE PARTY, AND THEREFORE ARE NOT FULLY DECENTRALIZED. They cannot be created by consensus, like QORT, at least not as of July 2025.

### Legitimate Use Case #1 - 'Stocks'

The most legitimate use case for non-QORT assets on Qortal, is to replace 'stocks'. Ownership in a company, or a concept, is a great way to leverage non-QORT assets on Qortal. Issue the asset, then distribute as many as the party owns to them, and they are trackable, trade-able, and able to be given value in the same way that stocks are, but with MUCH more LEGITIMACY, as they are tracked, traded, and validated by the Qortal Blockchain, and the nodes therein.

### Legitimate Use Case #2 - 'Group Ownership'

Another good use case for assets, is 'group ownership'. I.E. sharing ownership of something with a group of people. The asset could be issued, and split amongst the people, and therein ownership kept track of.

- Issue X number of assets total
- Split them into pieces and give X number = X% ownership
- Distributed to shared owner accounts.

### Edge Use Case #1 - 'physical asset representation' (WARNING)

This is a potential use case that requires ANOTHER centralized component. The VALIDATION of the physical asset that is supposedly behind the 'token'. This means that it is more risky than the other use cases that only have the issuance centralization.

WARNING to those that would accept a digital representation of something built on Qortal with an asset. This is potentially risky, and highly dependent upon the party that issues the asset. If they are legitimate, and you trust them, it could be okay. But if they are not, it could be a scam.

### Illegitimate Use Case #1 - 'decentralized coins' (such as any wannabe coin issued as an EVM not-token)

This is hands-down the most illegitimate use case for non-QORT assets on Qortal. They are NOT coins, and never will be. Even if they can look, feel, and be used like one for quite a few things. They are not controlled and issued with a model from consensus, therefore they are centralized.

Unless a new concept is created that allows non-QORT assets to be issued/created by consensus, and/or issued/created by an AT, and the asset count starts at 0, this is to be considered an illegitimate use case in our eyes.
