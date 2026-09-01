import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const BASE_URL = 'https://stage-api.bhata.gov.bd';

// ─── TEST OPTIONS ─────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: '30s', target: 2 },   // Ramp up to 2 VUs
    { duration: '1m',  target: 2 },   // Hold at 2 VUs
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    'http_req_duration':          ['p(95)<2000', 'p(99)<4000'],
    'http_req_failed':            ['rate<0.05'],
    'family_card_failure_rate':   ['rate<0.05'],
    'login_duration':             ['p(95)<1500'],
    'save_draft_duration':        ['p(95)<2000'],
    'media_upload_duration':      ['p(95)<3000'],
  },
};

// ─── CUSTOM METRICS ──────────────────────────────────────────────────────────

const loginDuration      = new Trend('login_duration', true);
const saveDraftDuration  = new Trend('save_draft_duration', true);
const mediaUploadDuration = new Trend('media_upload_duration', true);
const familyCardFailure  = new Rate('family_card_failure_rate');

// ─── COMMON AUTH HEADERS (post-login) ────────────────────────────────────────

function authHeaders(token) {
  return {
    'Accept':           'application/json, text/plain, */*',
    'Content-Type':     'application/json',
    'X-App-Language':   'bn',
    'Authorization':    `Bearer ${token}`,
  };
}

function authGetHeaders(token) {
  return {
    'Accept':           'application/json, text/plain, */*',
    'X-App-Language':   'bn',
    'Authorization':    `Bearer ${token}`,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function extractToken(res) {
  try {
    const body = JSON.parse(res.body);
    // Common token locations in this API
    return body?.data?.token || body?.token || body?.access_token || null;
  } catch {
    return null;
  }
}

function extractDraftId(res) {
  try {
    const body = JSON.parse(res.body);
    return body?.data?.id || body?.data?.draft_id || body?.id || null;
  } catch {
    return null;
  }
}

// Generate a unique 17-digit verification number starting with '19'
function generateVerificationNumber() {
  // '19' + 15 random digits = 17 digits total
  let digits = '19';
  for (let i = 0; i < 15; i++) {
    digits += String(Math.floor(Math.random() * 10));
  }
  return digits;
}

// Generate a unique date of birth where the birth year is at most (2026 - 20) = 2006
// Random year between 1950 and 2006, random month and valid day
function generateDateOfBirth() {
  const maxYear = 2026 - 20; // 2006
  const minYear = 1950;
  const year  = minYear + Math.floor(Math.random() * (maxYear - minYear + 1));
  const month = 1 + Math.floor(Math.random() * 12);
  // Use 28 as a safe max day to avoid month-end edge cases
  const day   = 1 + Math.floor(Math.random() * 28);
  const mm    = String(month).padStart(2, '0');
  const dd    = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

// Derive age in years from a yyyy-MM-dd date string (relative to 2026)
function calculateAge(dob) {
  const [year, month, day] = dob.split('-').map(Number);
  let age = 2026 - year;
  // Adjust if birthday hasn't occurred yet in 2026 (use Aug 31 as reference)
  if (month > 8 || (month === 8 && day > 31)) {
    age -= 1;
  }
  return age;
}

// ─── MAIN FLOW ────────────────────────────────────────────────────────────────

export default function () {

  let token = null;

  // Generate unique applicant data for this iteration
  const verificationNumber = generateVerificationNumber();
  const dateOfBirth        = generateDateOfBirth();
  const age                = calculateAge(dateOfBirth);

  // ── Step 1: Login (dev endpoint — username & password only) ────────────────
  group('01_login', function () {
    const payload = JSON.stringify({
      username: 'enumghatail',
      password: 'Password#1',
    });

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/login/dev`,
      payload,
      {
        headers: {
          'Accept':         'application/json, text/plain, */*',
          'Content-Type':   'application/json',
          'X-App-Language': 'bn',
        },
        timeout: '15s',
        tags: { name: 'family_card_login' },
      }
    );

    loginDuration.add(res.timings.duration);

    const loginOk = check(res, {
      'Login: status 200': r => r.status === 200,
      'Login: has token':  r => extractToken(r) !== null,
      'Login: response time < 1500ms': r => r.timings.duration < 1500,
    });

    if (!loginOk) {
      familyCardFailure.add(1);
      console.error(
        `[login FAIL] VU ${__VU} ITER ${__ITER} | HTTP ${res.status} | ${res.timings.duration}ms`
      );
      return; // skip remaining steps if login failed
    }

    token = extractToken(res);
    familyCardFailure.add(0);
  });
  if (!token) {
    console.warn(`[VU ${__VU}] No token obtained — skipping post-login steps`);
    return;
  }

  sleep(0.5);

  // ── Step 2: Get application page data ────────────────────────────────────
  group('02_get_application_page_data', function () {
    const res = http.get(
      `${BASE_URL}/api/v1/global/getApplicationPageData?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '15s',
        tags: { name: 'get_application_page_data' },
      }
    );

    check(res, {
      'App page data: status 200': r => r.status === 200,
      'App page data: response time < 2000ms': r => r.timings.duration < 2000,
    });
  });

  // ── Step 3: Get application counts ───────────────────────────────────────
  group('03_get_application_counts', function () {
    const res = http.get(
      `${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '10s',
        tags: { name: 'get_application_counts' },
      }
    );

    check(res, {
      'App counts: status 200': r => r.status === 200,
      'App counts: response time < 2000ms': r => r.timings.duration < 2000,
    });
  });

  sleep(0.5);

  // ── Step 4: Location lookups ──────────────────────────────────────────────
  group('04_location_lookups', function () {
    // District
    const distRes = http.get(
      `${BASE_URL}/api/v1/global/family-card-user/locations/district/get/2?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '10s',
        tags: { name: 'location_district' },
      }
    );
    check(distRes, {
      'District: status 200': r => r.status === 200,
    });

    sleep(0.3);

    // Thana
    const thanaRes = http.get(
      `${BASE_URL}/api/v1/global/family-card-user/locations/thana/get/21?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '10s',
        tags: { name: 'location_thana' },
      }
    );
    check(thanaRes, {
      'Thana: status 200': r => r.status === 200,
    });

    sleep(0.3);

    // Union
    const unionRes = http.get(
      `${BASE_URL}/api/v1/global/family-card-user/locations/union/get/197?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '10s',
        tags: { name: 'location_union' },
      }
    );
    check(unionRes, {
      'Union: status 200': r => r.status === 200,
    });

    sleep(0.3);

    // Ward
    const wardRes = http.get(
      `${BASE_URL}/api/v1/global/family-card-user/locations/ward/get/2171?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '10s',
        tags: { name: 'location_ward' },
      }
    );
    check(wardRes, {
      'Ward: status 200': r => r.status === 200,
    });

    sleep(0.3);

    // Global district
    const globalDistRes = http.get(
      `${BASE_URL}/api/v1/global/district/get/2?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '10s',
        tags: { name: 'global_district' },
      }
    );
    check(globalDistRes, {
      'Global district: status 200': r => r.status === 200,
    });

    sleep(0.3);

    // Global thana
    const globalThanaRes = http.get(
      `${BASE_URL}/api/v1/global/thana/get/21?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '10s',
        tags: { name: 'global_thana' },
      }
    );
    check(globalThanaRes, {
      'Global thana: status 200': r => r.status === 200,
    });

    sleep(0.3);

    // Global union
    const globalUnionRes = http.get(
      `${BASE_URL}/api/v1/global/union/get/197?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '10s',
        tags: { name: 'global_union' },
      }
    );
    check(globalUnionRes, {
      'Global union: status 200': r => r.status === 200,
    });

    sleep(0.3);

    // Global ward
    const globalWardRes = http.get(
      `${BASE_URL}/api/v1/global/ward/get/2171?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '10s',
        tags: { name: 'global_ward' },
      }
    );
    check(globalWardRes, {
      'Global ward: status 200': r => r.status === 200,
    });

    sleep(0.3);

    // Disabled areas
    const disabledRes = http.get(
      `${BASE_URL}/api/v1/global/online-application/disabled-areas/24?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '10s',
        tags: { name: 'disabled_areas' },
      }
    );
    check(disabledRes, {
      'Disabled areas: status 200': r => r.status === 200,
    });

    sleep(0.3);

    // Captcha
    const captchaRes = http.get(
      `${BASE_URL}/api/v1/captcha?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '10s',
        tags: { name: 'get_captcha' },
      }
    );
    check(captchaRes, {
      'Captcha: status 200': r => r.status === 200,
    });
  });

  sleep(0.5);

  // ── Step 5: Save draft – personal info ───────────────────────────────────
  let draftId = null;

  group('05_save_draft_personal', function () {
    const formData = {
      lang:                'bn',
      profession:          '109',
      sub_program_id:      '24',
      program_id:          '24',
      name_bn:             'বাংলা',
      name_en:             'TEST',
      date_of_birth:       dateOfBirth,
      age:                 String(age),
      gender_id:           '24',
      father_name_en:      'TEST',
      father_name_bn:      'বাংলা',
      mother_name_en:      'TEST',
      mother_name_bn:      'বাংলা',
      mobile:              '01671816194',
      verification_number: verificationNumber,
      verification_type:   '2',
      education_status:    '88',
      religion:            '96',
      marital_status:      '101',
      module:              'personal',
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      formData,
      {
        headers: {
          'Accept':           'application/json, text/plain, */*',
          'X-App-Language':   'bn',
          'Authorization':    `Bearer ${token}`,
          // Let k6 set multipart content-type automatically for form data
        },
        timeout: '20s',
        tags: { name: 'save_draft_personal' },
      }
    );

    saveDraftDuration.add(res.timings.duration);

    const draftOk = check(res, {
      'Save draft (personal): status 2xx': r => r.status >= 200 && r.status < 300,
      'Save draft (personal): response time < 3000ms': r => r.timings.duration < 3000,
    });

    if (draftOk) {
      draftId = extractDraftId(res);
    } else {
      console.error(
        `[save_draft FAIL] VU ${__VU} ITER ${__ITER} | HTTP ${res.status} | ${res.body}`
      );
      familyCardFailure.add(1);
    }
  });

  sleep(0.5);

  // Use the static draft ID from JMX as fallback if API didn't return one
  const effectiveDraftId = draftId || '4098117';

  // ── Step 6: Media uploads ─────────────────────────────────────────────────
  group('06_media_uploads', function () {

    // Upload applicant image
    const imageForm = {
      lang:     'bn',
      file:     http.file(open('./test.jpg', 'b'), 'test.jpg', 'image/jpeg'),
      field:    'image',
      draft_id: effectiveDraftId,
    };

    const imgRes = http.post(
      `${BASE_URL}/api/v1/family-card/applications/media-upload?lang=bn`,
      imageForm,
      {
        headers: {
          'Accept':           'application/json, text/plain, */*',
          'X-App-Language':   'bn',
          'Authorization':    `Bearer ${token}`,
        },
        timeout: '30s',
        tags: { name: 'media_upload_image' },
      }
    );

    mediaUploadDuration.add(imgRes.timings.duration);

    check(imgRes, {
      'Media upload (image): status 2xx': r => r.status >= 200 && r.status < 300,
    });

    sleep(0.5);

    // Upload signature
    const sigForm = {
      lang:     'bn',
      file:     http.file(open('./test.jpg', 'b'), 'test.jpg', 'image/jpeg'),
      field:    'signature',
      draft_id: effectiveDraftId,
    };

    const sigRes = http.post(
      `${BASE_URL}/api/v1/family-card/applications/media-upload?lang=bn`,
      sigForm,
      {
        headers: {
          'Accept':           'application/json, text/plain, */*',
          'X-App-Language':   'bn',
          'Authorization':    `Bearer ${token}`,
        },
        timeout: '30s',
        tags: { name: 'media_upload_signature' },
      }
    );

    mediaUploadDuration.add(sigRes.timings.duration);

    check(sigRes, {
      'Media upload (signature): status 2xx': r => r.status >= 200 && r.status < 300,
    });

    sleep(0.5);

    // Upload house image
    const houseForm = {
      lang:     'bn',
      file:     http.file(open('./test.jpg', 'b'), 'test.jpg', 'image/jpeg'),
      field:    'house_image',
      draft_id: effectiveDraftId,
    };

    const houseRes = http.post(
      `${BASE_URL}/api/v1/family-card/applications/media-upload?lang=bn`,
      houseForm,
      {
        headers: {
          'Accept':           'application/json, text/plain, */*',
          'X-App-Language':   'bn',
          'Authorization':    `Bearer ${token}`,
        },
        timeout: '30s',
        tags: { name: 'media_upload_house_image' },
      }
    );

    mediaUploadDuration.add(houseRes.timings.duration);

    check(houseRes, {
      'Media upload (house image): status 2xx': r => r.status >= 200 && r.status < 300,
    });
  });

  sleep(0.5);

  // ── Step 7: Save draft – photos (final submit with uploaded file paths) ───
  group('07_save_draft_photos', function () {
    const formData = {
      lang:                'bn',
      program_id:          '24',
      sub_program_id:      '24',
      module:              'photos',
      verification_number: verificationNumber,
      verification_type:   '2',
      draft_id:            effectiveDraftId,
      image:               'ctm/stage/applications/2026-09-01/applicant_image/7d75c43d-249c-4079-afa7-572964630e40.jpg',
      signature:           'ctm/stage/applications/2026-09-01/applicant_signature/aaf7f110-2b60-4b4c-ba2c-cabd6714bc1d.jpg',
      house_image:         'ctm/stage/applications/2026-09-01/house_image/59cce616-133d-44be-a2b1-2b7159a0517a.jpg',
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      formData,
      {
        headers: {
          'Accept':           'application/json, text/plain, */*',
          'X-App-Language':   'bn',
          'Authorization':    `Bearer ${token}`,
        },
        timeout: '20s',
        tags: { name: 'save_draft_photos' },
      }
    );

    saveDraftDuration.add(res.timings.duration);

    const ok = check(res, {
      'Save draft (photos): status 2xx': r => r.status >= 200 && r.status < 300,
      'Save draft (photos): response time < 3000ms': r => r.timings.duration < 3000,
    });

    if (!ok) {
      familyCardFailure.add(1);
      console.error(
        `[save_draft_photos FAIL] VU ${__VU} ITER ${__ITER} | HTTP ${res.status} | ${res.body}`
      );
    }
  });

  sleep(0.5);

  // ── Step 8: Final application counts refresh ──────────────────────────────
  group('08_final_counts_refresh', function () {
    const res = http.get(
      `${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`,
      {
        headers: authGetHeaders(token),
        timeout: '10s',
        tags: { name: 'final_counts_refresh' },
      }
    );

    check(res, {
      'Final counts: status 200': r => r.status === 200,
    });

    // Final location re-fetch (as recorded in JMX post-submit)
    http.get(
      `${BASE_URL}/api/v1/global/family-card-user/locations/district/get/2?lang=bn`,
      { headers: authGetHeaders(token), tags: { name: 'location_refresh_district' } }
    );
    http.get(
      `${BASE_URL}/api/v1/global/family-card-user/locations/thana/get/21?lang=bn`,
      { headers: authGetHeaders(token), tags: { name: 'location_refresh_thana' } }
    );
    http.get(
      `${BASE_URL}/api/v1/global/family-card-user/locations/union/get/197?lang=bn`,
      { headers: authGetHeaders(token), tags: { name: 'location_refresh_union' } }
    );
    http.get(
      `${BASE_URL}/api/v1/global/family-card-user/locations/ward/get/2171?lang=bn`,
      { headers: authGetHeaders(token), tags: { name: 'location_refresh_ward' } }
    );
  });

  // Pace between iterations
  sleep(1);
}
