# Rubric App V.2 — Design System

> **See also**: a Master Design System for all Rubric App projects and Google-integrated apps was
> once linked here at `../../.claude/DESIGN_SYSTEM.md`. No such file exists in or above this
> repository, so this document is the whole of the standard — anything the link was carrying has
> to be written down here or it is not written down anywhere.

## Color & Contrast

### Text on White/Light Backgrounds

**WCAG AA Compliance Required** — all body text must meet WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text).

#### Never Use (Too Light)
- ❌ `text-gray-400` — **2.54:1**. Fails even the 3:1 large-text floor. Disabled UI only.
- ❌ `text-gray-500` — **4.83:1**. Clears the 4.5:1 body floor by a hair, with no margin for
  anti-aliasing or a tinted background. Use `text-gray-600`.
- ❌ `text-blue-400` — **2.54:1**.
- ❌ `text-blue-500` — **3.68:1**. Fails body text; passes only as large text or a UI boundary.

#### Always Use (Sufficient Contrast)
- ✅ `text-gray-600` — **7.56:1** (**body text, descriptions, secondary info**)
- ✅ `text-gray-700` — **10.31:1** (**body text, labels, highlights**)
- ✅ `text-gray-800` — **14.68:1** (**emphasis, important labels**)
- ✅ `text-gray-900` — **17.74:1** (**headings, primary content, strong emphasis**)
- ✅ `text-blue-600` — **5.17:1** (links and interactive text)
- ✅ `text-blue-700` — **6.70:1** (links needing more weight)

> **These figures were re-measured in September 2026 and three were wrong.** The originals had
> `text-gray-400` at 5.3:1 (it is 2.54:1 — the problem was twice as bad as stated),
> `text-gray-500` at 5.8:1 (it is 4.83:1), and brand blue at 3.95:1 (it is 10.60:1 — see below).
> Anything waved through on the strength of the old numbers is worth re-checking.
>
> To reproduce any of these, use the WCAG relative-luminance formula:
> linearise each sRGB channel (`c/12.92` when `c ≤ 0.03928`, else `((c+0.055)/1.055) ** 2.4`),
> weight them `0.2126 R + 0.7152 G + 0.0722 B`, then `(lighter + 0.05) / (darker + 0.05)`.

### Green on Green

Status panels are `bg-green-50`. The text on them:

- ❌ `text-green-700` — **4.79:1**. Passes the 4.5:1 body floor by 0.29, which is the same margin
  this file already rejects for `text-gray-500` (4.83:1). It was used for every line of body copy
  in those panels until October 2026.
- ✅ `text-green-800` — **6.81:1** (body copy on a green panel)
- ✅ `text-green-900` — **8.70:1** (the bold first line)
- `text-green-600` — **3.15:1**, which is fine for the tick *icon* and nothing else: 3:1 is the
  floor for a non-text graphic, not for words.

The same holds for amber: `text-amber-900` on `bg-amber-50` is **8.75:1**, and `text-amber-600`
at **3.07:1** is the icon colour only.

### Brand Blue (`#0033a0`)
- **10.60:1 on white** — comfortably passes WCAG AA and AAA for body text.
- Safe for headings, body text, links and active/selected states alike.
- An earlier version of this file gave 3.95:1 and said "NOT for body text". That was wrong, and
  it meant the brand colour was being avoided for no reason.

### Dark Backgrounds
The ratios above are against white. On `bg-gray-900` the scale inverts and the light-background
rules do not carry over:
- ❌ `text-gray-600` on `bg-gray-900` — **2.35:1**
- ❌ `text-gray-500` on `bg-gray-900` — **3.67:1**
- ✅ `text-gray-300` on `bg-gray-900` — **12.04:1**

### Emphasis Text
- Use `font-bold` + `text-gray-900` for inline emphasis (e.g., "full rubric")
- **Never** use color alone to highlight text on white backgrounds

## Typography

### Heading Hierarchy
- **h1** (page titles) — `text-2xl font-black text-gray-900`
- **h2** (section headers) — `text-lg font-bold text-gray-900`
- **h3** (subsections) — `text-base font-bold text-gray-900`
- **labels** — `text-sm font-bold text-gray-900` or `text-gray-700`
- **body** — `text-sm text-gray-700`
- **small text** (captions, hints) — `text-xs text-gray-600`

## Components

### Tabs (Active State)
```
border-[#0033a0] text-[#0033a0]
```
Inactive tabs use `text-gray-600 hover:text-gray-900`

### Form Inputs
- Border: `border-gray-300`
- Focus: `focus:ring-2 focus:ring-blue-500 outline-none`
- Label: `text-sm font-bold text-gray-900`
- Placeholder: `text-gray-500` (disabled state is acceptable here)

### Buttons

- **Primary**: `bg-brand text-white hover:bg-brand-dark` — `#0033a0`, hover `#002d8f`
- **Secondary**: `bg-gray-100 text-gray-900 hover:bg-gray-200`
- **Tertiary**: `bg-white border border-gray-300 text-gray-700 hover:bg-gray-50`
- **Disabled**: `bg-gray-200 text-gray-700` — 6.08:1

> The disabled pair used to read `bg-gray-200 text-gray-500`, which is 3.90:1, and most buttons
> in the app were not even doing that: `disabled:bg-gray-300` with no text colour at all left a
> white label on light grey at **1.47:1**, so a disabled primary button lost the word saying what
> it would do. (`disabled:text-gray-400` on `bg-gray-300` was 1.72:1 — no better.) WCAG exempts
> text in a genuinely inactive control, so none of those were strictly failures; they were
> unreadable all the same, and the exemption lapses the moment a control becomes `aria-disabled`,
> which stays focusable and therefore active.

**Use `aria-disabled`, not `disabled`, wherever the button has a reason worth reading.** A
`disabled` button leaves the tab order, so a keyboard user never reaches it, never learns why it
is off, and cannot trigger a `title` tooltip carrying the explanation. The handler returns early
instead, the reason is a real paragraph with an `id`, and the button points at it with
`aria-describedby`. Styling hangs off `aria-disabled:` variants. `title` is not a carrier for
anything that matters — screen readers expose it inconsistently even on a reachable control.

### Non-text contrast

A border that is the only thing marking a control as a control needs **3:1**, not a hairline:

| Border | On white | Verdict |
|---|---|---|
| `border-gray-200` | 1.24:1 | invisible — the default `border` class resolves to this |
| `border-gray-300` | 1.47:1 | no |
| `border-gray-400` | 2.54:1 | still short |
| `border-gray-500` | 4.83:1 | **use this** |

The same floor applies to a focus indicator. `focus:border-blue-400` (2.54:1) is not one; pair
`focus:outline-none` with `focus-visible:ring-2 focus-visible:ring-brand ring-offset-2` (10.60:1)
and leave the border saying whatever it was saying about validity.

**Exactly one primary per action group.** A row of buttons has one blue; everything beside it is
secondary or tertiary. Two blues in a row means neither is the answer.

**Primary is the only colour an action takes.** There is no green "go" button, no separate colour
for deploy, download or confirm. If a button means yes, continue, execute, generate, deploy or
save, it is `bg-brand` — whatever the verb on it says.

> This used to read `bg-blue-600 text-white hover:bg-blue-700`, and the app had grown three action
> colours: `bg-blue-600` through Parts 1–3, `bg-[#0033a0]` on the Dashboard and in the Drive
> browser, and `bg-green-700` on eight buttons that happened to mean "go" — Deploy Now, Deploy
> Displayed Rubric, Use this version and deploy, Yes please, and the downloads in Part 2. Nothing
> distinguished the green ones; they were the same kind of action as the blue ones next to them.
>
> `#0033a0` is the resolved value because it is already this app's title bar and header colour,
> and because Canvas Extractor Tools uses it as its single action colour with no `blue-600`
> anywhere. The two apps are used by the same people on the same day, so a button that is nearly
> the same in both is worse than one that is identical.

**Purple is the one reserved colour**, and it is never a button fill. It borders AI-proposed
content that no person has approved yet — the CSV repair panel is the only use today. The point is
that a proposal must not be mistakable for a verified result; the control that *requests* the
proposal is an ordinary action and takes `bg-brand` like any other.

Green, amber and red stay **status** colours — a dot that says done, a bar that says failed, the
tint behind a success message. Never the fill of a button the user is meant to press.

### Icons

#### "Add to Drive" Button — Inline SVG Required
⚠️ **DO NOT use external Google Material Symbols CDN** — the "add_to_drive" icon doesn't exist at that URL (returns 404).

**Correct Implementation** — Use inline SVG with Google Drive logo (from V.1):
```jsx
<svg className="w-5 h-5 flex-shrink-0" viewBox="0 -960 960 960" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M220-100q-17 0-34.5-10.5T160-135L60-310q-8-14-8-34.5t8-34.5l260-446q8-14 25.5-24.5T380-860h200q17 0 34.5 10.5T640-825l182 312q-23-6-47.5-8t-48.5 2L574-780H386L132-344l94 164h316q11 23 25.5 43t33.5 37H220Zm70-180-29-51 183-319h72l101 176q-17 13-31.5 28.5T560-413l-80-139-110 192h164q-7 19-10.5 39t-3.5 41H290Zm430 160v-120H600v-80h120v-120h80v120h120v80H800v120h-80Z"/>
</svg>
```

**Why inline SVG?**
- Eliminates external CDN dependency
- `fill="currentColor"` automatically inherits button text color (white on green, gray on white, etc.)
- No filters needed — more reliable across browsers
- Matches V.1 implementation

#### All Other Icons
- Use lucide-react library (`CheckCircle2`, `Loader2`, `RotateCw`, `Clock`, `X`, etc.)
- **Icon colors**: Must meet same contrast rules as text — use `text-gray-700` or darker for body, `text-blue-600` for accent, `text-green-600` for success

### Error/Status Messages
- Error text: `text-red-700` (or `text-red-600` on white)
- Success: `text-green-700`
- Warning: `text-yellow-700`

## Checklist Before Commit

When adding new UI elements:
- [ ] All body text is `text-gray-600` or darker
- [ ] No `text-gray-400` or `text-gray-500` except for disabled states
- [ ] Inline emphasis uses `font-bold` + `text-gray-900`, not color
- [ ] Headings are `text-gray-900`
- [ ] Forms follow button/input patterns above
- [ ] Color contrast meets WCAG AA (4.5:1 minimum for normal text)
- [ ] Icon colors meet contrast requirements (use `text-gray-700` or darker for body content)
- [ ] "Add to Drive" button uses **inline SVG** with Google Drive logo (see Icons section), NOT external CDN
- [ ] All lucide-react icons match the color scheme (no light colors like `text-gray-400`)

Run this contrast check: [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
