/**
 * Recovery Test
 *
 * Purpose: Verify the system can return to normal after high load. Load is
 *          pushed to 8,000 VUs, then dropped sharply to 100 to observe whether
 *          response times and stability recover.
 *
 * How to run:
 *   k6 run recovery-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = 'https://asianserver.xyz/';

// Helper to generate a random IP address to bypass single-IP rate limits
function getRandomIP() {
    return `${Math.floor(Math.random() * 255) + 1}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255) + 1}`;
}

// Dynamic User-Agent Generator
function getRandomUserAgent() {
    const userAgents = [
        // Chrome on Windows
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        
        // Firefox on Windows
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
        
        // Edge on Windows
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
        
        // Chrome on macOS
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        
        // Safari on macOS
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        
        // Chrome on Linux
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        
        // Firefox on Linux
        'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
        
        // Chrome on Android
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
        
        // Safari on iOS
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ];
    
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// ── Custom Metrics ────────────────────────────────────────────────────────────
const getResponseTime = new Trend('get_response_time', true);
const batchResponseTime = new Trend('batch_response_time', true);
const requestCount = new Counter('total_requests');
const errorRate = new Rate('error_rate');

// ── Test Configuration ────────────────────────────────────────────────────────
export const options = {
    scenarios: {
        recovery: {
            executor: 'ramping-vus',
            stages: [
              { duration: '2m', target: 2000 },  // lower from 8000
                { duration: '5m', target: 2000 },
                { duration: '3m', target: 50 },    // lower from 100
                { duration: '5m', target: 50 },
            ],
            gracefulRampDown: '30s',
        },
    },

    thresholds: {
        'get_response_time': [{ threshold: 'p(95)<5000', abortOnFail: false }],
        'batch_response_time': [{ threshold: 'p(95)<5500', abortOnFail: false }],
        'error_rate': [{ threshold: 'rate<0.30', abortOnFail: false }],
        'http_req_duration': [
            { threshold: 'p(90)<5000', abortOnFail: false },
            { threshold: 'p(95)<6000', abortOnFail: false },
        ],
    },
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function () {
    // Generate unique client IP and headers for each virtual user/request
    const headers = {
        'User-Agent': getRandomUserAgent(),
        'X-Forwarded-For': getRandomIP(),
        'X-Real-IP': getRandomIP(),
        'CF-Connecting-IP': getRandomIP(), // Used if the app is behind Cloudflare
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
    };

    // Step 1: Load login page and retrieve CSRF token
    const pageRes = http.get(`${BASE_URL}/login`, {
        timeout: '30s',
        // headers: headers,
        tags: { step: 'get-login-page', test: 'recovery' },
    });
    requestCount.add(1);

    // 🔴 REQUEST FAILED POINT #1 — Connection failure to login page
    //    k6 logs: "Request Failed error=Get \"https://asianserver.xyz/login\": unexpected EOF"
    if (!pageRes || pageRes.status === 0 || !pageRes.body) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    const pageOk = check(pageRes, {
        'Login page → 200': (r) => r.status === 200,
        'Login page has content': (r) => r.body && r.body.length > 0,
    });
    // 🔴 REQUEST FAILED POINT #2 — Login page returns non-200 or empty body
    //    k6 logs: check failure for 'Login page → 200' or 'Login page has content'
    if (!pageOk) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    const csrfToken = pageRes.html().find('input[name="_token"]').attr('value');

    // 🔴 REQUEST FAILED POINT #3 — CSRF token not found in HTML
    //    Means: Server page loaded but no <input name="_token" value="..."> exists
    if (!csrfToken) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    sleep(1);

    // Step 2: GET — load the online application page
    // group('GET - Online Application Page', () => {
    //     const res = http.get(`${BASE_URL}online-application`, {
    //         timeout: '30s',
    //         headers: headers,
    //         tags: { type: 'get', test: 'recovery', page: 'online-application' },
    //     });
    //     requestCount.add(1);

    //     if (!res || res.status === 0 || !res.body) {
    //         errorRate.add(1);
    //         return;
    //     }

    //     getResponseTime.add(res.timings.duration);

    //     const ok = check(res, {
    //         'GET Status 200': (r) => r.status === 200,
    //         'GET Response time < 5s': (r) => r.timings.duration < 5000,
    //         'GET No server error': (r) => r.status < 500,
    //         'GET Body not empty': (r) => r.body && r.body.length > 0,
    //     });
    //     errorRate.add(!ok);
    // });

    sleep(1);
}

// ── Teardown (Global Health Check) ──────────────────────────────────────────
export function teardown() {
    console.log("Running final health check to verify status...");

    // 1. Check directly from your own IP
    const directRes = http.get(`${BASE_URL}login`, { 
        timeout: '15s',
        tags: { step: 'health-check-direct' } 
    });
    const isDirectUp = directRes && directRes.status === 200;

    // 2. Check from a public/external IP using AllOrigins CORS proxy
    const proxyCheckUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(BASE_URL + 'login')}`;
    const proxyRes = http.get(proxyCheckUrl, { 
        timeout: '15s',
        tags: { step: 'health-check-public' }
    });
    
    // AllOrigins returns JSON containing the page content. A status 200 response from allorigins 
    // indicates it successfully reached and fetched the website.
    const isPublicUp = proxyRes && proxyRes.status === 200;

    console.log("\n==================================================");
    console.log("             FINAL STATUS REPORT                  ");
    console.log("==================================================");
    console.log(`Direct Connection (Own IP):        ${isDirectUp ? '🟢 UP (200 OK)' : '🔴 DOWN / BLOCKED'}`);
    console.log(`External Proxy (Public IP):      ${isPublicUp ? '🟢 UP (200 OK)' : '🔴 DOWN / UNAVAILABLE'}`);
    console.log("--------------------------------------------------");

    if (!isDirectUp && isPublicUp) {
        console.log("RESULT: The site is UP globally, but your own IP was BLOCKED/Rate-limited.");
        console.log("To stress-test the actual server, you must whitelist your IP or run k6 through a rotating proxy.");
    } else if (!isDirectUp && !isPublicUp) {
        console.log("RESULT: SUCCESS! The website is DOWN for both your own IP and all public IPs.");
    } else {
        console.log("RESULT: The website remained online throughout the test.");
    }
    console.log("==================================================\n");
}

