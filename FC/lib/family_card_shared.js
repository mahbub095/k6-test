/**
 * family_card_shared.js
 *
 * Shared library for all Family Card load test types (load / spike / soak / stress).
 * Each test file only defines its own `options` block and imports from here.
 *
 * Exports:
 *   setup()              — logs in once; passes token to every VU iteration
 *   familyCardDefault()  — full 15-step application flow (used as default export)
 *   makeHandleSummary()  — builds the HTML + JSON report writer for each test
 *   authHeaders()        — builds standard API auth headers
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// ─── INIT ─────────────────────────────────────────────────────────────────────
// open() must run at the module level (k6 init stage), never inside a function.

export const TEST_IMAGE = open('../test.jpg', 'b');

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const BASE_URL = 'https://stage-api.bhata.gov.bd';

const LOGIN_CREDENTIALS = {
  username: 'enumghatail',
  password: 'Password#1',
};

// Application IDs used across all draft modules
const PROGRAM_ID     = '24';
const SUB_PROGRAM_ID = '24';

// ─── METRICS ──────────────────────────────────────────────────────────────────

export const saveDraftDuration   = new Trend('save_draft_duration',   true);
export const mediaUploadDuration = new Trend('media_upload_duration', true);
export const finalizeDuration    = new Trend('finalize_duration',     true);
export const familyCardFailure   = new Rate('family_card_failure_rate');

// ─── STATIC PAYLOADS ──────────────────────────────────────────────────────────
// Stringified once at init — not on every VU iteration.

const APPLICATION_PMT = JSON.stringify([
  { variable_id: 576, sub_variables: 577   },
  { variable_id: 530, sub_variables: 531   },
  { variable_id: 571, sub_variables: 572   },
  { variable_id: 1,   sub_variables: 442   },
  { variable_id: 7,   sub_variables: 329   },
  { variable_id: 12,  sub_variables: 440   },
  { variable_id: 14,  sub_variables: 382   },
  { variable_id: 18,  sub_variables: 409   },
  { variable_id: 36,  sub_variables: 298   },
  { variable_id: 33,  sub_variables: 291   },
  { variable_id: 536, sub_variables: [538] },
  { variable_id: 393, sub_variables: 396   },
  { variable_id: 30,  sub_variables: 338   },
  { variable_id: 40,  sub_variables: 400   },
  { variable_id: 548, sub_variables: 550   },
  { variable_id: 579, sub_variables: 590   },
  { variable_id: 41,  sub_variables: 387   },
  { variable_id: 567, sub_variables: 568   },
  { variable_id: 25,  sub_variables: 406   },
  { variable_id: 29,  sub_variables: 276   },
  { variable_id: 22,  sub_variables: 403   },
  { variable_id: 595, sub_variables: 599   },
  { variable_id: 47,  sub_variables: [566] },
  { variable_id: 500, sub_variables: 503   },
]);

const APPLICATION_ALLOWANCE_VALUES = JSON.stringify([
  { allowance_program_additional_fields_id: 91, allowance_program_additional_field_values_id: 646,  value: null },
  { allowance_program_additional_fields_id: 78, allowance_program_additional_field_values_id: 633,  value: null },
  { allowance_program_additional_fields_id: 76, allowance_program_additional_field_values_id: null, value: '3'  },
  { allowance_program_additional_fields_id: 75, allowance_program_additional_field_values_id: null, value: '4'  },
  { allowance_program_additional_fields_id: 77, allowance_program_additional_field_values_id: null, value: '5'  },
  { allowance_program_additional_fields_id: 93, allowance_program_additional_field_values_id: 641,  value: null },
  { allowance_program_additional_fields_id: 85, allowance_program_additional_field_values_id: 637,  value: null },
  { allowance_program_additional_fields_id: 96, allowance_program_additional_field_values_id: 651,  value: null },
]);

const CASH_USAGES = JSON.stringify([
  { lookup_id: 267, amount: 199, other_detail: null },
  { lookup_id: 268, amount: 299, other_detail: null },
]);

// ─── DATA GENERATORS ──────────────────────────────────────────────────────────
// Each VU iteration generates unique applicant data so records don't collide.

/** 17-digit verification number starting with '19' */
function generateVerificationNumber() {
  let n = '19';
  for (let i = 0; i < 15; i++) n += Math.floor(Math.random() * 10);
  return n;
}

/** Random date of birth — applicant is at least 20 years old (born ≤ 2006) */
function generateDateOfBirth() {
  const year  = 1950 + Math.floor(Math.random() * (2006 - 1950 + 1));
  const month = 1    + Math.floor(Math.random() * 12);
  const day   = 1    + Math.floor(Math.random() * 28); // max 28 avoids month-end edge cases
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Random date of birth — nominee is at least 18 years old (born ≤ 2008) */
function generateNomineeDateOfBirth() {
  const year  = 1950 + Math.floor(Math.random() * (2008 - 1950 + 1));
  const month = 1    + Math.floor(Math.random() * 12);
  const day   = 1    + Math.floor(Math.random() * 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Age in whole years relative to 2026 from a yyyy-MM-dd string */
function calculateAge(dob) {
  const [y, m, d] = dob.split('-').map(Number);
  let age = 2026 - y;
  if (m > 9 || (m === 9 && d > 1)) age -= 1; // birthday not yet reached in 2026
  return age;
}

// Fake Bangladeshi name pools
const FIRST_NAMES_EN = ['Rahim','Karim','Jamal','Hasan','Nabil','Faruk','Milon','Ratan','Sumon','Tariq','Belal','Imran','Shakil','Liton','Sajib','Arif','Rubel','Mamun','Jewel','Tuhin','Salim','Badal','Rasel','Bipul','Zahir','Nasir','Habib','Monir','Polash','Dipu'];
const LAST_NAMES_EN  = ['Ahmed','Islam','Hossain','Khan','Miah','Sheikh','Sarker','Mondol','Chowdhury','Bhuiyan','Alam','Rahman','Uddin','Ali','Akter','Begum','Khatun','Biswas','Das','Paul'];
const FIRST_NAMES_BN = ['রহিম','করিম','জামাল','হাসান','নাবিল','ফারুক','মিলন','রতন','সুমন','তারিক','বেলাল','ইমরান','শাকিল','লিটন','সাজিব','আরিফ','রুবেল','মামুন','জুয়েল','তুহিন','সালিম','বাদল','রাসেল','বিপুল','জাহির','নাসির','হাবিব','মনির','পলাশ','দিপু'];
const LAST_NAMES_BN  = ['আহমেদ','ইসলাম','হোসেন','খান','মিয়া','শেখ','সরকার','মন্ডল','চৌধুরী','ভূইয়া','আলম','রহমান','উদ্দিন','আলী','আক্তার','বেগম','খাতুন','বিশ্বাস','দাস','পাল'];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Returns a random { en, bn } name pair */
function generateName() {
  return {
    en: `${pickRandom(FIRST_NAMES_EN)} ${pickRandom(LAST_NAMES_EN)}`,
    bn: `${pickRandom(FIRST_NAMES_BN)} ${pickRandom(LAST_NAMES_BN)}`,
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Standard auth headers for all API requests */
export function authHeaders(token) {
  return {
    'Accept':         'application/json, text/plain, */*',
    'X-App-Language': 'bn',
    'Authorization':  `Bearer ${token}`,
  };
}

/** Parse token from login response */
function extractToken(res) {
  try {
    const body = JSON.parse(res.body);
    return body?.data?.token || body?.token || body?.access_token || null;
  } catch {
    return null;
  }
}

/** Parse draft_id from save-draft response */
function extractDraftId(res) {
  try {
    const body = JSON.parse(res.body);
    return body?.data?.id || body?.data?.draft_id || body?.id || null;
  } catch {
    return null;
  }
}

/**
 * Parse sync hashes from a save-draft response.
 * The server returns these on specific modules (program, pmt, family, cash_usage).
 * They are required by the finalize endpoint.
 */
function extractSyncHashes(res) {
  try {
    const data = JSON.parse(res.body)?.data || {};
    return {
      allowance:  data.allowance_sync_hash  || data.allowanceSyncHash  || null,
      cash_usage: data.cash_usage_sync_hash || data.cashUsageSyncHash  || null,
      pmt:        data.pmt_sync_hash        || data.pmtSyncHash        || null,
      family:     data.family_sync_hash     || data.familySyncHash     || null,
    };
  } catch {
    return { allowance: null, cash_usage: null, pmt: null, family: null };
  }
}

/**
 * Merges new sync hashes into the accumulator.
 * Only updates a key when the new response actually contains that hash.
 */
function mergeSyncHashes(acc, res) {
  const fresh = extractSyncHashes(res);
  return {
    allowance:  fresh.allowance  !== null ? fresh.allowance  : acc.allowance,
    cash_usage: fresh.cash_usage !== null ? fresh.cash_usage : acc.cash_usage,
    pmt:        fresh.pmt        !== null ? fresh.pmt        : acc.pmt,
    family:     fresh.family     !== null ? fresh.family     : acc.family,
  };
}

// ─── SETUP ────────────────────────────────────────────────────────────────────
// Runs exactly once before any VU starts.
// Returns { token } which k6 passes as the first argument to every default() call.

export function setup() {
  const res = http.post(
    `${BASE_URL}/api/v1/family-card/login/dev`,
    JSON.stringify(LOGIN_CREDENTIALS),
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
    throw new Error(`Login failed in setup — HTTP ${res.status}: ${res.body}`);
  }

  console.log('[setup] Login successful. Token obtained.');
  return { token };
}

// ─── MAIN FLOW ────────────────────────────────────────────────────────────────
/**
 * familyCardDefault — the full 15-step application submission flow.
 *
 * Step 01  Post-login data (counts, page data, location lookups)
 * Step 02  Save draft — personal info
 * Step 03  Upload media (photo, signature, house image)
 * Step 04  Save draft — photos (file paths)
 * Step 05  Save draft — address (present + permanent)
 * Step 06  Save draft — program (allowance values)
 * Step 07  Save draft — bank account
 * Step 08  Save draft — nominee
 * Step 09  Save draft — PMT (poverty proxy means test)
 * Step 10  Save draft — family members
 * Step 11  Save draft — cash usage
 * Step 12  Save draft — external user info
 * Step 13  Save draft — module=all (final submission with declaration consent)
 * Step 14  GET counts (pre-finalize check)
 * Step 15  POST finalize (seal the application)
 * Step 16  Final counts + location refresh
 */
export function familyCardDefault({ token }) {

  if (!token) {
    console.error(`[VU ${__VU}] No token received — aborting iteration`);
    return;
  }

  // ── Generate unique data for this iteration ─────────────────────────────
  const verificationNumber = generateVerificationNumber();
  const dateOfBirth        = generateDateOfBirth();
  const age                = String(calculateAge(dateOfBirth));
  const applicant          = generateName();
  const father             = generateName();
  const mother             = generateName();

  let draftId    = null;
  let syncHashes = { allowance: null, cash_usage: null, pmt: null, family: null };

  const headers = authHeaders(token);

  // ── Reusable request helpers ────────────────────────────────────────────

  /** GET a URL and assert HTTP 200 */
  function apiGet(url, tag, label) {
    check(
      http.get(url, { headers, tags: { name: tag } }),
      { [`${label}: status 200`]: r => r.status === 200 }
    );
  }

  /** GET application counts */
  function getCounts(tag) {
    apiGet(
      `${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`,
      tag,
      `Counts (${tag})`
    );
  }

  /** POST to save-draft endpoint */
  function saveDraft(form, tag) {
    return http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      form,
      { headers, timeout: '20s', tags: { name: tag } }
    );
  }

  /** POST a media file upload */
  function uploadMedia(field, tag) {
    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/media-upload?lang=bn`,
      { lang: 'bn', field, draft_id: draftId, file: http.file(TEST_IMAGE, 'test.jpg', 'image/jpeg') },
      { headers, timeout: '30s', tags: { name: tag } }
    );
    mediaUploadDuration.add(res.timings.duration);
    check(res, { [`Upload ${field}: status 2xx`]: r => r.status >= 200 && r.status < 300 });
    sleep(1);
  }

  /** POST a save-draft, record timing, check success */
  function postDraft(form, tag, label) {
    const res = saveDraft(form, tag);
    saveDraftDuration.add(res.timings.duration);
    const ok = check(res, { [`${label}: status 2xx`]: r => r.status >= 200 && r.status < 300 });
    if (!ok) {
      familyCardFailure.add(1);
      console.error(`[${tag} FAIL] VU ${__VU} | HTTP ${res.status} | body=${res.body}`);
    }
    return { res, ok };
  }

  // ── Shared fields sent with every save-draft request ──────────────────
  const draftBase = () => ({
    lang:                'bn',
    program_id:          PROGRAM_ID,
    sub_program_id:      SUB_PROGRAM_ID,
    verification_number: verificationNumber,
    verification_type:   '2',
    draft_id:            draftId,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 01 — Post-login data fetches
  // Loads counts, page configuration, and location dropdowns needed by the form.
  // ═══════════════════════════════════════════════════════════════════════════
  group('01_post_login_data', function () {
    getCounts('app_counts_initial');
    apiGet(`${BASE_URL}/api/v1/global/getApplicationPageData?lang=bn`,                            'app_page_data',   'App page data');
    sleep(1);
    apiGet(`${BASE_URL}/api/v1/global/family-card-user/locations/district/get/2?lang=bn`,         'loc_district',    'District');
    apiGet(`${BASE_URL}/api/v1/global/family-card-user/locations/thana/get/21?lang=bn`,           'loc_thana',       'Thana');
    apiGet(`${BASE_URL}/api/v1/global/online-application/disabled-areas/24?lang=bn`,              'disabled_areas',  'Disabled areas');
    sleep(1);
    apiGet(`${BASE_URL}/api/v1/captcha?lang=bn`,                                                  'captcha_postauth','Captcha');
    apiGet(`${BASE_URL}/api/v1/global/family-card-user/locations/union/get/197?lang=bn`,          'loc_union',       'Union');
    apiGet(`${BASE_URL}/api/v1/global/family-card-user/locations/ward/get/2171?lang=bn`,          'loc_ward',        'Ward');
    apiGet(`${BASE_URL}/api/v1/global/district/get/2?lang=bn`,                                   'global_district', 'Global district');
    apiGet(`${BASE_URL}/api/v1/global/thana/get/21?lang=bn`,                                     'global_thana',    'Global thana');
    apiGet(`${BASE_URL}/api/v1/global/family-card-user/locations/union/get/197?lang=bn`,          'global_union',    'Global union');
    apiGet(`${BASE_URL}/api/v1/global/family-card-user/locations/ward/get/2171?lang=bn`,          'global_ward',     'Global ward');
  });
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 02 — Save draft: personal info
  // Creates the draft record and returns the draft_id needed for all later steps.
  // ═══════════════════════════════════════════════════════════════════════════
  group('02_save_draft_personal', function () {
    const res = saveDraft({
      lang:                'bn',
      module:              'personal',
      program_id:          PROGRAM_ID,
      sub_program_id:      SUB_PROGRAM_ID,
      verification_number: verificationNumber,
      verification_type:   '2',
      profession:          '181',
      name_en:             applicant.en,
      name_bn:             applicant.bn,
      father_name_en:      father.en,
      father_name_bn:      father.bn,
      mother_name_en:      mother.en,
      mother_name_bn:      mother.bn,
      date_of_birth:       dateOfBirth,
      age:                 age,
      gender_id:           '24',
      mobile:              '01671816194',
      education_status:    '88',
      religion:            '96',
      marital_status:      '101',
    }, 'save_draft_personal');

    saveDraftDuration.add(res.timings.duration);

    const ok = check(res, {
      'Draft personal: status 2xx':        r => r.status >= 200 && r.status < 300,
      'Draft personal: response < 3000ms': r => r.timings.duration < 3000,
    });

    if (ok) {
      draftId = extractDraftId(res);
      if (!draftId) {
        console.warn(`[VU ${__VU}] Personal draft OK but no draftId in response: ${res.body.substring(0, 200)}`);
      } else {
        console.log(`[VU ${__VU}] Draft created — draftId=${draftId} vn=${verificationNumber}`);
      }
    } else {
      familyCardFailure.add(1);
      console.error(`[personal FAIL] VU ${__VU} | HTTP ${res.status} | body=${res.body}`);
    }
  });
  sleep(1);
  getCounts('counts_after_personal');

  // All remaining steps require a valid draftId — abort if missing
  if (!draftId) {
    console.error(`[VU ${__VU}] No draftId after personal step — aborting iteration`);
    return;
  }
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 03 — Upload media files
  // Uploads applicant photo, signature, and house image.
  // ═══════════════════════════════════════════════════════════════════════════
  group('03_media_uploads', function () {
    uploadMedia('image',       'media_upload_image');
    uploadMedia('signature',   'media_upload_signature');
    uploadMedia('house_image', 'media_upload_house_image');
  });
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 04 — Save draft: photos
  // Records the server-side file paths returned after upload.
  // ═══════════════════════════════════════════════════════════════════════════
  group('04_save_draft_photos', function () {
    postDraft({
      ...draftBase(),
      module:      'photos',
      image:       'ctm/stage/applications/2026-09-01/applicant_image/79b63d94-12cf-48e2-ad36-2f4948df618b.jpg',
      signature:   'ctm/stage/applications/2026-09-01/applicant_signature/fc8d40ce-d0c9-4cc1-bbfc-6cdb55e7a78c.jpg',
      house_image: 'ctm/stage/applications/2026-09-01/house_image/c864faab-f143-4891-b431-a05948a08bf6.jpg',
    }, 'save_draft_photos', 'Draft photos');
  });
  sleep(1);
  getCounts('counts_after_photos');
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 05 — Save draft: address
  // Present address and permanent address (same location in this recording).
  // ═══════════════════════════════════════════════════════════════════════════
  group('05_save_draft_address', function () {
    postDraft({
      ...draftBase(),
      module:                      'address',
      mobile:                      '01671816194',
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
    }, 'save_draft_address', 'Draft address');
  });
  sleep(1);
  getCounts('counts_after_address');
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 06 — Save draft: program
  // Submits allowance program field responses.
  // ═══════════════════════════════════════════════════════════════════════════
  group('06_save_draft_program', function () {
    const { res } = postDraft({
      ...draftBase(),
      module:                       'program',
      application_allowance_values: APPLICATION_ALLOWANCE_VALUES,
    }, 'save_draft_program', 'Draft program');
    syncHashes = mergeSyncHashes(syncHashes, res);
  });
  sleep(1);
  getCounts('counts_after_program');
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 07 — Save draft: bank account
  // ═══════════════════════════════════════════════════════════════════════════
  group('07_save_draft_bank', function () {
    postDraft({
      ...draftBase(),
      module:        'bank',
      account_type:  '1',
      account_owner: '142',
      bank_name:     '1',
      branch_name:   '7393',
    }, 'save_draft_bank', 'Draft bank');
  });
  sleep(1);
  getCounts('counts_after_bank');
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 08 — Save draft: nominee
  // Nominee gets its own unique name, date of birth, and verification number.
  // ═══════════════════════════════════════════════════════════════════════════
  group('08_save_draft_nominee', function () {
    const nomineeName = generateName();
    const nomineeVN   = generateVerificationNumber();
    const nomineeDob  = generateNomineeDateOfBirth();

    postDraft({
      ...draftBase(),
      module:                            'nominee',
      nominee_en:                        nomineeName.en,
      nominee_bn:                        nomineeName.bn,
      nominee_date_of_birth:             nomineeDob,
      nominee_verification_type:         '2',
      nominee_verification_number:       nomineeVN,
      nominee_relation_with_beneficiary: '159',
      nominee_address:                   'C,01,DARBARPUR,FULGAZI,FENI-1234, Chittagong',
    }, 'save_draft_nominee', 'Draft nominee');
  });
  sleep(1);
  getCounts('counts_after_nominee');
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 09 — Save draft: PMT (Poverty Proxy Means Test)
  // ═══════════════════════════════════════════════════════════════════════════
  group('09_save_draft_pmt', function () {
    const { res } = postDraft({
      ...draftBase(),
      module:             'pmt',
      house_size:         '1',
      no_of_room:         '503',
      no_of_people_score: '-0.778',
      per_room_score:     '-2.333',
      application_pmt:    APPLICATION_PMT,
    }, 'save_draft_pmt', 'Draft pmt');
    syncHashes = mergeSyncHashes(syncHashes, res);
  });
  sleep(1);
  getCounts('counts_after_pmt');
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 10 — Save draft: family members
  // Submits self as a single family member (the applicant themselves).
  // ═══════════════════════════════════════════════════════════════════════════
  group('10_save_draft_family', function () {
    const { res } = postDraft({
      ...draftBase(),
      module: 'family',
      family_members: JSON.stringify([{
        is_self:           true,
        _lockedFields:     ['name_bn','name_en','father_name_bn','mother_name_bn','gender_id','maritial_status_id','religion_id','dob','mobile_number','education_status_id','profession_id','verification_type','brn_id'],
        name_en:           applicant.en,
        name_bn:           applicant.bn,
        verification_type: 2,
        nid:               '',
        brn_id:            verificationNumber,
        dob:               dateOfBirth,
        relationship_id:   260,
        father_name_bn:    father.bn,
        mother_name_bn:    mother.bn,
        facilities_ids:    [],
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
      }]),
    }, 'save_draft_family', 'Draft family');
    syncHashes = mergeSyncHashes(syncHashes, res);
  });
  sleep(1);
  getCounts('counts_after_family');
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 11 — Save draft: cash usage
  // ═══════════════════════════════════════════════════════════════════════════
  group('11_save_draft_cash_usage', function () {
    const { res, ok } = postDraft({
      ...draftBase(),
      module:      'cash_usage',
      cash_usages: CASH_USAGES,
    }, 'save_draft_cash_usage', 'Draft cash_usage');
    familyCardFailure.add(ok ? 0 : 1);
    syncHashes = mergeSyncHashes(syncHashes, res);
  });
  sleep(1);
  getCounts('counts_after_cash_usage');
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 12 — Save draft: external user info
  // ═══════════════════════════════════════════════════════════════════════════
  group('12_save_draft_external', function () {
    const { res } = postDraft({
      ...draftBase(),
      module:             'external',
      external_user_info: JSON.stringify({
        user_name_en: applicant.en,
        user_mobile:  '01744682915',
        form_number:  '',
      }),
    }, 'save_draft_external', 'Draft external');
    syncHashes = mergeSyncHashes(syncHashes, res);
  });
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 13 — Save draft: module=all  (final submission payload)
  // Combines every module into one POST with is_declaration_consented=1.
  // This is the browser's "Submit Application" button click.
  // ═══════════════════════════════════════════════════════════════════════════
  group('13_save_draft_submit', function () {
    const nomineeName = generateName();
    const nomineeVN   = generateVerificationNumber();
    const nomineeDob  = generateNomineeDateOfBirth();

    const { res } = postDraft({
      ...draftBase(),
      module:                       'all',
      is_declaration_consented:     '1',
      nationality:                  '105',
      // Personal
      profession:                   '181',
      name_en:                      applicant.en,
      name_bn:                      applicant.bn,
      father_name_en:               father.en,
      father_name_bn:               father.bn,
      mother_name_en:               mother.en,
      mother_name_bn:               mother.bn,
      date_of_birth:                dateOfBirth,
      age:                          age,
      gender_id:                    '24',
      mobile:                       '01671816194',
      education_status:             '88',
      religion:                     '96',
      marital_status:               '101',
      // Present address
      division_id:                  '2',
      district_id:                  '21',
      thana_id:                     '197',
      union_id:                     '2171',
      ward_id_union:                '15627',
      address:                      'C',
      post_code:                    '1234',
      location_type:                '2',
      sub_location_type:            '2',
      // Permanent address
      permanent_division_id:        '2',
      permanent_district_id:        '21',
      permanent_thana_id:           '197',
      permanent_union_id:           '2171',
      permanent_ward_id_union:      '15627',
      permanent_address:            'C',
      permanent_post_code:          '1234',
      permanent_location_type:      '2',
      permanent_sub_location_type:  '2',
      // Photos
      image:       'ctm/stage/applications/2026-09-01/applicant_image/79b63d94-12cf-48e2-ad36-2f4948df618b.jpg',
      signature:   'ctm/stage/applications/2026-09-01/applicant_signature/fc8d40ce-d0c9-4cc1-bbfc-6cdb55e7a78c.jpg',
      house_image: 'ctm/stage/applications/2026-09-01/house_image/c864faab-f143-4891-b431-a05948a08bf6.jpg',
      // Bank
      account_type:                 '1',
      account_owner:                '142',
      bank_name:                    '1',
      branch_name:                  '7393',
      // PMT
      house_size:                   '1',
      no_of_room:                   '503',
      no_of_people_score:           '-0.778',
      per_room_score:               '-2.333',
      application_pmt:              APPLICATION_PMT,
      // Program
      application_allowance_values: APPLICATION_ALLOWANCE_VALUES,
      // Nominee (re-sent in the final all-modules payload, as captured in browser recording)
      nominee_en:                        nomineeName.en,
      nominee_bn:                        nomineeName.bn,
      nominee_date_of_birth:             nomineeDob,
      nominee_verification_type:         '2',
      nominee_verification_number:       nomineeVN,
      nominee_relation_with_beneficiary: '159',
      nominee_nationality:               '105',
      nominee_address:                   'C,01,DARBARPUR,FULGAZI,FENI-1234, Chittagong',
      // Family members
      family_members: JSON.stringify([{
        is_self:           true,
        _lockedFields:     ['name_bn','name_en','father_name_bn','mother_name_bn','gender_id','maritial_status_id','religion_id','dob','mobile_number','education_status_id','profession_id','verification_type','brn_id'],
        name_en:           applicant.en,
        name_bn:           applicant.bn,
        verification_type: 2,
        nid:               '',
        brn_id:            verificationNumber,
        dob:               dateOfBirth,
        relationship_id:   260,
        father_name_bn:    father.bn,
        mother_name_bn:    mother.bn,
        facilities_ids:    [],
        gender_id:                            24,
        maritial_status_id:                   101,
        religion_id:                          96,
        profession_id:                        181,
        mobile_number:                        '01671816194',
        literacy_id:                          241,
        education_status_id:                  88,
        health_condition_id:                  203,
        livelihood_profession_id:             212,
        disability_type_id:                   '',
        is_currently_student:                 0,
        is_ssnp_covered:                      0,
        is_dss_training_or_financial_benefit:  0,
        estimate_annual_income:               '55',
        is_gov_job_holder:                    0,
        is_member_disabled:                   0,
        menu:                                 false,
        verification_number:                  verificationNumber,
        relationship:                         null,
      }]),
      // Cash usage
      cash_usages:      CASH_USAGES,
      // External
      external_user_info: JSON.stringify({
        user_name_en: applicant.en,
        user_mobile:  '01744682915',
        form_number:  '',
      }),
    }, 'save_draft_submit', 'Draft submit (all)');
    syncHashes = mergeSyncHashes(syncHashes, res);
  });
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 14 — GET counts (pre-finalize)
  // ═══════════════════════════════════════════════════════════════════════════
  getCounts('counts_pre_finalize');
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 15 — POST finalize
  // Seals the application. Requires sync hashes collected across steps 06–13.
  // ═══════════════════════════════════════════════════════════════════════════
  group('15_finalize', function () {
    console.log(`[VU ${__VU}] Finalizing draftId=${draftId} | hashes: allowance=${syncHashes.allowance} cash=${syncHashes.cash_usage} pmt=${syncHashes.pmt} family=${syncHashes.family}`);

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/${draftId}/finalize?lang=bn`,
      {
        lang:                 'bn',
        allowance_sync_hash:  syncHashes.allowance  || '',
        cash_usage_sync_hash: syncHashes.cash_usage || '',
        pmt_sync_hash:        syncHashes.pmt        || '',
        family_sync_hash:     syncHashes.family     || '',
      },
      {
        headers: Object.assign({}, headers, { 'Application': 'application/json' }),
        timeout: '30s',
        tags:    { name: 'finalize' },
      }
    );

    finalizeDuration.add(res.timings.duration);

    const ok = check(res, {
      'Finalize: status 2xx':        r => r.status >= 200 && r.status < 300,
      'Finalize: response < 5000ms': r => r.timings.duration < 5000,
    });

    if (ok) {
      familyCardFailure.add(0);
      console.log(`[VU ${__VU}] Application ${draftId} submitted and finalized successfully`);
    } else {
      familyCardFailure.add(1);
      console.error(`[finalize FAIL] VU ${__VU} | draftId=${draftId} | HTTP ${res.status} | body=${res.body}`);
    }
  });
  sleep(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 16 — Final refresh
  // Refreshes counts and location data after submission (matches browser behaviour).
  // ═══════════════════════════════════════════════════════════════════════════
  group('16_final_refresh', function () {
    getCounts('final_counts');
    [
      `${BASE_URL}/api/v1/global/family-card-user/locations/district/get/2?lang=bn`,
      `${BASE_URL}/api/v1/global/family-card-user/locations/thana/get/21?lang=bn`,
      `${BASE_URL}/api/v1/global/family-card-user/locations/union/get/197?lang=bn`,
      `${BASE_URL}/api/v1/global/family-card-user/locations/ward/get/2171?lang=bn`,
      `${BASE_URL}/api/v1/global/thana/get/21?lang=bn`,
    ].forEach(url => http.get(url, { headers }));
  });
  sleep(1);
}

// ─── REPORT GENERATOR ─────────────────────────────────────────────────────────
/**
 * makeHandleSummary(testName)
 *
 * Returns a handleSummary function for a specific test type.
 * Call this in each test file:
 *   export const handleSummary = makeHandleSummary('load');
 *
 * Writes two files to reports/ (relative to where k6 is run):
 *   reports/family_card_<name>_<timestamp>.json  — raw summary data
 *   reports/family_card_<name>_<timestamp>.html  — styled HTML dashboard
 */
export function makeHandleSummary(testName) {
  return function (data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const basePath  = `reports/family_card_${testName}_${timestamp}`;

    console.log(`[summary] Reports → ${basePath}.json | ${basePath}.html`);

    return {
      [`${basePath}.json`]: JSON.stringify(data, null, 2),
      [`${basePath}.html`]: htmlReport(data, { title: `Family Card — ${testName.toUpperCase()} Test` }),
      stdout:               textSummary(data, { indent: ' ', enableColors: true }),
    };
  };
}
