/**
 * Application Submit — Load Test
 *
 * Mirrors application_submit.jmx exactly:
 *   1. GET  /online-application          (page load)
 *   2. GET  /api/v1/global/getApplicationPageData
 *   3. GET  /api/v1/global/online-application/disabled-areas/9
 *   4. GET  /api/v1/captcha               → extract captcha_token + captcha_value
 *   5. GET  /api/v1/global/district/get/3
 *   6. GET  /api/v1/global/thana/get/28
 *   7. GET  /api/v1/global/payment-processors/28
 *   8. GET  /api/v1/global/thana/get/28   (repeat — browser behaviour)
 *   9. GET  /api/v1/global/union/get/220
 *  10. GET  /api/v1/global/union/get/220   (repeat)
 *  11. GET  /api/v1/global/ward/get/2340
 *  12. GET  /api/v1/global/payment-processors/17940
 *  13. GET  /api/v1/global/district/get/3  (repeat)
 *  14. GET  /api/v1/global/thana/get/28    (repeat)
 *  15. GET  /api/v1/global/thana/get/28    (repeat)
 *  16. GET  /api/v1/global/union/get/220   (repeat)
 *  17. GET  /api/v1/global/ward/get/2340   (repeat)
 *  18. GET  /api/v1/global/thana/get/28    (repeat)
 *  19. GET  /api/v1/global/online-application/check-duplicate-account
 *  20. POST /api/v1/global/online-application/registration (multipart + image)
 *
 * JMeter config: 200 threads, ramp 300s, 1 loop
 * k6 equivalent: ramping-vus 0→200 over 5m, hold 5m, ramp-down 1m
 *
 * How to run:
 *   k6 run application_submit.js
 *
 * CSV file required: verification_numbers.csv
 * Image file required: test.jpg  (place next to this script)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
// import { SharedArray } from 'k6/data'; // unused — CSV method commented out
import encoding from 'k6/encoding';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL_1 = 'https://stage.bhata.gov.bd';
const BASE_URL_2 = 'https://stage-api.bhata.gov.bd';
const BEARER_TOKEN = '337274|R3xxrFTQm7P1x2AbUh5rX4NtX9X5nnb9UIcXbXCr5c0795b0';

// Static application payload fields (same for all VUs — from JMX)
const ACCOUNT_TYPE     = '2';
const PROGRAM_ID       = '22';
const SUB_PROGRAM_ID   = '9';
const THANA_ID         = '220';
const DIVISION_ID      = '3';
const DISTRICT_ID      = '3';
const UNION_ID         = '220';
const WARD_ID_UNION    = '17940';
const PERMANENT_THANA  = '220';
const PERMANENT_UNION  = '2340';
const PROFESSION       = '181';
const NATIONALITY      = '105';
const GENDER_ID        = '23';
const RELIGION         = '96';
const MARITAL_STATUS   = '101';
const EDUCATION_STATUS = '25';
const LOCATION_TYPE    = '1';        // union area
const SUB_LOCATION_TYPE = '2';
const MFS_NAME         = '1';
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

// ── CSV data — unique verification_number per VU ──────────────────────────────
// File: verification_numbers.csv  (same folder as this script)
//
// Rules enforced at load time:
//   verification_number — exactly 17 digits, must start with "19"
//                         (Bangladesh NID format)
//   account_number      — exactly 11 digits, must start with one of:
//                         016, 017, 018, 019, 013
//                         (valid BD mobile-banking prefixes)
//   Each row must be unique — no duplicate verification_number or account_number
//
// Replace placeholder rows with real valid NIDs from your staging database.
//
// Columns: verification_number, date_of_birth, name_bn, name_en,
//          father_name_bn, father_name_en, mother_name_bn, mother_name_en,
//          mobile, account_number
//
// const applicants = new SharedArray('applicants', function () {
//     const rows = open('./verification_numbers.csv')
//         .split('\n')
//         .slice(1)                          // skip header row
//         .filter(line => line.trim() !== '')
//         .map((line, idx) => {
//             const cols = line.split(',');
//             const vn = cols[0].trim();
//             const an = cols[9].trim();
//
//             // ── Validation: verification_number ──────────────────────────
//             if (vn.length !== 17) {
//                 throw new Error(
//                     `CSV row ${idx + 2}: verification_number "${vn}" must be exactly 17 digits (got ${vn.length})`
//                 );
//             }
//             if (!vn.startsWith('19')) {
//                 throw new Error(
//                     `CSV row ${idx + 2}: verification_number "${vn}" must start with "19"`
//                 );
//             }
//             if (!/^\d{17}$/.test(vn)) {
//                 throw new Error(
//                     `CSV row ${idx + 2}: verification_number "${vn}" must contain only digits`
//                 );
//             }
//
//             // ── Validation: account_number ───────────────────────────────
//             if (an.length !== 11) {
//                 throw new Error(
//                     `CSV row ${idx + 2}: account_number "${an}" must be exactly 11 digits (got ${an.length})`
//                 );
//             }
//             if (!/^0(16|17|18|19|13)\d{8}$/.test(an)) {
//                 throw new Error(
//                     `CSV row ${idx + 2}: account_number "${an}" must start with 016/017/018/019/013 and be 11 digits`
//                 );
//             }
//
//             return {
//                 verification_number: vn,
//                 date_of_birth:       cols[1].trim(),
//                 name_bn:             cols[2].trim(),
//                 name_en:             cols[3].trim(),
//                 father_name_bn:      cols[4].trim(),
//                 father_name_en:      cols[5].trim(),
//                 mother_name_bn:      cols[6].trim(),
//                 mother_name_en:      cols[7].trim(),
//                 mobile:              cols[8].trim(),
//                 account_number:      an,
//             };
//         });
//
//     // ── Uniqueness check ──────────────────────────────────────────────────
//     const seenVN = new Set();
//     const seenAN = new Set();
//     rows.forEach((r, idx) => {
//         if (seenVN.has(r.verification_number)) {
//             throw new Error(`CSV row ${idx + 2}: duplicate verification_number "${r.verification_number}"`);
//         }
//         if (seenAN.has(r.account_number)) {
//             throw new Error(`CSV row ${idx + 2}: duplicate account_number "${r.account_number}"`);
//         }
//         seenVN.add(r.verification_number);
//         seenAN.add(r.account_number);
//     });
//
//     return rows;
// });

// ── Static applicant fields (shared across all VUs) ───────────────────────────
// verification_number, account_number, and date_of_birth are generated uniquely per VU.
const STATIC_APPLICANT = {
    name_bn:        'পরীক্ষা ব্যবহারকারী',
    name_en:        'Test User',
    father_name_bn: 'পিতার নাম',
    father_name_en: 'Father Name',
    mother_name_bn: 'মাতার নাম',
    mother_name_en: 'Mother Name',
    mobile:         '01700000000',
};

// ── Load test image once (shared across all VUs) ──────────────────────────────
// Loaded from an absolute drive path so k6 finds it regardless of working directory.
// Update the path below to point to your actual test image on disk.
const IMAGE_BYTES = open('D:/Placeholder/test.jpg', 'b');

// ── Custom Metrics ────────────────────────────────────────────────────────────
const registrationDuration = new Trend('registration_duration', true);
const captchaFetchDuration  = new Trend('captcha_fetch_duration', true);
const requestCount          = new Counter('total_requests');
const errorRate             = new Rate('error_rate');

// ── Test Configuration ────────────────────────────────────────────────────────
// Mirrors JMX: 200 threads, ramp 300s (5m), 1 loop
export const options = {
    scenarios: {
        application_submit: {
            executor: 'ramping-vus',
            stages: [
                { duration: '1m',  target: 500 },   // ramp-up  (JMX ramp_time=300s)
                { duration: '1m',  target: 1000 },   // hold at peak
                { duration: '1m',  target: 20   },   // ramp-down
            ],
            gracefulRampDown: '30s',
        },
    },
    thresholds: {
        'registration_duration': [{ threshold: 'p(95)<10000', abortOnFail: false }],
        'captcha_fetch_duration': [{ threshold: 'p(95)<3000',  abortOnFail: false }],
        'error_rate':             [{ threshold: 'rate<0.05',   abortOnFail: false }],
        'http_req_duration':      [
            { threshold: 'p(90)<8000',  abortOnFail: false },
            { threshold: 'p(95)<10000', abortOnFail: false },
        ],
    },
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

// ── Main ──────────────────────────────────────────────────────────────────────
export default function () {

    // Generate unique verification_number, account_number, and date_of_birth per VU.
    // verification_number: 17 digits, randomly starts with "19" or "20" + 15 random digits.
    // Generate unique verification_number, account_number, and date_of_birth per VU.
    // verification_number: 17 digits, randomly starts with "19" or "20" + 15 random digits.
    // account_number:      11 digits, random prefix (016/019/013/015/017/018) + 8 random digits.
    // date_of_birth:       unique year per VU cycling from 1960 to 2000 (all adults).
    // age:                 computed from date_of_birth relative to current year.

    // Random verification_number: prefix "19" or "20", followed by 15 random digits.
    const vnPrefixes          = ['19', '20'];
    const vnPrefix            = vnPrefixes[Math.floor(Math.random() * vnPrefixes.length)];
    const vnSuffix            = String(Math.floor(Math.random() * 1e15)).padStart(15, '0');
    const verification_number = `${vnPrefix}${vnSuffix}`;

    // Random account_number: pick a random valid prefix + 8 truly random digits
    const prefixes     = ['016', '019', '013', '015', '017', '018'];
    const prefix       = prefixes[Math.floor(Math.random() * prefixes.length)];
    const randomSuffix = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
    const account_number = `${prefix}${randomSuffix}`;

    // Birth year range: 1960–2000  →  age range: 26–66 (all strictly > 25).
    // Calculated from base year 2026: youngest valid = 2026 - 26 = 2000.
    const birthYear    = 1960 + ((__VU - 1) % 41);  // cycles through 41 years (1960–2000)
    const dobFormatted = `${birthYear}-06-15`;        // YYYY-MM-DD
    const age          = 2026 - birthYear;            // always between 26 and 66

    const applicant = {
        ...STATIC_APPLICANT,
        verification_number,
        account_number,
        date_of_birth: dobFormatted,
        age:           String(age),
    };

    console.log(`VU ${__VU} → verification_number: ${applicant.verification_number} | account_number: ${applicant.account_number}`);

    // ── Step 1: GET Online Application Page ──────────────────────────────────
    group('Step 1 - GET Online Application Page', () => {
        const res = http.get(`${BASE_URL_1}/online-application`, {
            headers: PAGE_HEADERS,
            timeout: '30s',
            tags: { step: '01_get_page' },
        });
        requestCount.add(1);

        const ok = check(res, {
            'GET page → 200': (r) => r.status === 200,
            'GET page < 5s':  (r) => r.timings.duration < 5000,
        });
        if (!ok) errorRate.add(1);
    });

    sleep(1);

    // ── Step 2: GET Application Page Data ────────────────────────────────────
    group('Step 2 - GET getApplicationPageData', () => {
        const res = http.get(`${BASE_URL_2}/api/v1/global/getApplicationPageData?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags: { step: '02_get_page_data' },
        });
        requestCount.add(1);

        check(res, {
            'GET pageData → 200': (r) => r.status === 200,
        });
    });

    sleep(1);

    // ── Step 3: GET Disabled Areas ───────────────────────────────────────────
    group('Step 3 - GET Disabled Areas', () => {
        const res = http.get(`${BASE_URL_2}/api/v1/global/online-application/disabled-areas/9?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags: { step: '03_disabled_areas' },
        });
        requestCount.add(1);

        check(res, {
            'GET disabled-areas → 200': (r) => r.status === 200,
        });
    });

    sleep(1);

    // ── Step 4: GET Captcha — extract token + value ───────────────────────────
    let captchaToken = '';
    let captchaValue = '';

    group('Step 4 - GET Captcha', () => {
        const res = http.get(`${BASE_URL_2}/api/v1/captcha?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags: { step: '04_captcha' },
        });
        requestCount.add(1);
        captchaFetchDuration.add(res.timings.duration);

        const ok = check(res, {
            'GET captcha → 200':     (r) => r.status === 200,
            'GET captcha has body':  (r) => r.body && r.body.length > 0,
        });

        if (!ok) {
            errorRate.add(1);
            return;
        }

        // Extract captcha_token and captcha_value from response
        // Adjust JSON path if your API returns a different key name
        try {
            const body = res.json();
            captchaToken = body.captcha_token || body.token || '';
            captchaValue = body.captcha_value || body.value || '';
        } catch (_) {
            captchaToken = '';
            captchaValue = '';
        }

        if (!captchaToken) {
            console.warn(`VU ${__VU} — captcha_token not found. Check response: ${res.body}`);
            errorRate.add(1);
        }
    });

    sleep(1);

    // ── Steps 5–18: Lookup GETs (district / thana / union / ward / payment) ───
    // These mirror the repeated GET calls in the JMX. Run them as a batch
    // to match the parallel browser behaviour recorded in JMeter.
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
                params: { headers: API_HEADERS, timeout: '30s', tags: { step: '05_lookups' } },
            }))
        );

        requestCount.add(lookups.length);

        responses.forEach((res, i) => {
            const ok = check(res, {
                [`lookup[${i}] → 200`]: (r) => r.status === 200,
            });
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
                tags: { step: '19_check_duplicate' },
            }
        );
        requestCount.add(1);

        check(dupRes, {
            'GET check-duplicate → 200': (r) => r.status === 200,
        });
    });

    sleep(1);

    // ── Step 20: POST Registration (multipart/form-data with image) ───────────
    group('Step 20 - POST Registration', () => {

        if (!captchaToken) {
            console.warn(`VU ${__VU} — skipping POST: no captcha_token`);
            errorRate.add(1);
            return;
        }

        // Build multipart form-data body
        // k6 builds multipart automatically when you pass an object with
        // http.file() entries mixed with plain string fields.
        const formData = {
            // Query param
            lang: 'bn',

            // Core fields
            account_type:     ACCOUNT_TYPE,
            application_pmt:  APPLICATION_PMT,
            thana_id:         THANA_ID,
            division_id:      DIVISION_ID,
            district_id:      DISTRICT_ID,
            program_id:       PROGRAM_ID,
            sub_program_id:   SUB_PROGRAM_ID,

            // Applicant identity — from CSV
            verification_number: applicant.verification_number,
            verification_type:   '2',              // NID=2, birth cert=1
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

            // Location
            location_type:              LOCATION_TYPE,
            sub_location_type:          SUB_LOCATION_TYPE,
            union_id:                   UNION_ID,
            ward_id_union:              WARD_ID_UNION,
            permanent_thana_id:         PERMANENT_THANA,
            permanent_union_id:         PERMANENT_UNION,
            permanent_location_type:    LOCATION_TYPE,
            permanent_sub_location_type: SUB_LOCATION_TYPE,
            permanent_district_id:      DISTRICT_ID,
            permanent_division_id:      DIVISION_ID,
            address:                    'C',
            permanent_address:          'C',
            post_code:                  '1234',
            permanent_post_code:        '1234',

            // Payment / bank
            mobile:               applicant.mobile,
            account_number:       applicant.account_number,
            account_name:         'Test',
            account_owner:        '142',
            mfs_name:             MFS_NAME,
            is_bank_mfs_mandatory: IS_BANK_MFS_MANDATORY,

            // Scores
            no_of_people_score: '-7',
            per_room_score:     '-7',
            no_of_room:         '502',
            house_size:         '2',
            is_nominnee_optional: '0',

            // Captcha — extracted live from Step 4
            captcha_token: captchaToken,
            captcha_value: captchaValue,

            // Image upload — multipart binary (required field)
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
                    // DO NOT set Content-Type manually — k6 sets it automatically
                    // to multipart/form-data with boundary when http.file() is used
                },
                timeout: '60s',
                tags: { step: '20_post_registration' },
            }
        );
        requestCount.add(1);
        registrationDuration.add(res.timings.duration);

        const ok = check(res, {
            'POST registration → 200 or 201': (r) => r.status === 200 || r.status === 201,
            'POST registration not 422':      (r) => r.status !== 422,
            'POST registration not 5xx':      (r) => r.status < 500,
            'POST registration < 10s':        (r) => r.timings.duration < 10000,
        });

        errorRate.add(!ok);

        // Log status for debugging — check View Results Tree equivalent
        console.log(
            `VU ${__VU} | registration → HTTP ${res.status} | ` +
            `${res.timings.duration}ms | captcha_token: ${captchaToken} | ` +
            `verification: ${applicant.verification_number}`
        );

        // Log response body on failure so you can see exact validation error
        if (res.status === 422 || res.status >= 500) {
            console.error(`VU ${__VU} | FAILED body: ${res.body}`);
        }
    });

    sleep(1);
}
