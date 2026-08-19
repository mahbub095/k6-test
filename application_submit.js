/**
 * Application Submit Load Test
 *
 * Runs the full 21-step application submission flow.
 * Select test profile via TEST_FUNC environment variable:
 *
 *   k6 run application_submit.js                        (default: rampUp)
 *   k6 run -e TEST_FUNC=rampUp application_submit.js
 *   k6 run -e TEST_FUNC=stress  application_submit.js
 *   k6 run -e BEARER_TOKEN=xxx  application_submit.js
 *
 * Requirements:
 *   - Image file at: D:/k6-test/image/applicant.jpg
 */

import http  from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TEST_FUNC = __ENV.TEST_FUNC || 'rampUp';

const BASE_URL     = 'https://stage-api.bhata.gov.bd';
const PAGE_URL     = 'https://stage.bhata.gov.bd';

// Production Gateway
const GATEWAY_URL = 'https://gateway.bhata.gov.bd';

const BEARER_TOKEN = __ENV.BEARER_TOKEN || '337274|R3xxrFTQm7P1x2AbUh5rX4NtX9X5nnb9UIcXbXCr5c0795b0';

// Image loaded from local drive — update path if your file is elsewhere
const IMAGE_BYTES = open('D:/Placeholder/test.jpg', 'b');

// ---------------------------------------------------------------------------
// Static field values (match JMX)
// ---------------------------------------------------------------------------

const FIELDS = {
    account_type:        '2',
    program_id:          '22',
    sub_program_id:      '9',
    thana_id:            '220',
    division_id:         '3',
    district_id:         '3',
    union_id:            '220',
    ward_id_union:       '17940',
    permanent_thana_id:  '220',
    permanent_union_id:  '2340',
    profession:          '181',
    nationality:         '105',
    gender_id:           '23',
    religion:            '96',
    marital_status:      '101',
    education_status:    '25',
    location_type:       '1',
    sub_location_type:   '2',
    mfs_name:            '1',
    is_bank_mfs_mandatory: '1',
};

const APPLICATION_PMT = JSON.stringify([
    { variable_id: 576, sub_variables: 577  },
    { variable_id: 530, sub_variables: 531  },
    { variable_id: 571, sub_variables: 573  },
    { variable_id: 1,   sub_variables: 443  },
    { variable_id: 7,   sub_variables: 331  },
    { variable_id: 12,  sub_variables: 439  },
    { variable_id: 14,  sub_variables: 382  },
    { variable_id: 18,  sub_variables: 409  },
    { variable_id: 36,  sub_variables: 298  },
    { variable_id: 33,  sub_variables: 291  },
    { variable_id: 536, sub_variables: [538] },
    { variable_id: 393, sub_variables: 397  },
    { variable_id: 30,  sub_variables: 339  },
    { variable_id: 40,  sub_variables: 400  },
    { variable_id: 548, sub_variables: 552  },
    { variable_id: 579, sub_variables: 583  },
    { variable_id: 41,  sub_variables: 387  },
    { variable_id: 567, sub_variables: 569  },
    { variable_id: 25,  sub_variables: 405  },
    { variable_id: 29,  sub_variables: 275  },
    { variable_id: 22,  sub_variables: 403  },
    { variable_id: 595, sub_variables: 598  },
    { variable_id: 47,  sub_variables: [425] },
    { variable_id: 500, sub_variables: 502  },
]);

// ---------------------------------------------------------------------------
// Scenario stages
// ---------------------------------------------------------------------------

const RAMP_UP_STAGES = [
    { duration: '10s', target: 5    },
    // { duration: '1m',  target: 2000 },
    // { duration: '1m',  target: 4000 },
    // { duration: '5m',  target: 4000 },
    // { duration: '2m',  target: 200  },
];

const STRESS_STAGES = [
    { duration: '1m', target: 5  },
    // { duration: '2m', target: 2000 },
    // { duration: '3m', target: 5000 },
    // { duration: '5m', target: 8000 },
    // { duration: '2m', target: 0    },
];

// ---------------------------------------------------------------------------
// k6 options
// ---------------------------------------------------------------------------

export const options = {
    scenarios: {
        application_submit: {
            executor:         'ramping-vus',
            stages:           TEST_FUNC === 'stress' ? STRESS_STAGES : RAMP_UP_STAGES,
            gracefulRampDown: '30s',
        },
    },
    thresholds: {
        registration_duration:  [{ threshold: 'p(95)<10000', abortOnFail: false }],
        media_upload_duration:  [{ threshold: 'p(95)<10000', abortOnFail: false }],
        captcha_fetch_duration:  [{ threshold: 'p(95)<3000',  abortOnFail: false }],
        error_rate:              [{ threshold: 'rate<0.10',   abortOnFail: false }],
        http_req_duration: [
            { threshold: 'p(90)<8000',  abortOnFail: false },
            { threshold: 'p(95)<10000', abortOnFail: false },
        ],
    },
};

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const registrationDuration = new Trend('registration_duration', true);
const mediaUploadDuration  = new Trend('media_upload_duration',  true);
const captchaFetchDuration = new Trend('captcha_fetch_duration', true);
const requestCount         = new Counter('total_requests');
const errorRate            = new Rate('error_rate');

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

const API_HEADERS = {
    Authorization:  `Bearer ${BEARER_TOKEN}`,
    Accept:         'application/json, text/plain, */*',
    'X-App-Language': 'bn',
};

const PAGE_HEADERS = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36',
};

// ---------------------------------------------------------------------------
// Helper: generate a UUID v4 (unique upload session token per VU per call)
// ---------------------------------------------------------------------------

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ---------------------------------------------------------------------------
// Helper: POST a single media-upload and return the server image path
// ---------------------------------------------------------------------------

function mediaUpload(fieldName, stepTag) {
    const token = uuidv4();

    const res = http.post(
        `${BASE_URL}/api/v1/global/online-application/media-upload?lang=bn`,
        // For Production
        // `${GATEWAY_URL}/api/v1/global/online-application/media-upload?lang=bn`,
        {
            file:  http.file(IMAGE_BYTES, 'applicant.jpg', 'image/jpeg'),
            field: fieldName,
            token: token,
        },
        {
            headers: {
                Authorization:    `Bearer ${BEARER_TOKEN}`,
                Accept:           'application/json, text/plain, */*',
                'X-App-Language': 'bn',
                // Content-Type omitted — k6 sets multipart/form-data + boundary automatically
            },
            timeout: '60s',
            tags:    { step: stepTag },
        }
    );
    requestCount.add(1);
    mediaUploadDuration.add(res.timings.duration);

    const ok = check(res, {
        [`${fieldName} upload → 200 or 201`]: r => r.status === 200 || r.status === 201,
        [`${fieldName} upload not 422`]:      r => r.status !== 422,
        [`${fieldName} upload not 429`]:      r => r.status !== 429,
        [`${fieldName} upload not 5xx`]:      r => r.status < 500,
    });

    if (!ok) {
        errorRate.add(1);
        console.error(`VU ${__VU} — ${fieldName} upload FAILED HTTP ${res.status} | body: ${res.body}`);
        return '';
    }

    let imagePath = '';
    try {
        const body = res.json();
        imagePath = body.path || (body.data && body.data.path) || body.url || '';
    } catch (_) { /* non-JSON response */ }

    if (!imagePath) {
        console.warn(`VU ${__VU} — ${fieldName}: image path not found in response. body: ${res.body}`);
    }

    console.log(`VU ${__VU} — ${fieldName} upload → HTTP ${res.status} | ${res.timings.duration}ms | path: ${imagePath}`);
    return imagePath;
}

// ---------------------------------------------------------------------------
// Helper: build per-VU applicant data
// ---------------------------------------------------------------------------

function buildApplicant() {
    // verification_number: "19" or "20" prefix + 15 random digits
    const prefix = ['19', '20'][Math.floor(Math.random() * 2)];
    const suffix = String(Math.floor(Math.random() * 1e15)).padStart(15, '0');
    const verification_number = `${prefix}${suffix}`;

    // BD mobile-banking account number
    const mobilePrefix = ['013', '015', '016', '017', '018', '019'][Math.floor(Math.random() * 6)];
    const account_number = `${mobilePrefix}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

    // Birth year 1960–2000 → age 26–66
    const birthYear    = 1960 + ((__VU - 1) % 41);
    const date_of_birth = `${birthYear}-06-15`;
    const age           = String(2026 - birthYear);

    return {
        verification_number,
        account_number,
        date_of_birth,
        age,
        name_bn:        'পরীক্ষা ব্যবহারকারী',
        name_en:        'Test User',
        father_name_bn: 'পিতার নাম',
        father_name_en: 'Father Name',
        mother_name_bn: 'মাতার নাম',
        mother_name_en: 'Mother Name',
        mobile:         '01700000000',
    };
}

// ---------------------------------------------------------------------------
// Main flow: 20-step application submission
// ---------------------------------------------------------------------------

function runApplicationFlow() {
    const applicant = buildApplicant();
    console.log(`VU ${__VU} [${TEST_FUNC}] BRS: ${applicant.verification_number} | acc: ${applicant.account_number}`);

    // Step 1 — Load the application page
    group('Step 1 - GET Online Application Page', () => {
        const res = http.get(`${PAGE_URL}/online-application`, {
            headers: PAGE_HEADERS,
            timeout: '30s',
            tags:    { step: '01_get_page' },
        });
        requestCount.add(1);
        const ok = check(res, {
            'page → 200':     r => r.status === 200,
            'page < 5s':      r => r.timings.duration < 5000,
            'page not 429':   r => r.status !== 429,
        });
        if (!ok) errorRate.add(1);
    });
    sleep(1);

    // Step 2 — Application page data
    group('Step 2 - GET Application Page Data', () => {
        const res = http.get(`${BASE_URL}/api/v1/global/getApplicationPageData?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags:    { step: '02_page_data' },
        });
        requestCount.add(1);
        check(res, { 'pageData → 200': r => r.status === 200 });
    });
    sleep(1);

    // Step 3 — Disabled areas
    group('Step 3 - GET Disabled Areas', () => {
        const res = http.get(`${BASE_URL}/api/v1/global/online-application/disabled-areas/9?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags:    { step: '03_disabled_areas' },
        });
        requestCount.add(1);
        check(res, { 'disabled-areas → 200': r => r.status === 200 });
    });
    sleep(1);

    // Step 4 — Captcha (extract token + value for POST)
    let captchaToken = '';
    let captchaValue = '';

    group('Step 4 - GET Captcha', () => {
        const res = http.get(`${BASE_URL}/api/v1/captcha?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags:    { step: '04_captcha' },
        });
        requestCount.add(1);
        captchaFetchDuration.add(res.timings.duration);

        const ok = check(res, {
            'captcha → 200':    r => r.status === 200,
            'captcha has body': r => r.body && r.body.length > 0,
            'captcha not 429':  r => r.status !== 429,
        });

        if (!ok) { errorRate.add(1); return; }

        try {
            const body = res.json();
            captchaToken = body.captcha_token || body.token || '';
            captchaValue = body.captcha_value || body.value || '';
        } catch (_) { /* body is not JSON — token stays empty */ }

        if (!captchaToken) {
            console.warn(`VU ${__VU} — captcha_token missing. body: ${res.body}`);
            errorRate.add(1);
        }
    });
    sleep(1);

    // Steps 5–18 — Batched lookup GETs (district / thana / union / ward / payment)
    group('Steps 5-18 - Lookup GETs', () => {
        const lookupUrls = [
            `${BASE_URL}/api/v1/global/district/get/3?lang=bn`,
            `${BASE_URL}/api/v1/global/thana/get/28?lang=bn`,
            `${BASE_URL}/api/v1/global/payment-processors/28?lang=bn`,
            `${BASE_URL}/api/v1/global/thana/get/28?lang=bn`,
            `${BASE_URL}/api/v1/global/union/get/220?lang=bn`,
            `${BASE_URL}/api/v1/global/union/get/220?lang=bn`,
            `${BASE_URL}/api/v1/global/ward/get/2340?lang=bn`,
            `${BASE_URL}/api/v1/global/payment-processors/17940?lang=bn`,
            `${BASE_URL}/api/v1/global/district/get/3?lang=bn`,
            `${BASE_URL}/api/v1/global/thana/get/28?lang=bn`,
            `${BASE_URL}/api/v1/global/thana/get/28?lang=bn`,
            `${BASE_URL}/api/v1/global/union/get/220?lang=bn`,
            `${BASE_URL}/api/v1/global/ward/get/2340?lang=bn`,
            `${BASE_URL}/api/v1/global/thana/get/28?lang=bn`,
        ];

        const responses = http.batch(
            lookupUrls.map(url => ({
                method: 'GET',
                url,
                params: { headers: API_HEADERS, timeout: '30s', tags: { step: '05_lookups' } },
            }))
        );

        requestCount.add(lookupUrls.length);
        responses.forEach((res, i) => {
            const ok = check(res, { [`lookup[${i}] → 200`]: r => r.status === 200 });
            if (!ok) errorRate.add(1);
        });
    });
    sleep(1);

    // Step 19 — Check for duplicate account
    group('Step 19 - GET Check Duplicate Account', () => {
        const res = http.get(
            `${BASE_URL}/api/v1/global/online-application/check-duplicate-account` +
            `?account_number=${applicant.account_number}` +
            `&program_id=${FIELDS.program_id}` +
            `&sub_program_id=${FIELDS.sub_program_id}` +
            `&ignore_id=&lang=bn`,
            {
                headers: API_HEADERS,
                timeout: '30s',
                tags:    { step: '19_check_duplicate' },
            }
        );
        requestCount.add(1);
        check(res, { 'check-duplicate → 200': r => r.status === 200 });
    });
    sleep(1);

    // Wait before submitting — simulates the time a real user spends filling the form
    sleep(5);

    // Step 20 — POST media-upload (applicant photo)
    let uploadedImagePath = '';
    group('Step 20 - POST Media Upload (applicant photo)', () => {
        uploadedImagePath = mediaUpload('image', '20_media_upload_photo');
    });
    sleep(1);

    // Step 21 — POST registration
    group('Step 21 - POST Registration', () => {
        if (!captchaToken) {
            console.warn(`VU ${__VU} — skipping POST: no captcha_token`);
            errorRate.add(1);
            return;
        }

        const formData = {
            // Scenario
            lang:            'bn',
            account_type:    FIELDS.account_type,
            application_pmt: APPLICATION_PMT,
            program_id:      FIELDS.program_id,
            sub_program_id:  FIELDS.sub_program_id,

            // Location
            thana_id:    FIELDS.thana_id,
            division_id: FIELDS.division_id,
            district_id: FIELDS.district_id,

            // Applicant identity
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
            gender_id:           FIELDS.gender_id,
            religion:            FIELDS.religion,
            marital_status:      FIELDS.marital_status,
            education_status:    FIELDS.education_status,
            nationality:         FIELDS.nationality,
            profession:          FIELDS.profession,

            // Current address
            location_type:     FIELDS.location_type,
            sub_location_type: FIELDS.sub_location_type,
            union_id:          FIELDS.union_id,
            ward_id_union:     FIELDS.ward_id_union,
            address:           'C',
            post_code:         '1234',

            // Permanent address
            permanent_thana_id:          FIELDS.permanent_thana_id,
            permanent_union_id:          FIELDS.permanent_union_id,
            permanent_location_type:     FIELDS.location_type,
            permanent_sub_location_type: FIELDS.sub_location_type,
            permanent_district_id:       FIELDS.district_id,
            permanent_division_id:       FIELDS.division_id,
            permanent_address:           'C',
            permanent_post_code:         '1234',

            // Payment
            mobile:                applicant.mobile,
            account_number:        applicant.account_number,
            account_name:          'Test',
            account_owner:         '142',
            mfs_name:              FIELDS.mfs_name,
            is_bank_mfs_mandatory: FIELDS.is_bank_mfs_mandatory,

            // Household
            no_of_people_score:   '-7',
            per_room_score:       '-7',
            no_of_room:           '502',
            house_size:           '2',
            is_nominnee_optional: '0',

            // Captcha
            captcha_token: captchaToken,
            captcha_value: captchaValue,

            // Image — use server path from media-upload if available, otherwise embed binary
            ...(uploadedImagePath
                ? { image_path: uploadedImagePath }
                : { image: http.file(IMAGE_BYTES, 'test.jpg', 'image/jpeg') }
            ),
        };

        const res = http.post(
            `${BASE_URL}/api/v1/global/online-application/registration?lang=bn`,
            formData,
            {
                headers: API_HEADERS,
                timeout: '60s',
                tags:    { step: '21_post_registration' },
            }
        );
        requestCount.add(1);
        registrationDuration.add(res.timings.duration);

        const ok = check(res, {
            'registration → 200 or 201': r => r.status === 200 || r.status === 201,
            'registration not 422':      r => r.status !== 422,
            'registration not 429':      r => r.status !== 429,
            'registration not 5xx':      r => r.status < 500,
            'registration < 10s':        r => r.timings.duration < 10000,
        });
        errorRate.add(!ok);

        console.log(`VU ${__VU} [${TEST_FUNC}] registration → HTTP ${res.status} | ${res.timings.duration}ms | BRS: ${applicant.verification_number}`);

        if (res.status === 422 || res.status === 429 || res.status >= 500) {
            console.error(`VU ${__VU} FAILED — body: ${res.body}`);
        }
    });
    sleep(1);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default function () {
    runApplicationFlow();
}
