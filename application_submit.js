/**
 * Application Submit — Multi-Scenario Load Test
 *
 * Supported test functions (pass via -e TEST_FUNC=<name>):
 *   rampUp   — gradual ramp-up load test  (default)
 *   stress   — aggressive stress test pushing system to limits
 *
 * How to run:
 *   k6 run -e TEST_FUNC=rampUp  application_submit.js
 *   k6 run -e TEST_FUNC=stress  application_submit.js
 *   k6 run application_submit.js          ← defaults to rampUp
 *
 * Mirrors application_submit.jmx flow:
 *   1.  GET  /online-application
 *   2.  GET  /api/v1/global/getApplicationPageData
 *   3.  GET  /api/v1/global/online-application/disabled-areas/9
 *   4.  GET  /api/v1/captcha  → extract captcha_token + captcha_value
 *   5.  GET  /api/v1/global/district/get/3
 *   6-18. GET lookup endpoints (district / thana / union / ward / payment) batched
 *  19.  GET  /api/v1/global/online-application/check-duplicate-account
 *  20.  POST /api/v1/global/online-application/registration (multipart + image)
 *
 * CSV file required: verification_numbers.csv
 * Image file required: test.jpg (see IMAGE_BYTES path below)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import encoding from 'k6/encoding';
// import { SharedArray } from 'k6/data';

// ── Select test function via env var ──────────────────────────────────────────
// Valid values: "rampUp" | "stress"   (case-sensitive)
const TEST_FUNC = __ENV.TEST_FUNC || 'rampUp';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL_1   = 'https://stage.bhata.gov.bd';
const BASE_URL_2   = 'https://stage-api.bhata.gov.bd';
const BEARER_TOKEN = '337274|R3xxrFTQm7P1x2AbUh5rX4NtX9X5nnb9UIcXbXCr5c0795b0';

// Static application payload fields (same for all VUs — from JMX)
const ACCOUNT_TYPE      = '2';
const PROGRAM_ID        = '22';
const SUB_PROGRAM_ID    = '9';
const THANA_ID          = '220';
const DIVISION_ID       = '3';
const DISTRICT_ID       = '3';
const UNION_ID          = '220';
const WARD_ID_UNION     = '17940';
const PERMANENT_THANA   = '220';
const PERMANENT_UNION   = '2340';
const PROFESSION        = '181';
const NATIONALITY       = '105';
const GENDER_ID         = '23';
const RELIGION          = '96';
const MARITAL_STATUS    = '101';
const EDUCATION_STATUS  = '25';
const LOCATION_TYPE     = '1';
const SUB_LOCATION_TYPE = '2';
const MFS_NAME          = '1';
const IS_BANK_MFS_MANDATORY = '1';

const APPLICATION_PMT = JSON.stringify([
    {"variable_id":576,"sub_variables":577},
    {"variable_id":530,"sub_variables":531},
    {"variable_id":571,"sub_variables":573},
    {"variable_id":1,"sub_variables":443},
    {"variable_id":7,"sub_variables":331},
    {"variable_id":12,"sub_variables":439},
    {"variable_id":14,"sub_variables":382},
    {"variable_id":18,"sub_variables":409},
    {"variable_id":36,"sub_variables":298},
    {"variable_id":33,"sub_variables":291},
    {"variable_id":536,"sub_variables":[538]},
    {"variable_id":393,"sub_variables":397},
    {"variable_id":30,"sub_variables":339},
    {"variable_id":40,"sub_variables":400},
    {"variable_id":548,"sub_variables":552},
    {"variable_id":579,"sub_variables":583},
    {"variable_id":41,"sub_variables":387},
    {"variable_id":567,"sub_variables":569},
    {"variable_id":25,"sub_variables":405},
    {"variable_id":29,"sub_variables":275},
    {"variable_id":22,"sub_variables":403},
    {"variable_id":595,"sub_variables":598},
    {"variable_id":47,"sub_variables":[425]},
    {"variable_id":500,"sub_variables":502},
]);

// ── Static applicant base (overridden per VU at runtime) ─────────────────────
const STATIC_APPLICANT = {
    name_bn:        'পরীক্ষা ব্যবহারকারী',
    name_en:        'Test User',
    father_name_bn: 'পিতার নাম',
    father_name_en: 'Father Name',
    mother_name_bn: 'মাতার নাম',
    mother_name_en: 'Mother Name',
    mobile:         '01700000000',
};

// ── CSV upload logic (commented out — using random generation instead) ────────
// const VN_DATA = new SharedArray('verification_numbers', () => {
//     const rows = open('./verification_numbers.csv').split('\n');
//     return rows
//         .slice(1)                        // skip header row
//         .filter(line => line.trim())     // skip blank lines
//         .map(line => {
//             const cols = line.split(',');
//             return {
//                 verification_number: cols[0].trim(),
//                 date_of_birth:       cols[1].trim(),
//                 name_bn:             cols[2].trim(),
//                 name_en:             cols[3].trim(),
//                 father_name_bn:      cols[4].trim(),
//                 father_name_en:      cols[5].trim(),
//                 mother_name_bn:      cols[6].trim(),
//                 mother_name_en:      cols[7].trim(),
//                 mobile:              cols[8].trim(),
//                 account_number:      cols[9].trim(),
//             };
//         });
// });

// ── Load test image once (shared across all VUs) ──────────────────────────────
// Update the path below to point to your actual test image on disk.
const IMAGE_BYTES = open('D:/Placeholder/test.jpg', 'b');

// ── Custom Metrics ────────────────────────────────────────────────────────────
const registrationDuration = new Trend('registration_duration', true);
const captchaFetchDuration  = new Trend('captcha_fetch_duration', true);
const requestCount          = new Counter('total_requests');
const errorRate             = new Rate('error_rate');

// ── Scenario stages ───────────────────────────────────────────────────────────

/**
 * rampUp stages
 *
 * Gradually increases load to validate the system handles real traffic growth.
 * Mirrors the original JMX config (200 threads, ramp 300 s).
 *
 *   0 → 500  VUs over 1 min   — warm up
 *   500 → 2000 over 1 min     — approach normal load
 *   2000 → 4000 over 1 min    — full load
 *   hold 4000 for 5 min       — sustained load plateau
 *   4000 → 200  over 2 min    — cool down
 */
const RAMP_UP_STAGES = [
    { duration: '10s', target: 1  },
    { duration: '1m', target: 2000 },
    { duration: '1m', target: 4000 },
    { duration: '5m', target: 4000 },
    { duration: '2m', target: 200  },
];

/**
 * stress stages
 *
 * Pushes the system beyond normal limits to find its breaking point.
 * Observes failure patterns, error types, and recovery behaviour.
 *
 *   0 → 500  VUs over 1 min   — warm up
 *   500 → 2000 over 2 min     — ramp up
 *   2000 → 5000 over 3 min    — increase stress
 *   hold 5000 → 8000 over 5m  — peak stress
 *   8000 → 0   over 2 min     — ramp-down / recovery check
 */
const STRESS_STAGES = [
    { duration: '1m', target: 500  },
    { duration: '2m', target: 2000 },
    { duration: '3m', target: 5000 },
    { duration: '5m', target: 8000 },
    { duration: '2m', target: 0    },
];

// ── Thresholds (shared) ───────────────────────────────────────────────────────
const SHARED_THRESHOLDS = {
    'registration_duration': [{ threshold: 'p(95)<10000', abortOnFail: false }],
    'captcha_fetch_duration': [{ threshold: 'p(95)<3000',  abortOnFail: false }],
    'error_rate':             [{ threshold: 'rate<0.10',   abortOnFail: false }],
    'http_req_duration': [
        { threshold: 'p(90)<8000',  abortOnFail: false },
        { threshold: 'p(95)<10000', abortOnFail: false },
    ],
};

// ── Dynamic options based on TEST_FUNC ────────────────────────────────────────
export const options = {
    scenarios: {
        application_submit: {
            executor:         'ramping-vus',
            stages:           TEST_FUNC === 'stress' ? STRESS_STAGES : RAMP_UP_STAGES,
            gracefulRampDown: '30s',
        },
    },
    thresholds: SHARED_THRESHOLDS,
};

// ── Shared headers ────────────────────────────────────────────────────────────
const API_HEADERS = {
    'Authorization':  `Bearer ${BEARER_TOKEN}`,
    'Accept':         'application/json, text/plain, */*',
    'X-App-Language': 'bn',
};

const PAGE_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper — builds a random applicant, guaranteed non-null verification_number
// ─────────────────────────────────────────────────────────────────────────────
function buildApplicant() {
    // Generate verification_number: "19" or "20" + 15 digits
    // Retry until we get a non-null, non-empty value (should always succeed on first try,
    // but the loop protects against any edge-case where string generation returns falsy).
    let verification_number = '';
    let attempts = 0;
    while (!verification_number && attempts < 10) {
        const vnPrefixes = ['19', '20'];
        const vnPrefix   = vnPrefixes[Math.floor(Math.random() * vnPrefixes.length)];
        const vnSuffix   = String(Math.floor(Math.random() * 1e15)).padStart(15, '0');
        const candidate  = `${vnPrefix}${vnSuffix}`;
        if (candidate && candidate.length > 0) {
            verification_number = candidate;
        }
        attempts++;
    }

    if (!verification_number) {
        // Absolute fallback — should never happen
        verification_number = '1990010112345678' + String(__VU).padStart(1, '0');
        console.error(`VU ${__VU} — verification_number generation failed; using fallback: ${verification_number}`);
    }

    // Random account_number: valid BD mobile-banking prefix + 8 random digits
    const prefixes       = ['016', '019', '013', '015', '017', '018'];
    const prefix         = prefixes[Math.floor(Math.random() * prefixes.length)];
    const randomSuffix   = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
    const account_number = `${prefix}${randomSuffix}`;

    // Birth year range: 1960–2000  →  age range 26–66 (strictly > 25)
    const birthYear    = 1960 + ((__VU - 1) % 41);
    const dobFormatted = `${birthYear}-06-15`;
    const age          = 2026 - birthYear;

    return {
        ...STATIC_APPLICANT,
        verification_number,
        account_number,
        date_of_birth: dobFormatted,
        age:           String(age),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper — executes the full 20-step application submit flow
// ─────────────────────────────────────────────────────────────────────────────
function runApplicationFlow() {
    const applicant = buildApplicant();

    console.log(`VU ${__VU} [${TEST_FUNC}] → BRS: ${applicant.verification_number} | acc: ${applicant.account_number}`);

    // ── Step 1: GET Online Application Page ──────────────────────────────────
    group('Step 1 - GET Online Application Page', () => {
        const res = http.get(`${BASE_URL_1}/online-application`, {
            headers: PAGE_HEADERS,
            timeout: '30s',
            tags: { step: '01_get_page', test: TEST_FUNC },
        });
        requestCount.add(1);

        const ok = check(res, {
            'GET page → 200':      (r) => r.status === 200,
            'GET page < 5s':       (r) => r.timings.duration < 5000,
            'GET page not 429':    (r) => r.status !== 429,
        });
        if (!ok) errorRate.add(1);
    });

    sleep(1);

    // ── Step 2: GET Application Page Data ────────────────────────────────────
    group('Step 2 - GET getApplicationPageData', () => {
        const res = http.get(`${BASE_URL_2}/api/v1/global/getApplicationPageData?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags: { step: '02_get_page_data', test: TEST_FUNC },
        });
        requestCount.add(1);
        check(res, { 'GET pageData → 200': (r) => r.status === 200 });
    });

    sleep(1);

    // ── Step 3: GET Disabled Areas ───────────────────────────────────────────
    group('Step 3 - GET Disabled Areas', () => {
        const res = http.get(`${BASE_URL_2}/api/v1/global/online-application/disabled-areas/9?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags: { step: '03_disabled_areas', test: TEST_FUNC },
        });
        requestCount.add(1);
        check(res, { 'GET disabled-areas → 200': (r) => r.status === 200 });
    });

    sleep(1);

    // ── Step 4: GET Captcha — extract token + value ───────────────────────────
    let captchaToken = '';
    let captchaValue = '';

    group('Step 4 - GET Captcha', () => {
        const res = http.get(`${BASE_URL_2}/api/v1/captcha?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags: { step: '04_captcha', test: TEST_FUNC },
        });
        requestCount.add(1);
        captchaFetchDuration.add(res.timings.duration);

        const ok = check(res, {
            'GET captcha → 200':    (r) => r.status === 200,
            'GET captcha has body': (r) => r.body && r.body.length > 0,
            'GET captcha not 429':  (r) => r.status !== 429,
        });

        if (!ok) { errorRate.add(1); return; }

        try {
            const body  = res.json();
            captchaToken = body.captcha_token || body.token || '';
            captchaValue = body.captcha_value || body.value || '';
        } catch (_) {
            captchaToken = '';
            captchaValue = '';
        }

        if (!captchaToken) {
            console.warn(`VU ${__VU} — captcha_token not found. body: ${res.body}`);
            errorRate.add(1);
        }
    });

    sleep(1);

    // ── Steps 5–18: Batched lookup GETs ──────────────────────────────────────
    group('Steps 5-18 - Lookup GETs', () => {
        const lookups = [
            `${BASE_URL_2}/api/v1/global/district/get/3?lang=bn`,
            `${BASE_URL_2}/api/v1/global/thana/get/28?lang=bn`,
            `${BASE_URL_2}/api/v1/global/payment-processors/28?lang=bn`,
            `${BASE_URL_2}/api/v1/global/thana/get/28?lang=bn`,
            `${BASE_URL_2}/api/v1/global/union/get/220?lang=bn`,
            `${BASE_URL_2}/api/v1/global/union/get/220?lang=bn`,
            `${BASE_URL_2}/api/v1/global/ward/get/2340?lang=bn`,
            `${BASE_URL_2}/api/v1/global/payment-processors/17940?lang=bn`,
            `${BASE_URL_2}/api/v1/global/district/get/3?lang=bn`,
            `${BASE_URL_2}/api/v1/global/thana/get/28?lang=bn`,
            `${BASE_URL_2}/api/v1/global/thana/get/28?lang=bn`,
            `${BASE_URL_2}/api/v1/global/union/get/220?lang=bn`,
            `${BASE_URL_2}/api/v1/global/ward/get/2340?lang=bn`,
            `${BASE_URL_2}/api/v1/global/thana/get/28?lang=bn`,
        ];

        const responses = http.batch(
            lookups.map(url => ({
                method: 'GET',
                url,
                params: { headers: API_HEADERS, timeout: '30s', tags: { step: '05_lookups', test: TEST_FUNC } },
            }))
        );

        requestCount.add(lookups.length);
        responses.forEach((res, i) => {
            const ok = check(res, { [`lookup[${i}] → 200`]: (r) => r.status === 200 });
            if (!ok) errorRate.add(1);
        });
    });

    sleep(1);

    // ── Step 19: GET Check Duplicate Account ─────────────────────────────────
    group('Step 19 - GET Check Duplicate Account', () => {
        const dupRes = http.get(
            `${BASE_URL_2}/api/v1/global/online-application/check-duplicate-account` +
            `?account_number=${applicant.account_number}` +
            `&program_id=${PROGRAM_ID}` +
            `&sub_program_id=${SUB_PROGRAM_ID}` +
            `&ignore_id=` +
            `&lang=bn`,
            {
                headers: API_HEADERS,
                timeout: '30s',
                tags: { step: '19_check_duplicate', test: TEST_FUNC },
            }
        );
        requestCount.add(1);
        check(dupRes, { 'GET check-duplicate → 200': (r) => r.status === 200 });
    });

    sleep(1);

    // ── Step 20: POST Registration (multipart/form-data with image) ───────────
    group('Step 20 - POST Registration', () => {
        if (!captchaToken) {
            console.warn(`VU ${__VU} — skipping POST: no captcha_token`);
            errorRate.add(1);
            return;
        }

        const formData = {
            lang:            'bn',
            account_type:    ACCOUNT_TYPE,
            application_pmt: APPLICATION_PMT,
            thana_id:        THANA_ID,
            division_id:     DIVISION_ID,
            district_id:     DISTRICT_ID,
            program_id:      PROGRAM_ID,
            sub_program_id:  SUB_PROGRAM_ID,

            verification_number: applicant.verification_number,
            verification_type:   '2',
            name_bn:             applicant.name_bn,
            name_en:             applicant.name_en,
            father_name_bn:      applicant.father_name_bn,
            father_name_en:      applicant.father_name_en,
            mother_name_bn:      applicant.mother_name_bn,
            mother_name_en:      applicant.mother_name_en,
            date_of_birth:       applicant.date_of_birth,
            age:                 applicant.age,
            gender_id:           GENDER_ID,
            religion:            RELIGION,
            marital_status:      MARITAL_STATUS,
            education_status:    EDUCATION_STATUS,
            nationality:         NATIONALITY,
            profession:          PROFESSION,

            location_type:               LOCATION_TYPE,
            sub_location_type:           SUB_LOCATION_TYPE,
            union_id:                    UNION_ID,
            ward_id_union:               WARD_ID_UNION,
            permanent_thana_id:          PERMANENT_THANA,
            permanent_union_id:          PERMANENT_UNION,
            permanent_location_type:     LOCATION_TYPE,
            permanent_sub_location_type: SUB_LOCATION_TYPE,
            permanent_district_id:       DISTRICT_ID,
            permanent_division_id:       DIVISION_ID,
            address:                     'C',
            permanent_address:           'C',
            post_code:                   '1234',
            permanent_post_code:         '1234',

            mobile:               applicant.mobile,
            account_number:       applicant.account_number,
            account_name:         'Test',
            account_owner:        '142',
            mfs_name:             MFS_NAME,
            is_bank_mfs_mandatory: IS_BANK_MFS_MANDATORY,

            no_of_people_score:   '-7',
            per_room_score:       '-7',
            no_of_room:           '502',
            house_size:           '2',
            is_nominnee_optional: '0',

            captcha_token: captchaToken,
            captcha_value: captchaValue,

            // Multipart binary image — k6 sets Content-Type automatically
            image: http.file(IMAGE_BYTES, 'test.jpg', 'image/jpeg'),
        };

        const res = http.post(
            `${BASE_URL_2}/api/v1/global/online-application/registration?lang=bn`,
            formData,
            {
                headers: {
                    'Authorization':  `Bearer ${BEARER_TOKEN}`,
                    'Accept':         'application/json, text/plain, */*',
                    'X-App-Language': 'bn',
                    // Do NOT set Content-Type — k6 sets multipart/form-data + boundary automatically
                },
                timeout: '60s',
                tags: { step: '20_post_registration', test: TEST_FUNC },
            }
        );
        requestCount.add(1);
        registrationDuration.add(res.timings.duration);

        const ok = check(res, {
            'POST registration → 200 or 201': (r) => r.status === 200 || r.status === 201,
            'POST registration not 422':      (r) => r.status !== 422,
            'POST registration not 429':      (r) => r.status !== 429,
            'POST registration not 5xx':      (r) => r.status < 500,
            'POST registration < 10s':        (r) => r.timings.duration < 10000,
        });
        errorRate.add(!ok);

        console.log(
            `VU ${__VU} [${TEST_FUNC}] | registration → HTTP ${res.status} | ` +
            `${res.timings.duration}ms | captcha: ${captchaToken} | BRS: ${applicant.verification_number}`
        );

        if (res.status === 422 || res.status === 429 || res.status >= 500) {
            console.error(`VU ${__VU} | FAILED body: ${res.body}`);
        }
    });

    sleep(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// rampUp — gradual load test
//
// Run: k6 run -e TEST_FUNC=rampUp application_submit.js
//
// Stages:
//   0 → 500  over 1 min   warm up
//   500 → 2000 over 1 min  approach normal load
//   2000 → 4000 over 1 min full load
//   hold 4000 for 5 min    sustained plateau
//   4000 → 200 over 2 min  cool down
// ─────────────────────────────────────────────────────────────────────────────
export function rampUp() {
    runApplicationFlow();
}

// ─────────────────────────────────────────────────────────────────────────────
// stress — aggressive stress test
//
// Run: k6 run -e TEST_FUNC=stress application_submit.js
//
// Stages:
//   0 → 500  over 1 min   warm up
//   500 → 2000 over 2 min  ramp up
//   2000 → 5000 over 3 min increase stress
//   5000 → 8000 over 5 min peak stress
//   8000 → 0   over 2 min  ramp-down / recovery check
// ─────────────────────────────────────────────────────────────────────────────
export function stress() {
    runApplicationFlow();
}

// ─────────────────────────────────────────────────────────────────────────────
// default export — routes to the selected function
// ─────────────────────────────────────────────────────────────────────────────
export default function () {
    if (TEST_FUNC === 'stress') {
        stress();
    } else {
        rampUp();
    }
}
