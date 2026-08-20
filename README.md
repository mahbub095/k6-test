# k6 Performance Test Suite — Application Submit

Full end-to-end load testing of the application submission flow against the **production** (`api.bhata.gov.bd`) and **staging** (`stage-api.bhata.gov.bd`) environments.

---

## Test files at a glance

| File | Test Type | Purpose | Duration |
|------|-----------|---------|----------|
| `application_submit_load.js` | **Breakpoint** | Find the VU level that causes 502 / server down | ~33 min (auto-stops at failure) |
| `application_submit_stress.js` | **Stress** | Push beyond normal limits, find breaking point | ~21 min |
| `application_submit_spike.js` | **Spike** | Sudden 12× surge, verify system absorbs the shock | ~8 min |
| `application_submit_soak.js` | **Soak / Endurance** | 2-hour sustained load — surface memory leaks | ~2 h 10 min |
| `application_submit_advanced.js` | **Advanced Analysis** | Per-step latency, funnel drop, e2e duration | ~15 min |

All 5 files exercise the **full 23-step** application submission flow.

---

## What each test run does — the 23-step flow

| Step | Method | Endpoint |
|------|--------|----------|
| 1 | GET | `/online-application` (page load) |
| 2 | GET | `/api/v1/global/getApplicationPageData` |
| 3 | GET | `/api/v1/global/online-application/disabled-areas/8` |
| 4 | GET | `/api/v1/captcha` — extracts `captcha_token` + `captcha_value` |
| 5 | POST | `/api/v1/global/online-application/media-upload` (image upload) |
| 6–19 | GET (batch) | district / thana / union / ward / payment-processors lookups |
| 20–22 | GET (batch) | `/api/v1/global/online-application/check-duplicate-account` × 3 |
| 23 | POST | `/api/v1/global/online-application/registration` (full form) |

---

## 1. Install k6

### Windows

**Option A — Winget (recommended)**
```powershell
winget install k6 --source winget
```

**Option B — Chocolatey**
```powershell
choco install k6
```

**Option C — Direct installer**
Download the `.msi` from [github.com/grafana/k6/releases](https://github.com/grafana/k6/releases) and run it.

### macOS
```bash
brew install k6
```

### Linux (Debian / Ubuntu)
```bash
sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69

echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] \
  https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list

sudo apt update && sudo apt install k6
```

**Verify installation**
```bash
k6 version
```

---

## 2. Prerequisites

| Requirement | Detail |
|-------------|--------|
| Test image | Place a JPEG at `./test.jpg` (same folder as the scripts). Used as applicant photo in Step 5. |
| Bearer token | Pass via env var `BEARER_TOKEN` (see run commands below). |
| Network access | Must reach `api.bhata.gov.bd`, `dss.bhata.gov.bd`, and `gateway.bhata.gov.bd` for production tests, or `stage-api.bhata.gov.bd` and `stage.bhata.gov.bd` for staging. |
| `results/` folder | Create once before using `--out json` or `--out csv` output. |

```powershell
# Create results folder (run once)
New-Item -ItemType Directory -Path "results" -Force
```

---

## 3. Run the tests

Navigate to the test folder first:

```powershell
cd "d:\k6 test\v1"
```

---

### Breakpoint Test — find when production goes down

Ramps from 150 to 1 500 VUs in steps of 150 every 3 minutes.
**Auto-stops** the moment `gateway_502_rate` or `server_down_rate` exceeds 50% for 60 seconds.

```bash
k6 run application_submit_load.js
```

With bearer token:
```bash
k6 run -e BEARER_TOKEN=your_token_here application_submit_load.js
```

Save full results for post-analysis (recommended):
```bash
k6 run --out json=results/breakpoint_result.json -e BEARER_TOKEN=your_token_here application_submit_load.js
```

**Breakpoint stages:**

| Stage | Duration | Target VUs | What to watch |
|-------|----------|-----------|---------------|
| 01 | 3m | 150 | Baseline — server healthy |
| 02 | 3m | 300 | Light load |
| 03 | 3m | 450 | Moderate load |
| 04 | 3m | 600 | Medium load |
| 05 | 3m | 750 | Medium-high |
| 06 | 3m | 900 | High load |
| 07 | 3m | 1 050 | Near-stress |
| 08 | 3m | 1 200 | First degradation expected |
| 09 | 3m | 1 350 | 502s may start here |
| 10 | 3m | 1 500 | Sustained failure / server down |
| 11 | 3m | 0 | Drain — verify recovery |

**Key metric:** `gateway_502_rate` — when this climbs past 50%, the server is down.
The VU count at that moment is your production capacity ceiling.

---

### Stress Test — find the breaking point on staging

```bash
k6 run application_submit_stress.js
```

```bash
k6 run -e BEARER_TOKEN=your_token_here application_submit_stress.js
```

**Stages:**

| Duration | Target VUs | Purpose |
|----------|-----------|---------|
| 2m | 100 | Warm-up |
| 3m | 300 | Moderate stress |
| 3m | 500 | High stress |
| 3m | 800 | Heavy stress |
| 5m | 1 000 | Breaking point |
| 3m | 500 | Partial recovery check |
| 2m | 0 | Full ramp-down |

---

### Spike Test — sudden traffic burst

```bash
k6 run application_submit_spike.js
```

```bash
k6 run -e BEARER_TOKEN=your_token_here application_submit_spike.js
```

**Stages:**

| Duration | Target VUs | Purpose |
|----------|-----------|---------|
| 1m | 50 | Normal idle baseline |
| 30s | 600 | Sudden 12× spike |
| 3m | 600 | Hold spike |
| 30s | 50 | Drop back to normal |
| 2m | 50 | Verify recovery |
| 1m | 0 | Ramp-down |

---

### Soak Test — 2-hour endurance run

> Designed to surface memory leaks, DB connection pool exhaustion, and session expiry problems. Only run when you have monitoring on the server side.

```bash
k6 run application_submit_soak.js
```

```bash
k6 run -e BEARER_TOKEN=your_token_here application_submit_soak.js
```

**Stages:**

| Duration | Target VUs | Purpose |
|----------|-----------|---------|
| 5m | 50 | Gentle ramp-up |
| 2h | 100 | Sustained endurance load |
| 5m | 0 | Graceful drain |

---

### Advanced Analysis — per-step bottleneck analysis

Runs two parallel scenarios to reveal which step degrades first as concurrency rises.

```bash
k6 run application_submit_advanced.js
```

```bash
k6 run --out json=results/advanced_result.json -e BEARER_TOKEN=your_token_here application_submit_advanced.js
```

**Scenarios:**

| Scenario | Executor | VUs | Duration | Purpose |
|----------|----------|-----|----------|---------|
| `normal_load` | constant-vus | 50 | 10m | Steady-state per-step latency baseline |
| `ramp_analysis` | ramping-vus | 0 → 200 | 15m | Shows how each step degrades under load |

**Extra metrics produced (not in other files):**

| Metric | What it tells you |
|--------|------------------|
| `step_01_get_page_duration` … `step_23_registration_duration` | p50/p90/p95/p99 per individual step |
| `flow_e2e_duration` | Total wall-clock time for one full 23-step submission |
| `flow_completion_rate` | % of VUs that reached Step 23 successfully |
| `captcha_success_rate` | % of captcha fetches that returned a usable token |
| `upload_success_rate` | % of media uploads that returned an image path |
| `funnel_drop_at_captcha` | Count of VUs that exited at Step 4 |
| `funnel_drop_at_upload` | Count of VUs that exited at Step 5 |

---

## 4. Save results

### JSON output
```bash
k6 run --out json=results/result.json application_submit_load.js
```

### CSV output
```bash
k6 run --out csv=results/result.csv application_submit_load.js
```

### Grafana Cloud (if configured)
```bash
k6 cloud application_submit_load.js
```

---

## 5. Thresholds summary

| File | Metric | Threshold | abortOnFail |
|------|--------|-----------|-------------|
| load (breakpoint) | `gateway_502_rate` | < 50% | **YES** — auto-stops test |
| load (breakpoint) | `server_down_rate` | < 50% | **YES** — auto-stops test |
| load (breakpoint) | `error_rate` | < 50% | no |
| stress | `error_rate` | < 30% | no |
| spike | `error_rate` | < 50% | no |
| soak | `error_rate` | < 5% | no |
| advanced | `flow_completion_rate` | > 90% | no |
| advanced | `captcha_success_rate` | > 95% | no |
| all | `registration_duration` p(95) | < 10 000 ms | no |
| all | `http_req_duration` p(95) | < 10 000 ms | no |

---

## 6. Uniqueness — how applicant data is generated

Each VU + iteration produces a guaranteed-unique applicant so the server never sees "Account number is already in use":

```
verification_number = "19" + VU(6 digits) + ITER(6 digits) + ms(3 digits)
account_number      = "016" + VU(4 digits) + ITER(4 digits)
mobile              = "017" + VU(4 digits) + ITER(4 digits)
```

Example — VU 5, iteration 12:
```
verification_number = 19000005000012xxx
account_number      = 01600050012
mobile              = 01700050012
```

---

## 7. Configuration reference

All values that may need changing are at the top of each script:

| Constant | Purpose |
|----------|---------|
| `PAGE_URL` | Frontend URL (`dss.bhata.gov.bd` / `stage.bhata.gov.bd`) |
| `API_URL` | API backend URL (`api.bhata.gov.bd` / `stage-api.bhata.gov.bd`) |
| `GATEWAY_URL` | Gateway URL used for media upload |
| `BEARER_TOKEN` | Auth token — pass as env var, do not hardcode |
| `IMAGE_FILE` | Test JPEG loaded at init time from `./test.jpg` |
| `FIELDS` | All static form field IDs (program, location, household, etc.) |
| `BREAKPOINT_STAGES` | VU ramp schedule in `application_submit_load.js` |

---

## 8. Common issues

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| `cannot open file ./test.jpg` | Image not found | Place `test.jpg` in `d:\k6 test\v1\` |
| All requests return 401 | Token expired | Pass a fresh token: `-e BEARER_TOKEN=xxx` |
| All POSTs return 422 | Captcha parse failed or form field mismatch | Check console for `captcha_token missing` |
| "Account number is already in use" | Old hardcoded mobile/account | Pull latest scripts — `buildApplicant()` now uses `__VU` + `__ITER` |
| High 429 rate | Rate-limit hit | Reduce target VUs in the stages config |
| `k6: command not found` | k6 not on PATH | Re-run install and restart terminal |
| `gateway_502_rate` triggers abort early | Server is genuinely overloaded | That VU count is your capacity ceiling — job done |
| Soak test shows latency creep after 60 min | Memory leak on server | Report to backend team with the `results/` JSON |
