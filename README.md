# k6 Load Test — Application Submit

## What this test does

Simulates the full 20-step application submission flow against the staging environment:

| Step | Request |
|------|---------|
| 1 | GET `/online-application` (page load) |
| 2 | GET `/api/v1/global/getApplicationPageData` |
| 3 | GET `/api/v1/global/online-application/disabled-areas/9` |
| 4 | GET `/api/v1/captcha` — extracts `captcha_token` and `captcha_value` |
| 5–18 | GET district / thana / union / ward / payment-processors (batched) |
| 19 | GET check-duplicate-account |
| 20 | POST `/api/v1/global/online-application/registration` (multipart + image) |

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
| Test image  | Place a JPEG at `D:/Placeholder/test.jpg` (used as the applicant photo in Step 20) |
| Network     | Must be able to reach `stage.bhata.gov.bd` and `stage-api.bhata.gov.bd` |
| Bearer token | Set in `application_submit.js` under `BEARER_TOKEN` — update if it expires |

---

## 3. Run the test

Navigate to the folder containing `application_submit.js`:

```bash
cd "d:\k6 test\v1"
```

### Ramp-up profile (default)

Gradually increases load up to 4 000 VUs over ~9 minutes.

```bash
k6 run application_submit.js
```

or explicitly:

```bash
k6 run -e TEST_FUNC=rampUp application_submit.js
```

**Stages:**

| Duration | Target VUs |
|----------|-----------|
| 10s | 1 |
| 1m | 2 000 |
| 1m | 4 000 |
| 5m | 4 000 (hold) |
| 2m | 200 (cool-down) |

---

### Stress profile

Pushes the system to 8 000 VUs to find its breaking point.

```bash
k6 run -e TEST_FUNC=stress application_submit.js
```

**Stages:**

| Duration | Target VUs |
|----------|-----------|
| 1m | 500 |
| 2m | 2 000 |
| 3m | 5 000 |
| 5m | 8 000 (peak) |
| 2m | 0 (ramp-down) |

---

## 4. Save results to a file

### JSON output
```bash
k6 run --out json=results/result.json application_submit.js
```

### CSV output
```bash
k6 run --out csv=results/result.csv application_submit.js
```

> The `results/` folder is already in the project. Create it first if it doesn't exist.

---

## 5. Thresholds

The test defines pass/fail thresholds. k6 exits with a non-zero code if any threshold is breached.

| Metric | Threshold |
|--------|-----------|
| `registration_duration` p(95) | < 10 000 ms |
| `captcha_fetch_duration` p(95) | < 3 000 ms |
| `error_rate` | < 10 % |
| `http_req_duration` p(90) | < 8 000 ms |
| `http_req_duration` p(95) | < 10 000 ms |

---

## 6. Custom metrics

| Metric | Type | Description |
|--------|------|-------------|
| `registration_duration` | Trend | Time taken for the POST registration request |
| `captcha_fetch_duration` | Trend | Time taken to fetch the captcha |
| `total_requests` | Counter | Total HTTP requests sent |
| `error_rate` | Rate | Ratio of failed checks |

---

## 7. Configuration reference

All values that may need changing are at the top of `application_submit.js`:

| Constant | Purpose |
|----------|---------|
| `BASE_URL` | API base URL (`stage-api.bhata.gov.bd`) |
| `PAGE_URL` | Frontend base URL (`stage.bhata.gov.bd`) |
| `BEARER_TOKEN` | Auth token — update when it expires |
| `IMAGE_BYTES` | Path to the test image file |
| `FIELDS` | All static form field values (IDs, program, location, etc.) |
| `RAMP_UP_STAGES` | VU ramp schedule for the rampUp profile |
| `STRESS_STAGES` | VU ramp schedule for the stress profile |

---

## 8. Common issues

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| `cannot open file` error | Image not found | Place `test.jpg` at `D:/Placeholder/test.jpg` |
| All POSTs return 401 | Token expired | Update `BEARER_TOKEN` in the script |
| All POSTs return 422 | Captcha parse failed or form field mismatch | Check Step 4 logs for `captcha_token missing` |
| High 429 rate | Rate limit hit | Reduce target VUs in the stages config |
| `k6: command not found` | k6 not installed or not on PATH | Re-run the install step and restart the terminal |
