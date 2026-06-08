---
version: alpha
name: OpenMagicPointer
description: A desktop-native floating agent interface built around a cursor-following glass command capsule, compact context attachments, CUA grounding overlays, and a persistent background work hub.
colors:
  primary: "#0D6FFF"
  primary-hover: "#2563EB"
  accent: "#3478F6"
  accent-soft: "rgba(52, 120, 246, 0.10)"
  accent-glow: "rgba(52, 120, 246, 0.22)"
  canvas-transparent: "transparent"
  glass-blue: "rgba(13, 111, 255, 0.88)"
  glass-blue-strong: "rgba(13, 111, 255, 0.94)"
  glass-white: "rgba(255, 255, 255, 0.92)"
  glass-black: "rgba(28, 28, 30, 0.92)"
  glass-border-light: "rgba(255, 255, 255, 0.16)"
  glass-border-dark: "rgba(0, 0, 0, 0.10)"
  ink: "#1D1D1F"
  ink-strong: "#1C1C1E"
  muted: "#86868B"
  on-blue: "#FFFFFF"
  on-white: "#1C1C1E"
  on-black: "#FFFFFF"
  success: "#30A14E"
  danger: "#E5383B"
  warning: "#B8860B"
  approval: "#8B5CF6"
  cua-teal: "rgba(20, 184, 166, 0.78)"
  cua-teal-soft: "rgba(20, 184, 166, 0.07)"
  active-cyan: "#67E8F9"
  code-bg: "#0F172A"
  stream-code-bg: "#0B1329"
typography:
  body:
    fontFamily: "DM Sans, -apple-system, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
  body-small:
    fontFamily: "DM Sans, -apple-system, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0"
  label-caps:
    fontFamily: "DM Sans, -apple-system, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.04em"
  micro:
    fontFamily: "DM Sans, -apple-system, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.04em"
  display:
    fontFamily: "Instrument Serif, serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "0"
  mono:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: "0"
rounded:
  hairline: "3px"
  sm: "8px"
  md: "14px"
  panel: "18px"
  pill: "999px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  shell-margin: "12px"
components:
  command-capsule:
    backgroundColor: "{colors.glass-blue}"
    textColor: "{colors.on-blue}"
    rounded: "{rounded.pill}"
    padding: "2px 12px 2px 8px"
    height: "24px"
    width: "520px"
  command-capsule-white:
    backgroundColor: "{colors.glass-white}"
    textColor: "{colors.on-white}"
    rounded: "{rounded.pill}"
    padding: "2px 12px 2px 8px"
  command-capsule-black:
    backgroundColor: "{colors.glass-black}"
    textColor: "{colors.on-black}"
    rounded: "{rounded.pill}"
    padding: "2px 12px 2px 8px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-blue}"
    typography: "{typography.body-small}"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-blue}"
    rounded: "{rounded.pill}"
  button-ghost:
    backgroundColor: "rgba(255, 255, 255, 0.10)"
    textColor: "rgba(255, 255, 255, 0.80)"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
  modal-card:
    backgroundColor: "rgba(13, 111, 255, 0.90)"
    textColor: "{colors.on-blue}"
    rounded: "{rounded.pill}"
    padding: "24px"
    width: "min(860px, calc(100vw - 32px))"
  background-hub-trigger:
    backgroundColor: "{colors.glass-blue}"
    textColor: "{colors.on-blue}"
    rounded: "{rounded.pill}"
    height: "54px"
    width: "54px"
  background-hub-panel:
    backgroundColor: "rgba(13, 111, 255, 0.90)"
    textColor: "{colors.on-blue}"
    rounded: "{rounded.panel}"
    padding: "12px 10px 10px"
    width: "min(380px, calc(100vw - 28px))"
  context-chip:
    backgroundColor: "rgba(255, 255, 255, 0.12)"
    textColor: "rgba(255, 255, 255, 0.90)"
    rounded: "{rounded.pill}"
    padding: "2px 7px"
    height: "22px"
  cua-highlight:
    backgroundColor: "{colors.cua-teal-soft}"
    textColor: "{colors.cua-teal}"
    rounded: "{rounded.hairline}"
  code-block:
    backgroundColor: "{colors.code-bg}"
    textColor: "#E5EDF8"
    typography: "{typography.mono}"
    rounded: "10px"
    padding: "12px"
---

## Overview

OpenMagicPointer should feel like a small piece of desktop glass that appears exactly where the user's attention already is. The interface is not a web page, a sidebar, or a dashboard. It is a compact, cursor-adjacent command instrument that expands only when work requires more context.

The default atmosphere is translucent, kinetic, and precise: blue-tinted glass over the desktop, pill-shaped controls, small high-density labels, and direct action buttons. Density is 8 out of 10, variance is 3 out of 10, and motion is 6 out of 10. The product should read as an operating-system overlay for agent work, not as a marketing app.

Design from the existing surfaces first:

- The primary surface is the command capsule.
- The secondary surfaces are dropdowns, context chips, hover previews, CUA highlights, settings modals, task panels, and the BG background hub.
- The desktop behind the overlay is part of the composition, so every surface must preserve transparency, blur, and tight spatial discipline.

## Colors

Blue is the default operational color. Use **Primary Blue** (#0D6FFF) for the command capsule, dropdowns, background hub, and modal default theme. Use **Accent Blue** (#3478F6) for selection rectangles, focus rings, primary buttons, and progress strokes. Use **Deep Blue** (#2563EB) for primary hover states and stronger active accents.

White and black are alternate themes, not separate design systems. White surfaces use **Glass White** (rgba(255, 255, 255, 0.92)) with **Ink Strong** (#1C1C1E). Black surfaces use **Glass Black** (rgba(28, 28, 30, 0.92)) with white text and subdued white borders.

Use **CUA Teal** (rgba(20, 184, 166, 0.78)) only for grounded desktop element previews, selected CUA candidates, and context transfer states. Use **Active Cyan** (#67E8F9) only as a small running indicator dot or active work pulse. Do not let cyan become a general accent.

Status colors are functional and quiet: green for ready or success, red for destructive or failed, amber for warnings, and approval purple only for permission states. Never use status colors as broad backgrounds.

## Typography

Use DM Sans as the default interface typeface. It should stay compact, legible, and close to native desktop UI. Body text is 13-14px, labels are 10-12px, and headings inside panels are restrained. Large display type does not belong in the overlay.

Instrument Serif is allowed only for occasional identity text such as a backend label or modal title. It should be light, brief, and never used for dense controls, settings fields, history rows, task rows, or code output.

Use uppercase labels sparingly for status rails, section names, and tiny metadata. Letter spacing should stay at 0.04em only for these tiny all-caps labels. All normal prose and control text must use letter spacing 0.

Use monospaced typography for code, command output, debug details, timestamps when density is high, and raw CUA metadata. Code blocks use 12px type, 1.55 line-height, and the dark navy code background.

## Layout

The overlay layout is cursor anchored. The command capsule should appear near the activation point with a 12px screen margin, avoid viewport edges, and expand downward into the stream panel only when the conversation or active state requires it.

Default capsule sizing is 520px wide and 24px high, with user customization bounded between 280-900px width and 24-96px height. Any new control placed inside the capsule must survive the 24px height case. Use ellipsis, compact icon buttons, and collapsible rows instead of forcing the shell taller.

Use grid for panels, lists, settings sections, and modal body structure. Use flex only for short inline alignment such as button rows, pill contents, status rails, and action clusters. Avoid page-like centered layouts; there is no hero section in this product.

The BG background hub is a persistent floating corner control. It starts as a 54px circular trigger, expands to 96px on hover or focus, and reveals a 380px maximum-width panel. It should always remain compact, corner-aware, and directly actionable.

All text in dense rows must be single-line by default with `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap`. Switch to multi-line only for agent prose, markdown output, approval reasons, errors, or explicit detail panels.

## Elevation & Depth

Depth comes from glass, blur, border, and inset highlights. The canonical treatment is a translucent surface, 1px semi-transparent border, `backdrop-filter: blur(40px) saturate(180%)`, a soft outer shadow, and subtle inset light strokes.

Use strong elevation only for modal cards, dropdowns, task panels, and the background hub panel. Small chips and row items should rely on border, tint, and inset highlight rather than heavy shadows.

The app background remains transparent. Never add a full-window canvas color behind the overlay. Modal scrims may use a very light black tint with blur, but they must still feel like temporary desktop overlays.

## Shapes

The command surface is pill-first. Primary controls, context chips, dropdown items, segmented controls, counters, status tags, and buttons should use the pill radius.

Use 14-18px radii for nested task cards, background hub rows, history items, and detail panels. Use 3-4px radii only for precision overlays such as selection rectangles and CUA highlight boxes where the shape must match desktop elements.

Do not introduce large decorative rounded cards. In this product, rounded shapes communicate touchable controls and compact overlay containers, not decorative content blocks.

## Components

**Command Capsule**
The capsule is the core component. It uses the active theme color, glass blur, a dynamic pill radius derived from height, a compact textarea, a small menu button, and optional context rows. The capsule must be draggable, resizable where already supported, and safe over arbitrary desktop content.

**Context Chips**
Context chips represent windows, selections, regions, and CUA entities. They are compact, pill-shaped, draggable when floating, and removable from the shelf. The shelf can scroll horizontally without visible scrollbars. Empty shelf text must be tiny and subdued.

**CUA Highlights**
CUA overlays are functional measurement marks. They use teal for candidates, blue for selected entities, and 120ms appearance transitions. Hover and selected states can pulse, but the overlay must not make the whole desktop capture clicks.

**Dropdowns**
Dropdowns are fixed-position glass panels aligned to the capsule. Items are 34px minimum height, use icon cells, and respond with subtle tint plus `scale(0.98)` active feedback. Dropdowns should stay narrow and avoid nested menus unless the choice set requires it.

**Settings Modal**
Settings uses a 860px max-width glass modal, a three-part segmented control, compact field rows, sliders, toggles, and backend cards. Controls are dense but readable. Preserve blue, white, and black theme support across every nested section.

**Background Hub**
The BG hub is always available. It combines active CUA tasks and conversation history. It must expose direct actions such as Open, Terminal, Stop, Rec, Replay, and Delete without turning into a full-screen task manager.

**Agent Stream**
Agent output lives inside the capsule's expanded stream panel. Markdown must remain readable in a narrow panel: prose wraps, code and tables are bounded by the panel width, and user bubbles align to the right while assistant content aligns left.

**Approval Prompt**
Approval requests are inline and urgent but not modal unless the operation demands it. Use amber warning treatment, concise tool/reason text, and three clear actions: allow, deny, and always allow.

## Do's and Don'ts

Do preserve the illusion that the UI is part of the desktop. Use transparency, blur, small controls, and exact cursor-relative placement.

Do keep interactive surfaces explicitly scoped. Small overlays can capture pointer events, but the rest of the desktop overlay must remain pass-through whenever possible.

Do make every background task or parked conversation directly actionable from the BG hub. Avoid passive status-only rows.

Do use existing themes, tokens, and utility classes before adding new visual rules.

Do keep future additions compact enough for the 24px capsule height and the 380px background hub width.

Do not add landing-page patterns, hero sections, feature cards, oversized headings, marketing copy, or decorative illustrations.

Do not replace the desktop-overlay model with a conventional dashboard or chat sidebar.

Do not introduce broad purple/blue gradients, neon glow aesthetics, or ornamental background blobs. Blue is already the operational color; extra blue decoration weakens the interface.

Do not use pure black (#000000). Use #1C1C1E, #1D1D1F, or translucent black.

Do not use emojis in product UI. Use glyphs, compact letters, or real icon components.

Do not use generic empty-state copy that explains the product. Empty states should describe the immediate data state and the next direct action.

Do not animate layout dimensions except for established compact reveal mechanics such as the BG hub expansion. Prefer transform, opacity, and color transitions.

Do not hide raw errors behind friendly copy. This is an agent control surface; operational failures should remain concrete and debuggable.
