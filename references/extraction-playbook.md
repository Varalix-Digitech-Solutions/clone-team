# Extraction Playbook

Condensed, self-contained extraction guidance for the clone-team. This mirrors
the `clone-website` skill (the team already loads it via `ui-pack`); keep it here
so the Manager and the Frontend Developer have the exact scripts and the spec
template inline, without round-tripping to another file mid-build.

> If anything here is thinner than you need, read
> `~/.claude/skills/clone-website/SKILL.md` directly — it is the fuller source.

## Phase-1 recon checklist (Manager)

1. **Screenshots** at 1440 / 768 / 390, full page, saved to
   `docs/design-references/` with descriptive names. These are the master
   reference; builders get section crops later.
2. **Global extraction** — fonts (every family/weight actually used), color
   palette, favicons/meta, global CSS/JS patterns (scroll-snap, custom
   scrollbars, global keyframes, backdrop filters), and **smooth-scroll
   libraries** (look for `.lenis`, Locomotive Scroll, custom scroll containers).
3. **Mandatory interaction sweep** — a dedicated pass *after* screenshots:
   - **Scroll** slowly top to bottom; note header changes (and the trigger
     position), elements that animate in, auto-switching sidebars/tabs,
     scroll-snap, and non-native scroll feel.
   - **Click** every interactive element; for tabs/pills click **each** and
     record the content per state.
   - **Hover** everything that might react; record what changes and the
     transition.
   - **Responsive** at 1440 / 768 / 390; note which sections reflow and at which
     breakpoint.
   Save to `docs/research/BEHAVIORS.md` — the behavior bible.
4. **Page topology** — every distinct section top to bottom, with order,
   fixed/sticky vs. flow, layout/z-index, dependencies, and the **interaction
   model** of each. Save to `docs/research/PAGE_TOPOLOGY.md`. This becomes the
   **section list** in `state.json`.

## Asset discovery (run via agent-browser)

```javascript
JSON.stringify({
  images: [...document.querySelectorAll('img')].map(img => ({
    src: img.src || img.currentSrc, alt: img.alt,
    width: img.naturalWidth, height: img.naturalHeight,
    parentClasses: img.parentElement?.className,
    siblings: img.parentElement ? [...img.parentElement.querySelectorAll('img')].length : 0,
    position: getComputedStyle(img).position, zIndex: getComputedStyle(img).zIndex
  })),
  videos: [...document.querySelectorAll('video')].map(v => ({
    src: v.src || v.querySelector('source')?.src, poster: v.poster,
    autoplay: v.autoplay, loop: v.loop, muted: v.muted
  })),
  backgroundImages: [...document.querySelectorAll('*')].filter(el => {
    const bg = getComputedStyle(el).backgroundImage; return bg && bg !== 'none';
  }).map(el => ({ url: getComputedStyle(el).backgroundImage,
    element: el.tagName + '.' + el.className?.split(' ')[0] })),
  svgCount: document.querySelectorAll('svg').length,
  fonts: [...new Set([...document.querySelectorAll('*')].slice(0, 200).map(el => getComputedStyle(el).fontFamily))],
  favicons: [...document.querySelectorAll('link[rel*="icon"]')].map(l => ({ href: l.href, sizes: l.sizes?.toString() }))
});
```

Then write a Node script that downloads everything to `public/` (batched,
4-at-a-time, with error handling), preserving meaningful structure.

## Per-component style extraction (run via agent-browser)

Replace `SELECTOR` with the section's container. Capture the full output into the
spec — never hand-measure individual properties.

```javascript
(function(selector) {
  const el = document.querySelector(selector);
  if (!el) return JSON.stringify({ error: 'Element not found: ' + selector });
  const props = ['fontSize','fontWeight','fontFamily','lineHeight','letterSpacing','color',
    'textTransform','textDecoration','backgroundColor','background',
    'padding','paddingTop','paddingRight','paddingBottom','paddingLeft',
    'margin','marginTop','marginRight','marginBottom','marginLeft',
    'width','height','maxWidth','minWidth','maxHeight','minHeight',
    'display','flexDirection','justifyContent','alignItems','gap',
    'gridTemplateColumns','gridTemplateRows',
    'borderRadius','border','borderTop','borderBottom','borderLeft','borderRight',
    'boxShadow','overflow','overflowX','overflowY',
    'position','top','right','bottom','left','zIndex',
    'opacity','transform','transition','cursor',
    'objectFit','objectPosition','mixBlendMode','filter','backdropFilter',
    'whiteSpace','textOverflow','WebkitLineClamp'];
  const extract = (e) => { const cs = getComputedStyle(e), s = {};
    props.forEach(p => { const v = cs[p];
      if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') s[p] = v; });
    return s; };
  function walk(e, d) { if (d > 4) return null; const kids = [...e.children];
    return { tag: e.tagName.toLowerCase(),
      classes: e.className?.toString().split(' ').slice(0, 5).join(' '),
      text: e.childNodes.length === 1 && e.childNodes[0].nodeType === 3 ? e.textContent.trim().slice(0, 200) : null,
      styles: extract(e),
      images: e.tagName === 'IMG' ? { src: e.src, alt: e.alt, naturalWidth: e.naturalWidth, naturalHeight: e.naturalHeight } : null,
      childCount: kids.length, children: kids.slice(0, 20).map(c => walk(c, d + 1)).filter(Boolean) }; }
  return JSON.stringify(walk(el, 0), null, 2);
})('SELECTOR');
```

**Multi-state:** capture state A, trigger the change (scroll/click/hover via
agent-browser), capture state B, and record the diff explicitly: "property X
changes from A to B, triggered by TRIGGER, transition: TRANSITION."

## Determine the interaction model BEFORE building

1. Don't click first. **Scroll** through the section and watch for self-changing
   content → scroll-driven (find the mechanism: IntersectionObserver,
   scroll-snap, `position: sticky`, `animation-timeline`, JS scroll listeners).
2. If nothing changes on scroll, **then** click/hover to test.
3. Write the model explicitly in the spec.

## Capture the SCROLL TRAJECTORY, not just two endpoints (motion is data)

Scroll-/time-driven motion is the #1 thing that silently slips the gate, because
a still screenshot can't show it. For any animated element (a morphing shape, a
parallax layer, a carousel that advances on scroll, elements that animate in from
below, a sticky pin), record the animation as a **function of scroll position**,
not a single before/after. Sample the animated element's state at several scrollY
values across its active range and write the **scrollY → state map** into the spec
so the builder reproduces the trajectory and the Tester can diff against it.

```javascript
// Run via agent-browser: step the scroll and read the animated element each step.
(function(selector){
  const out=[]; const el=()=>document.querySelector(selector);
  const max=document.body.scrollHeight-innerHeight;
  for(let y=0; y<=max; y+=Math.round(max/12)){
    window.scrollTo(0,y);
    const e=el(); if(!e){ out.push({y,missing:true}); continue; }
    const cs=getComputedStyle(e);
    out.push({ y,
      transform: cs.transform!=='none'?cs.transform:undefined,
      height: cs.height, opacity: cs.opacity,
      // app-specific signals: active slide index, visible image src, sticky offset...
      activeIdx: e.querySelector('[data-active],.is-active,[aria-current]')?.dataset?.index,
      topImg: e.querySelector('img')?.currentSrc?.split('/').pop() });
  }
  return JSON.stringify(out,null,1);
})('SELECTOR');
```

Record in the spec, per animated element: the **trigger** (scroll range / threshold
/ timer), the **start → mid → end states**, what *fires* the change (so the clone
actually cycles/morphs/reveals — not a frozen lookalike), the **direction**
(forward on scroll-down, reverse on scroll-up?), and the **easing/cadence**. For
time-driven carousels, note the interval. "It animates" is not a spec — the
scrollY→state map is.

**Also capture the SCROLL DISTANCE of pinned/scrubbed sections** — not just the
states they pass through. For a `position:sticky` / GSAP-ScrollTrigger pin, measure
the **pin length**: the `.pin-spacer` (or section) height and how many
viewport-heights of scroll the pin spans (e.g. original pins for `6 × innerHeight`
= ~5400px at a 900px viewport, with each of 3 panels owning ~2 viewport-heights).
Record it in the spec as a multiple of the viewport (so it holds across sizes) and
note the per-panel scrollY band. A clone that reproduces the panels but over a
**shorter scroll span** scrubs too fast — a real fidelity defect. Sanity anchor:
record the page's total `document.body.scrollHeight` at 1440×900 so the builder and
Tester can diff total height and immediately see if any long/pinned section was
compressed.

## Spec file template

Write to `docs/research/components/<name>.spec.md`. Every section filled; "N/A"
with a reason where it truly doesn't apply (think twice before N/A-ing states).

```markdown
# <ComponentName> Specification

## Overview
- Target file: `src/components/<ComponentName>.<ext>`
- Screenshot: `docs/design-references/<name>.png`
- Interaction model: <static | click | scroll | hover | time | mixed>

## DOM Structure
<what contains what>

## Computed Styles (exact getComputedStyle values)
### Container
- <prop>: <value>
### <Child 1> … <Child N>
- <prop>: <value>

## States & Behaviors
### <behavior name>
- Trigger: <exact mechanism / threshold>
- State A (before): <values>
- State B (after): <values>
- Transition: <duration, easing, properties>
- Implementation approach: <CSS transition | IntersectionObserver | animation-timeline | …>
### Hover states
- <element>: <prop>: <before> → <after>, transition: <value>

## Per-State Content (if applicable)
### State: "<name>"
- <title / cards / data verbatim>

## Assets
- <local paths to images/videos>; icons used: <names from icons file>

## Text Content (verbatim)
<copy-pasted from the live site>

## Responsive Behavior
- Desktop (1440): <layout>
- Tablet (768): <changes>
- Mobile (390): <changes>
- Breakpoint: ~<N>px
```

## Pre-dispatch checklist (every box must be checkable)

- [ ] Spec written with ALL sections filled
- [ ] Every CSS value from `getComputedStyle()`, not estimated
- [ ] Interaction model identified and documented
- [ ] Every state's content + styles captured (stateful components)
- [ ] Scroll triggers: threshold, before/after, transition recorded
- [ ] Hover: before/after + timing recorded
- [ ] All images identified (including overlays/layers)
- [ ] Responsive documented for desktop + mobile
- [ ] Text verbatim, not paraphrased
- [ ] Spec under ~150 lines (else split the section)
