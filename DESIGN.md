# Design

Dark, project-management SaaS lane (reference: Linear's restraint, not its gradients). Scene: a developer at a desk in the evening, a terminal or Claude desktop open beside the page. The site borrows the sidebar's own vocabulary so the product and the page look like one thing.

## Color (OKLCH, tinted toward indigo)

| Role | Value |
| --- | --- |
| bg | oklch(0.155 0.014 275) |
| surface | oklch(0.195 0.016 275) |
| raised | oklch(0.235 0.018 275) |
| line | oklch(0.32 0.02 275 / 0.7) |
| text | oklch(0.95 0.008 275) |
| muted | oklch(0.74 0.02 275) |
| dim | oklch(0.60 0.02 275) |
| accent (needs the user) | oklch(0.76 0.13 270) |
| project pill | oklch(0.74 0.12 250) |
| session pill | oklch(0.74 0.14 315) |
| age pill | oklch(0.76 0.12 165) |

Strategy: Restrained. One accent. The three pill hues exist only inside the product replica, where they match the real sidebar.

## Type

Geist (UI and headings, weight 400 to 700, tight tracking on display sizes) and Geist Mono (commands, ids, labels). Self-hosted latin subsets, no third-party requests.

## Components

- Window frame with the replica sidebar (rows, tinted meta pills, inline card, accent border on the open card).
- Command blocks with a copy button.
- Spec rows: label left, text right, hairline between. Used instead of icon cards.
- Hairline ledger rules behind the hero, fading out.

## Motion

One staged sequence in the hero (Claude defers something, a row appears). Ease-out only. Nothing animates layout properties. Reduced motion shows the end state.
