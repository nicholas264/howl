# Campfire application theme

`src/theme.css` owns the authenticated app's typography, palette, navigation, focus states, and shared controls. The CRM is the visual baseline. Load this stylesheet with the app shell, not through a feature's lazy import.

Use `--ui-font`, `--ui-canvas`, `--ui-surface`, `--ui-soft`, `--ui-border`, `--ui-border-strong`, `--ui-ink`, `--ui-muted`, `--ui-subtle`, `--ui-accent`, `--ui-accent-soft`, and `--ui-accent-border`. Existing `--surface`, `--text`, and `--flame` aliases resolve to this same palette. Component CSS should own layout and semantic status/series colors, not a competing page theme.

Legacy shared styles use fallback values so public application pages keep their branding. Ad drawing functions, brand constants, and exported artwork retain their original fonts and colors. Only editor controls inherit the application theme.

Validation: full application checks plus desktop navigation through CRM, Financials, Organization, Home, Creators, Static Studio, and Image Ads; mobile CRM/Financials switching at 390px. Isolated preview uses synthetic data and mocks Clerk hooks only in its Vite plugin; production authentication is unchanged.
