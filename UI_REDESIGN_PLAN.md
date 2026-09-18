# Nexus UI redesign plan

Status: implemented on September 18, 2026, after the user authorized implementation. Lint, TypeScript, production build, local HTTP rendering, and catalogue artwork counts were verified. The available computer-use environment exposed no browser surface, so final screenshot-based visual QA remains a manual follow-up.

## 1. Objective and review scope

Make the tracker easier to read and navigate, reduce the amount of screen occupied by artwork, and introduce a richer dark palette while retaining the cinematic Stark/TVA character.

This plan is based on inspection of `src/app/globals.css`, `src/app/layout.tsx`, `src/components/marvel-nexus.tsx`, and the relevant progress/runtime presentation. Findings below distinguish confirmed code behavior from visual hypotheses. No live browser screenshots were captured for this review. The precise locations of the reported skewed text must be verified at implementation time.

The proposed default direction is a compact cinematic dashboard with a restrained banner, readable horizontal archive cards, and clearly separated global and local statistics.

## 2. Findings and priorities

| Priority | Finding and evidence | Proposed resolution |
| --- | --- | --- |
| P0 | The hero is fixed at 515px on desktop, 620px on tablet, and 570px on mobile. Header and hero alone consume most of a typical laptop viewport. | Replace it with a compact introductory banner, move useful dashboard information upward, and keep the release countdown in the banner. |
| P0 | Archive cards combine a tall `2/2.78` image with a fixed 242px text area. | Use compact horizontal cards with a bounded vertical poster and a flexible text column. |
| P0 | Fonts named in CSS are not loaded in the root layout. Font appearance depends on installed system fonts. | Load an explicit body and heading family with real weights and stable fallbacks. |
| P0 | Many useful labels are 5–10px, with uppercase lettering and wide tracking. | Establish a readable type scale; remove tiny text from controls, counts, badges, and prerequisites. |
| P0 | The PRIMARY ribbon rotates text 45 degrees; headings use outlines, strong negative tracking, and line heights down to .85. | Replace the ribbon with a horizontal label and use solid, upright, comfortably spaced text. Verify other reported distortion in a browser. |
| P0 | The palette relies heavily on cyan and dim blue-gray. Poster saturation is reduced by filters and overlays. | Add role-based violet, amber, coral, mint, and layered slate surfaces; restore more natural artwork color. |
| P1 | Six local statistic cards compete for width, including four narrow `.43fr` columns with nonwrapping labels. | Group the four counters within a single structured panel instead of six competing cards. |
| P1 | Mobile CSS hides `.next-operation > button`, which includes both the poster button and Open File button. | Keep a clear, tappable next-entry action visible at all widths. |
| P1 | A full-image locked overlay obscures the artwork and places a long prerequisite paragraph in very small text. | Keep the poster identifiable and put a concise lock reason in a readable content area. |
| P1 | Detail and lore drawers have no explicit Escape handler, focus trap, focus restoration, or body-scroll lock; icon close buttons lack accessible labels. | Implement the complete dialog interaction pattern for both drawers. |
| P1 | A `tablist` contains ordinary buttons without tab roles, selection state, panel association, or arrow-key navigation. | Implement accessible tabs and selected-state styling. |
| P1 | All-content progress and required-only runtime appear together with dense explanatory text. | Give each its own short scope label and a readable checkpoint breakdown. Preserve the calculations. |
| P1 | Finishing a single tab can show “You are ready for Avengers: Doomsday.” regardless of global completion. | Gate that message on actual global completion; otherwise say that the selected track is complete. |
| P1 | Percentage rounding can display 100% before every checkpoint is complete, particularly on large tracks. | Determine completion from exact counts and prevent an incomplete track from displaying 100%. |
| P2 | Filters can produce an empty grid with no explanation; the Series filter also includes specials. | Add empty states and accurate category labels or a separate Specials filter. |
| P2 | Long archives lack title search and meaningful release-era landmarks. | Add local title search and understated release-order group headings without changing entry order. |
| P2 | Network failures during progress updates can leave the interface busy without useful recovery. | Add visible error/retry feedback and reliably clear busy state. |
| P2 | CSS is compressed into long lines with successive overrides of the same layouts. | Consolidate responsive rules, introduce shared tokens, and organize component styles so fixes do not accumulate conflicting overrides. |

## 3. Page placement and hierarchy

### Desktop layout

Use a content width of approximately 1280–1440px with consistent outer gutters. The recommended structure is:

```text
Header: Nexus                              Lore brief / Profile
Compact banner: Road to Doomsday            Release countdown

GLOBAL ROW
[ Doomsday readiness                       ][ Required time left ]

[ MCU                    X-Men                    Street-Level ]

LOCAL ROW
[ Selected-track progress ][ Movies / Seasons / Specials / Episodes ][ Local time ]

[ Next required entry: small poster, title, prerequisite, Open details ]
[ Search titles                          All / Movies / Series / Specials / Optional ]

[ Poster | Title, metadata, status, actions ][ Poster | Title, metadata, status, actions ]
[ Poster | Title, metadata, status, actions ][ Poster | Title, metadata, status, actions ]
```

Place the global row above the track selector to communicate that switching tabs does not change it. Local information follows the selector. Global progress and time stay paired on one desktop row; all local information occupies the next dashboard row beneath the tabs. The release countdown remains distinct from remaining watch time.

### Compact hero

- Target about 160–220px on desktop, content-driven rather than fixed-height at every breakpoint.
- Use a short title, one sentence, and the release countdown. The main viewing action lives in the next-entry panel, avoiding duplicate calls to action.
- Use a widescreen backdrop as a bounded side visual or subtle banner background. Keep important text on a reliable dark surface.
- Limit decorative image area on mobile; do not increase hero height when the screen narrows.
- On a 1366×768 viewport, target visibility of the global row, track selector, and useful local information without a full-screen scroll. Never achieve that target by shrinking text.

### Archive cards and poster sizing

- Default to a two-column desktop grid of horizontal cards. Each card pairs a real vertical poster with readable content.
- Initial poster target: 104–120px wide and 156–180px high on desktop, retaining the artwork's 2:3 ratio.
- On phones, use one card per row with an approximately 80–96px wide poster. Allow the content column to grow for long titles.
- Remove the fixed 242px card-copy height. Use intrinsic height and align actions without squeezing content or manufacturing empty space.
- Use moderate 12–16px radii, consistent padding, and a visible but quiet border.
- Show title, release date, runtime/episode count, required/optional status, and primary action in a consistent order.
- Keep a two-line spoiler-free summary preview where space permits; full copy remains accessible in details.
- Preserve full poster proportions. Use dedicated widescreen assets for banners, with title-specific crop adjustments only where necessary.
- The drawer can show a larger image, but its banner should be around 160–220px and allow users to reach episode content quickly.

## 4. Typography and skewed-text investigation

### Proposed typography

Use Inter for body text and controls and Space Grotesk for headings and numbers. Load licensed font assets explicitly through the supported Next.js font mechanism. Prefer self-hosted assets with documented licenses; consult the installed Next.js font guide before implementation.

| Role | Initial target |
| --- | --- |
| Page title | 32–40px desktop; 26–32px mobile; line height 1.1–1.2 |
| Section title | 22–28px |
| Card title | 16–18px; normal title case; line height 1.3 |
| Body/summary | 14–16px; line height 1.5–1.65 |
| Metadata/badge | 12–13px; normal or modest tracking |
| Button label | 13–14px; actual loaded weight 600 or 700 |
| Statistic value | 24–32px; tabular numerals |
| Secondary note | At least 12px for useful information |

- Reserve uppercase for short category labels; use sentence/title case for instructions and names.
- Replace outlined Doomsday lettering with a solid heading and a restrained accent.
- Replace the rotated PRIMARY ribbon with a horizontal “Global” badge.
- Keep transforms on decorative artwork, not text-bearing containers; preserve intentional graphic motifs only where they do not affect reading.
- Remove aggressive negative letter spacing and avoid simulated weight 900 when no matching font is loaded.
- Ensure long titles and counts wrap naturally; apply `min-width: 0` where flex/grid children need to shrink.
- Verify computed fonts, actual loaded weights, browser zoom, Windows text rendering, and transforms before attributing every distorted-looking label to one cause.
- Check Unicode punctuation in the actual rendered page; terminal encoding artifacts alone are not evidence of corrupted UI text.

## 5. Expanded dark palette

These are proposed starting tokens, subject to contrast checks on the actual rendered backgrounds.

| Role | Color | Use |
| --- | --- | --- |
| Canvas | `#0B0E14` | Main dark background |
| Base surface | `#121824` | Cards and navigation |
| Raised surface | `#1A2233` | Drawers, selected panels |
| Hover surface | `#222D42` | Interactive hover states |
| Primary text | `#F2F5FA` | Titles and important values |
| Secondary text | `#B6C2D4` | Descriptions and metadata |
| Muted text | `#8C9BB1` | Supporting labels, after contrast verification |
| Global/Doomsday | `#A99BFF` | Shared progress, global badges, major highlights |
| MCU | `#59D8F5` | MCU tabs and local accents |
| X-Men | `#F4BF69` | X-Men tabs and local accents |
| Street-Level | `#F18C9C` | Street-Level tabs and local accents |
| Completed/success | `#65D6A3` | Watched checkmarks and success states |
| Optional | `#E8C477` | Optional badge and explanatory note |
| Error | `#FF7D89` | Save failures and actionable errors |
| Structural border | `#334158` | Panel separation; stronger contrast for controls |

- Each track changes only its local accents. The global pair retains one consistent identity across tabs.
- Use neutral locks with an icon and text; an unwatched prerequisite is not a save error.
- Use color in panel tints, small indicators, progress fills, and natural poster artwork rather than making every surface neon.
- Keep required/optional/complete/locked meaning clear through text and icons as well as color.
- Reduce broad desaturation, grayscale, excessive glow, and full-card blur. Retain subtle glass effects for navigation and drawers.
- Check text contrast at 4.5:1 for normal text and 3:1 for large text; verify relevant control boundaries and focus indicators at 3:1.

## 6. Statistics and scope clarity

Preserve the established rules:

- Global Doomsday progress and watch time include required MCU and required X-Men entries only.
- Street-Level content and optional entries never contribute to Doomsday readiness.
- Local archive progress includes all entries in the active tab, including optional entries.
- Local remaining time includes required entries in that tab only.
- Checkpoints count movies + specials + individual episodes. A season is a grouping of episodes, not an extra checkpoint.
- Keep all existing progress records, content IDs, release-order gates, and cross-track prerequisites intact.

Presentation changes:

1. Label global panels “Doomsday readiness” and “Required watch time”; show “Required MCU + X-Men” as scope text.
2. Label local panels with the selected track, and distinguish “All entries” progress from “Required entries” time.
3. Group movie, season, special, and episode counts in a readable 2×2 counter area within the local row. Label seasons accurately because the catalogue indexes seasons separately.
4. Keep the checkpoint breakdown visible in a compact expandable explanation or wrapped supporting text, rather than one crowded sentence.
5. Use explicit fraction labels for watched/completed counts and explicit “remaining” labels for remaining counts.
6. Display zero remaining time as `00h 00m 00s`; reserve “TBD” for unknown metadata. The existing formatter conflates zero with unknown.
7. Keep known remaining runtime plus a visible pending-runtime note where data is incomplete. Avoid presenting minute-level source data as independently verified second-level precision.
8. Base completion messaging on exact completed/total counts. Rounded percentages must not claim completion early.
9. When one track ends, show its completion state. Only show global Doomsday completion when the global requirements are satisfied.

The earlier arithmetic audit verified sums in the catalogue, not the accuracy of every externally sourced runtime. Re-researching the entire catalogue is outside this UI redesign; the UI must clearly identify existing pending metadata.

## 7. Interaction, accessibility, and additional fixes

### Next entry and locked content

- Keep the next-entry action available on mobile with a 44px touch target.
- Put the exact missing prerequisite in readable text with an “Open prerequisite” action that navigates to its tab/details without changing progress.
- Retain a subtle lock treatment over artwork, with full explanation in the drawer.
- Label optional entries clearly and retain Moon Knight's developer recommendation as a separate readable badge/note.
- Make watched status easy to identify. Explain that undoing required progress can clear dependent progress before the user performs that action.

### Drawers

- Add accessible title association and labeled close controls.
- Move focus inside on open, trap focus, close on Escape, restore focus to the trigger, and prevent background interaction/scrolling.
- Keep a close control visible while the episode list scrolls.
- Use readable episode titles, explicit watched state, and touch-friendly rows. Avoid unreadably dim disabled text.
- Keep titles outside heavily cropped images when needed for readability.

### Navigation and discovery

- Implement correct tab roles, `aria-selected`, associated panels, arrow keys, and visible focus.
- Keep track labels legible on small screens; allow scrolling or an appropriate compact layout instead of shrinking to 8px.
- Add title search scoped to the active track; filters and search never change global or local totals.
- Give specials an accurate filter category. Show an explanatory empty state and a reset action when a filter finds nothing.
- Use modest release-era headings to orient long lists without changing release order.

### Loading, errors, and motion

- Preserve visible content during save operations and label the affected control as saving.
- Add recoverable error feedback for failed loading, saving, and logout requests; clear busy state reliably.
- Expose errors/status updates to assistive technology without announcing the countdown every second.
- Use 150–220ms transitions for interactive feedback. Keep reduced-motion support and minimize always-running decorative animation.
- Give images a consistent fallback and reserve their dimensions to avoid layout jumps.

### Sign-in screen

- Apply the same typography, surface palette, and controls.
- Reduce the mobile introduction height so the form is readily discoverable.
- Make credential requirements and errors readable, with clear focus states and a labeled password-visibility control.
- Keep registration, login, and database behavior unchanged.

## 8. Responsive behavior

| Viewport | Intended arrangement |
| --- | --- |
| 1280px and wider | Two global panels on one row; grouped local dashboard on the next row; two horizontal archive cards per row |
| 901–1279px | Keep the global pair together if readable; local groups wrap deliberately; archive switches to one column when card content needs it |
| 641–900px | Global section precedes local section; use two panels only when minimum readable widths fit; one archive column |
| 320–640px | Stack global panels as one group, then tabs and local information; compact single-column archive cards; visible next-entry action |

Respect the user's global-first/local-second hierarchy on every screen. Rows may stack on smaller devices to preserve readability. Do not use fixed heights that clip wrapped content. Test both sides of each breakpoint and at 200% zoom.

## 9. Implementation sequence and affected files

### Phase 1 — Establish a visual baseline

- Read the applicable Next.js guides before editing.
- Capture the existing login, each tab, next-entry panel, locked card, movie drawer, episode drawer, and lore drawer at desktop/mobile sizes.
- Inspect the reported skewed text using computed styles and font-loading information.
- Use isolated fixture progress for empty, partial, and complete states; do not change the user's saved profile for screenshots.

### Phase 2 — Design foundations

- `src/app/layout.tsx`: load the chosen fonts and expose shared font variables.
- `src/app/globals.css`: introduce palette, typography, spacing, radius, and focus tokens; format/consolidate existing rules.
- Add focused component styles or CSS modules where they reduce global selector collisions.

### Phase 3 — Layout and cards

- `src/components/marvel-nexus.tsx`: build the compact banner; preserve the global/local dashboard hierarchy; group local counters; revise card and next-entry structure.
- Replace oversize poster presentation and fixed text heights.
- Implement deliberate responsive layouts and remove conflicting legacy overrides.

### Phase 4 — Interaction and presentation correctness

- Improve tabs, drawers, filter states, errors, and accessibility.
- Extract reusable UI components only where it improves maintainability, such as a shared dialog shell or metric group.
- Fix misleading zero-time and completion presentation with narrow changes to the relevant helpers if necessary.
- Keep source metadata, watched records, and prerequisite logic stable.

### Phase 5 — Verification and polish

- Compare before/after screenshots and check the acceptance criteria below.
- Run lint and production build; verify the production CSS ordering as well as the development view.
- Add targeted regression checks for any changed completion/zero-time behavior. Do not add tests that merely duplicate CSS values.
- Document the resulting visual conventions in README if useful.

## 10. Acceptance checklist for later implementation

- [ ] The banner no longer occupies most of a typical laptop or phone screen.
- [ ] Archive posters have bounded dimensions and retain their vertical proportions.
- [ ] All useful labels are readable without zoom; no tiny badge text or squeezed counter headings.
- [ ] Text is upright, uses the intended loaded fonts, and has no clipping or overlapping lines.
- [ ] Global readiness/time remain paired and identical when tabs change with the same watched state.
- [ ] Local progress/counters/time correctly follow the active tab and retain their established inclusion rules.
- [ ] Checkpoint totals remain explainable as movies + specials + episodes; seasons are not double-counted.
- [ ] Zero runtime, pending runtime, partial completion, and full completion have distinct truthful states.
- [ ] Optional, locked, available, completed, and error states are clear without relying solely on color.
- [ ] Natural poster colors contribute to the richer dark theme; foreground text stays legible over artwork.
- [ ] Next-entry artwork/action remains visible and usable on mobile.
- [ ] Drawers work with keyboard-only navigation, Escape, focus restoration, and screen readers.
- [ ] Tab navigation has correct semantics and keyboard behavior.
- [ ] Save failures and empty search/filter results provide useful recovery actions.
- [ ] No horizontal page overflow at 320, 390, 768, 1024, 1366, 1440, and 1920px widths, including long titles and 200% zoom.
- [ ] Check a short viewport such as 1366×768 and 390×667, not only tall screenshots.
- [ ] Test MCU, X-Men, and Street-Level with empty, partial, near-complete, and complete fixture progress.
- [ ] Check Moon Knight, a long Doctor Strange title, an optional special, a long episode title, and pending metadata.
- [ ] Verify Chrome/Edge and Firefox rendering where available, with browser coverage reported honestly.
- [ ] User accounts, saved progress, release order, and cross-track locks remain intact.
- [ ] Lint and production build pass; no image failures or new browser-console errors in the verified flows.

## 11. Deliverable boundary

This turn delivers this plan only. Implementation, font installation, artwork changes, application refactoring, screenshots of a redesigned UI, and deployment will wait for the user's later implementation request.
