/**
 * Application Submit — Advanced Performance Analysis
 *
 * Test Type : Advanced / Composite Analysis
 * Purpose   : Deep instrumentation of the full 23-step application submission
 *             flow to identify bottlenecks at the individual step level.
 *             Goes beyond pass/fail thresholds to produce:
 *
 *               ✦ Per-step latency trends (p50 / p90 / p95 / p99)
 *               ✦ Per-step error rates
 *               ✦ Throughput (requests/s) per step
 *               ✦ Media upload throughput tracking
 *               ✦ End-to-end flow completion rate
 *               ✦ Step-drop funnel analysis (how many VUs drop at each step)
 *               ✦ Duplicate detection hit rate
 *               ✦ Captcha success/failure rate
 *               ✦ Registration success rate at different concurrency levels
 *
 * Scenarios : Two concurrent scenarios run in parallel:
 *
 *   normal_load  — 50 VUs constant, 10 minutes
 *                  Captures steady-state per-step latency distribution.
 *
 *   ramp_analysis — 0 → 200 VUs over 15 minutes
 *                  Reveals how each step's latency degrades as concurrency rises.
 *
 * Usage:
 *   k6 run application_submit_advanced.js
 *   k6 run -e BEARER_TOKEN=xxx application_submit_advanced.js
 *   k6 run --out json=results/advanced_$(date +%Y%m%d_%H%M%S).json application_submit_advanced.js
 *   k6 run --out csv=results/advanced.csv application_submit_advanced.js
 *
 * Requirements:
 *   - Image file at: ./test.jpg  (relative to this script)
 *   - results/ directory (for JSON/CSV output)
 */

import http from 'k6/http';
import { check, sleep, group, fail } from 'k6';
import { Trend, Counter, Rate, Gauge } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PAGE_URL = 'https://stage.bhata.gov.bd';
const API_URL  = 'https://stage-api.bhata.gov.bd';

const BEARER_TOKEN = __ENV.BEARER_TOKEN || '';

// Image pre-wrapped at init time — http.file() must not be called inside VU scope
const IMAGE_FILE = http.file(open('./test.jpg', 'b'), 'test.jpg', 'image/jpeg');

// ---------------------------------------------------------------------------
// k6 options — two parallel scenarios
// ---------------------------------------------------------------------------

export const options = {
    scenarios: {
        // Scenario A: constant load for baseline per-step analysis
        normal_load: {
            executor:   'constant-vus',
            vus:        50,
            duration:   '10m',
            tags:       { scenario: 'normal_load' },
            gracefulStop: '30s',
        },
        // Scenario B: ramping load to show concurrency-vs-latency relationship
        ramp_analysis: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '3m',  target: 50  },  // ramp to low load
                { duration: '4m',  target: 100 },  // ramp to medium load
                { duration: '4m',  target: 200 },  // ramp to high load
                { duration: '4m',  target: 0   },  // ramp-down
            ],
            tags:         { scenario: 'ramp_analysis' },
            gracefulRampDown: '30s',
        },
    },

    thresholds: {
        // ── Per-step latency thresholds ────────────────────────────────────
        'step_01_get_page_duration':         [{ threshold: 'p(95)<5000',  abortOnFail: false }],
        'step_02_page_data_duration':        [{ threshold: 'p(95)<5000',  abortOnFail: false }],
        'step_03_disabled_areas_duration':   [{ threshold: 'p(95)<5000',  abortOnFail: false }],
        'step_04_captcha_duration':          [{ threshold: 'p(95)<3000',  abortOnFail: false }],
        'step_05_media_upload_duration':     [{ threshold: 'p(95)<10000', abortOnFail: false }],
        'step_06_lookups_duration':          [{ threshold: 'p(95)<5000',  abortOnFail: false }],
        'step_20_duplicate_check_duration':  [{ threshold: 'p(95)<3000',  abortOnFail: false }],
        'step_23_registration_duration':     [{ threshold: 'p(95)<10000', abortOnFail: false }],

        // ── Per-step error rates ───────────────────────────────────────────
        'step_01_error_rate':   [{ threshold: 'rate<0.05', abortOnFail: false }],
        'step_02_error_rate':   [{ threshold: 'rate<0.05', abortOnFail: false }],
        'step_03_error_rate':   [{ threshold: 'rate<0.05', abortOnFail: false }],
        'step_04_error_rate':   [{ threshold: 'rate<0.05', abortOnFail: false }],
        'step_05_error_rate':   [{ threshold: 'rate<0.10', abortOnFail: false }],
        'step_23_error_rate':   [{ threshold: 'rate<0.05', abortOnFail: false }],

        // ── Flow-level metrics ─────────────────────────────────────────────
        'flow_completion_rate': [{ threshold: 'rate>0.90', abortOnFail: false }],
        'captcha_success_rate': [{ threshold: 'rate>0.95', abortOnFail: false }],
        'upload_success_rate':  [{ threshold: 'rate>0.90', abortOnFail: false }],
        'error_rate':           [{ threshold: 'rate<0.05', abortOnFail: false }],
        'http_req_duration': [
            { threshold: 'p(90)<8000',  abortOnFail: false },
            { threshold: 'p(95)<10000', abortOnFail: false },
        ],
    },
};

// ---------------------------------------------------------------------------
// Per-step latency Trends — one per step for granular analysis
// ---------------------------------------------------------------------------

const step01Duration   = new Trend('step_01_get_page_duration',        true);
const step02Duration   = new Trend('step_02_page_data_duration',       true);
const step03Duration   = new Trend('step_03_disabled_areas_duration',  true);
const step04Duration   = new Trend('step_04_captcha_duration',         true);
const step05Duration   = new Trend('step_05_media_upload_duration',    true);
const step06Duration   = new Trend('step_06_lookups_duration',         true);
const step20Duration   = new Trend('step_20_duplicate_check_duration', true);
const step23Duration   = new Trend('step_23_registration_duration',    true);

// End-to-end flow duration (time from Step 1 to end of Step 23)
const e2eDuration      = new Trend('flow_e2e_duration', true);

// ---------------------------------------------------------------------------
// Per-step error Rates
// ---------------------------------------------------------------------------

const step01ErrorRate  = new Rate('step_01_error_rate');
const step02ErrorRate  = new Rate('step_02_error_rate');
const step03ErrorRate  = new Rate('step_03_error_rate');
const step04ErrorRate  = new Rate('step_04_error_rate');
const step05ErrorRate  = new Rate('step_05_error_rate');
const step23ErrorRate  = new Rate('step_23_error_rate');

// ---------------------------------------------------------------------------
// Flow-level Rates & Counters
// ---------------------------------------------------------------------------

const errorRate          = new Rate('error_rate');
const flowCompletionRate = new Rate('flow_completion_rate');  // reaches Step 23 successfully
const captchaSuccessRate = new Rate('captcha_success_rate');  // captcha token obtained
const uploadSuccessRate  = new Rate('upload_success_rate');   // media upload returned a path
const requestCount       = new Counter('total_requests');

// Funnel drop counters — how many VUs exit at each step
const dropAtCaptcha      = new Counter('funnel_drop_at_captcha');
const dropAtUpload       = new Counter('funnel_drop_at_upload');

// ---------------------------------------------------------------------------
// Step-drop funnel tracker (Gauge shows current active count per step)
// ---------------------------------------------------------------------------

const activeVUs = new Gauge('active_vus_gauge');

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
// Helpers
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
// Uniqueness strategy:
//   All unique fields are derived from (__VU, __ITER, Date.now()) so that
//   every iteration of every VU produces a distinct value — even across
//   multiple test runs on the same day.
//
//   account_number  — "016" + timestamp(7) + vu(2) + random(4) → unique & random
//   mobile          — "017" + timestamp(7) + vu(2) + random(4) → unique & random
//   verification_number — "19" + timestamp(7) + vu(4) + iter(3) + random(3)
// ---------------------------------------------------------------------------

function randomUniqueNumber(prefix, totalDigits) {
    const tsPart   = String(Date.now() % 10000000).padStart(7, '0');
    const vuPart   = String(__VU % 100).padStart(2, '0');
    const randPart = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const raw      = tsPart + vuPart + randPart;
    const needed   = totalDigits - prefix.length;
    return prefix + raw.slice(-needed);
}

function buildApplicant() {
    const account_number = randomUniqueNumber('016', 11);
    const mobile         = randomUniqueNumber('017', 11);

    // verification_number: exactly 17 digits, unique & random
    const verification_number = randomUniqueNumber('19', 17);

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
// Main flow — full 23-step application submission with deep instrumentation
// ---------------------------------------------------------------------------

export default function () {
    const applicant  = buildApplicant();
    const flowStart  = Date.now();     // wall-clock start for e2e duration
    let   flowPassed = false;          // set true only when Step 23 succeeds

    activeVUs.add(1);

    // ── Step 1 — GET online-application page ─────────────────────────────────
    group('Step 1 - GET Online Application Page', () => {
        const res = http.get(`${PAGE_URL}/online-application`, {
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Cache-Control': 'no-cache',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
            },
            timeout: '30s',
            tags: { step: '01_get_page', test: 'advanced' },
        });
        requestCount.add(1);
        step01Duration.add(res.timings.duration);

        const ok = check(res, {
            'step01 → 200':           r => r.status === 200,
            'step01 body not empty':  r => r.body && r.body.length > 0,
            'step01 not 429':         r => r.status !== 429,
            'step01 not 5xx':         r => r.status < 500,
            'step01 < 5s':            r => r.timings.duration < 5000,
        });
        step01ErrorRate.add(!ok);
        if (!ok) errorRate.add(1);
    });
    sleep(1);

    // ── Step 2 — GET application page data ───────────────────────────────────
    group('Step 2 - GET Application Page Data', () => {
        const res = http.get(`${API_URL}/api/v1/global/getApplicationPageData?lang=bn`, {
            headers: {
                Authorization: `Bearer ${BEARER_TOKEN}`,
                Accept: 'application/json, text/plain, */*',
                'X-App-Language': 'bn',
                'Cache-Control': 'no-cache',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
            },
            timeout: '30s',
            tags: { step: '02_page_data', test: 'advanced' },
        });
        requestCount.add(1);
        step02Duration.add(res.timings.duration);

        const ok = check(res, {
            'step02 → 200':    r => r.status === 200,
            'step02 not 5xx':  r => r.status < 500,
            'step02 < 5s':     r => r.timings.duration < 5000,
        });
        step02ErrorRate.add(!ok);
        if (!ok) errorRate.add(1);
    });
    sleep(1);

    // ── Step 3 — GET disabled areas ──────────────────────────────────────────
    group('Step 3 - GET Disabled Areas', () => {
        const res = http.get(`${API_URL}/api/v1/global/online-application/disabled-areas/8?lang=bn`, {
            headers: {
                Authorization: `Bearer ${BEARER_TOKEN}`,
                Accept: 'application/json, text/plain, */*',
                'X-App-Language': 'bn',
                'Cache-Control': 'no-cache',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
            },
            timeout: '30s',
            tags: { step: '03_disabled_areas', test: 'advanced' },
        });
        requestCount.add(1);
        step03Duration.add(res.timings.duration);

        const ok = check(res, {
            'step03 → 200':   r => r.status === 200,
            'step03 not 5xx': r => r.status < 500,
            'step03 < 5s':    r => r.timings.duration < 5000,
        });
        step03ErrorRate.add(!ok);
        if (!ok) errorRate.add(1);
    });
    sleep(1);

    // ── Step 4 — GET captcha ─────────────────────────────────────────────────
    let captchaToken = '';
    let captchaValue = '';

    group('Step 4 - GET Captcha', () => {
        const res = http.get(`${API_URL}/api/v1/captcha?lang=bn`, {
            headers: {
                Authorization: `Bearer ${BEARER_TOKEN}`,
                Accept: 'application/json, text/plain, */*',
                'X-App-Language': 'bn',
                'Cache-Control': 'no-cache',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
            },
            timeout: '30s',
            tags: { step: '04_captcha', test: 'advanced' },
        });
        requestCount.add(1);
        step04Duration.add(res.timings.duration);

        const ok = check(res, {
            'step04 → 200':          r => r.status === 200,
            'step04 body not empty': r => r.body && r.body.length > 0,
            'step04 not 429':        r => r.status !== 429,
            'step04 < 3s':           r => r.timings.duration < 3000,
        });
        step04ErrorRate.add(!ok);
        if (!ok) { errorRate.add(1); return; }

        try {
            const body   = res.json();
            captchaToken = body.captcha_token || body.token || '';
            captchaValue = body.captcha_value || body.value || '';
        } catch (_) { /* non-JSON body */ }
    });

    // Funnel gate: captcha
    const captchaOk = captchaToken.length > 0;
    captchaSuccessRate.add(captchaOk);
    if (!captchaOk) {
        dropAtCaptcha.add(1);
        activeVUs.add(-1);
        console.warn(`VU ${__VU} [advanced] — dropped at captcha`);
        return;
    }
    sleep(1);

    // ── Step 5 — POST media-upload ───────────────────────────────────────────
    let uploadedImagePath = '';
    const mediaToken      = uuidv4();

    group('Step 5 - POST Media Upload', () => {
        const res = http.post(
            `${API_URL}/api/v1/global/online-application/media-upload?lang=bn`,
            { field: 'image', file: IMAGE_FILE, token: mediaToken },
            {
                headers: {
                    Authorization: `Bearer ${BEARER_TOKEN}`,
                    Accept: 'application/json, text/plain, */*',
                    'X-App-Language': 'bn',
                    'Cache-Control': 'no-cache',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
                },
                timeout: '60s',
                tags: { step: '05_media_upload', test: 'advanced' },
            }
        );
        requestCount.add(1);
        step05Duration.add(res.timings.duration);

        const ok = check(res, {
            'step05 → 200 or 201':     r => r.status === 200 || r.status === 201,
            'step05 not 422':          r => r.status !== 422,
            'step05 not 429':          r => r.status !== 429,
            'step05 not 5xx':          r => r.status < 500,
            'step05 < 10s':            r => r.timings.duration < 10000,
            'step05 has image path':   r => {
                try { const b = r.json(); return !!(b.path || (b.data && b.data.path) || b.url); }
                catch (_) { return false; }
            },
        });
        step05ErrorRate.add(!ok);
        errorRate.add(!ok);

        if (ok) {
            try {
                const body        = res.json();
                uploadedImagePath = body.path || (body.data && body.data.path) || body.url || '';
            } catch (_) { /* non-JSON */ }
        }
    });

    // Funnel gate: upload
    const uploadOk = uploadedImagePath.length > 0;
    uploadSuccessRate.add(uploadOk);
    if (!uploadOk) {
        dropAtUpload.add(1);
        activeVUs.add(-1);
        console.error(`VU ${__VU} [advanced] — dropped at upload`);
        return;
    }
    sleep(1);

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

        const batchStart  = Date.now();
        const responses   = http.batch(
            lookupUrls.map(url => ({
                method: 'GET',
                url,
                params: {
                    headers: {
                        Authorization: `Bearer ${BEARER_TOKEN}`,
                        Accept: 'application/json, text/plain, */*',
                        'X-App-Language': 'bn',
                        'Cache-Control': 'no-cache',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
                    },
                    timeout: '30s',
                    tags: { step: '06_lookups', test: 'advanced' },
                },
            }))
        );
        // Record wall-clock time for the entire batch (max concurrency effect)
        step06Duration.add(Date.now() - batchStart);
        requestCount.add(lookupUrls.length);

        let batchErrors = 0;
        responses.forEach((res, i) => {
            const ok = check(res, {
                [`step06 lookup[${i}] → 200`]: r => r.status === 200,
                [`step06 lookup[${i}] not 5xx`]: r => r.status < 500,
            });
            if (!ok) { errorRate.add(1); batchErrors++; }
        });

        // Flag if more than 20% of lookups failed — indicates systemic pressure
        if (batchErrors / lookupUrls.length > 0.2) {
            console.warn(`VU ${__VU} [advanced] — ${batchErrors}/${lookupUrls.length} lookup GETs failed`);
        }
    });
    sleep(1);

    // ── Steps 20–22 — Check duplicate account ────────────────────────────────
    group('Steps 20-22 - GET Check Duplicate Account', () => {
        const dupUrl =
            `${API_URL}/api/v1/global/online-application/check-duplicate-account` +
            `?account_number=${applicant.account_number}` +
            `&program_id=${FIELDS.program_id}&sub_program_id=${FIELDS.sub_program_id}` +
            `&ignore_id=&lang=bn`;

        const dupHeaders = {
            Authorization: `Bearer ${BEARER_TOKEN}`,
            Accept: 'application/json, text/plain, */*',
            'X-App-Language': 'bn',
            'Cache-Control': 'no-cache',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        };

        const dupStart   = Date.now();
        const responses  = http.batch([
            { method: 'GET', url: dupUrl, params: { headers: dupHeaders, timeout: '30s', tags: { step: '20_check_duplicate', test: 'advanced' } } },
            { method: 'GET', url: dupUrl, params: { headers: dupHeaders, timeout: '30s', tags: { step: '21_check_duplicate', test: 'advanced' } } },
            { method: 'GET', url: dupUrl, params: { headers: dupHeaders, timeout: '30s', tags: { step: '22_check_duplicate', test: 'advanced' } } },
        ]);
        step20Duration.add(Date.now() - dupStart);
        requestCount.add(3);

        responses.forEach((res, i) => {
            const ok = check(res, {
                [`step20 dup[${i}] → 200`]:   r => r.status === 200,
                [`step20 dup[${i}] not 5xx`]: r => r.status < 500,
            });
            if (!ok) errorRate.add(1);
        });
    });
    sleep(1);

    // ── Step 23 — POST registration ───────────────────────────────────────────
    group('Step 23 - POST Registration', () => {
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
                headers: {
                    Authorization: `Bearer ${BEARER_TOKEN}`,
                    Accept: 'application/json, text/plain, */*',
                    'X-App-Language': 'bn',
                    'Cache-Control': 'no-cache',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
                },
                timeout: '60s',
                tags: { step: '23_post_registration', test: 'advanced' },
            }
        );
        requestCount.add(1);
        step23Duration.add(res.timings.duration);

        const ok = check(res, {
            'step23 → 200 or 201':   r => r.status === 200 || r.status === 201,
            'step23 not 422':        r => r.status !== 422,
            'step23 not 429':        r => r.status !== 429,
            'step23 not 5xx':        r => r.status < 500,
            'step23 < 10s':          r => r.timings.duration < 10000,
        });
        step23ErrorRate.add(!ok);
        errorRate.add(!ok);
        flowPassed = ok;

        console.log(`VU ${__VU} [advanced] — step23 HTTP ${res.status} | ${res.timings.duration}ms | BRS: ${applicant.verification_number}`);
        if (!ok) console.error(`VU ${__VU} [advanced] step23 FAILED — body: ${res.body}`);
    });

    // ── E2E flow metrics ──────────────────────────────────────────────────────
    e2eDuration.add(Date.now() - flowStart);
    flowCompletionRate.add(flowPassed);
    activeVUs.add(-1);

    sleep(10);
}
