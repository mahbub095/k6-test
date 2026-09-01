import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── INIT STAGE — open() must be called here, not inside default() ────────────
// k6 reads the file once during init and shares the binary data across all VUs.
const TEST_IMAGE = open('./test.jpg', 'b');

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const BASE_URL = 'https://stage-api.bhata.gov.bd';

// ─── TEST OPTIONS ─────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: '30s', target: 1 },
    { duration: '1m',  target: 1 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    'http_req_duration':        ['p(95)<3000', 'p(99)<5000'],
    'http_req_failed':          ['rate<0.10'],
    'family_card_failure_rate': ['rate<0.10'],
    'save_draft_duration':      ['p(95)<3000'],
    'media_upload_duration':    ['p(95)<5000'],
    'finalize_duration':        ['p(95)<5000'],
  },
};

// ─── CUSTOM METRICS ───────────────────────────────────────────────────────────

const saveDraftDuration   = new Trend('save_draft_duration', true);
const mediaUploadDuration = new Trend('media_upload_duration', true);
const familyCardFailure   = new Rate('family_card_failure_rate');
const finalizeDuration    = new Trend('finalize_duration', true);

// ─── DATA GENERATORS ─────────────────────────────────────────────────────────

// Unique 17-digit verification number starting with '19'
function generateVerificationNumber() {
  let n = '19';
  for (let i = 0; i < 15; i++) n += Math.floor(Math.random() * 10);
  return n;
}

// Random date of birth — applicant must be at least 20 years old (born ≤ 2006)
function generateDateOfBirth() {
  const year  = 1950 + Math.floor(Math.random() * (2006 - 1950 + 1)); // 1950–2006
  const month = 1   + Math.floor(Math.random() * 12);
  const day   = 1   + Math.floor(Math.random() * 28); // capped at 28 — safe for all months
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Age in whole years relative to 2026 from a yyyy-MM-dd string
function calculateAge(dob) {
  const [y, m, d] = dob.split('-').map(Number);
  let age = 2026 - y;
  // Birthday hasn't occurred yet in 2026 (reference: Sep 1 2026)
  if (m > 9 || (m === 9 && d > 1)) age -= 1;
  return age;
}

// Fake name pools — enough variety for load testing
const FIRST_NAMES_EN = [
  'Rahim', 'Karim', 'Jamal', 'Hasan', 'Nabil', 'Faruk', 'Milon', 'Ratan',
  'Sumon', 'Tariq', 'Belal', 'Imran', 'Shakil', 'Liton', 'Sajib', 'Arif',
  'Rubel', 'Mamun', 'Jewel', 'Tuhin', 'Salim', 'Badal', 'Rasel', 'Bipul',
  'Zahir', 'Nasir', 'Habib', 'Monir', 'Polash', 'Dipu',
];

const LAST_NAMES_EN = [
  'Ahmed', 'Islam', 'Hossain', 'Khan', 'Miah', 'Sheikh', 'Sarker', 'Mondol',
  'Chowdhury', 'Bhuiyan', 'Alam', 'Rahman', 'Uddin', 'Ali', 'Akter',
  'Begum', 'Khatun', 'Biswas', 'Das', 'Paul',
];

const FIRST_NAMES_BN = [
  'রহিম', 'করিম', 'জামাল', 'হাসান', 'নাবিল', 'ফারুক', 'মিলন', 'রতন',
  'সুমন', 'তারিক', 'বেলাল', 'ইমরান', 'শাকিল', 'লিটন', 'সাজিব', 'আরিফ',
  'রুবেল', 'মামুন', 'জুয়েল', 'তুহিন', 'সালিম', 'বাদল', 'রাসেল', 'বিপুল',
  'জাহির', 'নাসির', 'হাবিব', 'মনির', 'পলাশ', 'দিপু',
];

const LAST_NAMES_BN = [
  'আহমেদ', 'ইসলাম', 'হোসেন', 'খান', 'মিয়া', 'শেখ', 'সরকার', 'মন্ডল',
  'চৌধুরী', 'ভূইয়া', 'আলম', 'রহমান', 'উদ্দিন', 'আলী', 'আক্তার',
  'বেগম', 'খাতুন', 'বিশ্বাস', 'দাস', 'পাল',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Returns { en, bn } for a full fake name (first + last)
function fakeName() {
  return {
    en: `${pick(FIRST_NAMES_EN)} ${pick(LAST_NAMES_EN)}`,
    bn: `${pick(FIRST_NAMES_BN)} ${pick(LAST_NAMES_BN)}`,
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function extractToken(res) {
  try {
    const body = JSON.parse(res.body);
    return body?.data?.token || body?.token || body?.access_token || null;
  } catch { return null; }
}

function extractDraftId(res) {
  try {
    const body = JSON.parse(res.body);
    return body?.data?.id || body?.data?.draft_id || body?.id || null;
  } catch { return null; }
}

// Extract sync hashes from save-draft module=all response (used by finalize)
function extractSyncHashes(res) {
  try {
    const d = JSON.parse(res.body)?.data || {};
    return {
      allowance:  d.allowance_sync_hash  || d.allowanceSyncHash  || null,
      cash_usage: d.cash_usage_sync_hash || d.cashUsageSyncHash  || null,
      pmt:        d.pmt_sync_hash        || d.pmtSyncHash        || null,
      family:     d.family_sync_hash     || d.familySyncHash     || null,
    };
  } catch {
    return { allowance: null, cash_usage: null, pmt: null, family: null };
  }
}

// Merge non-null hash values from a new response into the running accumulator
function mergeSyncHashes(acc, res) {
  const fresh = extractSyncHashes(res);
  return {
    allowance:  fresh.allowance  !== null ? fresh.allowance  : acc.allowance,
    cash_usage: fresh.cash_usage !== null ? fresh.cash_usage : acc.cash_usage,
    pmt:        fresh.pmt        !== null ? fresh.pmt        : acc.pmt,
    family:     fresh.family     !== null ? fresh.family     : acc.family,
  };
}

function authHeaders(token) {
  return {
    'Accept':         'application/json, text/plain, */*',
    'X-App-Language': 'bn',
    'Authorization':  `Bearer ${token}`,
  };
}

// ─── SETUP — login runs ONCE, token shared with all VUs ───────────────────────

export function setup() {
  const res = http.post(
    `${BASE_URL}/api/v1/family-card/login/dev`,
    JSON.stringify({ username: 'enumghatail', password: 'Password#1' }),
    {
      headers: {
        'Accept':         'application/json, text/plain, */*',
        'Content-Type':   'application/json',
        'X-App-Language': 'bn',
      },
      timeout: '15s',
      tags: { name: 'setup_login' },
    }
  );

  const token = extractToken(res);

  check(res, {
    'Setup login: status 200': r => r.status === 200,
    'Setup login: has token':  r => token !== null,
  });

  if (!token) {
    throw new Error(`Setup login failed — HTTP ${res.status}: ${res.body}`);
  }

  console.log('[setup] Login OK. Token obtained.');
  return { token };
}

// ─── MAIN FLOW ────────────────────────────────────────────────────────────────
// Each VU iteration runs steps 01–12 using the shared token from setup().
//
// Modules sent to save-draft (in order from JMX):
//   personal → photos → address → program → bank → nominee
//   → pmt → family → cash_usage → external → (final counts refresh)

export default function ({ token }) {

  if (!token) {
    console.error(`[VU ${__VU}] No token — aborting`);
    return;
  }

  // ── Per-iteration unique applicant data ───────────────────────────────────
  const verificationNumber = generateVerificationNumber();
  const dateOfBirth        = generateDateOfBirth();
  const age                = String(calculateAge(dateOfBirth));
  const applicant          = fakeName();
  const father             = fakeName();
  const mother             = fakeName();

  // draftId is populated from the personal save-draft response and reused
  // by every subsequent module in this iteration.
  let draftId    = null;
  let syncHashes = { allowance: null, cash_usage: null, pmt: null, family: null };

  // Shared draft_id helper — logs a warning if still null when called
  function getDraftId(step) {
    if (!draftId) {
      console.warn(`[VU ${__VU}][${step}] draftId is null — personal draft may have failed`);
    }
    return draftId || '';
  }

  // ── Step 01: Post-login data fetches ─────────────────────────────────────

  group('01_post_login_data', function () {

    check(
      http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'app_counts_initial' },
      }),
      { 'App counts: status 200': r => r.status === 200 }
    );

    check(
      http.get(`${BASE_URL}/api/v1/global/getApplicationPageData?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'app_page_data' },
      }),
      { 'App page data: status 200': r => r.status === 200 }
    );

    sleep(0.3);

    check(
      http.get(`${BASE_URL}/api/v1/global/family-card-user/locations/district/get/2?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'loc_district' },
      }),
      { 'District: status 200': r => r.status === 200 }
    );

    check(
      http.get(`${BASE_URL}/api/v1/global/family-card-user/locations/thana/get/21?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'loc_thana' },
      }),
      { 'Thana: status 200': r => r.status === 200 }
    );

    check(
      http.get(`${BASE_URL}/api/v1/global/online-application/disabled-areas/24?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'disabled_areas' },
      }),
      { 'Disabled areas: status 200': r => r.status === 200 }
    );

    sleep(0.3);

    check(
      http.get(`${BASE_URL}/api/v1/captcha?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'captcha_postauth' },
      }),
      { 'Captcha (post-auth): status 200': r => r.status === 200 }
    );

    check(
      http.get(`${BASE_URL}/api/v1/global/family-card-user/locations/union/get/197?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'loc_union' },
      }),
      { 'Union: status 200': r => r.status === 200 }
    );

    check(
      http.get(`${BASE_URL}/api/v1/global/family-card-user/locations/ward/get/2171?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'loc_ward' },
      }),
      { 'Ward: status 200': r => r.status === 200 }
    );

    check(
      http.get(`${BASE_URL}/api/v1/global/district/get/2?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'global_district' },
      }),
      { 'Global district: status 200': r => r.status === 200 }
    );

    check(
      http.get(`${BASE_URL}/api/v1/global/thana/get/21?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'global_thana' },
      }),
      { 'Global thana: status 200': r => r.status === 200 }
    );

    check(
      http.get(`${BASE_URL}/api/v1/global/family-card-user/locations/union/get/197?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'global_union' },
      }),
      { 'Global union: status 200': r => r.status === 200 }
    );

    check(
      http.get(`${BASE_URL}/api/v1/global/family-card-user/locations/ward/get/2171?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'global_ward' },
      }),
      { 'Global ward: status 200': r => r.status === 200 }
    );
  });

  sleep(0.5);

  // ── Step 02: save-draft — module: personal ────────────────────────────────

  group('02_save_draft_personal', function () {
    const form = {
      lang:                'bn',
      module:              'personal',
      program_id:          '24',
      sub_program_id:      '24',
      profession:          '181',
      name_bn:             applicant.bn,
      name_en:             applicant.en,
      date_of_birth:       dateOfBirth,
      age:                 age,
      gender_id:           '24',
      father_name_en:      father.en,
      father_name_bn:      father.bn,
      mother_name_en:      mother.en,
      mother_name_bn:      mother.bn,
      mobile:              '01671816194',
      verification_number: verificationNumber,
      verification_type:   '2',
      education_status:    '88',
      religion:            '96',
      marital_status:      '101',
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      form,
      { headers: authHeaders(token), timeout: '20s', tags: { name: 'save_draft_personal' } }
    );

    saveDraftDuration.add(res.timings.duration);

    const ok = check(res, {
      'Draft personal: status 2xx':        r => r.status >= 200 && r.status < 300,
      'Draft personal: response < 3000ms': r => r.timings.duration < 3000,
    });

    if (ok) {
      draftId = extractDraftId(res);
      if (!draftId) {
        console.warn(`[VU ${__VU}] personal draft OK but draftId not found in response: ${res.body.substring(0, 200)}`);
      } else {
        console.log(`[VU ${__VU}] draftId=${draftId} verificationNumber=${verificationNumber}`);
      }
    } else {
      familyCardFailure.add(1);
      console.error(`[save_draft_personal FAIL] VU ${__VU} | HTTP ${res.status} | body=${res.body}`);
    }
  });

  sleep(0.3);

  check(
    http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
      headers: authHeaders(token), tags: { name: 'counts_after_personal' },
    }),
    { 'Counts after personal: status 200': r => r.status === 200 }
  );

  // Abort if personal draft failed — all subsequent modules need draftId
  if (!draftId) {
    console.error(`[VU ${__VU}] draftId missing after personal — skipping remaining modules`);
    return;
  }

  sleep(0.5);

  // ── Step 03: Media uploads (image, signature, house_image) ────────────────

  group('03_media_uploads', function () {
    const dId = draftId;

    const imgRes = http.post(
      `${BASE_URL}/api/v1/family-card/applications/media-upload?lang=bn`,
      { lang: 'bn', field: 'image',       draft_id: dId, file: http.file(TEST_IMAGE, 'test.jpg', 'image/jpeg') },
      { headers: authHeaders(token), timeout: '30s', tags: { name: 'media_upload_image' } }
    );
    mediaUploadDuration.add(imgRes.timings.duration);
    check(imgRes, { 'Upload image: status 2xx': r => r.status >= 200 && r.status < 300 });

    sleep(0.3);

    const sigRes = http.post(
      `${BASE_URL}/api/v1/family-card/applications/media-upload?lang=bn`,
      { lang: 'bn', field: 'signature',   draft_id: dId, file: http.file(TEST_IMAGE, 'test.jpg', 'image/jpeg') },
      { headers: authHeaders(token), timeout: '30s', tags: { name: 'media_upload_signature' } }
    );
    mediaUploadDuration.add(sigRes.timings.duration);
    check(sigRes, { 'Upload signature: status 2xx': r => r.status >= 200 && r.status < 300 });

    sleep(0.3);

    const houseRes = http.post(
      `${BASE_URL}/api/v1/family-card/applications/media-upload?lang=bn`,
      { lang: 'bn', field: 'house_image', draft_id: dId, file: http.file(TEST_IMAGE, 'test.jpg', 'image/jpeg') },
      { headers: authHeaders(token), timeout: '30s', tags: { name: 'media_upload_house_image' } }
    );
    mediaUploadDuration.add(houseRes.timings.duration);
    check(houseRes, { 'Upload house_image: status 2xx': r => r.status >= 200 && r.status < 300 });
  });

  sleep(0.5);

  // ── Step 04: save-draft — module: photos ─────────────────────────────────

  group('04_save_draft_photos', function () {
    const form = {
      lang:                'bn',
      module:              'photos',
      program_id:          '24',
      sub_program_id:      '24',
      verification_number: verificationNumber,
      verification_type:   '2',
      draft_id:            draftId,
      image:               'ctm/stage/applications/2026-09-01/applicant_image/79b63d94-12cf-48e2-ad36-2f4948df618b.jpg',
      signature:           'ctm/stage/applications/2026-09-01/applicant_signature/fc8d40ce-d0c9-4cc1-bbfc-6cdb55e7a78c.jpg',
      house_image:         'ctm/stage/applications/2026-09-01/house_image/c864faab-f143-4891-b431-a05948a08bf6.jpg',
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      form,
      { headers: authHeaders(token), timeout: '20s', tags: { name: 'save_draft_photos' } }
    );

    saveDraftDuration.add(res.timings.duration);
    check(res, { 'Draft photos: status 2xx': r => r.status >= 200 && r.status < 300 });
  });

  sleep(0.3);

  check(
    http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
      headers: authHeaders(token), tags: { name: 'counts_after_photos' },
    }),
    { 'Counts after photos: status 200': r => r.status === 200 }
  );

  sleep(0.5);

  // ── Step 05: save-draft — module: address ─────────────────────────────────
  // All present-address and permanent-address fields from the JMX recording.

  group('05_save_draft_address', function () {
    const form = {
      lang:                        'bn',
      module:                      'address',
      program_id:                  '24',
      sub_program_id:              '24',
      mobile:                      '01671816194',
      verification_number:         verificationNumber,
      verification_type:           '2',
      draft_id:                    draftId,
      // Present address
      division_id:                 '2',
      district_id:                 '21',
      thana_id:                    '197',
      union_id:                    '2171',
      ward_id_union:               '15627',
      address:                     'C',
      post_code:                   '1234',
      location_type:               '2',
      sub_location_type:           '2',
      // Permanent address
      permanent_division_id:       '2',
      permanent_district_id:       '21',
      permanent_thana_id:          '197',
      permanent_union_id:          '2171',
      permanent_ward_id_union:     '15627',
      permanent_address:           'C',
      permanent_post_code:         '1234',
      permanent_location_type:     '2',
      permanent_sub_location_type: '2',
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      form,
      { headers: authHeaders(token), timeout: '20s', tags: { name: 'save_draft_address' } }
    );

    saveDraftDuration.add(res.timings.duration);

    const ok = check(res, {
      'Draft address: status 2xx':        r => r.status >= 200 && r.status < 300,
      'Draft address: response < 3000ms': r => r.timings.duration < 3000,
    });

    if (!ok) {
      familyCardFailure.add(1);
      console.error(`[save_draft_address FAIL] VU ${__VU} | HTTP ${res.status} | body=${res.body}`);
    }
  });

  sleep(0.3);

  check(
    http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
      headers: authHeaders(token), tags: { name: 'counts_after_address' },
    }),
    { 'Counts after address: status 200': r => r.status === 200 }
  );

  sleep(0.5);

  // ── Step 06: save-draft — module: program (application_allowance_values) ──

  group('06_save_draft_program', function () {
    const form = {
      lang:               'bn',
      module:             'program',
      program_id:         '24',
      sub_program_id:     '24',
      verification_number: verificationNumber,
      verification_type:  '2',
      draft_id:           draftId,
      application_allowance_values: JSON.stringify([
        { allowance_program_additional_fields_id: 91, allowance_program_additional_field_values_id: 646,  value: null },
        { allowance_program_additional_fields_id: 78, allowance_program_additional_field_values_id: 633,  value: null },
        { allowance_program_additional_fields_id: 76, allowance_program_additional_field_values_id: null, value: '3' },
        { allowance_program_additional_fields_id: 75, allowance_program_additional_field_values_id: null, value: '4' },
        { allowance_program_additional_fields_id: 77, allowance_program_additional_field_values_id: null, value: '5' },
        { allowance_program_additional_fields_id: 93, allowance_program_additional_field_values_id: 641,  value: null },
        { allowance_program_additional_fields_id: 85, allowance_program_additional_field_values_id: 637,  value: null },
        { allowance_program_additional_fields_id: 96, allowance_program_additional_field_values_id: 651,  value: null },
      ]),
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      form,
      { headers: authHeaders(token), timeout: '20s', tags: { name: 'save_draft_program' } }
    );

    saveDraftDuration.add(res.timings.duration);
    check(res, { 'Draft program: status 2xx': r => r.status >= 200 && r.status < 300 });
    syncHashes = mergeSyncHashes(syncHashes, res);
  });

  sleep(0.3);

  check(
    http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
      headers: authHeaders(token), tags: { name: 'counts_after_program' },
    }),
    { 'Counts after program: status 200': r => r.status === 200 }
  );

  sleep(0.5);

  // ── Step 07: save-draft — module: bank ───────────────────────────────────

  group('07_save_draft_bank', function () {
    const form = {
      lang:                'bn',
      module:              'bank',
      program_id:          '24',
      sub_program_id:      '24',
      verification_number: verificationNumber,
      verification_type:   '2',
      draft_id:            draftId,
      account_type:        '1',
      account_owner:       '142',
      bank_name:           '1',
      branch_name:         '7393',
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      form,
      { headers: authHeaders(token), timeout: '20s', tags: { name: 'save_draft_bank' } }
    );

    saveDraftDuration.add(res.timings.duration);

    const ok = check(res, {
      'Draft bank: status 2xx':        r => r.status >= 200 && r.status < 300,
      'Draft bank: response < 3000ms': r => r.timings.duration < 3000,
    });

    if (!ok) {
      familyCardFailure.add(1);
      console.error(`[save_draft_bank FAIL] VU ${__VU} | HTTP ${res.status} | body=${res.body}`);
    }
  });

  sleep(0.3);

  check(
    http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
      headers: authHeaders(token), tags: { name: 'counts_after_bank' },
    }),
    { 'Counts after bank: status 200': r => r.status === 200 }
  );

  sleep(0.5);

  // ── Step 08: save-draft — module: nominee ────────────────────────────────

  group('08_save_draft_nominee', function () {
    const form = {
      lang:                'bn',
      module:              'nominee',
      program_id:          '24',
      sub_program_id:      '24',
      verification_number: verificationNumber,
      verification_type:   '2',
      draft_id:            draftId,
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      form,
      { headers: authHeaders(token), timeout: '20s', tags: { name: 'save_draft_nominee' } }
    );

    saveDraftDuration.add(res.timings.duration);
    check(res, { 'Draft nominee: status 2xx': r => r.status >= 200 && r.status < 300 });
  });

  sleep(0.3);

  check(
    http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
      headers: authHeaders(token), tags: { name: 'counts_after_nominee' },
    }),
    { 'Counts after nominee: status 200': r => r.status === 200 }
  );

  sleep(0.5);

  // ── Step 09: save-draft — module: pmt ────────────────────────────────────

  group('09_save_draft_pmt', function () {
    const form = {
      lang:                'bn',
      module:              'pmt',
      program_id:          '24',
      sub_program_id:      '24',
      verification_number: verificationNumber,
      verification_type:   '2',
      draft_id:            draftId,
      house_size:          '1',
      no_of_room:          '503',
      no_of_people_score:  '-0.778',
      per_room_score:      '-2.333',
      application_pmt: JSON.stringify([
        { variable_id: 576, sub_variables: 577  },
        { variable_id: 530, sub_variables: 531  },
        { variable_id: 571, sub_variables: 572  },
        { variable_id: 1,   sub_variables: 442  },
        { variable_id: 7,   sub_variables: 329  },
        { variable_id: 12,  sub_variables: 440  },
        { variable_id: 14,  sub_variables: 382  },
        { variable_id: 18,  sub_variables: 409  },
        { variable_id: 36,  sub_variables: 298  },
        { variable_id: 33,  sub_variables: 291  },
        { variable_id: 536, sub_variables: [538] },
        { variable_id: 393, sub_variables: 396  },
        { variable_id: 30,  sub_variables: 338  },
        { variable_id: 40,  sub_variables: 400  },
        { variable_id: 548, sub_variables: 550  },
        { variable_id: 579, sub_variables: 590  },
        { variable_id: 41,  sub_variables: 387  },
        { variable_id: 567, sub_variables: 568  },
        { variable_id: 25,  sub_variables: 406  },
        { variable_id: 29,  sub_variables: 276  },
        { variable_id: 22,  sub_variables: 403  },
        { variable_id: 595, sub_variables: 599  },
        { variable_id: 47,  sub_variables: [566] },
        { variable_id: 500, sub_variables: 503  },
      ]),
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      form,
      { headers: authHeaders(token), timeout: '20s', tags: { name: 'save_draft_pmt' } }
    );

    saveDraftDuration.add(res.timings.duration);
    check(res, { 'Draft pmt: status 2xx': r => r.status >= 200 && r.status < 300 });
    syncHashes = mergeSyncHashes(syncHashes, res);
  });

  sleep(0.3);

  check(
    http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
      headers: authHeaders(token), tags: { name: 'counts_after_pmt' },
    }),
    { 'Counts after pmt: status 200': r => r.status === 200 }
  );

  sleep(0.5);

  // ── Step 10: save-draft — module: family ─────────────────────────────────

  group('10_save_draft_family', function () {
    const form = {
      lang:                'bn',
      module:              'family',
      program_id:          '24',
      sub_program_id:      '24',
      verification_number: verificationNumber,
      verification_type:   '2',
      draft_id:            draftId,
      family_members: JSON.stringify([
        {
          is_self:                            true,
          _lockedFields:                      ['name_bn','name_en','father_name_bn','mother_name_bn','gender_id','maritial_status_id','religion_id','dob','mobile_number','education_status_id','profession_id','verification_type','brn_id'],
          name_en:                            applicant.en,
          name_bn:                            applicant.bn,
          verification_type:                  2,
          nid:                                '',
          brn_id:                             verificationNumber,
          dob:                                dateOfBirth,
          relationship_id:                    260,
          father_name_bn:                     father.bn,
          mother_name_bn:                     mother.bn,
          facilities_ids:                     [],
          gender_id:                          24,
          maritial_status_id:                 101,
          religion_id:                        96,
          profession_id:                      181,
          mobile_number:                      '01671816194',
          literacy_id:                        241,
          education_status_id:                88,
          health_condition_id:                203,
          livelihood_profession_id:           212,
          disability_type_id:                 '',
          is_currently_student:               0,
          is_ssnp_covered:                    0,
          is_dss_training_or_financial_benefit: 0,
          estimate_annual_income:             '55',
          is_gov_job_holder:                  0,
          is_member_disabled:                 0,
          menu:                               false,
        },
      ]),
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      form,
      { headers: authHeaders(token), timeout: '20s', tags: { name: 'save_draft_family' } }
    );

    saveDraftDuration.add(res.timings.duration);
    check(res, { 'Draft family: status 2xx': r => r.status >= 200 && r.status < 300 });
    syncHashes = mergeSyncHashes(syncHashes, res);
  });

  sleep(0.3);

  check(
    http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
      headers: authHeaders(token), tags: { name: 'counts_after_family' },
    }),
    { 'Counts after family: status 200': r => r.status === 200 }
  );

  sleep(0.5);

  // ── Step 11: save-draft — module: cash_usage ─────────────────────────────

  group('11_save_draft_cash_usage', function () {
    const form = {
      lang:                'bn',
      module:              'cash_usage',
      program_id:          '24',
      sub_program_id:      '24',
      verification_number: verificationNumber,
      verification_type:   '2',
      draft_id:            draftId,
      cash_usages: JSON.stringify([
        { lookup_id: 267, amount: 199, other_detail: null },
        { lookup_id: 268, amount: 299, other_detail: null },
      ]),
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      form,
      { headers: authHeaders(token), timeout: '20s', tags: { name: 'save_draft_cash_usage' } }
    );

    saveDraftDuration.add(res.timings.duration);

    const ok = check(res, {
      'Draft cash_usage: status 2xx':        r => r.status >= 200 && r.status < 300,
      'Draft cash_usage: response < 3000ms': r => r.timings.duration < 3000,
    });

    if (!ok) {
      familyCardFailure.add(1);
      console.error(`[save_draft_cash_usage FAIL] VU ${__VU} | HTTP ${res.status} | body=${res.body}`);
    } else {
      familyCardFailure.add(0);
    }
    syncHashes = mergeSyncHashes(syncHashes, res);
  });

  sleep(0.3);

  check(
    http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
      headers: authHeaders(token), tags: { name: 'counts_after_cash_usage' },
    }),
    { 'Counts after cash_usage: status 200': r => r.status === 200 }
  );

  sleep(0.5);

  // ── Step 12: save-draft — module: external ────────────────────────────────

  group('12_save_draft_external', function () {
    const form = {
      lang:                'bn',
      module:              'external',
      program_id:          '24',
      sub_program_id:      '24',
      verification_number: verificationNumber,
      verification_type:   '2',
      draft_id:            draftId,
      external_user_info: JSON.stringify({
        user_name_en:  applicant.en,
        user_mobile:   '01744682915',
        form_number:   '',
      }),
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      form,
      { headers: authHeaders(token), timeout: '20s', tags: { name: 'save_draft_external' } }
    );

    saveDraftDuration.add(res.timings.duration);
    check(res, { 'Draft external: status 2xx': r => r.status >= 200 && r.status < 300 });

    // Accumulate any remaining sync hashes from this response
    syncHashes = mergeSyncHashes(syncHashes, res);
  });

  sleep(0.3);

  // ── Step 13: GET counts (pre-finalize) ────────────────────────────────────

  check(
    http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
      headers: authHeaders(token), tags: { name: 'counts_pre_finalize' },
    }),
    { 'Counts pre-finalize: status 200': r => r.status === 200 }
  );

  sleep(0.5);

  // ── Step 14: POST finalize ────────────────────────────────────────────────
  // Finalizes the application. URL contains the draft_id.
  // Sync hashes come from the save-draft responses — sent as captured values.

  group('14_finalize', function () {
    const form = {
      lang:                 'bn',
      allowance_sync_hash:  syncHashes.allowance  || '',
      cash_usage_sync_hash: syncHashes.cash_usage || '',
      pmt_sync_hash:        syncHashes.pmt        || '',
      family_sync_hash:     syncHashes.family     || '',
    };

    console.log(`[VU ${__VU}] Finalizing draftId=${draftId} hashes: allowance=${syncHashes.allowance} cash=${syncHashes.cash_usage} pmt=${syncHashes.pmt} family=${syncHashes.family}`);

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/${draftId}/finalize?lang=bn`,
      form,
      {
        headers: Object.assign({}, authHeaders(token), {
          'Application': 'application/json',
        }),
        timeout: '30s',
        tags: { name: 'finalize' },
      }
    );

    finalizeDuration.add(res.timings.duration);

    const ok = check(res, {
      'Finalize: status 2xx':        r => r.status >= 200 && r.status < 300,
      'Finalize: response < 5000ms': r => r.timings.duration < 5000,
    });

    if (ok) {
      familyCardFailure.add(0);
      console.log(`[VU ${__VU}] Application ${draftId} finalized successfully`);
    } else {
      familyCardFailure.add(1);
      console.error(`[finalize FAIL] VU ${__VU} | draftId=${draftId} | HTTP ${res.status} | body=${res.body}`);
    }
  });

  sleep(0.5);

  // ── Step 15: GET counts + location refresh (post-finalize) ────────────────

  group('15_final_refresh', function () {
    check(
      http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
        headers: authHeaders(token), tags: { name: 'final_counts' },
      }),
      { 'Final counts: status 200': r => r.status === 200 }
    );

    const locations = [
      `${BASE_URL}/api/v1/global/family-card-user/locations/district/get/2?lang=bn`,
      `${BASE_URL}/api/v1/global/family-card-user/locations/thana/get/21?lang=bn`,
      `${BASE_URL}/api/v1/global/family-card-user/locations/union/get/197?lang=bn`,
      `${BASE_URL}/api/v1/global/family-card-user/locations/ward/get/2171?lang=bn`,
      `${BASE_URL}/api/v1/global/thana/get/21?lang=bn`,
    ];

    for (const url of locations) {
      http.get(url, { headers: authHeaders(token) });
    }
  });

  sleep(1);
}
