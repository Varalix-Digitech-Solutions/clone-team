# Motion Playbook — the clone-team motion-fidelity reference

This is the **self-contained** knowledge base for the two motion specialists —
the **Interaction & Motion Analyst** (who authors the motion spec) and the
**Motion Developer** (who builds from it). It exists so the team never misses an
animation or interaction state, even when the optional `ui-animation` skill is not
installed on the host. If `ui-animation` *is* installed, prefer it for deep craft
(spring physics, gesture/drag, clip-path techniques) and use this as the shared
checklist + templates.

Why this track exists: the layout-focused extraction spec captures structure,
color, and copy well but under-describes **motion** — micro-hover feedback, focus
rings, intro curtains, scroll-scrubbed text, and ambient "glittery" motion
(shimmer/particles/grain). Treating motion as a binary "does it animate at all"
misses fidelity. This playbook turns "notice it" into "enumerate and verify it."

---

## 1. The motion taxonomy (classify every animated element into ONE)

| Class | What it is | How to detect | How to verify |
|-------|-----------|---------------|---------------|
| `load-intro` | Preloader / brand-colored full-screen **curtain** / splash / page-transition overlay; plays once on load, then gone (~1–2s) | **COLD hard-reload**, sample first ~0–2.5s | Reload a fresh session; screenshot at load + DOM every ~250ms |
| `one-shot-entrance` | Fades/slides in once on scroll-into-view, then stays | IntersectionObserver, `.is-visible` classes | Scroll element into view; confirm it animates in once |
| `scroll-scrubbed` | Tied **continuously** to scroll progress: text reveals split into `.line/.word/.char`, pinned carousels, parallax, progress bars | Scroll handler / GSAP ScrollTrigger / Lenis | Scroll in increments **and wait ≥600ms**; map scrollY→state; measure pin DISTANCE |
| `hover-focus` | Driven by pointer hover or keyboard focus | `:hover`/`:focus` styles, JS listeners | Hover AND keyboard-`Tab` to it; read before/after |
| `click-tap` | Driven by click/tap: accordion, tab, ripple, toggle | click listeners, `aria-expanded` | Click; confirm state change + timing |
| `time-loop` | Autoplay / auto-rotate on a timer | `setInterval`, autoplay carousels | Wait; confirm it advances unaided at the right cadence |
| `continuous-decorative` | Ambient/generative: **shimmer, sparkle/particles, grain/noise, gradient drift, canvas/WebGL shaders, marquees, looping video textures** | `<canvas>`, `requestAnimationFrame`, animated gradients, looping `<video>`, SVG `<animate>` | Diff two screenshots a moment apart at the SAME scroll position — shifted pixels with no input = decorative motion |

**`continuous-decorative` is the most-dropped class** — the layout pass almost
never records it. Hunt it on purpose.

---

## 2. State matrix template (one row per interactive element)

For every link, button, input, card, tab, accordion, nav item, menu — record
each state, or `—` if it genuinely doesn't exist (so the absence is explicit):

| Element | default | hover | focus (keyboard) | active/pressed | loading | disabled | empty | error |
|---------|---------|-------|------------------|----------------|---------|----------|-------|-------|
| Primary button | bg `#…`, … | bg `#…`, 150ms ease-out | 2px ring `#…` | scale .98 | spinner, label hidden | opacity .5, no-pointer | — | — |
| Text input | border `#…` | border `#…` | border `#…` + ring | — | — | bg `#…` | placeholder `#…` | border red, msg |
| Nav link | … | underline grow L→R 200ms | ring | — | — | — | — | — |

Record **what changes** (color/transform/shadow/opacity), the **duration**, and
the **easing** for each. Trigger keyboard focus with `Tab`, not just the mouse —
a focus ring that only shows on keyboard focus is real, required state.

---

## 3. Animated-element inventory template (the anti-miss list)

```
- name/selector: ".hero__title"
  class: scroll-scrubbed
  trigger: scrollY 6600–8400 (the .steps__description block)
  trajectory: per-char opacity 0.20 → 1.00, left→right, stagger ~12ms
  split: .char (chars), masked by overflow:clip
  distance: spans ~2 viewport-heights of pin
  duration/easing: scrubbed (no fixed duration); linear to scroll
- name/selector: ".transition" (intro curtain)
  class: load-intro
  trigger: page load (cold)
  trajectory: 60-cell grid wipe, lime #beff8b, gone by ~1.2s; removed after (never blocks input)
- name/selector: ".bg-shimmer"
  class: continuous-decorative
  trigger: always (rAF)
  trajectory: gradient drift, ~8s loop
```

Every entry the original animates MUST appear here, and MUST animate in the clone.
Right text/section rendered **static** where the original animates it = an NG.

---

## 4. Motion-token layer (define once, apply everywhere)

Distill recurring values so motion is consistent, not one-off:

```css
:root {
  /* durations */
  --motion-fast: 150ms;   --motion-base: 250ms;   --motion-slow: 500ms;
  /* easings */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  /* spring-ish (for JS/WAAPI) */ /* stiffness/damping or a bezier approximation */
  /* distances + stagger */
  --motion-rise: 24px;   --motion-stagger: 60ms;
}
```

The Motion Developer applies these tokens across the page so entrances, hovers,
and reveals share a coherent rhythm.

---

## 5. Craft rules (from ui-animation; these are fidelity AND quality)

- **Pick the right primitive:** CSS **transitions** for interruptible, state-driven
  changes (hover/focus/toggle); **keyframes** for predetermined sequences; **spring
  physics** (WAAPI/JS) for natural, momentum-driven motion.
- **Never animate layout properties** (`width`, `height`, `top`, `left`,
  `margin`) — they trigger layout/reflow and jank. Animate `transform` and
  `opacity`, which are compositor-friendly.
- **Never use `transition: all`** — name the exact properties. `all` animates
  unintended properties and is a performance trap.
- **Keep `filter` animations modest** (e.g. blur ≤ ~20px) — large filter
  animations are expensive.
- **Don't fight keyboard users** — avoid animating focus moves triggered by the
  keyboard in ways that delay or hide the focus target; keep focus visible.
- **Clip-path / mask reveals** for text and image wipes (`overflow: clip` on a
  `.line-mask`, translate the `.line` inside it).
- **Respect `prefers-reduced-motion: reduce`** — gate non-essential motion:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
  }
  ```
  but keep meaning-bearing motion (e.g. a loading spinner) functional.

---

## 6. Drive-to-verify recipe (both analyst and tester rely on this)

A still frame **cannot** prove motion — a frozen page looks identical to a working
one in a screenshot. So:

1. **Intro:** hard-reload a COLD session; screenshot at load + read DOM every
   ~250ms for the first ~2.5s.
2. **States:** hover, then **keyboard-`Tab`** to focus, then click each interactive
   element; read computed style before/after.
3. **Scroll-driven:** scroll in small increments and **wait ≥600ms** before reading
   (async observers fire late); read `transform`/`opacity`/`height`/active-index at
   each step; build the scrollY→state map; measure pin DISTANCE in viewport-heights.
   Cheap detector for a compressed pin: diff total `document.body.scrollHeight`
   between original and clone at the same viewport.
4. **Decorative/continuous:** screenshot, wait ~400ms, screenshot again at the SAME
   scroll position; if pixels moved with no input, it's `continuous-decorative` —
   record it.

If a behavior listed in the spec was only checked as a static frame, the check is
**incomplete** — go drive it.

---

## 7. Where this plugs into the loop

`extract → spec  →  MOTION-ANALYZE (this playbook → *.motion.md)  →  develop (FE)
→  MOTION pass (Motion Developer, same file)  →  Tester gate  →  fix`

The Motion Analyst runs once per page (after the FE spec) and writes the motion
spec. The Motion Developer runs every round **after** the FE Developer and **before**
the Tester — so motion is always the last writer and survives FE fix rounds. The
Tester cross-checks the clone against the motion spec: every inventory entry must
animate, every state-matrix entry must match.
