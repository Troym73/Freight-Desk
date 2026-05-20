# FreightDesk AI — Fide Freight

An AI-powered freight quoting and brokerage management tool built for Fide Freight's internal team. FreightDesk streamlines the rate quoting process, automates mileage calculations, and gives brokers a full suite of tools to manage their day-to-day operations.

**Live app:** [fidefreight-freightdesk.netlify.app](https://fidefreight-freightdesk.netlify.app)

---

## What It Does

**Rate & Quote**
- Google Maps autocomplete for pickup and delivery cities
- Auto-calculates exact truck routing miles via Google Routes API
- Supports multi-stop loads (up to 8 stops)
- Pulls DAT RateView data and blends with Truckstop posted rates
- Calculates quote to shipper, carrier pay, and gross margin
- AI-powered quote recommendations via Claude (Anthropic)

**Broker Tools**
- Detention calculator
- TONU (Truck Order Not Used) calculator
- Layover calculator
- AI carrier email generator
- Freight dimensions lookup for oversized/specialized equipment

**My Quotes**
- Save quotes to a personal history
- Mark loads as Won or Lost
- Track win rate, revenue, and margin over time
- Reopen any saved quote to edit and recalculate

**Admin Dashboard**
- Full team performance overview
- Per-broker quote history and stats
- User management
- Revenue quoted vs revenue won tracking

**AI Assistant**
- Built-in freight brokerage chat assistant
- Answers questions on HOS rules, carrier vetting, BOL requirements, cargo claims, detention, and more

---

## Built With

- **Frontend** — HTML, CSS, vanilla JavaScript (single file, no framework)
- **Backend** — Netlify Serverless Functions (Node.js)
- **Database** — Supabase (PostgreSQL)
- **APIs** — Google Maps Places API, Google Routes API, Anthropic Claude API
- **Auth** — Supabase Auth (email/password)
- **Hosting** — Netlify

---

## Architecture

The app is a single `index.html` file that talks to two Netlify serverless functions:

- `maps.js` — handles city autocomplete and mileage calculations via Google APIs
- `claude.js` — handles all AI features via Anthropic's Claude API

All API keys are stored as environment variables in Netlify and never exposed to the browser. User data and quotes are stored in Supabase with row-level security so brokers only see their own data.

---

## Features In Progress

- Mobile responsive layout
- Load tracking after booking
- Carrier database
- Rate history charts

---

*Built by Troy M. — Fide Freight, Grand Rapids MI*
