/**
 * Load Test — Login Phase
 *
 * Purpose: Gradually ramp up to 20,000 VUs and measure the login endpoint's
 *          response time, error rate, and throughput.
 *
 * How to run:
 *   k6 run login_load.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.bhata.gov.bd/api/v1/';  // Your actual API
// const BASE_URL = 'https://asianserver.xyz';  // Old URL
const EMAIL    = 'admin';
const PASSWORD = 'admin';

// ── Custom Metrics ────────────────────────────────────────────────────────────
const loginDuration = new Trend('login_duration', true);
const requestCount  = new Counter('total_requests');
const errorRate     = new Rate('error_rate');

// ── Test Configuration ────────────────────────────────────────────────────────
export const options = {
    scenarios: {
        load: {
            executor: 'ramping-vus',
            stages: [
                { duration: '2m', target: 100   },  // slow ramp-up
                { duration: '5m', target: 100 },  // peak load
                { duration: '2m', target: 10     },  // ramp-down
            ],
            gracefulRampDown: '30s',
        },
    },

    // ── Grafana Cloud Configuration ───────────────────────────────────────────
    // Run with: k6 cloud run login_load.js
    cloud: {
        name:        'Login Load Test',
        projectID:   8273634,    // ✅ Your Project ID
        
        // Free tier only allows 1 load zone
        // Remove distribution block for Free tier
    },

    thresholds: {
        'login_duration':    [{ threshold: 'p(95)<5000',  abortOnFail: false }],
        'error_rate':        [{ threshold: 'rate<0.05',   abortOnFail: false }],
        'http_req_duration': [
            { threshold: 'p(90)<4000', abortOnFail: false },
            { threshold: 'p(95)<5000', abortOnFail: false },
        ],
    },
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function () {

    // Step 1: Load login page and retrieve CSRF token
    const pageRes = http.get(`${BASE_URL}admin/login`, {
        timeout: '30s',
        tags: { step: 'get-login-page' },
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
    });
    requestCount.add(1);

    // Skip this iteration if the connection failed or body is null
    if (!pageRes || pageRes.status === 0 || !pageRes.body) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    // Check login page loaded successfully
    const pageOk = check(pageRes, {
        'Login page → 200':       (r) => r.status === 200,
        'Login page has content': (r) => r.body && r.body.length > 0,
    });
    if (!pageOk) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    // Extract CSRF token from HTML
    const csrfToken = pageRes.html().find('input[name="_token"]').attr('value');

    // Skip if CSRF token is missing — POST would fail with 419 anyway
    if (!csrfToken) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    sleep(1);

    // ── Dynamic User-Agent Headers ───────────────────────────────────────────
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OPR/107.0.0.0',
    ];
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

    // Step 2: Submit login with email and password
    const loginRes = http.post(
        `${BASE_URL}admin/login`,  // Correct path for your API
        {
            _token: csrfToken,
            email: EMAIL,
            password: PASSWORD
        },
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'User-Agent': randomUserAgent,
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': `${BASE_URL}admin/login`,
            },
            redirects: 5,
            timeout: '30s',
            tags: { step: 'post-login' },
        }
    );
    requestCount.add(1);

    // Skip if login response is null or connection failed
    if (!loginRes || loginRes.status === 0) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    loginDuration.add(loginRes.timings.duration);

    // Better success checks
    const ok = check(loginRes, {
        'Login POST successful': (r) => r.status === 200 || r.status === 302,  // 302 = redirect success
        'Login POST < 5s':       (r) => r.timings.duration < 5000,
        'No server error':       (r) => r.status < 500,
        // Check for successful login indicators
        'Dashboard redirect': (r) => r.url.includes('/dashboard') || r.url.includes('/home'),
        'Login error missing': (r) => !r.body.includes('Invalid credentials') && !r.body.includes('Login failed')
    });
    errorRate.add(!ok);

    // Log login result for debugging
    console.log(`Login POST: ${loginRes.status} - ${loginRes.timings.duration}ms - ${loginRes.url}`);

    sleep(1);
}
