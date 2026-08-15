/**
 * Stress Test
 *
 * Purpose: Push the system beyond its normal operating limits to observe when
 *          and how it fails. VUs ramp up gradually to 8,000. Measures failure
 *          patterns, error messages, and recovery ability after load is removed.
 *
 * How to run:
 *   k6 run stress-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL      = 'https://stage-api.bhata.gov.bd';   // Your actual API
// const BASE_URL   = 'https://asianserver.xyz';     // Old URL
const USERNAME      = 'ibcs-qa-super';
const PASSWORD      = 'Password#4';
const CAPTCHA_VALUE = '25';
const CAPTCHA_TOKEN = '$2y$12$ycvyNe5Sq3hNsbnBgpcn9.i.Cq/4B00wc5zK1aSUlV4xw8ufPTKA2';
const OTP           = '375450';

// ── Custom Metrics ────────────────────────────────────────────────────────────
const loginDuration = new Trend('login_duration', true);
const requestCount  = new Counter('total_requests');
const errorRate     = new Rate('error_rate');

// ── Test Configuration ────────────────────────────────────────────────────────
export const options = {
    scenarios: {
        stress: {
            executor: 'ramping-vus',
            stages: [
                { duration: '1m', target: 500  },  // warm up
                { duration: '2m', target: 2000 },  // ramp up
                { duration: '3m', target: 5000 },  // increase stress
                { duration: '5m', target: 8000 },  // peak stress
                { duration: '2m', target: 0    },  // ramp-down
            ],
            gracefulRampDown: '30s',
        },
    },

    thresholds: {
        'login_duration':    [{ threshold: 'p(95)<5000', abortOnFail: false }],
        'error_rate':        [{ threshold: 'rate<0.10',  abortOnFail: false }],
        'http_req_duration': [
            { threshold: 'p(90)<5000', abortOnFail: false },
            { threshold: 'p(95)<6000', abortOnFail: false },
        ],
    },
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function () {

    // Log that we're using config default credentials
    console.log(`Using config default credentials: ${USERNAME}`);

    // ── Step 1: GET Login Page — retrieve CSRF token ──────────────────────────
    const pageRes = http.get(`${BASE_URL}/`, {
        timeout: '30s',
        tags: { step: 'get-login-page', test: 'stress' },
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

    // ── Dynamic User-Agent Headers ────────────────────────────────────────────
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OPR/107.0.0.0',
    ];
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

    // ── Step 2: POST Login — OTP endpoint ────────────────────────────────────
    const loginRes = http.post(
        `${BASE_URL}/api/v1/admin/login/otp?lang=bn`,  // OTP login endpoint
        {
            _token:        csrfToken,
            username:      USERNAME,
            password:      PASSWORD,
            captcha_value: CAPTCHA_VALUE,
            captcha_token: CAPTCHA_TOKEN,
            otp:           OTP,
        },
        {
            headers: {
                'Content-Type':  'application/x-www-form-urlencoded',
                'Accept':        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'User-Agent':    randomUserAgent,
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer':       `${BASE_URL}/`,
            },
            redirects: 5,
            timeout:   '30s',
            tags: { step: 'post-login', test: 'stress' },
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
        'Login POST successful':  (r) => r.status === 200 || r.status === 302,
        'Login POST < 5s':        (r) => r.timings.duration < 5000,
        'No server error':        (r) => r.status < 500,
        'Dashboard redirect':     (r) => r.url.includes('/dashboard') || r.url.includes('/home'),
        'Login error missing':    (r) => !r.body.includes('Invalid credentials') && !r.body.includes('Login failed'),
    });
    errorRate.add(!ok);

    // Log login result for debugging
    console.log(`Login POST: ${loginRes.status} - ${loginRes.timings.duration}ms - ${loginRes.url}`);

    sleep(1);
}
