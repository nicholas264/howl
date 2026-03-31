# HOWL Ad Engine — Local Install

## Setup with Claude Code (30 seconds)

Open Claude Code in your terminal and run:

```
claude "Set up this project: npm install, then copy .env.example to .env and tell me to add my API key"
```

Or do it manually:

```bash
cd howl-ad-engine
npm install
cp .env.example .env
```

Then open `.env` and paste your Anthropic API key (get one at https://console.anthropic.com/settings/keys).

## Run

```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

## How It Works

- The Vite dev server proxies API calls through `localhost` so your API key never touches the browser
- All HOWL product data, 7 review-mined creative angles, 6 customer avatars, and the swipe file are baked into the system prompt
- Export CSV → paste into Google Sheet → sync to Figma templates → batch export PNGs

## Updating

To update the ad engine (add products, change angles, update pricing), just edit `src/App.jsx`. The product data, angles, avatars, and system prompt are all clearly labeled at the top of the file.
