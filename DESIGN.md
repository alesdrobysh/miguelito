# Miguelito WebUI Design Notes

## Intent
A mobile-first messenger surface for non-power users. The interface should disappear behind the conversation while still feeling carefully made.

## Design tokens
- Background: warm off-white parchment (`#f7f2ea`, `#efe6d9`).
- Surface: translucent warm white used sparingly for app chrome (`#fffaf2`, rgba whites).
- Ink: dark warm brown/black (`#211b16`).
- Muted text: warm gray/brown (`#83766a`).
- Accent: restrained terracotta (`#b56f42`, `#8f4f2e`).
- Success/online: muted sage (`#6f8e67`).
- Borders: low-alpha warm brown lines.

## Components
- App shell: single phone-like chat frame on desktop, full-screen on mobile.
- Header: hamburger/drawer button, avatar/identity, language selector.
- Drawer: secondary context only; no learning controls on first screen.
- Message bubbles: user right aligned with terracotta fill; assistant left aligned with warm white fill.
- Composer: fixed bottom area, textarea plus send button, keyboard-friendly.

## Typography
System sans stack via Albert Sans/Instrument Sans in CSS. Tight but readable headings, normal body rhythm, no decorative display type in the chat surface.

## Motion
Subtle bubble entrance only. No bouncing, parallax, looping animation, or decorative motion.

## Accessibility and hardening targets
- Works at narrow mobile widths.
- Visible focus state for composer.
- Sufficient text contrast against warm surfaces.
- Markdown rendering must escape HTML before applying limited inline formatting.
- Long messages wrap and preserve line breaks.

## Slop guardrails
Reject: purple gradients, blurred orbs, neon glow, glass cards for their own sake, generic AI/SaaS hero sections, fake analytics cards, decorative dashboards, excessive shadows, monospace branding.
