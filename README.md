# SentiTrader AI - Market Analysis Terminal.
Author: SentiTraderAI- Dev.Team-Amiram Azulay (https://aistudio.google.com|Gemini3-Pro)

**Version:** SentiTraderAIBeta0.3

![React](https://img.shields.io/badge/React-19-blue?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.2-blue?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-Bundler-646CFF?logo=vite)
![Gemini](https://img.shields.io/badge/AI-Gemini_3_Flash-8E75B2?logo=google)
![License](https://img.shields.io/badge/License-Apache_2.0-green)

## 1. Executive Summary

SentiTrader AI is a high-performance, multimodal financial terminal designed to democratize sophisticated market analysis. It bridges the gap between raw data ingestion and actionable intelligence by combining high-frequency charting with Google Gemini 3's multimodal reasoning. The application successfully manages complex state synchronization across disparate asset classes (Crypto/Stocks) while maintaining a sub-500ms UI latency profile.

## 2. System Architecture

The system follows a **Decoupled Service-Oriented Architecture (DSOA)** within a React Single Page Application (SPA) framework.

### Core Principles
*   **Master-Slave Sync Model**: `App.tsx` serves as the Global State Authority, while services act as specialized transport layers.
*   **Hybrid Data Pipeline**:
    *   **Crypto**: Native WebSockets via Binance (Push-based).
    *   **Stocks**: Advanced Sequential Polling via Yahoo Finance (Pull-based) with "Cache-Busting" and "Recursive Timeouts" to prevent request stacking.[best-practice-10,000ms]
*   **Multimodal AI**: Integrates Google GenAI SDK (`gemini-3-pro-preview`) to perform visual forensic analysis on canvas snapshots and sentiment simulation.

## 3. Data Sources & Handling

### A. Crypto Environment
*   **Source**: Binance Public API & WebSockets (`wss://stream.binance.com:9443`).
*   **Mechanism**: Real-time streaming using `kline` (candlestick) and `miniTicker` streams.
*   **Handling**: Updates are pushed directly to the chart with <100ms latency. Buckets anchor to UTC standards.

### B. Stocks Environment
*   **Source**: Yahoo Finance via Proxy Rotation- allorigins | corsproxy.io | thingproxy.
*   **Mechanism**: High-frequency Sequential Polling [for optimized Performance 10,000ms].
*   **Robust Fetching**:
    *   **Cache-Busting**: Appends a unique nonce (`cb=Date.now()`) to every request to bypass proxy caching ("Zombie Data").[robustFetchJson-cb=timestamp]
    *   **Sequential Logic**: Uses recursive `setTimeout` instead of `setInterval` to ensure Request(n+1) only starts after Request(n) completes, eliminating "220s Lag" / browser thread exhaustion.
*   **Mid-Bucket Merge**: The app performs "In-Flight" candle construction, merging real-time ticks into historical buckets to maintain high/low wicks across all timeframes.
*   **Session Awareness**: Strictly adheres to Regular Trading Hours (RTH). Pre-Market and After-Hours data is handled via specific logic in `marketDataService.ts` and `timeUtils.ts`.

## 4. Timeframe & Timestamp Logic

The application implements rigorous time management to ensure institutional accuracy:

*   **Intraday (1m - 4h)**: Uses Unix epoch anchoring to ensure candles start exactly at :00, :15, :30, etc.
*   **Daily/Weekly**: Anchors to Exchange Time (New York for Stocks, UTC for Crypto).
*   **Backward Timer**: A countdown mechanism that intelligently snaps to market close events. If the market closes at 16:00 ET, the 4H candle timer stops at 16:00, not 18:00.
*   **Drift Detection**: The Debug Engine monitors the delta between the *Exchange Timestamp* (source) and *System Wall Clock* to flag latency or data staleness.

## 5. File Structure & Component Correlation

```
/
├── index.html                  # Entry point, styles, Tailwind config, Importmap
├── index.tsx                   # Mounts App component
├── App.tsx                     # CORE: Global State, Data Subscriptions, Layout
├── types.ts                    # TypeScript Definitions (contracts between modules)
├── constants.ts                # Initial Asset Lists
├── components/
│   ├── ChartContainer.tsx      # VISUALIZATION: Lightweight-Charts, Markers, Debug Overlay
│   ├── Watchlist.tsx           # SIDEBAR: Asset management, drag-and-drop
│   ├── AIAnalyst.tsx           # INTELLIGENCE: Gemini Chat & Report UI
│   ├── IndicatorSelector.tsx   # UI: Technical Indicator toggles
│   └── TimeframeSelector.tsx   # UI: Timeframe toggles
├── services/
│   ├── marketDataService.ts    # TRANSPORT: Fetch logic, WebSockets, Polling engines
│   └── geminiService.ts        # AI: Prompt engineering, GenAI SDK integration
└── utils/
    ├── technicalAnalysis.ts    # MATH: Indicators (SMC, RSI, Patterns) calculation
    └── timeUtils.ts            # LOGIC: RTH sessions, intervals, countdowns
```

### Component Correlation
1.  **App.tsx** initializes `marketDataService`.
2.  **marketDataService** feeds raw ticks to `App.tsx`.
3.  **App.tsx** normalizes data and passes it to `utils/technicalAnalysis.ts`.
4.  **technicalAnalysis.ts** enriches candles with indicators (SMA, SMC, etc.).
5.  **ChartContainer.tsx** renders the enriched data and provides visual snapshots.
6.  **AIAnalyst.tsx** consumes the snapshot + data to generate reports via `geminiService.ts`.

##TBD##-indicators SMC,DIVERGENCE,PATTERNS -do not Display in Lightweight Charts™-V5.

## 6. How to Run (e.g. VS Code)

### Prerequisites
*   Node.js (v18+ recommended)
*   VS Code

### Setup
1.  **Clone/Open** the project folder in VS Code.
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
3.  **Environment Variables**:
    Create a `.env` file in the root directory:
    ```env
    GEMINI_API_KEY=your_google_genai_api_key_here
    ```
4.  **Run Development Server**:
    ```bash
    npm run dev
    ```
5.  **Build for Production**:
    ```bash
    npm run build
    ```
   **Run Locally:**
    Option 1: Quick local check
    npm install -g serve
    serve dist
    Option 2: Using npx (no global install)
    npx serve dist
    Option 3: Preview mode (Vite / modern setups)
    npm run preview

## 7. PWA & Deployment Guide

### Progressive Web App (PWA)
To enable PWA capabilities (installable app):
1.  **Manifest**: Create `public/manifest.json` with app icons, name, and `display: standalone`.
2.  **Service Worker**: Register a service worker in `index.html` to cache assets (offline support).
3.  **Vite Config**: Use `vite-plugin-pwa` for automated generation.

### Deploy to GitHub Pages
1.  **Update `vite.config.ts`**:
    Set the base path to your repository name:
    ```typescript
    base: '/your-repo-name/',
    ```
2.  **Build**: Run `npm run build`.
3.  **Deploy**: Upload the contents of the `dist/` folder to a `gh-pages` branch or configure GitHub Actions to deploy from `dist/`.

## 8. Attribution & Credits

**Charting Library**:
TradingView's Lightweight Charts™
Copyright (c) 2023 TradingView, Inc.
Licensed under the Apache License, Version 2.0.

**Signed:**
Author: SentiTraderAI- Dev.Team-Amiram Azulay (https://aistudio.google.com|Gemini3-Pro)
