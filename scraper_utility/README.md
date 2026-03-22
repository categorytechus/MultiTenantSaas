# Web Scraper Utility

A generic, configurable web scraper that collects articles, summaries, and PDFs on **any topic** using DuckDuckGo search. Driven entirely by `config.json` — no hardcoded topics, domains, or queries.

Designed to be used as a pluggable utility by AI agents in the Multi-Tenant SaaS platform.

---

## Project Structure

```
scraper_utility/
│
├── scraper.py           ← main script
├── config.json          ← all inputs defined here
├── credentials.txt      ← optional login credentials
├── requirements.txt     ← dependencies
├── README.md            ← this file
│
└── output/              ← generated on run
    ├── results.csv
    ├── results.json
    └── pdfs/
```

---

## Quickstart

**1. Install dependencies**
```bash
pip install -r requirements.txt
```

**2. Edit config.json** with your topic and queries

**3. Run**
```bash
python scraper.py
```

Or with a custom config file:
```bash
python scraper.py --config finance_config.json
```

---

## config.json

### Required fields

| Field | Type | Description |
|-------|------|-------------|
| `topic` | string | The subject being researched (e.g. `"PeopleSoft payroll"`) |
| `queries` | array | List of `{label, query}` objects |

### Optional fields (have defaults if omitted)

| Field | Default | Description |
|-------|---------|-------------|
| `max_results` | `8` | DuckDuckGo results per query |
| `summary_lines` | `3` | Sentences in each LSA summary |
| `request_delay` | `1.5` | Seconds between page requests |
| `query_delay` | `4.0` | Seconds between DDG queries |
| `output_folder` | `"output"` | Where CSV, JSON, and PDFs are saved |
| `credentials_file` | `"credentials.txt"` | Path to login credentials |
| `login_enabled` | `true` | Whether to attempt Selenium login |
| `blocked_domains` | see below | Domains to always skip |

### Default blocked domains
```json
["youtube.com", "youtu.be", "twitter.com", "x.com", "t.me",
 "telegram.org", "reddit.com", "facebook.com", "instagram.com",
 "google.com/finance", "scribd.com"]
```
Override this in `config.json` to customise for your use case.

### Example config.json

```json
{
  "topic": "real estate due diligence",
  "max_results": 10,
  "queries": [
    {"label": "market_reports",  "query": "real estate market report 2025"},
    {"label": "due_diligence",   "query": "real estate due diligence checklist"},
    {"label": "underwriting",    "query": "multifamily deal underwriting guide"},
    {"label": "sec_data",        "query": "SEC real estate investment filings 2025"},
    {"label": "auction_sites",   "query": "HUD home store auction listings 2025"}
  ]
}
```

---

## How It Works

```
1. Load config.json
   └─ Fill missing fields with defaults
   └─ Validate required fields

2. Selenium Login (optional)
   └─ Read credentials.txt
   └─ Headless Chrome logs in → cookies injected into session

3. DuckDuckGo Search
   └─ One search per query in config
   └─ query_delay seconds between searches (avoids rate limiting)

4. Filter URLs
   ├─ Skip blocked domains
   └─ Skip duplicates seen in earlier queries

5. Parallel Scraping (5 threads)
   ├─ Use authenticated session if domain matches credentials
   ├─ Extract body text via trafilatura (strips ads/nav/footers)
   ├─ Fallback to BeautifulSoup <p> tags if trafilatura returns nothing
   └─ Collect PDF links whose URL or anchor text mentions the topic

6. Quality Check
   ├─ Skip if fewer than 50 words of body text
   └─ Skip if topic not mentioned in headline or body

7. Summarize
   └─ LSA algorithm (sumy) → N key sentences
      · Input capped at 1000 words
      · 10 second timeout — skips gracefully if too slow

8. Download PDFs
   └─ Topic must appear in PDF URL or anchor text
   └─ Retries up to 3 times with exponential backoff

9. Save Output
   ├─ output/results.csv  — one row per article
   └─ output/results.json — structured for agent consumption
```

---

## Output

### `output/results.csv`

| Column | Description |
|--------|-------------|
| `label` | Query label from config (e.g. `news`, `deals`) |
| `title` | Page title from DuckDuckGo |
| `url` | Full URL |
| `snippet` | DuckDuckGo preview text |
| `headline` | H1 heading from the page |
| `summary` | LSA extractive summary |
| `body` | Full cleaned body text |
| `pdf_links` | Pipe-separated PDF URLs |
| `error` | Any HTTP or network error |

### `output/results.json`

```json
{
  "topic": "PeopleSoft payroll",
  "scraped_at": "2026-03-21T10:30:00",
  "total": 42,
  "results": [
    {
      "label": "documentation",
      "title": "...",
      "url": "...",
      "summary": "...",
      "body": "...",
      "pdf_links": ["..."],
      ...
    }
  ]
}
```

### `output/pdfs/`
PDFs whose URL or anchor text mentions the topic — downloaded with retry on failure.

---

## Selenium Login

- Runs in **headless mode** — no browser window opens
- ChromeDriver installs automatically via `webdriver-manager`
- Cookies extracted and injected into `requests.Session`
- If login fails, scraping continues unauthenticated
- Only **email + password** login is supported — OTP-based sites cannot be automated

Set `"login_enabled": false` in config to skip login entirely.

---

## Use Case Examples

| Vertical | Topic | Example queries |
|----------|-------|----------------|
| Higher Ed | `"PeopleSoft payroll"` | setup docs, troubleshooting, training |
| Finance | `"SEC insider trading"` | EDGAR filings, forms, disclosures |
| Real Estate | `"multifamily underwriting"` | deal analysis, cap rates, market data |
| Any company | `"Tesla earnings"` | results, guidance, analyst reports |

---

## Libraries Used

| Library | Purpose |
|---------|---------|
| `ddgs` | DuckDuckGo search — no API key needed |
| `requests` | Fetch pages and PDFs |
| `trafilatura` | Clean article extraction (strips ads, nav, footers) |
| `beautifulsoup4` | HTML parsing and PDF link extraction |
| `sumy` + `nltk` | LSA extractive summarization |
| `lxml` | HTML parser |
| `selenium` | Automate browser login |
| `webdriver-manager` | Auto-installs ChromeDriver |

---

## Known Limitations

| Issue | Cause |
|-------|-------|
| JS-rendered pages return 0 words | Content loads via JavaScript — not accessible to `requests` |
| Some sites return 403 | Cloudflare or bot protection — not bypassable |
| OTP login sites not supported | Cannot automate OTP without manual input |
| DDG results vary per run | DuckDuckGo rotates results — expected behaviour |
