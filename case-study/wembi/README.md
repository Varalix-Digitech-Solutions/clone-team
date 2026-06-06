# Case study: cloning wembi.ai with clone-team

> Built with **[clone-team](../../README.md)** — a [Claude Code](https://claude.com/claude-code)
> skill that clones any website with a coordinated team of AI agents **and** writes
> you the `ARCHITECTURE.md` to rebuild it. This page is one worked example, not a
> wembi showcase: the point is what the *skill* did with a deliberately hard target.

## Install clone-team

In Claude Code:

```
/plugin marketplace add Varalix-Digitech-Solutions/clone-team
/plugin install clone-team@clone-team
```

Then just ask it to clone a site. Full instructions, requirements, and the
engine write-up are in the **[main README](../../README.md)**.

## Why wembi.ai was a hard target

A single-page site whose entire impression rests on motion — a static screenshot
looks identical whether the clone works or not, so the only honest proof is in
how it *moves*. The hard parts:

- **Lenis smooth scroll** — non-native scroll cadence the clone has to match feel-for-feel
- **Scroll-driven `<video>`** — frame scrubbed to scroll position, not autoplayed
- **Reveal-on-scroll choreography** — the page starts visually empty and assembles as you scroll
- **Custom `@font-face` wordmark** + pixel-level type and spacing
- **Multilingual copy** and a 3D hero render that has to stay intact

## Before / after — driven in lockstep

Original (left) vs. the clone-team build (right), driven through `agent-browser`
to the **same scroll point** so the comparison is fair frame-for-frame:

![wembi.ai original (left) vs clone-team build (right), scroll-synced side by side](media/wembi-compare.gif)

> Both panes are scrolled in lockstep. This is exactly what the Tester gate checks —
> it **drives** the scroll and diffs the *state trajectory* (transform / opacity /
> active video frame), rather than trusting a still that can't tell working motion
> from frozen motion.

A representative section, pixel-level type, layout, and the 3D render intact:

![clone-team build — "Functioning" section](media/wembi-section.png)

## How clone-team built it

| | |
|---|---|
| **Site** | https://www.wembi.ai/ (single-page) |
| **Original stack** | Nuxt / Vue + Lenis + scroll-driven `<video>` |
| **Clone stack** | plain HTML/CSS/JS + Tailwind v4 + Lenis (stack chosen at run start) |

1. **Recon + foundation** — the Manager mapped the page, downloaded assets, and stood up the scaffold.
2. **Whole-page build (one-shot)** — because the unit of work is a *page*, a single Opus builder produced the entire page so backgrounds, asset paths, and the scroll choreography stayed internally consistent (no assembly seams).
3. **The unskippable Tester gate** — every round, the Tester ran a full regression against the live original at 1440 / 768 / 390 and **drove** every scroll/animation, diffing the *state trajectory* rather than a still. The page wasn't "done" until the Tester returned OK.
4. **Architecture doc in parallel** — the Backend Architect produced an `ARCHITECTURE.md` describing the page's structure, scroll model, and asset/flow map.

All of this ran inside clone-team's **dynamic Workflow**, so the test gate was a
control-flow condition, not a judgment call. See the
[main README](../../README.md) for how the engine works.

## Notes & attribution

This is an **unaffiliated technical recreation** for demonstrating the
`clone-team` skill. All design, branding, copy, and visual assets belong to
**wembi.ai**; visit the real, far better thing at <https://www.wembi.ai/>. The
clone's source and downloaded assets are **not** published in this repository —
only these short capture clips, shown for commentary and comparison.
