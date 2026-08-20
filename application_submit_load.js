/**
 * Application Submit — Breakpoint Test
 *
 * Test Type : Breakpoint Test
 * Purpose   : Find the exact VU level at which https://api.bhata.gov.bd
 *             breaks — returning 502 Bad Gateway, 503 Service Unavailable,
 *             connection refused, or timeout. Load ramps continuously and
 *             slowly so the breaking point is captured with precision.
 *
 * How it works:
 *   VUs ramp in small, slow increments. At each level the test measures
 *   error rates and latency. When 502/503/connection errors appear and
 *   sustain, that VU count IS the server's capacity ceiling.
 *
 *   The test uses `abortOnFail: true` on the 502 threshold so it stops
 *   automatically the moment sustained failure is detected — no need to
 *   babysit it or guess when to kill it.
 *
 * Breakpoint Stages (slow ramp — 150 VU increments every 3 minutes):
 *
 *   Stage  VUs    Cumulative Time   Purpose
 *   ──────────────────────────────────────────────────────────────────────
 *   01     150    3m                Initial baseline — server should be healthy
 *   02     300    6m                Light load
 *   03     450    9m                Moderate load
 *   04     600    12m               Medium load
 *   05     750    15m               Medium-high load
 *   06     900    18m               High load
 *   07    1050    21m               Near-stress
 *   08    1200    24m               Heavy load — watch for first degradation
 *   09    1350    27m               Very heavy — 502s may begin here
 *   10    1500    30m               Extreme — expect sustained 502s or down
 *   11       0    33m               Drain — verify if server recovers
 *
 * Total duration: ~33 minutes (or earlier if abortOnFail triggers)
 *
 * Key metrics to watch in real time:
 *   - http_req_failed          → % of requests returning any error
 *   - gateway_502_rate         → rate of 502 Bad Gateway responses
 *   - server_down_rate         → rate of 5xx + connection failures combined
 *   - registration_duration    → p95 latency on POST /registration
 *   - vus                      → current active VU count when failure starts
 *
 * Run command:
 *   k6 run application_submit_load.js
 *   k6 run -e BEARER_TOKEN=xxx application_submit_load.js
 *
 *   With live output to JSON (recommended — analyse after):
 *   k6 run --out json=results/breakpoint_result.json application_submit_load.js
 *
 * How to read results:
 *   Find the timestamp when `gateway_502_rate` first exceeds 50%.
 *   Cross-reference with `vus` metric at that timestamp.
 *   That VU count is the production server's breaking point.
 *
 * WARNING:
 *   This test is designed to cause service degradation on the target server.
 *   Only run against production with explicit authorisation.
 *   The abortOnFail threshold will stop the test automatically when
 *   sustained 502/503 is detected to minimise impact duration.
 *
 * Requirements:
 *   - Image file at: ./test.jpg  (relative to this script)
 *   - results/ directory must exist for --out json output
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PAGE_URL    = 'https://stage.bhata.gov.bd';
const API_URL     = 'https://stage-api.bhata.gov.bd';
const GATEWAY_URL = 'https://gateway.bhata.gov.bd';

const BEARER_TOKEN = __ENV.BEARER_TOKEN || '';

// Image pre-wrapped at init time — http.file() must not be called inside VU scope
const IMAGE_FILE = http.file(open('./test.jpg', 'b'), 'test.jpg', 'image/jpeg');

// ---------------------------------------------------------------------------
// Breakpoint ramp stages
//
// Strategy: slow, even increments of 150 VUs every 3 minutes.
// This gives the server time to respond to each load level before
// the next increment hits — making the breaking point observable and precise.
// ---------------------------------------------------------------------------

const BREAKPOINT_STAGES = [
    { duration: '2m', target: 20000  },  // Stage 01 — baseline, server should be healthy
    { duration: '3m', target: 30000  },  // Stage 02 — light load
    { duration: '3m', target: 45000  },  // Stage 03 — moderate load
    { duration: '3m', target: 60000  },  // Stage 04 — medium load
//     { duration: '3m', target: 75000  },  // Stage 05 — medium-high load
//     { duration: '3m', target: 90000  },  // Stage 06 — high load
//     { duration: '3m', target: 10500 },  // Stage 07 — near-stress
//     { duration: '3m', target: 12000 },  // Stage 08 — heavy — watch for first degradation
//     { duration: '3m', target: 13500 },  // Stage 09 — very heavy — 502s may begin here
//     { duration: '3m', target: 15000 },  // Stage 10 — extreme — expect sustained 502/down
//     { duration: '3m', target: 0    },  // Stage 11 — drain — verify server recovery
];

// ---------------------------------------------------------------------------
// k6 options
// ---------------------------------------------------------------------------

export const options = {
    scenarios: {
        breakpoint: {
            executor:         'ramping-vus',
            stages:           BREAKPOINT_STAGES,
            gracefulRampDown: '60s',
        },
    },

    thresholds: {
        // ── Breakpoint detection thresholds ──────────────────────────────────
        //
        // gateway_502_rate: abort the test automatically when more than 50%
        // of all requests return 502 over a 1-minute window. This marks the
        // confirmed breaking point and stops the test to limit production impact.
        'gateway_502_rate': [
            {
                threshold:   'rate<0.50',
                abortOnFail: true,     // AUTO-STOP when server is truly down
                delayAbortEval: '60s', // Wait 60s to confirm it's sustained, not transient
            },
        ],

        // server_down_rate covers 502 + 503 + connection errors combined
        'server_down_rate': [
            {
                threshold:   'rate<0.50',
                abortOnFail: true,
                delayAbortEval: '60s',
            },
        ],

        // ── Degradation signal thresholds (abortOnFail: false — informational) ──
        // These tell you at what point the server STARTS degrading, before it dies.
        'registration_duration': [
            { threshold: 'p(95)<10000', abortOnFail: false },  // 10s — first warning
            { threshold: 'p(95)<30000', abortOnFail: false },  // 30s — severe degradation
        ],
        'captcha_fetch_duration': [
            { threshold: 'p(95)<5000',  abortOnFail: false },
        ],
        'media_upload_duration': [
            { threshold: 'p(95)<15000', abortOnFail: false },
        ],

        // ── Overall error rate — watch for gradual climb before 502 flood ──────
        'error_rate': [
            { threshold: 'rate<0.10', abortOnFail: false },  // 10% — degrading
            { threshold: 'rate<0.50', abortOnFail: false },  // 50% — near broken
        ],

        // ── Built-in http_req_failed tracks connection errors + non-2xx ─────────
        'http_req_failed': [
            { threshold: 'rate<0.10', abortOnFail: false },
            { threshold: 'rate<0.50', abortOnFail: false },
        ],

        // ── Raw latency ──────────────────────────────────────────────────────────
        'http_req_duration': [
            { threshold: 'p(90)<15000', abortOnFail: false },
            { threshold: 'p(95)<30000', abortOnFail: false },
        ],
    },
};

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const registrationDuration = new Trend('registration_duration',  true);
const mediaUploadDuration  = new Trend('media_upload_duration',  true);
const captchaFetchDuration = new Trend('captcha_fetch_duration', true);
const requestCount         = new Counter('total_requests');

// gateway_502_rate — specifically tracks 502 Bad Gateway from the API/gateway
// This is the PRIMARY signal that the server is down or overloaded
const gateway502Rate       = new Rate('gateway_502_rate');

// server_down_rate — tracks 502 + 503 + 0 (connection refused/timeout) combined
// A sustained rise here means the server cannot handle the current load
const serverDownRate       = new Rate('server_down_rate');

// error_rate — tracks any non-2xx response (wider net than serverDownRate)
const errorRate            = new Rate('error_rate');

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

const PAGE_HEADERS = {
    'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Site':            'none',
    'Sec-Fetch-Mode':            'navigate',
    'Sec-Fetch-User':            '?1',
    'Sec-Fetch-Dest':            'document',
    'Cache-Control':             'no-cache',
    'Pragma':                    'no-cache',
    'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'sec-ch-ua':                 '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    'sec-ch-ua-mobile':          '?0',
    'sec-ch-ua-platform':        '"Windows"',
};

const API_HEADERS = {
    Authorization:    `Bearer ${BEARER_TOKEN}`,
    Accept:           'application/json, text/plain, */*',
    'X-App-Language': 'bn',
    'Cache-Control':  'no-cache',
    'Pragma':         'no-cache',
    'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'sec-ch-ua':          '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    'sec-ch-ua-mobile':   '?0',
    'sec-ch-ua-platform': '"Windows"',
};

// ---------------------------------------------------------------------------
// Static field values
// ---------------------------------------------------------------------------

const FIELDS = {
    program_id:                  '22',
    sub_program_id:              '8',
    account_type:                '2',
    thana_id:                    '312',
    division_id:                 '3',
    district_id:                 '42',
    union_id:                    '3240',
    ward_id_union:               '26612',
    permanent_thana_id:          '312',
    permanent_union_id:          '3240',
    permanent_district_id:       '42',
    permanent_division_id:       '3',
    permanent_ward_id_union:     '26612',
    location_type:               '2',
    sub_location_type:           '2',
    permanent_location_type:     '2',
    permanent_sub_location_type: '2',
    profession:                  '150',
    nationality:                 '105',
    gender_id:                   '23',
    religion:                    '96',
    marital_status:              '101',
    education_status:            '25',
    mfs_name:                    '1',
    is_bank_mfs_mandatory:       '1',
    account_owner:               '142',
    no_of_people_score:          '-28',
    per_room_score:              '-14',
    no_of_room:                  '501',
    house_size:                  '2',
    is_nominnee_optional:        '0',
};

const APPLICATION_PMT = JSON.stringify([
    { variable_id: 576, sub_variables: 577   },
    { variable_id: 530, sub_variables: 531   },
    { variable_id: 571, sub_variables: 572   },
    { variable_id: 1,   sub_variables: 443   },
    { variable_id: 7,   sub_variables: 330   },
    { variable_id: 12,  sub_variables: 440   },
    { variable_id: 14,  sub_variables: 383   },
    { variable_id: 18,  sub_variables: 409   },
    { variable_id: 36,  sub_variables: 298   },
    { variable_id: 33,  sub_variables: 292   },
    { variable_id: 536, sub_variables: [537] },
    { variable_id: 393, sub_variables: 397   },
    { variable_id: 30,  sub_variables: 339   },
    { variable_id: 40,  sub_variables: 400   },
    { variable_id: 548, sub_variables: 550   },
    { variable_id: 579, sub_variables: 580   },
    { variable_id: 41,  sub_variables: 387   },
    { variable_id: 567, sub_variables: 568   },
    { variable_id: 25,  sub_variables: 406   },
    { variable_id: 29,  sub_variables: 275   },
    { variable_id: 22,  sub_variables: 403   },
    { variable_id: 595, sub_variables: 597   },
    { variable_id: 47,  sub_variables: [424] },
    { variable_id: 500, sub_variables: 501   },
]);

const APPLICATION_ALLOWANCE_VALUES = JSON.stringify([
    { allowance_program_additional_fields_id: 100, allowance_program_additional_field_values_id: null, value: 'Test' },
    { allowance_program_additional_fields_id: 101, allowance_program_additional_field_values_id: null, value: 'TESt' },
    { allowance_program_additional_fields_id: 102, allowance_program_additional_field_values_id: null, value: '123'  },
    { allowance_program_additional_fields_id: 103, allowance_program_additional_field_values_id: null, value: 'C'    },
    { allowance_program_additional_fields_id: 104, allowance_program_additional_field_values_id: 512,  value: null   },
    { allowance_program_additional_fields_id: 87,  allowance_program_additional_field_values_id: 548,  value: null   },
]);

// ---------------------------------------------------------------------------
// Helper: UUID v4
// ---------------------------------------------------------------------------

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ---------------------------------------------------------------------------
// Helper: build per-VU applicant data — collision-proof
//
// verification_number — "19" + VU(6) + ITER(6) + ms(3) = 17 digits
// account_number      — "016" + VU(4) + ITER(4) = 11 digits
// mobile              — "017" + VU(4) + ITER(4) = 11 digits (≠ account_number)
// ---------------------------------------------------------------------------

function buildApplicant() {
    const ts = Date.now() % 1000;

    const verification_number =
        '19' +
        String(__VU).padStart(6, '0') +
        String(__ITER).padStart(6, '0') +
        String(ts).padStart(3, '0');

    const account_number =
        '016' +
        String(__VU).padStart(4, '0') +
        String(__ITER).padStart(4, '0');

    const mobile =
        '017' +
        String(__VU).padStart(4, '0') +
        String(__ITER).padStart(4, '0');

    const birthYear  = 1950 + Math.floor(Math.random() * 51);
    const birthMonth = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
    const birthDay   = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
    const date_of_birth = `${birthYear}-${birthMonth}-${birthDay}`;
    const age           = String(2026 - birthYear);

    return {
        verification_number,
        account_number,
        mobile,
        date_of_birth,
        age,
        name_bn:        'আবেদনকারীর নাম',
        name_en:        'Application Name',
        father_name_bn: 'আবেদনকারীর পিতার নাম',
        father_name_en: 'Fathers Name',
        mother_name_bn: 'আবেদনকারীর মাতার নাম',
        mother_name_en: 'Mothers Name',
    };
}

// ---------------------------------------------------------------------------
// Shared response classifier
// Records into gateway_502_rate and server_down_rate for every HTTP call.
// Call this after EVERY request so the breakpoint metrics stay accurate.
// ---------------------------------------------------------------------------

function classifyResponse(res) {
    const is502  = res.status === 502;
    const isDown = res.status === 502 || res.status === 503 || res.status === 0;

    gateway502Rate.add(is502  ? 1 : 0);
    serverDownRate.add(isDown ? 1 : 0);

    // Log 502s explicitly so you know exactly when they start appearing
    if (is502) {
        console.error(`[502] VU ${__VU} ITER ${__ITER} — ${res.url} | ${res.timings.duration}ms`);
    }
    if (res.status === 503) {
        console.error(`[503] VU ${__VU} ITER ${__ITER} — ${res.url} | ${res.timings.duration}ms`);
    }
    if (res.status === 0) {
        console.error(`[CONN_FAIL] VU ${__VU} ITER ${__ITER} — ${res.url} — connection refused / timeout`);
    }
}

// ---------------------------------------------------------------------------
// Main flow — full 23-step application submission
// ---------------------------------------------------------------------------

export default function () {
    const applicant = buildApplicant();

    // ── Step 1 — GET online-application page ─────────────────────────────────
    group('Step 1 - GET Online Application Page', () => {
        const res = http.get(`${PAGE_URL}/online-application`, {
            headers: PAGE_HEADERS,
            timeout: '30s',
            tags:    { step: '01_get_page', test: 'breakpoint' },
        });
        requestCount.add(1);
        classifyResponse(res);

        const ok = check(res, {
            'step01 → 200':     r => r.status === 200,
            'step01 not 502':   r => r.status !== 502,
            'step01 not 503':   r => r.status !== 503,
            'step01 not 0':     r => r.status !== 0,
        });
        if (!ok) errorRate.add(1);
    });
    sleep(1);

    // ── Step 2 — GET application page data ───────────────────────────────────
    group('Step 2 - GET Application Page Data', () => {
        const res = http.get(`${API_URL}/api/v1/global/getApplicationPageData?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags:    { step: '02_page_data', test: 'breakpoint' },
        });
        requestCount.add(1);
        classifyResponse(res);

        const ok = check(res, {
            'step02 → 200':   r => r.status === 200,
            'step02 not 502': r => r.status !== 502,
            'step02 not 503': r => r.status !== 503,
        });
        if (!ok) errorRate.add(1);
    });
    sleep(1);

    // ── Step 3 — GET disabled areas ──────────────────────────────────────────
    group('Step 3 - GET Disabled Areas', () => {
        const res = http.get(`${API_URL}/api/v1/global/online-application/disabled-areas/8?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags:    { step: '03_disabled_areas', test: 'breakpoint' },
        });
        requestCount.add(1);
        classifyResponse(res);

        const ok = check(res, {
            'step03 → 200':   r => r.status === 200,
            'step03 not 502': r => r.status !== 502,
        });
        if (!ok) errorRate.add(1);
    });
    sleep(1);

    // ── Step 4 — GET captcha ─────────────────────────────────────────────────
    let captchaToken = '';
    let captchaValue = '';

    group('Step 4 - GET Captcha', () => {
        const res = http.get(`${API_URL}/api/v1/captcha?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags:    { step: '04_captcha', test: 'breakpoint' },
        });
        requestCount.add(1);
        captchaFetchDuration.add(res.timings.duration);
        classifyResponse(res);

        const ok = check(res, {
            'step04 → 200':   r => r.status === 200,
            'step04 not 502': r => r.status !== 502,
            'step04 not 503': r => r.status !== 503,
        });
        if (!ok) { errorRate.add(1); return; }

        try {
            const body   = res.json();
            captchaToken = body.captcha_token || body.token || '';
            captchaValue = body.captcha_value || body.value || '';
        } catch (_) { /* non-JSON */ }
    });
    sleep(1);

    // ── Step 5 — POST media-upload (via GATEWAY) ─────────────────────────────
    let uploadedImagePath = '';
    const mediaToken      = uuidv4();

    group('Step 5 - POST Media Upload', () => {
        const res = http.post(
            `${API_URL}/api/v1/global/online-application/media-upload?lang=bn`,
            { field: 'image', file: IMAGE_FILE, token: mediaToken },
            {
                headers: API_HEADERS,
                timeout: '60s',
                tags:    { step: '05_media_upload', test: 'breakpoint' },
            }
        );
        requestCount.add(1);
        mediaUploadDuration.add(res.timings.duration);
        classifyResponse(res);

        const ok = check(res, {
            'step05 → 200 or 201': r => r.status === 200 || r.status === 201,
            'step05 not 502':      r => r.status !== 502,
            'step05 not 503':      r => r.status !== 503,
            'step05 not 5xx':      r => r.status < 500,
        });
        errorRate.add(!ok);

        if (ok) {
            try {
                const body        = res.json();
                uploadedImagePath = body.path || (body.data && body.data.path) || body.url || '';
            } catch (_) { /* non-JSON */ }
        }
    });
    sleep(1);

    if (!uploadedImagePath) {
        console.warn(`VU ${__VU} [breakpoint] — no image path, skipping remaining steps`);
        return;
    }

    // ── Steps 6–19 — Batched lookup GETs ─────────────────────────────────────
    group('Steps 6-19 - Lookup GETs', () => {
        const lookupUrls = [
            `${API_URL}/api/v1/global/district/get/3?lang=bn`,
            `${API_URL}/api/v1/global/thana/get/42?lang=bn`,
            `${API_URL}/api/v1/global/payment-processors/42?lang=bn`,
            `${API_URL}/api/v1/global/thana/get/42?lang=bn`,
            `${API_URL}/api/v1/global/union/get/312?lang=bn`,
            `${API_URL}/api/v1/global/union/get/312?lang=bn`,
            `${API_URL}/api/v1/global/ward/get/3240?lang=bn`,
            `${API_URL}/api/v1/global/payment-processors/26612?lang=bn`,
            `${API_URL}/api/v1/global/district/get/3?lang=bn`,
            `${API_URL}/api/v1/global/thana/get/42?lang=bn`,
            `${API_URL}/api/v1/global/thana/get/42?lang=bn`,
            `${API_URL}/api/v1/global/union/get/312?lang=bn`,
            `${API_URL}/api/v1/global/ward/get/3240?lang=bn`,
            `${API_URL}/api/v1/global/thana/get/42?lang=bn`,
        ];
        const responses = http.batch(
            lookupUrls.map(url => ({
                method: 'GET',
                url,
                params: { headers: API_HEADERS, timeout: '30s', tags: { step: '06_lookups', test: 'breakpoint' } },
            }))
        );
        requestCount.add(lookupUrls.length);
        responses.forEach((res, i) => {
            classifyResponse(res);
            const ok = check(res, { [`step06 lookup[${i}] → 200`]: r => r.status === 200 });
            if (!ok) errorRate.add(1);
        });
    });
    sleep(1);

    // ── Steps 20–22 — Check duplicate account ────────────────────────────────
    group('Steps 20-22 - GET Check Duplicate Account', () => {
        const dupUrl =
            `${API_URL}/api/v1/global/online-application/check-duplicate-account` +
            `?account_number=${applicant.account_number}` +
            `&program_id=${FIELDS.program_id}` +
            `&sub_program_id=${FIELDS.sub_program_id}` +
            `&ignore_id=&lang=bn`;

        const responses = http.batch([
            { method: 'GET', url: dupUrl, params: { headers: API_HEADERS, timeout: '30s', tags: { step: '20_check_duplicate', test: 'breakpoint' } } },
            { method: 'GET', url: dupUrl, params: { headers: API_HEADERS, timeout: '30s', tags: { step: '21_check_duplicate', test: 'breakpoint' } } },
            { method: 'GET', url: dupUrl, params: { headers: API_HEADERS, timeout: '30s', tags: { step: '22_check_duplicate', test: 'breakpoint' } } },
        ]);
        requestCount.add(3);
        responses.forEach((res, i) => {
            classifyResponse(res);
            const ok = check(res, { [`step20 dup[${i}] → 200`]: r => r.status === 200 });
            if (!ok) errorRate.add(1);
        });
    });
    sleep(1);

    // ── Step 23 — POST registration ───────────────────────────────────────────
    group('Step 23 - POST Registration', () => {
        if (!captchaToken) {
            console.warn(`VU ${__VU} [breakpoint] — skipping POST: no captcha_token`);
            errorRate.add(1);
            return;
        }

        const formData = {
            lang:                         'bn',
            account_type:                 FIELDS.account_type,
            program_id:                   FIELDS.program_id,
            sub_program_id:               FIELDS.sub_program_id,
            application_pmt:              APPLICATION_PMT,
            application_allowance_values: APPLICATION_ALLOWANCE_VALUES,
            thana_id:                     FIELDS.thana_id,
            division_id:                  FIELDS.division_id,
            district_id:                  FIELDS.district_id,
            verification_number:          applicant.verification_number,
            verification_type:            '2',
            name_bn:                      applicant.name_bn,
            name_en:                      applicant.name_en,
            father_name_bn:               applicant.father_name_bn,
            father_name_en:               applicant.father_name_en,
            mother_name_bn:               applicant.mother_name_bn,
            mother_name_en:               applicant.mother_name_en,
            date_of_birth:                applicant.date_of_birth,
            age:                          applicant.age,
            gender_id:                    FIELDS.gender_id,
            religion:                     FIELDS.religion,
            marital_status:               FIELDS.marital_status,
            education_status:             FIELDS.education_status,
            nationality:                  FIELDS.nationality,
            profession:                   FIELDS.profession,
            location_type:                FIELDS.location_type,
            sub_location_type:            FIELDS.sub_location_type,
            union_id:                     FIELDS.union_id,
            ward_id_union:                FIELDS.ward_id_union,
            address:                      'C',
            post_code:                    '1234',
            permanent_thana_id:           FIELDS.permanent_thana_id,
            permanent_union_id:           FIELDS.permanent_union_id,
            permanent_district_id:        FIELDS.permanent_district_id,
            permanent_division_id:        FIELDS.permanent_division_id,
            permanent_ward_id_union:      FIELDS.permanent_ward_id_union,
            permanent_location_type:      FIELDS.permanent_location_type,
            permanent_sub_location_type:  FIELDS.permanent_sub_location_type,
            permanent_address:            'C',
            permanent_post_code:          '1234',
            mobile:                       applicant.mobile,
            account_number:               applicant.account_number,
            account_name:                 'Test',
            account_owner:                FIELDS.account_owner,
            mfs_name:                     FIELDS.mfs_name,
            is_bank_mfs_mandatory:        FIELDS.is_bank_mfs_mandatory,
            no_of_people_score:           FIELDS.no_of_people_score,
            per_room_score:               FIELDS.per_room_score,
            no_of_room:                   FIELDS.no_of_room,
            house_size:                   FIELDS.house_size,
            is_nominnee_optional:         FIELDS.is_nominnee_optional,
            captcha_token:                captchaToken,
            captcha_value:                captchaValue,
            media_token:                  mediaToken,
            image:                        uploadedImagePath,
        };

        const res = http.post(
            `${API_URL}/api/v1/global/online-application/registration?lang=bn`,
            formData,
            {
                headers: API_HEADERS,
                timeout: '60s',
                tags:    { step: '23_post_registration', test: 'breakpoint' },
            }
        );
        requestCount.add(1);
        registrationDuration.add(res.timings.duration);
        classifyResponse(res);

        const ok = check(res, {
            'step23 → 200 or 201': r => r.status === 200 || r.status === 201,
            'step23 not 422':      r => r.status !== 422,
            'step23 not 502':      r => r.status !== 502,
            'step23 not 503':      r => r.status !== 503,
            'step23 not 5xx':      r => r.status < 500,
        });
        errorRate.add(!ok);

        // Only log every 50th iteration to avoid flooding during high-VU stages
        if (__ITER % 50 === 0 || res.status >= 500 || res.status === 0) {
            console.log(`VU ${__VU} ITER ${__ITER} [breakpoint] — step23 HTTP ${res.status} | ${res.timings.duration}ms`);
        }
    });

    // Think time — represents realistic user pause between form submission
    // and starting a new session. Keep this consistent so VU count maps
    // directly to concurrent users, not request rate.
    sleep(10);
}
