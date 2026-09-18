# Mobile scaling implementation plan

Status: planned only; implementation awaits the user's next request.
Date: September 19, 2026.

## Objective and boundaries

Make the existing Nexus UI comfortable on phones while preserving its approved appearance: colors, fonts, cinematic backdrop, glass panels, artwork, cards, progress rings, badges, and overall section order. This is a responsive sizing and layout pass, not a redesign.

Preserve the desktop presentation and all current application behavior, including Mission and Format filters, tab-triggered scrolling to the next required unwatched title, confirmation before removing older watched checkpoints, and Moon Knight's prerequisite exception. Do not reintroduce the removed Progress filter. Do not change catalogue data, prerequisite rules, database records, or authentication behavior.

This plan is based on source inspection of `src/app/globals.css`, `src/components/marvel-nexus.tsx`, and `src/app/layout.tsx`. The observations below are code findings and layout risks, not claims of defects reproduced in a mobile browser. Capture browser baselines before implementation. The older `UI_REDESIGN_PLAN.md` is historical; this plan governs this mobile pass.

## Current findings

- Responsive rules already exist at 1120px, 820px, and 580px. Extend and consolidate these rather than layer conflicting overrides.
- Filter buttons are 34px tall, icon buttons 36px, search 39px, and drawer close buttons 40px. Increase mobile hit areas to at least 44 by 44 CSS pixels.
- Search and authentication input text is 13px and 14px respectively. Use 16px on phones and check focus behavior on iOS.
- At small widths, archive cards reserve 88px for the poster plus margins and padding. Long titles, metadata, badges, and prerequisite messages compete for the remaining width.
- Dashboard rows combine fixed-size progress rings, long uppercase labels, and nonwrapping runtime values. `.track-status .progress-ring` also has higher specificity than the mobile ring rule; resolve sizing deliberately.
- The next-required panel keeps artwork, text, and its action in one row. The copy can become cramped.
- Mobile universe tabs hide their text labels. Keep the existing identity marks but provide short visible names where they fit and full accessible names throughout.
- Confirmation dialogs have no explicit viewport-height cap or internal scrolling. Drawer titles are absolutely positioned over a fixed-height hero, creating a risk with long titles or enlarged text.
- Existing episode rows truncate names and hide runtime on phones. Improve title space and retain access to useful episode information.

## Implementation sequence

### 1. Establish a visual baseline

Capture the current dashboard, archive, details drawer, confirmation dialog, and authentication screen at representative phone and desktop sizes. Use test fixtures or a disposable profile when exercising progress actions; preserve existing user progress. Before changing Next.js code, read the relevant installed guides in `node_modules/next/dist/docs/` as required by `AGENTS.md`.

### 2. Set consistent mobile sizing

Keep the existing breakpoints as the starting point. Use 820px and below for compact layouts, 580px and below for phones, and add a roughly 380px refinement only if measured overflow requires it. Check breakpoint boundaries as well as common device widths.

Use consistent 12–16px outer gutters, 12–16px panel padding, and 8–12px internal gaps on phones. Favor flexible widths, wrapping, `minmax(0, 1fr)`, and content-driven height. Do not scale the entire page with transforms or reduce all typography to squeeze it in. Keep zoom available. Fix overflow at its source rather than masking it with clipping.

### 3. Refine the header and dashboard

- Retain the current header and menu; enlarge icon hit areas and prevent the brand and controls from colliding.
- Keep the hero artwork and four-part countdown. Reduce surplus spacing while allowing text to wrap naturally.
- Keep global and local statistics distinct. Size rings consistently, allow scope labels to wrap, and fit runtime values without clipping.
- Preserve the two-by-two counter panel; adjust padding and label wrapping for small phones.
- Keep the three universe tabs equal-width with clear selection states and usable touch areas.
- Let the next-required panel action move onto a full-width second row on narrow screens, keeping its title and prerequisite readable.

### 4. Refine archive filters and cards

- Keep Mission and Format controls visible and combinable. Use full-width search, readable labels, and buttons at least 44px tall; let the long Doomsday label span a row if necessary.
- Preserve horizontal poster-and-copy cards. Use a bounded, responsive poster width and allow metadata and badges to wrap.
- Keep titles and prerequisite messages readable; prioritize flexible card height over smaller text. Target 18–20px titles and 13–14px supporting copy, tuned against the baseline.
- Keep watch actions easy to tap. On the narrowest screens, allow supporting text or actions to span the card width if needed, using minimal markup changes.
- Retain the current tab-scroll trigger and target. Verify that a tall card's title lands visibly on short screens; use a mobile start alignment if centering hides the title. Respect reduced-motion preferences and avoid unexpected background scrolling when opening prerequisites.

### 5. Fit overlays, forms, and feedback to phones

- Keep details and lore drawers full-width on phones, with viewport-aware height, internal scrolling, reachable close controls, and safe-area padding.
- Allow long drawer titles to expand the hero/title area instead of overlapping controls.
- Let episode names wrap and place runtime on a secondary line where needed; keep rows comfortably tappable.
- Cap confirmation dialogs to the usable viewport, allow internal scrolling, and stack actions on narrow screens. Preserve cancel focus, keyboard handling, and drawer focus restoration.
- Use 16px input text and comfortable controls in sign-in and registration. Reduce excess introductory spacing while retaining the same branding and content.
- Account for the mobile keyboard, browser toolbar changes, notches, and home indicators. Use dynamic viewport units with fallbacks and safe-area insets where appropriate. If viewport configuration needs updating, use the installed Next.js Viewport API.
- Keep toasts and empty/error states readable and within the usable screen. Restrict hover transforms to devices that support hover if touch testing shows sticky effects.

## Files and scope

Most changes belong in `src/app/globals.css`. Make small structural or accessibility changes in `src/components/marvel-nexus.tsx` only when CSS alone cannot produce a robust mobile layout. Touch `src/app/layout.tsx` only if viewport/safe-area support requires it. Avoid new dependencies and unrelated refactoring.

## Verification and acceptance

Test portrait widths of 320, 360, 390, 430, and 768px, a short landscape viewport such as 844 by 390px, and desktop baselines at 1280 and 1440px. Check around 580, 820, and 1120px for abrupt layout failures. Browser emulation covers layout; use real iOS Safari and Android Chrome when available for keyboard and browser-toolbar behavior, and report any untested cases.

Acceptance criteria:

- The UI retains its approved visual identity and desktop appearance.
- No unintended horizontal scrolling, clipped controls, overlapping text, or hidden dialog actions at the target sizes.
- Main touch controls provide at least 44px hit areas; inputs remain legible and zoom is permitted.
- Long movie titles, large runtime totals, locked cards, optional badges, partially watched series, and empty search results fit correctly.
- All three tabs, combined filters, next-title scrolling, episode actions, unwatch confirmation/cancellation, and nested drawer focus work as before.
- Dialogs remain usable in landscape and with enlarged text; check 200% zoom, reduced motion, keyboard navigation, and focus visibility.
- Authentication remains usable with the on-screen keyboard open.
- Run ESLint, TypeScript, and a production build, then review before/after screenshots. Static checks alone do not constitute mobile visual verification.

Deliver the responsive changes with representative screenshots and a concise validation report. If browser/device access is unavailable, explicitly record the missing visual checks instead of claiming they passed.
