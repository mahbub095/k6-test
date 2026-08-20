/**
 * Application Submit Load Test
 *
 * Usage:
 *   k6 run application_submit.js
 *   k6 run -e TEST_FUNC=stress  application_submit.js
 *   k6 run -e BEARER_TOKEN=xxx  application_submit.js
 *
 * Requirements:
 *   - Image file at: ./test.jpg  (relative to this script)
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
const TEST_FUNC    = __ENV.TEST_FUNC    || 'rampUp';

// Image pre-wrapped at init time — http.file() must not be called inside VU scope
const IMAGE_FILE = http.file(open('./test.jpg', 'b'), 'test.jpg', 'image/jpeg');

// ---------------------------------------------------------------------------
// Scenario stages
// ---------------------------------------------------------------------------

const RAMP_UP_STAGES = [
    { duration: '2m', target: 1 },
    // { duration: '3m', target: 50000 },
    // { duration: '5m', target: 60000 },
];

const STRESS_STAGES = [
    { duration: '1m', target: 1    },
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
        media_upload_duration:  [{ threshold: 'p(95)<10000', abortOnFail: false }],
        registration_duration:  [{ threshold: 'p(95)<10000', abortOnFail: false }],
        captcha_fetch_duration: [{ threshold: 'p(95)<3000',  abortOnFail: false }],
        error_rate:             [{ threshold: 'rate<0.30',   abortOnFail: false }],
        http_req_duration: [
            { threshold: 'p(90)<8000',  abortOnFail: false },
            { threshold: 'p(95)<10000', abortOnFail: false },
        ],
    },
};

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const mediaUploadDuration  = new Trend('media_upload_duration',  true);
const registrationDuration = new Trend('registration_duration',  true);
const captchaFetchDuration = new Trend('captcha_fetch_duration', true);
const requestCount         = new Counter('total_requests');
const errorRate            = new Rate('error_rate');

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

// Page headers — used for browser-like GET requests (no Authorization)
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

// API headers — used for all JSON API calls (Content-Type omitted for multipart)
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
// Helper: UUID v4 — client-generated media_token, sent with upload and
// repeated in registration so the server can match the file to the submission
// ---------------------------------------------------------------------------

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ---------------------------------------------------------------------------
// Helper: build per-VU applicant data
// Uniqueness guarantees:
//   verification_number — "19"/"20" prefix + 15 truly random digits (~1e15 space)
//   account_number      — 3-digit prefix + 8 random digits = 11 digits total (~1e8 space)
//   date_of_birth       — random year 1950–2000 + random month + random day
// ---------------------------------------------------------------------------

function buildApplicant() {
    // verification_number: prefix (19/20) + 15 random digits — large enough to never collide
    const vnPrefix = ['19', '20'][Math.floor(Math.random() * 2)];
    const vnSuffix = String(Math.floor(Math.random() * 1e15)).padStart(15, '0');
    const verification_number = `${vnPrefix}${vnSuffix}`;

    // account_number: 3-digit mobile prefix + 8 random digits = 11 digits total
    const mobilePrefix   = ['013', '015', '016', '017', '018', '019'][Math.floor(Math.random() * 6)];
    const mobileSuffix   = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const account_number = `${mobilePrefix}${mobileSuffix}`;

    // date_of_birth: fully random year (1950–2000), month (01–12), day (01–28)
    // Day capped at 28 to avoid invalid dates (Feb 29 etc.)
    const birthYear  = 1950 + Math.floor(Math.random() * 51);   // 1950–2000
    const birthMonth = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
    const birthDay   = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
    const date_of_birth = `${birthYear}-${birthMonth}-${birthDay}`;
    const age           = String(2026 - birthYear);

    return {
        verification_number,
        account_number,
        date_of_birth,
        age,
        name_bn:        'আবেদনকারীর নাম',
        name_en:        'Application Name',
        father_name_bn: 'আবেদনকারীর পিতার নাম',
        father_name_en: 'Fathers Name',
        mother_name_bn: 'আবেদনকারীর মাতার নাম',
        mother_name_en: 'Mothers Name',
        mobile:         '01678600000',
    };
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

export default function () {
    const applicant = buildApplicant();
    console.log(`VU ${__VU} — BRS: ${applicant.verification_number} | acc: ${applicant.account_number} | dob: ${applicant.date_of_birth}`);

    // Step 1 — GET online-application page
    group('Step 1 - GET Online Application Page', () => {
        const res = http.get(`${PAGE_URL}/online-application`, {
            headers: PAGE_HEADERS,
            timeout: '30s',
            tags:    { step: '01_get_page' },
        });
        requestCount.add(1);
        const ok = check(res, {
            'page → 200':   r => r.status === 200,
            'page < 5s':    r => r.timings.duration < 5000,
            'page not 429': r => r.status !== 429,
        });
        if (!ok) errorRate.add(1);
    });
    sleep(1);

    // Step 2 — GET application page data
    group('Step 2 - GET Application Page Data', () => {
        const res = http.get(`${API_URL}/api/v1/global/getApplicationPageData?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags:    { step: '02_page_data' },
        });
        requestCount.add(1);
        const ok = check(res, { 'pageData → 200': r => r.status === 200 });
        if (!ok) errorRate.add(1);
    });
    sleep(1);

    // Step 3 — GET disabled areas
    group('Step 3 - GET Disabled Areas', () => {
        const res = http.get(`${API_URL}/api/v1/global/online-application/disabled-areas/8?lang=bn`, {
            headers: API_HEADERS,
            timeout: '30s',
            tags:    { step: '03_disabled_areas' },
        });
        requestCount.add(1);
        const ok = check(res, { 'disabled-areas → 200': r => r.status === 200 });
        if (!ok) errorRate.add(1);
    });
    sleep(1);

    // Step 4 — GET captcha
    let captchaToken = '';
    let captchaValue = '';

    group('Step 4 - GET Captcha', () => {
        const res = http.get(`${API_URL}/api/v1/captcha?lang=bn`, {
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
        } catch (_) { /* non-JSON */ }

        if (!captchaToken) {
            console.warn(`VU ${__VU} — captcha_token missing. body: ${res.body}`);
            errorRate.add(1);
        }
    });
    sleep(1);

    // Step 5 — POST media-upload
    // media_token is client-generated — sent with upload and reused in registration
    let uploadedImagePath = '';
    const mediaToken      = uuidv4();

    group('Step 5 - POST Media Upload', () => {
        const res = http.post(
            `${API_URL}/api/v1/global/online-application/media-upload?lang=bn`,
            {
                field: 'image',
                file:  IMAGE_FILE,
                token: mediaToken,
            },
            {
                headers: API_HEADERS,
                timeout: '60s',
                tags:    { step: '05_media_upload' },
            }
        );

        requestCount.add(1);
        mediaUploadDuration.add(res.timings.duration);

        const ok = check(res, {
            'media-upload → 200 or 201':   r => r.status === 200 || r.status === 201,
            'media-upload not 422':        r => r.status !== 422,
            'media-upload not 429':        r => r.status !== 429,
            'media-upload not 5xx':        r => r.status < 500,
            'media-upload < 10s':          r => r.timings.duration < 10000,
            'media-upload has image path': r => {
                try {
                    const b = r.json();
                    return !!(b.path || (b.data && b.data.path) || b.url);
                } catch (_) { return false; }
            },
        });

        errorRate.add(!ok);

        console.log(`VU ${__VU} — media-upload HTTP ${res.status} | ${res.timings.duration}ms`);

        if (!ok) {
            console.error(`VU ${__VU} media-upload FAILED — body: ${res.body}`);
            return;
        }

        // Parse image path — media_token is already known (we generated it)
        try {
            const body        = res.json();
            uploadedImagePath = body.path || (body.data && body.data.path) || body.url || '';
        } catch (_) { /* non-JSON */ }

        if (uploadedImagePath) {
            console.log(`VU ${__VU} — uploaded image path: ${uploadedImagePath}`);
        } else {
            console.error(`VU ${__VU} — image path missing in upload response. body: ${res.body}`);
            errorRate.add(1);
        }
    });
    sleep(1);

    // Abort if image upload did not return a valid path — registration will fail without it
    if (!uploadedImagePath) {
        console.error(`VU ${__VU} — aborting: no image path from media-upload, skipping remaining steps`);
        return;
    }

    // Steps 6–19 — Batched lookup GETs
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
                params: { headers: API_HEADERS, timeout: '30s', tags: { step: '06_lookups' } },
            }))
        );

        requestCount.add(lookupUrls.length);
        responses.forEach((res, i) => {
            const ok = check(res, { [`lookup[${i}] → 200`]: r => r.status === 200 });
            if (!ok) errorRate.add(1);
        });
    });
    sleep(1);

    // Steps 20–22 — Check duplicate account (×3 as recorded in JMX)
    group('Steps 20-22 - GET Check Duplicate Account', () => {
        const dupUrl =
            `${API_URL}/api/v1/global/online-application/check-duplicate-account` +
            `?account_number=${applicant.account_number}` +
            `&program_id=${FIELDS.program_id}` +
            `&sub_program_id=${FIELDS.sub_program_id}` +
            `&ignore_id=&lang=bn`;

        const responses = http.batch([
            { method: 'GET', url: dupUrl, params: { headers: API_HEADERS, timeout: '30s', tags: { step: '20_check_duplicate' } } },
            { method: 'GET', url: dupUrl, params: { headers: API_HEADERS, timeout: '30s', tags: { step: '21_check_duplicate' } } },
            { method: 'GET', url: dupUrl, params: { headers: API_HEADERS, timeout: '30s', tags: { step: '22_check_duplicate' } } },
        ]);

        requestCount.add(3);
        responses.forEach((res, i) => {
            const ok = check(res, { [`check-duplicate[${i}] → 200`]: r => r.status === 200 });
            if (!ok) errorRate.add(1);
        });
    });
    sleep(1);

    // Step 23 — POST registration
    group('Step 23 - POST Registration', () => {
        if (!captchaToken) {
            console.warn(`VU ${__VU} — skipping POST: no captcha_token`);
            errorRate.add(1);
            return;
        }

        const formData = {
            // Scenario
            lang:                         'bn',
            account_type:                 FIELDS.account_type,
            program_id:                   FIELDS.program_id,
            sub_program_id:               FIELDS.sub_program_id,
            application_pmt:              APPLICATION_PMT,
            application_allowance_values: APPLICATION_ALLOWANCE_VALUES,

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
            permanent_district_id:       FIELDS.permanent_district_id,
            permanent_division_id:       FIELDS.permanent_division_id,
            permanent_ward_id_union:     FIELDS.permanent_ward_id_union,
            permanent_location_type:     FIELDS.permanent_location_type,
            permanent_sub_location_type: FIELDS.permanent_sub_location_type,
            permanent_address:           'C',
            permanent_post_code:         '1234',

            // Payment
            mobile:                applicant.mobile,
            account_number:        applicant.account_number,
            account_name:          'Test',
            account_owner:         FIELDS.account_owner,
            mfs_name:              FIELDS.mfs_name,
            is_bank_mfs_mandatory: FIELDS.is_bank_mfs_mandatory,

            // Household
            no_of_people_score:  FIELDS.no_of_people_score,
            per_room_score:      FIELDS.per_room_score,
            no_of_room:          FIELDS.no_of_room,
            house_size:          FIELDS.house_size,
            is_nominnee_optional: FIELDS.is_nominnee_optional,

            // Captcha
            captcha_token: captchaToken,
            captcha_value: captchaValue,

            // Media — token generated before upload, path returned by upload
            media_token: mediaToken,
            image:       uploadedImagePath,
        };

        const res = http.post(
            `${API_URL}/api/v1/global/online-application/registration?lang=bn`,
            formData,
            {
                headers: API_HEADERS,
                timeout: '60s',
                tags:    { step: '23_post_registration' },
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

        console.log(`VU ${__VU} — registration HTTP ${res.status} | ${res.timings.duration}ms | BRS: ${applicant.verification_number}`);

        if (!ok) {
            console.error(`VU ${__VU} FAILED — body: ${res.body}`);
        }
    });
    sleep(10);
}
