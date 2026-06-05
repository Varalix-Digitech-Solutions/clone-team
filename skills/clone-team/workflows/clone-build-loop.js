export const meta = {
  name: 'clone-team-build-loop',
  description:
    'Autonomous, resumable website-clone loop. Enforces extract→spec→develop→full-regression-test→fix per section (the Tester gate cannot be skipped), runs a parallel backend-architecture documentation track, then assemble→final-regression→fix. Built for the clone-team skill.',
  phases: [
    { title: 'Spec & Build' },
    { title: 'Motion' },
    { title: 'Regression' },
    { title: 'Backend Docs' },
    { title: 'Assemble & Final Regression' },
  ],
}

// ---------------------------------------------------------------------------
// This script is the ENFORCEMENT ENGINE. The Manager (the main thread running
// the clone-team skill) cannot reorder or skip these steps, because they are
// expressed as control flow here, not as discretion. Every section must pass
// the Tester before it is considered done; the page must pass a final
// regression before the run returns.
//
// `args` (passed by the Manager from state.json) is expected to contain:
//   {
//     goal:        string,                 // the /goal — the exact-clone target
//     targetUrl:   string | string[],
//     stack:       string,                 // e.g. "Next.js + Tailwind + shadcn"
//     projectDir:  string,                 // absolute path to the clone project
//     credsFilePath: string | null,        // gitignored file the agents read to log in
//     loginQuirks: string,                 // free text the Manager gathered
//     appInsights: string,                 // anything useful about using the app
//     sections:    Array<{                 // the work-list from PAGE_TOPOLOGY
//        name, screenshot?, interactionModel?, complexity?, dependsOn?,
//        targetFile?, specPath?, status?    // 'done' => skip; 'built' => test-first re-validate (resume)
//     }>,
//     runConfig:   { modelTier, maxRounds, finalCap, backendDepth },
//     personas:    { fe?, backend?, tester?, motionAnalyst?, motionDev? } // optional overrides of the defaults below
//     paths:       { research, components, designRefs } // doc output dirs
//   }
// Anything missing falls back to a sensible default so the workflow is also
// runnable standalone.
// ---------------------------------------------------------------------------

// Robust args intake. The harness may hand `args` to the script either as a
// real object OR as a JSON string (depending on how the Manager passed it).
// We normalize both so a stringified payload is never silently dropped — that
// failure mode (empty config -> empty section list -> "assemble nothing")
// is invisible and expensive, so we defend against it here, loudly.
let A = args || {}
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { A = { __argsParseError: String(e && e.message || e) } }
}
if (Array.isArray(A) || typeof A !== 'object' || A === null) A = { __argsShapeError: `args was ${Array.isArray(A) ? 'an array' : typeof A}` }

const goal = A.goal || 'Produce a pixel-perfect, behavior-accurate clone of the target site.'
const targetUrl = Array.isArray(A.targetUrl) ? A.targetUrl.join(', ') : (A.targetUrl || '(see project docs)')
const stack = A.stack || '(stack unspecified — read the project scaffold / package.json to determine it; do NOT assume React/Next.js)'
const projectDir = A.projectDir || '.'
const credsLine = A.credsFilePath
  ? `Login is required. Read credentials from \`${A.credsFilePath}\` (gitignored — never print, commit, or paste them into reports). Login quirks: ${A.loginQuirks || 'none reported'}.`
  : 'No login required for the target.'
const appInsights = A.appInsights || 'none reported'
const statePath = A.statePath || '' // absolute path to scripts/state.mjs (durable checkpoint CLI)
const research = A.paths?.research || 'docs/research'
const components = A.paths?.components || 'docs/research/components'
const designRefs = A.paths?.designRefs || 'docs/design-references'

const cfg = A.runConfig || {}
const maxRounds = Number.isFinite(cfg.maxRounds) ? cfg.maxRounds : 4
const finalCap = Number.isFinite(cfg.finalCap) ? cfg.finalCap : 3
const backendDepth = cfg.backendDepth || 'inferred' // 'none' | 'flows' | 'inferred' | 'deep'
// waveSize caps how many sections build concurrently. On a constrained machine,
// 11 parallel agents each driving a headless Chrome can exhaust memory and crash
// the host before any section reaches a checkpoint. Building in small waves caps
// peak load AND lets each completed wave be Tester-marked `done` (durable), so a
// crash resumes instead of restarting from zero. 0/undefined => all-at-once.
const waveSize = Number.isFinite(cfg.waveSize) && cfg.waveSize > 0 ? cfg.waveSize : 9999
// skipAssembly: build+test sections only; leave page assembly to the Manager's
// Phase 3 (the authoritative assembly + final regression). Useful for wave runs.
const skipAssembly = !!cfg.skipAssembly
// serialBackend: run the backend-docs browser AFTER the section grind instead of
// concurrently — required when the host budgets only 1 concurrent browser
// (capacity.mjs --browsers). leanResources: tell every agent to keep at most ONE
// agent-browser session alive and not spawn browser-driving sub-builders, so the
// run never crosses systemd-oomd's memory-pressure kill threshold.
const serialBackend = !!cfg.serialBackend
const leanResources = !!cfg.leanResources

// Model tier -> per-role model. Manager runs in the main thread (session model).
const TIERS = {
  'max-fidelity':   { dev: 'opus',   tester: 'opus',   backend: 'opus',   extract: 'sonnet', motion: 'opus'   },
  'cost-optimized': { dev: 'sonnet', tester: 'sonnet', backend: 'sonnet', extract: 'haiku',  motion: 'sonnet' },
  'ultra-cheap':    { dev: 'sonnet', tester: 'sonnet', backend: 'sonnet', extract: 'haiku',  motion: 'sonnet' },
}
const M = TIERS[cfg.modelTier] || TIERS['max-fidelity']

const sections = (A.sections || []).filter(Boolean)

// --- Startup config echo + fail-fast guard ---------------------------------
// Log the RESOLVED config so a misconfigured launch is visible immediately
// (not discovered three rounds later when "assemble nothing" finally surfaces).
log(`clone-team config: projectDir=${projectDir} | stack=${stack} | tier=${cfg.modelTier || 'max-fidelity'} | sections=${sections.length} | waveSize=${waveSize >= 9999 ? 'all' : waveSize} | skipAssembly=${skipAssembly} | backendDepth=${backendDepth}`)
if (A.__argsParseError || A.__argsShapeError) {
  log(`ABORT: args were not usable (${A.__argsParseError || A.__argsShapeError}). The Manager must pass a real object OR a JSON string for \`args\`.`)
  return { error: 'bad-args', detail: A.__argsParseError || A.__argsShapeError, summary: { sections: 0, passed: 0, flagged: [], finalVerdict: 'not-run', backendCoverage: 'skipped' } }
}
if (sections.length === 0) {
  // Hard stop. Proceeding would run the backend track then try to assemble an
  // empty page and report "blocked" — a silent misfire. Fail loudly instead so
  // the Manager fixes the launch (almost always: args arrived without `sections`).
  log('ABORT: 0 sections to build. This is a launch misconfiguration (args.sections empty or not delivered) — NOT a successful empty run. Fix the args and relaunch.')
  return { error: 'no-sections', summary: { sections: 0, passed: 0, flagged: [], finalVerdict: 'not-run', backendCoverage: 'skipped' }, hint: 'Pass args.sections as a non-empty array (object or JSON-string args both accepted).' }
}

// --- Role capsules (defaults; the canonical full versions live in agents/*.md
// and the Manager may override these via args.personas) ---------------------

const skillDirHint = A.skillDir ? ` (at \`${A.skillDir}/references/motion-playbook.md\`)` : ''

const UIPACK = `Before doing ANY work, try to load the \`ui-pack\` skill (it bundles clone-website, agent-browser, ui-ux-pro-max, impeccable, emil-design-eng). If \`ui-pack\` is NOT installed on this machine, DEGRADE GRACEFULLY — do not abort: use the \`agent-browser\` CLI directly (run \`agent-browser skills get core --full\` once for its command guide), plus whichever of \`emil-design-eng\` / \`ui-ux-pro-max\` are installed, and this skill's extraction-playbook reference for the extraction scripts + spec template. Either way you MUST drive and verify the real UI through agent-browser — never guess what the page looks like.`

const UIANIM = `Also try to load the \`ui-animation\` skill (motion craft: CSS transitions vs keyframes vs spring physics, easing/timing, clip-path reveals, gestures/drag, performance rules, review format). If it is NOT installed, DEGRADE GRACEFULLY — read this skill's \`references/motion-playbook.md\`${skillDirHint}, which carries the same motion taxonomy, the state-matrix + motion-token templates, the performance rules, and the drive-to-verify recipe. Motion craft rules: prefer transform/opacity, NEVER animate layout props (width/height/top/left) or use \`transition: all\`, keep filter animations modest, and respect \`prefers-reduced-motion: reduce\`.`

const FE_PERSONA = A.personas?.fe || `You are the FRONTEND DEVELOPER on a website-cloning team: a veteran frontend + UX engineer, the team's build machine. ${UIPACK} You build pixel-perfect, behavior-accurate clones from a spec, extracting EXACT getComputedStyle values, real text, real downloaded assets, and every interaction state. You may spawn your own sub-builder agents for complex sections. You NEVER guess a value the spec should contain — if the spec is missing something, extract it from the live site yourself. You make the build and typecheck pass before reporting. You report back with full, honest notes (including anything you couldn't verify) so the Manager and Tester have complete context.`

const TESTER_PERSONA = A.personas?.tester || `You are the TESTER on a website-cloning team — the most important quality gate, an expert in testing methodology AND UX. ${UIPACK} You receive the goal and full context and you know exactly what the delivery must contain. You run a FULL REGRESSION every round, not a spot check: side-by-side visual diff against the ORIGINAL at 1440/768/390 via agent-browser, every interactive behavior (scroll/click/hover/time/responsive), and build/type checks. CRITICAL — you DO NOT stop at the first bug. Finish the ENTIRE regression in one pass and ACCUMULATE every defect you find (visual at all three viewports, every interaction/state, responsive reflow, content/asset mismatches, build/type errors). Never short-circuit and report a single issue back early — that wastes a whole expensive round; the Developer needs the COMPLETE punch list so they can fix everything at once. Note each issue as you go and keep testing. No bug, requirement mismatch, or undesirable UX detail escapes you. Only after the full sweep do you return a strict verdict: OK only if it is an exact copy with ZERO issues; otherwise NG with the FULL list of SPECIFIC, REPRODUCIBLE issues (where, expected vs actual, how to reproduce, screenshot ref), ordered by severity, that the Developer can act on directly.`

const BACKEND_PERSONA = A.personas?.backend || `You are the BACKEND ARCHITECT on a website-cloning team: a powerhouse in backend architecture with deep domain reasoning. ${UIPACK} You also use clean-code discipline. Your deliverable is DOCUMENTATION, not a running backend: you reverse-engineer and clearly document how the target system is structured and how its flows work — observed network/API surface, inferred data model and entities, auth/session flow, state and navigation, and the end-to-end user journeys — to the requested depth. You write it as a well-structured, auditable document a fresh team could build from.`

const MOTION_ANALYST_PERSONA = A.personas?.motionAnalyst || `You are the INTERACTION & MOTION ANALYST on a website-cloning team — a motion-design specialist whose SOLE job is to ensure NO animation and NO interaction state is ever missed. ${UIPACK} ${UIANIM} You do NOT build; you OBSERVE the live original exhaustively and author a MOTION SPEC: (1) a STATE MATRIX for every interactive element (default/hover/focus/active/loading/disabled/empty/error — what changes, with duration + easing); (2) a complete ANIMATED-ELEMENT INVENTORY, each entry classified — load-intro, one-shot-entrance, scroll-scrubbed, hover-focus, click-tap, time-loop, or continuous-decorative (shimmer, particles, grain, gradient-drift, canvas/WebGL, marquee, looping video); (3) a MOTION-TOKEN layer (durations, easings, distances, stagger) so motion is consistent; (4) reduced-motion + keyboard-flow notes. You catch the SUBTLE things the layout-focused extractor skips: micro-hover feedback, keyboard focus rings, and decorative/generative ("glittery") motion — that is fidelity, not garnish. You DRIVE everything in agent-browser to confirm it: COLD hard-reload for intro; hover + keyboard-Tab-focus + click every interactive element; scroll in increments and WAIT >=600ms for async (IntersectionObserver/Lenis/GSAP) motion to fire before reading. You never guess — if you cannot observe a state, record it as an explicit unknown.`

const MOTION_DEV_PERSONA = A.personas?.motionDev || `You are the MOTION DEVELOPER on a website-cloning team — an animation engineer who runs a SEQUENTIAL polish pass AFTER the Frontend Developer has built the page. ${UIPACK} ${UIANIM} You edit the SAME page file the FE Developer produced, but you touch ONLY motion: add/repair every entry in the MOTION SPEC that the build left static or wrong, while preserving the FE Developer's layout, structure, content, colors, and asset paths EXACTLY (if a change alters the static at-rest rendering, you have overstepped — flag layout/content fixes for the Manager instead). You implement the full taxonomy: load-intro curtains, one-shot entrances, scroll-scrubbed text/element reveals (split text into .line/.word/.char yourself when needed and match the per-element trajectory AND the scroll DISTANCE/pin length), hover/focus/active/loading states, click feedback, time/loop, and continuous-decorative (shimmer/particles/grain/canvas/marquee). Apply the motion tokens consistently; gate non-essential motion behind prefers-reduced-motion; keep keyboard focus visible. You DRIVE each behavior in agent-browser to confirm it fires with the right trajectory + cadence + distance, and you keep build + typecheck GREEN (motion must still work when the page is SERVED, not file://). Report exactly which motion you added/fixed and anything you could not reproduce.`

// --- Structured output schemas ---------------------------------------------

const SPEC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['sectionName', 'specPath', 'interactionModel', 'ready'],
  properties: {
    sectionName: { type: 'string' },
    specPath: { type: 'string', description: 'path to the written .spec.md' },
    interactionModel: { type: 'string', enum: ['static', 'click-driven', 'scroll-driven', 'hover-driven', 'time-driven', 'mixed'] },
    subComponents: { type: 'array', items: { type: 'string' } },
    complexity: { type: 'string', enum: ['simple', 'moderate', 'complex'] },
    ready: { type: 'boolean', description: 'true if the spec is complete enough to build from with zero guessing' },
    notes: { type: 'string' },
  },
}

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['sectionName', 'filesWritten', 'buildPasses', 'typecheckPasses', 'summary'],
  properties: {
    sectionName: { type: 'string' },
    filesWritten: { type: 'array', items: { type: 'string' } },
    buildPasses: { type: 'boolean' },
    typecheckPasses: { type: 'boolean' },
    summary: { type: 'string' },
    devNotes: { type: 'string', description: 'honest notes: what was done, what is uncertain, what was inferred' },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['scope', 'verdict', 'issues'],
  properties: {
    scope: { type: 'string', description: 'what was regression-tested' },
    verdict: { type: 'string', enum: ['OK', 'NG'] },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'area', 'description', 'expected', 'actual'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          area: { type: 'string' },
          description: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          repro: { type: 'string' },
          screenshotRef: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const DOC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['docPath', 'coverage'],
  properties: {
    docPath: { type: 'string' },
    sectionsCovered: { type: 'array', items: { type: 'string' } },
    coverage: { type: 'string', enum: ['partial', 'substantial', 'complete'] },
    gaps: { type: 'array', items: { type: 'string' } },
  },
}

const MOTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['motionPath', 'inventoryCount', 'ready'],
  properties: {
    motionPath: { type: 'string', description: 'path to the written .motion.md spec' },
    stateMatrixElements: { type: 'integer', description: 'count of interactive elements given a state matrix' },
    inventoryCount: { type: 'integer', description: 'count of animated elements enumerated' },
    classesPresent: {
      type: 'array',
      items: { type: 'string', enum: ['load-intro', 'one-shot-entrance', 'scroll-scrubbed', 'hover-focus', 'click-tap', 'time-loop', 'continuous-decorative'] },
      description: 'which motion classes were actually observed on the original — tells the Tester what to verify',
    },
    tokensDefined: { type: 'boolean' },
    reducedMotionNoted: { type: 'boolean' },
    ready: { type: 'boolean', description: 'true only if every behavior can be built from this spec with ZERO guessing' },
    notes: { type: 'string' },
  },
}

// --- Prompt builders --------------------------------------------------------

const skillDir = A.skillDir || '' // absolute path to the clone-team skill repo (for references/extraction-playbook.md etc.)
const CONTEXT = `## Shared context
- GOAL: ${goal}
- TARGET: ${targetUrl}
- CLONE STACK: ${stack}
- PROJECT DIR: ${projectDir}
- ${credsLine}
- App insights: ${appInsights}
- Research dir: ${research} | Component specs: ${components} | Design refs: ${designRefs}${skillDir ? `\n- Clone-team skill dir: ${skillDir} (extraction scripts + spec template in ${skillDir}/references/extraction-playbook.md; durable state CLI at ${skillDir}/scripts/state.mjs)` : ''}${leanResources ? `\n- RESOURCE BUDGET (host is memory-constrained; systemd-oomd kills the whole session on sustained pressure): keep AT MOST ONE agent-browser session alive at a time. Reuse a single NAMED session (\`agent-browser --session <slug> ...\`) instead of opening new browsers, and CLOSE it (\`agent-browser close --all\`) the moment you're done — especially BEFORE running \`npm run build\`/vite (each browser is ~4GB). Do NOT spawn sub-builder agents that drive their own browser; build sub-components yourself within the one session. To compare ORIGINAL vs CLONE, do it SEQUENTIALLY in the one session (screenshot the original, navigate to the clone, screenshot it, then diff the images) — never two live browsers at once. Going over budget gets the entire run OOM-killed — staying lean is mandatory, not optional.` : ''}`

const specPrompt = (s) => `${FE_PERSONA}

${CONTEXT}

## Task: EXTRACT then write the SPEC for ONE section — "${s.name}"
You are NOT building yet. Open the target with agent-browser, isolate this section${s.screenshot ? ` (reference screenshot: ${s.screenshot})` : ''}, and extract EVERYTHING a builder needs to reproduce it with zero guessing:
- exact getComputedStyle values for every element (use the per-component extraction script from the extraction playbook),
- the interaction model (scroll vs click vs hover vs time — determine by SCROLLING first, then clicking),
- EVERY state (tabs, scroll thresholds, hovers) with before/after values + transition,
- verbatim text, all assets (including layered/overlay images), responsive behavior at 1440/768/390.
Write the spec to \`${components}/${(s.name || 'section').replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.spec.md\` using the spec template. If the section needs more than ~150 lines of spec, list the sub-components to split it into. Then return the structured result.`

const devPrompt = (s, spec, verdict, lastBuild) => `${FE_PERSONA}

${CONTEXT}

## Task: BUILD section "${s.name}" to pixel-perfection${s.targetFile ? ` into \`${s.targetFile}\`` : ''}
Read the spec at \`${spec?.specPath || (components + '/' + (s.name || 'section').replace(/[^a-z0-9-]/gi, '-').toLowerCase() + '.spec.md')}\` and build EXACTLY to it. Import shared foundation (icons, tokens, cn(), primitives) rather than redefining. Use only assets already downloaded to the project. If you discover the spec is missing a value, extract it live yourself and update the spec. Make build + typecheck pass before reporting.
BUILD IT AS A STANDALONE, SELF-CONSISTENT ARTIFACT — it must be correct on the REAL assembled page, not only inside a preview/test harness: (a) every asset path (images, fonts) must resolve from where \`${s.targetFile || 'this file'}\` ACTUALLY lives in the final page, not relative to a temporary preview wrapper; (b) background and text colors must be correct against the real page background (never rely on a harness bg to make light text visible); (c) spacing/margins must be right where this piece sits in the full page. Verify by loading it the way it ships, not only via a one-off preview file — preview-harness-only correctness is the #1 cause of an "approved" piece breaking on assembly.
${verdict && verdict.verdict === 'NG' ? `\n## This is a FIX round. The Tester returned NG. Address EVERY issue below, with full context of what you built last round:\n### Your previous notes\n${lastBuild?.devNotes || lastBuild?.summary || '(none)'}\n### Tester issues to fix\n${(verdict.issues || []).map((i, n) => `${n + 1}. [${i.severity}] ${i.area}: ${i.description}\n   expected: ${i.expected}\n   actual: ${i.actual}${i.repro ? `\n   repro: ${i.repro}` : ''}`).join('\n')}\n` : ''}
Return the structured build result with honest devNotes.`

const motionPathFor = (s) => `${components}/${(s.name || 'section').replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.motion.md`

const motionAnalysisPrompt = (s, spec) => `${MOTION_ANALYST_PERSONA}

${CONTEXT}

## Task: author the MOTION SPEC for "${s.name}" — so NOTHING animated is missed
You are NOT building. Open the live original with agent-browser and exhaustively catalogue its motion + interaction states, then WRITE the spec to \`${motionPathFor(s)}\`. Use ${skillDir ? skillDir + '/references/motion-playbook.md' : "this skill's references/motion-playbook.md"} for the templates + taxonomy. Cover, with EXACT observed (driven, never guessed) values:
- LOAD / INTRO first: COLD hard-reload and sample the first ~0–2.5s for any preloader / curtain / splash / page-transition overlay (color, structure, duration, exit). A warm browser has already finished it — you WILL miss it without a cold reload.
- STATE MATRIX: for EVERY interactive element (links, buttons, inputs, cards, tabs, accordions, nav, menus) record default/hover/focus/active/loading/disabled/empty/error — what changes + duration/easing. Trigger each: hover, focus via keyboard Tab, click.
- ANIMATED-ELEMENT INVENTORY: enumerate EVERY element that moves and classify each (load-intro / one-shot-entrance / scroll-scrubbed / hover-focus / click-tap / time-loop / continuous-decorative). Scroll in small increments and WAIT >=600ms for async motion to fire before reading. Deliberately hunt the SUBTLE + DECORATIVE: micro-hover shifts, focus rings, and "glittery" continuous motion — shimmer, particles, grain, gradient drift, canvas/WebGL, marquees, looping video. For scroll-scrubbed reveals note split granularity (.line/.word/.char) and the scrollY band + DISTANCE (viewport-heights of pin).
- MOTION TOKENS: distill recurring durations, easings, distances, stagger into a small token set.
- reduced-motion + keyboard-flow notes.
Reference the FE spec at \`${spec?.specPath || ''}\` for element names. Return the structured result, listing in classesPresent every motion class you actually observed.`

const motionDevPrompt = (s, spec, motion, verdict, lastBuild) => `${MOTION_DEV_PERSONA}

${CONTEXT}

## Task: MOTION polish pass on "${s.name}"${s.targetFile ? ` in \`${s.targetFile}\`` : ''} (sequential — AFTER the FE build, BEFORE the gate)
The Frontend Developer has just built/updated this page file. Read the MOTION SPEC at \`${motion?.motionPath || motionPathFor(s)}\` and the FE spec at \`${spec?.specPath || ''}\`, then implement EVERY motion + interaction-state entry the current build is missing or has wrong — WITHOUT changing layout, structure, content, colors, or assets (those are the FE Developer's Tester-approved scope; you ONLY add/repair motion). Wire load-intro curtains, entrances, scroll-scrubbed reveals (split text nodes yourself when needed; match per-element trajectory AND scroll DISTANCE), hover/focus/active/loading states, click feedback, time/loop, and continuous-decorative (shimmer/particles/grain/canvas/marquee). Apply the motion tokens consistently; gate non-essential motion behind \`prefers-reduced-motion: reduce\`; keep keyboard focus visible. DRIVE each behavior in agent-browser and confirm it fires with the right trajectory + cadence + scroll distance. Keep build + typecheck GREEN, and confirm motion still works when the page is SERVED (not file://).
${verdict && verdict.verdict === 'NG' ? `\n## Fix round — the Tester returned NG. Own the MOTION/INTERACTION issues below (leave pure layout/content/color issues to the FE Developer):\n${(verdict.issues || []).map((i, n) => `${n + 1}. [${i.severity}] ${i.area}: ${i.description} (expected: ${i.expected}; actual: ${i.actual})`).join('\n')}\n` : ''}
Return the structured build result: filesWritten, buildPasses, typecheckPasses, and devNotes listing exactly which motion you added/fixed (by inventory entry) and anything you could not reproduce.`

const testPrompt = (s, spec, build) => `${TESTER_PERSONA}

${CONTEXT}

## Task: FULL REGRESSION of section "${s.name}" — gate before it can ship
The Developer reports: ${build?.summary || '(no summary)'} — files: ${(build?.filesWritten || []).join(', ') || '(none)'}.
Reference spec: \`${spec?.specPath || ''}\`. MOTION spec (the animated-element inventory + state matrix authored by the Motion Analyst, then built by the Motion Developer): \`${motionPathFor(s)}\`.
CROSS-CHECK THE MOTION SPEC: every element it inventories MUST animate in the clone — right text/section rendered STATIC where the original animates it is an NG; every state-matrix entry (hover, keyboard focus, active, loading, disabled) must match; and scroll-scrubbed + continuous-decorative ("glittery" shimmer/particles/grain/canvas) motion must be DRIVEN to confirm it fires (a still frame can't prove it). Check the load-intro with a COLD reload.
Run the full regression: open the ORIGINAL and the CLONE side by side via agent-browser at 1440/768/390; diff visually pixel by pixel. For EVERY scroll-/time-/hover-/click-driven behavior, DRIVE it and diff the STATE TRAJECTORY against the original — a static screenshot cannot prove motion (a frozen page looks identical in a still frame). Scroll in increments and read the animated state (transform/height/opacity/active-index/visible image) at each step on both; confirm scrolling actually TRIGGERS the change (image cycling, shape morph, elements animating in from below), with matching trigger thresholds, direction, and easing/cadence — missing or frozen animation is an NG. Confirm build + typecheck pass AND the page runs as SHIPPED (serve a clean copy / static server — a page that needs an uncommitted build artifact or breaks when copied is an NG). Do not rubber-stamp — you are the gate. Return verdict OK only if it is an exact copy; otherwise NG with specific, reproducible issues the Developer can fix directly.
${statePath ? `\n## DURABLE CHECKPOINT (mandatory on OK — do this BEFORE you return)\nThe moment your verdict is OK, run exactly:\n\`node ${statePath} mark-section --dir ${projectDir} --name "${s.name}" --status done --rounds ${'<the round number you approved>'}\`\nThis writes the durable \`done\` marker so a crash or usage-cutoff resumes without redoing this approved section. NEVER run it on NG. This is the single thing that makes the run survivable — do not skip it.\n` : ''}`

const backendPrompt = () => `${BACKEND_PERSONA}

${CONTEXT}

## Task: produce the ARCHITECTURE DOCUMENTATION deliverable (depth: ${backendDepth})
Reverse-engineer how the target system works and document it as \`${research}/ARCHITECTURE.md\` following the backend-doc template structure: overview & purpose, page/route map, observed API & network surface, inferred data model & entities, auth/session flow, state & navigation model, key end-to-end user journeys (step by step), third-party services, and explicit assumptions/unknowns. Use agent-browser to observe real network traffic and flows. ${backendDepth === 'flows' ? 'Stay at UI-observable flows; do not over-infer the data model.' : backendDepth === 'deep' ? 'Go deep: infer the full data model, API contracts, and auth in detail.' : 'Infer the data model and API surface at a reasonable, clearly-flagged level.'} Return the structured doc result.`

const assemblePrompt = (results, finalVerdict, round) => `${FE_PERSONA}

${CONTEXT}

## Task: ASSEMBLE the full page(s) and make the whole clone cohere (round ${round})
All sections are built and Tester-approved individually. Wire them together in the app entry: layout, scroll containers, z-index layering, sticky/fixed overlays, page-level behaviors (scroll-snap, scroll-driven animations, smooth scroll like Lenis), and connect real content. Make the full build pass.
${finalVerdict && finalVerdict.verdict === 'NG' ? `\n## This is a FIX round. The final regression returned NG. Fix EVERY issue:\n${(finalVerdict.issues || []).map((i, n) => `${n + 1}. [${i.severity}] ${i.area}: ${i.description} (expected: ${i.expected}; actual: ${i.actual})`).join('\n')}\n` : ''}
Built sections: ${results.filter(Boolean).map(r => r.section).join(', ')}. Return the structured build result.`

const finalRegressionPrompt = (round) => `${TESTER_PERSONA}

${CONTEXT}

## Task: FINAL FULL-PAGE REGRESSION (round ${round}) — the last automated gate
Open the ORIGINAL and the assembled CLONE side by side via agent-browser. Walk the entire page(s) top to bottom at 1440/768/390. Verify it is an EXACT copy end to end: every section in place, page-level behaviors correct (scroll, sticky headers, transitions, smooth scroll), every flow working, build clean. Return OK only if the whole thing is indistinguishable from the original; otherwise NG with specific, reproducible issues.`

// --- The enforced loop ------------------------------------------------------

log(`clone-team loop starting: ${sections.length} section(s), tier=${cfg.modelTier || 'max-fidelity'}, maxRounds=${maxRounds}`)

async function buildAndVerify(section, idx) {
  if (section.status === 'done') {
    log(`skip (already done): ${section.name}`)
    return { section: section.name, status: 'done', rounds: 0, cached: true }
  }

  // Step 1: extract + spec (skip if the Manager already wrote one).
  // Note: agents carry an explicit `phase:` in opts — we deliberately do NOT
  // call the global phase() here, since this function runs concurrently across
  // sections and the global phase state would race.
  let spec = section.specPath ? { specPath: section.specPath, sectionName: section.name } : null
  if (!spec) {
    spec = await agent(specPrompt(section), { label: `spec:${section.name}`, phase: 'Spec & Build', schema: SPEC_SCHEMA, model: M.extract })
  }

  // Step 1.5: MOTION ANALYSIS — author the motion spec ONCE per section (the
  // state matrix + animated-element inventory the Motion Developer builds from
  // and the Tester gates against). Resumable: skip if the Manager pre-wrote one.
  let motion = section.motionPath ? { motionPath: section.motionPath } : null
  if (!motion) {
    motion = await agent(motionAnalysisPrompt(section, spec), { label: `motion-analyze:${section.name}`, phase: 'Motion', schema: MOTION_SCHEMA, model: M.motion })
  }

  let round = 0, verdict = null, lastBuild = null

  // RE-VALIDATE PATH (status 'built'): a section whose targetFile already exists
  // on disk but was never Tester-approved — e.g. a prior run was killed mid-fix,
  // or a cross-session resume. Lead with the GATE, not a rebuild: re-running the
  // Developer first would throw away a possibly-good file and burn a whole round.
  // Test the existing build; only enter the fix loop if it comes back NG (and
  // seed that loop with the verdict so round 1 is a targeted fix, not a rewrite).
  if (section.status === 'built') {
    verdict = await agent(
      testPrompt(section, spec, { summary: 'pre-existing build from a prior run — re-validating before any rebuild', filesWritten: section.targetFile ? [section.targetFile] : [] }),
      { label: `revalidate:${section.name}`, phase: 'Regression', schema: VERDICT_SCHEMA, model: M.tester }
    )
    if (verdict.verdict === 'OK') {
      log(`OK ${section.name} (re-validated existing build — 0 build rounds)`)
      return { section: section.name, status: 'pass', rounds: 0, spec, build: null, verdict, revalidated: true }
    }
    log(`NG ${section.name} re-validation: ${(verdict.issues || []).length} issue(s) — entering fix loop`)
  }

  // Steps 2-4: develop -> full-regression-test -> fix, until OK or cap.
  while (round < maxRounds) {
    round++
    lastBuild = await agent(devPrompt(section, spec, verdict, lastBuild), { label: `dev:${section.name}#${round}`, phase: 'Spec & Build', schema: BUILD_SCHEMA, model: M.dev })
    // MOTION pass: a sequential specialist edit of the SAME file, right after the
    // FE build and BEFORE the gate — so motion is always the last writer and
    // survives FE fix rounds (the FE dev may rebuild structure each round; the
    // Motion Developer re-applies/repairs motion on top every time).
    await agent(motionDevPrompt(section, spec, motion, verdict, lastBuild), { label: `motion-dev:${section.name}#${round}`, phase: 'Motion', schema: BUILD_SCHEMA, model: M.motion })
    verdict = await agent(testPrompt(section, spec, lastBuild), { label: `test:${section.name}#${round}`, phase: 'Regression', schema: VERDICT_SCHEMA, model: M.tester })
    if (verdict.verdict === 'OK') {
      log(`OK ${section.name} (round ${round})`)
      return { section: section.name, status: 'pass', rounds: round, spec, build: lastBuild, verdict }
    }
    log(`NG ${section.name} round ${round}: ${(verdict.issues || []).length} issue(s)`)
  }
  log(`FLAGGED ${section.name}: hit round cap (${maxRounds}) — needs Manager attention`)
  return { section: section.name, status: 'flagged', rounds: round, spec, build: lastBuild, lastVerdict: verdict }
}

// The backend documentation track. It drives its OWN browser, so on a host that
// budgets only 1 concurrent browser it MUST run serially (after the sections),
// not concurrently — otherwise section-browser + backend-browser = 2 live
// browsers and the run gets OOM-killed. serialBackend enforces that.
const runBackend = () => backendDepth === 'none'
  ? Promise.resolve(null)
  : agent(backendPrompt(), { label: 'backend-architect', phase: 'Backend Docs', schema: DOC_SCHEMA, model: M.backend })

// Sections build in WAVES of `waveSize` (each section runs its own enforced
// dev/tester loop). Waves run sequentially; within a wave, sections are parallel.
// This caps peak load on constrained hosts and checkpoints progress between waves
// (each passing section is Tester-marked `done`, so a crash resumes cleanly).
async function buildInWaves(items) {
  const out = []
  const total = Math.ceil(items.length / waveSize)
  for (let w = 0; w * waveSize < items.length; w++) {
    const chunk = items.slice(w * waveSize, w * waveSize + waveSize)
    if (waveSize < items.length) log(`wave ${w + 1}/${total}: ${chunk.map(s => s.name).join(', ')}`)
    const res = await pipeline(chunk, (section, _orig, j) => buildAndVerify(section, w * waveSize + j))
    out.push(...res)
  }
  return out
}

let sectionResults, backendDoc
if (serialBackend) {
  log('Backend docs run SERIALLY after sections (resource budget = 1 concurrent browser).')
  sectionResults = await buildInWaves(sections)
  backendDoc = await runBackend()
} else {
  // Capable host: sections and the backend track run concurrently.
  ;[sectionResults, backendDoc] = await Promise.all([buildInWaves(sections), runBackend()])
}

const passed = sectionResults.filter(r => r && (r.status === 'pass' || r.status === 'done'))
const flagged = sectionResults.filter(r => r && r.status === 'flagged')
log(`sections complete: ${passed.length} passed, ${flagged.length} flagged`)

// Assemble -> final regression -> fix (enforced). Run ONLY when at least one
// section actually passed AND nothing is still flagged. The `passed.length > 0`
// guard is deliberate: assembling with zero built sections is never a valid
// "done" — it is a misfire, and must not reach the final-regression gate.
let finalVerdict = null, finalRound = 0, assembly = null
if (skipAssembly) {
  log(`Assembly skipped (buildOnly): ${passed.length} section(s) passed, ${flagged.length} flagged. The Manager assembles + final-regresses in Phase 3.`)
} else if (passed.length > 0 && flagged.length === 0) {
  while (finalRound < finalCap) {
    finalRound++
    assembly = await agent(assemblePrompt(sectionResults, finalVerdict, finalRound), { label: `assemble#${finalRound}`, phase: 'Assemble & Final Regression', schema: BUILD_SCHEMA, model: M.dev })
    finalVerdict = await agent(finalRegressionPrompt(finalRound), { label: `final-regression#${finalRound}`, phase: 'Assemble & Final Regression', schema: VERDICT_SCHEMA, model: M.tester })
    if (finalVerdict.verdict === 'OK') { log('FINAL REGRESSION: OK'); break }
    log(`FINAL REGRESSION round ${finalRound}: NG (${(finalVerdict.issues || []).length} issue(s))`)
  }
} else if (passed.length === 0) {
  log('Skipping assembly — ZERO sections passed the Tester gate. Nothing to assemble; this run produced no shippable section (check section build logs).')
} else {
  log(`Skipping assembly — ${flagged.length} flagged section(s) must be resolved by the Manager first: ${flagged.map(f => f.section).join(', ')}.`)
}

return {
  summary: {
    sections: sectionResults.length,
    passed: passed.length,
    flagged: flagged.map(f => f.section),
    finalVerdict: finalVerdict?.verdict || 'not-run',
    backendCoverage: backendDoc?.coverage || (backendDepth === 'none' ? 'skipped' : 'unknown'),
  },
  sectionResults,
  backendDoc,
  finalVerdict,
  assembly,
}
