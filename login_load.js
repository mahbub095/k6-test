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
const BASE_URL = 'https://stage-api.bhata.gov.bd/api/v1/';
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
                { duration: '2m', target: 200   },  // slow ramp-up
                { duration: '5m', target: 20000 },  // peak load
                { duration: '2m', target: 0     },  // ramp-down
            ],
            gracefulRampDown: '30s',
        },
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
    const pageRes = http.get(`${BASE_URL}/admin/login`, {
        timeout: '30s',
        tags: { step: 'get-login-page' },
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

    // Step 2: Submit login with email and password
  
    const loginRes = http.post(
        `${BASE_URL}/admin/login`,
        { _token: csrfToken, email: EMAIL, password: PASSWORD },
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'text/html',
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

    const ok = check(loginRes, {
        'Login → 200':         (r) => r.status === 200,
        'Login response < 5s': (r) => r.timings.duration < 5000,
        'No server error':     (r) => r.status < 500,
    });
    errorRate.add(!ok);

    sleep(1);
}
