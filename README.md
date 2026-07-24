# АМЦ - Академический Медицинский Центр (redesign)

Modern redesign concept of sad56.ru (Академический Медицинский Центр, Санкт-Петербург) built as a fast static site. Original brand palette and all original content preserved; the layout, typography and interactions are fully redesigned.

## Pages

- `index.html` - main landing: hero, stats, advantages, history, doctors, clinic gallery, reviews, prices summary, FAQ, quit-smoking CTA, contacts with map
- `price-and-services.html` - full price list (grouped tables)
- `smoke.html` - quit-smoking program: course, steps, reviews, FAQ

## Stack

- Pure HTML + CSS + vanilla JS, no build step
- Raleway (Google Fonts), brand colors: coral `#f5553f`, emblem red `#e20016`, violet `#671cfd`, ink `#101010`, soft `#f1f5fc`
- Scroll-reveal via IntersectionObserver, accessible FAQ accordion, callback modal, a11y mode (larger text) with localStorage persistence
- `prefers-reduced-motion` respected, semantic markup, keyboard-friendly focus states

## Run locally

Any static server works:

```bash
npx serve .
# or
python3 -m http.server 8080
```

## Notes

- Doctor and clinic photos are from the original site (Wayback Machine archive).
- The callback form is front-end only (demo success state); wire it to a backend or service before production use.
