---
name: Authera Client Dashboard
description: A restrained concierge command center for bounded agent purchases.
colors:
  ground: "#f7f8fb"
  surface: "#ffffff"
  surface-muted: "#f1f3f7"
  line: "#e2e6ee"
  line-strong: "#c9d0dc"
  ink: "#1d2230"
  ink-muted: "#5b6577"
  ink-faint: "#687386"
  cobalt: "#2448d6"
  cobalt-strong: "#1b39b3"
  cobalt-soft: "#e8ecfb"
  emerald: "#0f684b"
  emerald-soft: "#e3f4ec"
  amber: "#9a5b00"
  amber-soft: "#fff3dc"
  coral: "#a62e25"
  coral-soft: "#fde8e6"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "normal"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "8px"
  lg: "8px"
spacing:
  2xs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-strong}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "44px"
  button-destructive:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.cobalt}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "44px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  badge-verified:
    backgroundColor: "{colors.emerald-soft}"
    textColor: "{colors.emerald}"
    typography: "{typography.label}"
    rounded: "9999px"
    padding: "2px 8px"
---

# Design System: Authera Client Dashboard

## Overview

**Creative North Star: "Concierge Command Center"**

Authera's client world is a restrained operational console for a nontechnical person who delegates one bounded purchase and then supervises by exception. It should feel calm, exact, and quietly protective: the interface foregrounds the purchase outcome, current agent state, and the next human decision while keeping authorization mechanics available without making them the visual center.

This is the incumbent visual system for client routes under `/dashboard`, with `OverviewPage.tsx` as its representative artifact. Brand identity development is deliberately deferred, so the system relies on disciplined information hierarchy, semantic color, plain language, and predictable interaction rather than decorative imagery, a distinctive logo treatment, or an invented brand voice.

**Key Characteristics:**

- Restrained, operational, and calm.
- Attention-first supervision by exception.
- Plain-language authority before technical evidence.
- Flat bordered surfaces with state-specific tonal color.
- Responsive density with touch targets protected on mobile.

## Colors

The palette is a cool near-white and charcoal foundation with one action accent and three strictly semantic state families.

### Primary

- **Command Cobalt:** Use for primary actions, links, active navigation, focus treatment, and the agent's current active step.
- **Deep Command Cobalt:** Reserve for primary-action hover state.
- **Quiet Cobalt Wash:** Use behind selected navigation, informational badges, and active-step icons.

### Secondary

- **Verified Emerald:** Use for completed, allowed, active, and in-limit outcomes.
- **Verified Emerald Wash:** Pair with Verified Emerald for reassuring status surfaces and badges.

### Tertiary

- **Attention Amber:** Use only when an exact human decision is pending or a limit needs attention.
- **Attention Amber Wash:** Provide the background for pending-decision alerts.
- **Stop Coral:** Use for revocation, failures, destructive actions, and field errors.
- **Stop Coral Wash:** Use for destructive alerts without turning the whole page alarming.

### Neutral

- **Cool Ground:** The page canvas behind all operational surfaces.
- **White Surface:** Cards, shell rails, top bars, fields, and dialogs.
- **Muted Surface:** Table headers, progress strips, disabled fields, code labels, and subtle hover fills.
- **Quiet Divider:** Default borders and separators.
- **Firm Divider:** Inputs, secondary buttons, dashed empty states, and boundaries that need stronger definition.
- **Charcoal Ink:** Primary copy and headings.
- **Muted Ink:** Supporting copy and default inactive navigation.
- **Faint Ink:** Eyebrows, metadata, shell footer text, and low-priority detail; do not use it for essential instructions.

### Named Rules

**The Semantic Color Rule.** Cobalt means action or active context, emerald means verified or complete, amber means attention, and coral means destructive or failed; never swap these roles for decoration.

## Typography

**Display Font:** Inter with the system sans-serif stack.

**Body Font:** Inter with the system sans-serif stack.

**Label/Mono Font:** UI monospace for identifiers and compact evidence only.

**Character:** The typography is compact, neutral, and conversational. Weight and spacing establish hierarchy; the system does not depend on oversized display type or a decorative pairing.

### Hierarchy

- **Display:** The dashboard greeting only; compact enough to leave live plan state in the first viewport.
- **Headline:** Purchase brief titles and page-level headings.
- **Title:** Card headings, section headings, and strong status labels.
- **Body:** Explanations, narrative status, and control text; keep the central plain-language narrative to a comfortable measure of roughly 48–64 characters where layout permits.
- **Label:** Field labels, links inside dense surfaces, metadata, and progress-step labels.
- **Mono:** Reason codes, hashes, IDs, and other technical evidence after progressive disclosure; never use it for the primary explanation.
- **Amounts:** Use the body family with tabular numerals, semibold weight, and a larger local size so prices remain comparable without becoming promotional.

### Named Rules

**The Plain-Language First Rule.** State what happened, why it matters, and what the person can do before showing internal IDs, signatures, hashes, or protocol fields.

## Layout

The client surface is mobile-first and one column by default. At the medium breakpoint, the shell becomes a fixed 208px navigation rail beside the content; below it, the brand row and five-item client navigation remain horizontal above the page. Content is capped at 1280px, centered, and padded progressively from mobile through desktop. The dominant rhythm is 16px between primary surfaces, with tighter 8–12px spacing inside dense operational components.

The dashboard itself follows an attention-first sequence: greeting and create action; pending decisions when present; one active or most recently completed purchase brief with a single narrative sentence; its three-step progression; best offer or completed purchase beside readable activity; and the full price comparison collapsed as optional detail. Loading, disconnected/error, empty, active, pending-approval, revoked/expired on linked detail surfaces, and completed states must all preserve this order rather than rearrange the product around the happy path.

Responsive behavior is explicit. The greeting and main plan header stack until space is available; the three plan steps stack on narrow screens and become three columns from the small breakpoint; the offer and activity cards stay stacked until the large breakpoint, where they use a 5/7 split. Client controls and disclosure summaries keep a 44px minimum target on mobile and may tighten to 40px from the medium breakpoint. Tables scroll inside their own bordered container, actions wrap, and text-bearing flex or grid children keep `min-width: 0` so long offers and identifiers cannot create page-level horizontal scrolling.

**The Actor Boundary Rule.** `/dashboard` contains only the client navigation—Home, Plans, Activity, Purchases, and Settings. Purchasing-agent, merchant, auditor, and judge controls remain in their separate `/agent`, `/verify`, `/audit`, and `/demo` perspectives; their operational detail must not leak into the client's information architecture.

**The Mobile Density Rule.** Preserve touch target size before compactness: controls are at least 44px high on mobile, then may compress to the established 40px desktop density.

## Elevation & Depth

The system is flat by default. Depth comes from a cool ground behind white surfaces, one-pixel borders, muted sectional fills, and restrained semantic washes—not from stacked shadows. Only modal dialogs lift decisively above the page with a strong ambient shadow and a charcoal backdrop; the switch thumb uses a small utility shadow so its physical state remains legible.

### Shadow Vocabulary

- **Switch Thumb:** A small two-part ambient shadow used only on the moving switch knob.
- **Modal Lift:** A large two-part ambient shadow used only when a dialog enters the top interaction layer; pair it with the established dark translucent backdrop.

### Named Rules

**The Flat-by-Default Rule.** Cards, dashboard sections, navigation, alerts, and fields stay border-led and shadowless at rest; elevation is reserved for modal interaction or the physical switch thumb.

## Shapes

The recurring silhouette is a gently curved rectangle. Compact marks use the smaller corner, while controls, cards, alerts, fields, dialogs, tables, empty states, and disclosure containers share the medium corner. The large token intentionally resolves to the same restrained corner rather than creating a rounder card tier. Badges, avatars, progress icons, and switch tracks are fully rounded because they communicate compact status or physical state. Borders are one pixel by default; empty states may use a dashed firm divider, and no nested surface should add a second decorative outline without a state reason.

## Components

Components are compact and literal: state, consequence, and next action should be recognizable before decoration.

### Buttons

- **Shape:** Gently curved rectangular controls using the shared medium corner.
- **Primary:** Command Cobalt with white text, medium weight, and compact horizontal padding; use for the single forward action in a local decision.
- **Secondary:** White with Charcoal Ink and a Firm Divider; use for safe alternatives, inspection, change, and cancel actions.
- **Destructive:** Stop Coral with white text; use only for explicit revoke, stop, reject, or destructive confirmation.
- **Ghost:** Transparent with Command Cobalt; use for low-emphasis navigation or tertiary actions.
- **Hover / Focus:** Color transitions use the standard short easing. Keyboard focus is always a visible two-pixel cobalt outline or ring with a two-pixel offset. Disabled and loading states remain explicit; loading announces progress without replacing the accessible label.

### Chips

- **Style:** Status badges use a fully rounded semantic wash, matching semantic text, a subtle same-family border, compact padding, and semibold label text.
- **State:** Neutral is informationally quiet; verified, attention, destructive, and info tones retain fixed meanings. Badges support adjacent plain-language copy and do not carry the only explanation of a state.

### Cards / Containers

- **Corner Style:** Shared medium corner.
- **Background:** White Surface on Cool Ground, with Muted Surface reserved for structural subregions such as headers or progress strips.
- **Shadow Strategy:** Flat and border-led; see Elevation & Depth.
- **Border:** Quiet Divider by default, with semantic border tint only when a state truly owns the whole surface.
- **Internal Padding:** Compact 12px vertical and 16px horizontal content padding; related dashboard surfaces are separated by the 16px page rhythm.

### Inputs / Fields

- **Style:** White Surface, Firm Divider, medium corner, Body typography, and compact horizontal inset.
- **Focus:** Border shifts to Command Cobalt with a translucent two-pixel cobalt ring.
- **Error / Disabled:** Errors use Stop Coral text directly below the field. Disabled fields use Muted Surface; controls preserve their label and make their unavailable state visible.

### Navigation

Client navigation uses icon-plus-label items. On mobile, the five destinations form an equal-width row with icons above compact labels; at the medium breakpoint, they become left-aligned rows in the 208px rail. Active state uses Quiet Cobalt Wash and Command Cobalt; inactive state uses Muted Ink and gains a muted surface plus Charcoal Ink on hover. Every navigation region carries an actor-specific accessible label.

### Client Dashboard Contract

The dashboard is a supervision surface, not a booking catalog. Pending exact-checkout decisions appear first. The main purchase brief then connects the client's requested outcome, the agent's current work, and what happens next in one readable narrative. A three-step strip makes authorization, matching, and purchase state scannable; the best real offer or completed purchase and recent activity follow; the complete price comparison remains in a native disclosure labelled as optional detail. No-offer, in-limit, over-limit, pending-decision, and completed states reuse this same composition.

**The Supervise-by-Exception Rule.** Interrupt the client only for an exact decision, a failure, or a completed record; routine search work stays visible but does not demand action.

**The Progressive Evidence Rule.** Lead with human-readable consequences and keep cryptographic, protocol, and full audit evidence behind explicit disclosures or dedicated detail routes.

## Do's and Don'ts

### Do:

- **Do** keep the active purchase outcome, current agent state, and next consequence in one plain-language sentence.
- **Do** put pending human decisions before routine progress and bind approval copy to the exact offer without implying the standing limit changes.
- **Do** preserve keyboard access, visible focus, semantic headings, labelled navigation and dialogs, screen-reader loading announcements, and focus return after dialogs close.
- **Do** keep meaningful controls at least 44px high on mobile and honor reduced-motion preferences by collapsing animation and transition durations.
- **Do** use color together with text, icons, and state labels; never make semantic color the only status signal.

### Don't:

- **Don't** expose agent, merchant, auditor, or demo controls inside the client dashboard navigation.
- **Don't** turn the dashboard into a mock catalog, a dense technical console, or a promotional landing page.
- **Don't** allow the LLM or conversational styling to imply authorization; the UI reports deterministic gateway state.
- **Don't** surface raw card data, private keys, secrets, or unexplained hashes in the primary client flow.
- **Don't** add decorative shadows, glass effects, oversized headings, excessive rounding, or an invented brand motif while identity work remains deferred.
