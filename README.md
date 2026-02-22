# Plant Discovery (App + Backend)

Expo mobile app + Node backend for plant identification from photos, botanical knowledge lookup, and narrative generation.

## What it includes

- Species identification with PlantNet (server-side upload)
- Optional disease analysis with HF model
- Real botanical knowledge retrieval from:
  - Wikipedia (summary)
  - GBIF taxonomy match API
- Narrative generation with HF chat model
- Final plant card sections:
  - Description
  - History
  - Habitat
  - Toxicity
  - Care
  - Fun facts
- Language selection (IT / EN / ES)
- Camera capture
- Image upload
- Offline caching of previous analysis results (new analyses require internet)
- Searchable history list
- Shareable plant card
- Calm botanical card-based UI with confidence and alternatives

## 1) Backend Setup

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

Backend runs on `http://localhost:8080` by default.

Required backend env:
- `PLANTNET_API_KEY`
- `HUGGINGFACE_TOKEN` (optional but recommended for disease/narrative)

## 2) Mobile Setup

```bash
cd ..
npm install
cp .env.example .env
npm run start
```

Open in Expo Go or run with simulator/device.

Note: the app normalizes captured/uploaded photos to JPEG before analysis to improve PlantNet compatibility on iOS formats (HEIC/Live Photo variants).

Mobile env:
- `EXPO_PUBLIC_BACKEND_URL` (example: `http://192.168.1.10:8080` on same Wi-Fi)

## Architecture

- `server/src/index.js`: backend API (`/health`, `/identify`)
- `src/services/pipeline.ts`: mobile -> backend pipeline client
- `src/storage/cache.ts`: offline result cache
- `src/storage/history.ts`: searchable identification history
- `App.tsx`: mobile UI and interactions
