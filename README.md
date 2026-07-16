# PortfolioIQ — Share Portfolio Tracker

Production-grade investment analytics: live prices, time-adjusted ROI, risk classification, Thai/Asian stocks.

---

## Deploy to Render (free)

### 1. Push to GitHub first

```bash
cd "/Users/focus/Desktop/Claude /Share market tracking system"
git init
git add .
git commit -m "Initial commit"
# Create a repo on github.com then:
git remote add origin https://github.com/YOUR_USERNAME/portfolio-tracker.git
git push -u origin main
```

### 2. Deploy on Render

1. Go to **render.com** → sign in
2. Click **New → Blueprint**
3. Connect your GitHub repo
4. Render reads `render.yaml` and automatically creates:
   - **PostgreSQL database** (free)
   - **Backend API** web service (Node.js, free)
   - **Frontend** static site (React, free)
5. Click **Apply** — done. Render builds and deploys everything.

**Important:** After deploy, go to the `portfolio-tracker-ui` service settings on Render and set:
- `VITE_API_URL` = the URL of your `portfolio-tracker-api` service (e.g. `https://portfolio-tracker-api.onrender.com`)

Then trigger a **Manual Deploy** on the frontend to rebuild with that env var.

---

## Run locally

### Requires Node.js (download from nodejs.org if not installed)

```bash
cd "/Users/focus/Desktop/Claude /Share market tracking system"
./start.sh
```

Open **http://localhost:5173**

For local dev, create `backend/.env`:
```
PORT=3001
DATABASE_URL=postgresql://localhost:5432/portfolio
JWT_SECRET=any-long-random-string
```

---

## How prices work

| What | How often |
|---|---|
| Frontend auto-refresh | Every **60 seconds** while page is open |
| Backend background job | Every **5 minutes** pre-fetches all tickers |
| In-memory cache | 5 minutes (avoids hitting Yahoo too often) |
| DB fallback | If Yahoo is down, last known price is used |

---

## Supported Exchanges

| Exchange | Code | Example ticker |
|---|---|---|
| London Stock Exchange | LSE | LLOY |
| New York Stock Exchange | NYSE | JPM |
| NASDAQ | NASDAQ | AAPL |
| **Stock Exchange of Thailand** | **SET** | **PTT** |
| Market for Alternative Investment | MAI | — |
| Singapore Exchange | SGX | D05 |
| Hong Kong Exchange | HKEX | 0700 |
| Tokyo Stock Exchange | TSE | 7203 |
| Korea Exchange | KRX | 005930 |
| Toronto Stock Exchange | TSX | RY |
| Australian Securities Exchange | ASX | CBA |

---

## Project Structure

```
├── render.yaml           Render deployment blueprint
├── backend/
│   ├── src/
│   │   ├── db/schema.js       PostgreSQL schema + init
│   │   ├── routes/            auth, platforms, transactions, prices
│   │   ├── services/
│   │   │   ├── priceService.js    Yahoo Finance + 5-min background refresh
│   │   │   └── analyticsService.js  ROI + aggregations
│   │   └── middleware/auth.js JWT
│   └── package.json
└── frontend/
    ├── src/
    │   ├── hooks/useAutoRefresh.js  60-second polling hook
    │   ├── pages/                   Dashboard, Transactions, Platforms, Risk
    │   ├── components/              KPICard, RiskBadge, Layout
    │   └── services/api.js
    └── vite.config.js
```
