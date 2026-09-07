/**
 * family_card_submit.js
 *
 * Converted from FC/SUBMIT.jmx (BlazeMeter browser recording).
 *
 * This is a FOCUSED submit script — it skips the per-module draft steps and
 * sends only the two requests the browser makes at the very end of the flow:
 *
 *   1. POST  /api/v1/family-card/applications/save-draft  (module=all)
 *   2. GET   /api/v1/family-card/applications/counts
 *   3. POST  /api/v1/family-card/applications/{draft_id}/finalize
 *   4. GET   /api/v1/family-card/applications/counts
 *
 * The JMX also contained OPTIONS preflight requests — those are browser CORS
 * artifacts and are intentionally omitted here (k6 sends real HTTP, not CORS).
 *
 * Use this script when you want to load-test the submit + finalize endpoints
 * in isolation, without replaying the full 16-step draft workflow.
 * For the full end-to-end flow use family_card_load / soak / stress / spike.
 *
 * Usage:
 *   k6 run family_card_submit.js
 *   k6 run --vus 10 --duration 5m family_card_submit.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// ─── INIT ─────────────────────────────────────────────────────────────────────

export const TEST_IMAGE = open('./test.jpg', 'b');

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const BASE_URL = 'https://stage-api.bhata.gov.bd';

const LOGIN_CREDENTIALS = {
  username: 'enumghatail',
  password: 'Password#1',
};

const PROGRAM_ID     = '24';
const SUB_PROGRAM_ID = '24';

// ─── OPTIONS ──────────────────────────────────────────────────────────────────
// Smoke / baseline defaults — override via CLI flags or env vars.

export const options = {
  vus:      1,
  duration: '1m',

  thresholds: {
    http_req_failed:          ['rate<0.05'],
    http_req_duration:        ['p(95)<5000'],
    save_draft_all_duration:  ['p(95)<5000'],
    finalize_duration:        ['p(95)<5000'],
  },
};

// ─── METRICS ──────────────────────────────────────────────────────────────────

const saveDraftAllDuration = new Trend('save_draft_all_duration', true);
const finalizeDuration     = new Trend('finalize_duration',       true);
const submitFailureRate    = new Rate('submit_failure_rate');

// ─── STATIC PAYLOADS ──────────────────────────────────────────────────────────

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

function generateVerificationNumber() {
  let n = '19';
  for (let i = 0; i < 15; i++) n += Math.floor(Math.random() * 10);
  return n;
}

function generateDateOfBirth() {
  const year  = 1950 + Math.floor(Math.random() * (2006 - 1950 + 1));
  const month = 1    + Math.floor(Math.random() * 12);
  const day   = 1    + Math.floor(Math.random() * 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function generateNomineeDateOfBirth() {
  const year  = 1950 + Math.floor(Math.random() * (2008 - 1950 + 1));
  const month = 1    + Math.floor(Math.random() * 12);
  const day   = 1    + Math.floor(Math.random() * 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function calculateAge(dob) {
  const [y, m, d] = dob.split('-').map(Number);
  let age = 2026 - y;
  if (m > 9 || (m === 9 && d > 1)) age -= 1;
  return age;
}

const FIRST_NAMES_EN = ['Rahim','Karim','Jamal','Hasan','Nabil','Faruk','Milon','Ratan','Sumon','Tariq','Belal','Imran','Shakil','Liton','Sajib','Arif','Rubel','Mamun','Jewel','Tuhin','Salim','Badal','Rasel','Bipul','Zahir','Nasir','Habib','Monir','Polash','Dipu'];
const LAST_NAMES_EN  = ['Ahmed','Islam','Hossain','Khan','Miah','Sheikh','Sarker','Mondol','Chowdhury','Bhuiyan','Alam','Rahman','Uddin','Ali','Akter','Begum','Khatun','Biswas','Das','Paul'];
const FIRST_NAMES_BN = ['রহিম','করিম','জামাল','হাসান','নাবিল','ফারুক','মিলন','রতন','সুমন','তারিক','বেলাল','ইমরান','শাকিল','লিটন','সাজিব','আরিফ','রুবেল','মামুন','জুয়েল','তুহিন','সালিম','বাদল','রাসেল','বিপুল','জাহির','নাসির','হাবিব','মনির','পলাশ','দিপু'];
const LAST_NAMES_BN  = ['আহমেদ','ইসলাম','হোসেন','খান','মিয়া','শেখ','সরকার','মন্ডল','চৌধুরী','ভূইয়া','আলম','রহমান','উদ্দিন','আলী','আক্তার','বেগম','খাতুন','বিশ্বাস','দাস','পাল'];

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateName() {
  return {
    en: `${pickRandom(FIRST_NAMES_EN)} ${pickRandom(LAST_NAMES_EN)}`,
    bn: `${pickRandom(FIRST_NAMES_BN)} ${pickRandom(LAST_NAMES_BN)}`,
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function authHeaders(token) {
  return {
    'Accept':         'application/json, text/plain, */*',
    'X-App-Language': 'en',
    'Authorization':  `Bearer ${token}`,
  };
}

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

// ─── SETUP ────────────────────────────────────────────────────────────────────

export function setup() {
  const res = http.post(
    `${BASE_URL}/api/v1/family-card/login/dev`,
    JSON.stringify(LOGIN_CREDENTIALS),
    {
      headers: {
        'Accept':         'application/json, text/plain, */*',
        'Content-Type':   'application/json',
        'X-App-Language': 'en',
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

// ─── DEFAULT (VU iteration) ───────────────────────────────────────────────────
/**
 * Mirrors the exact request sequence from SUBMIT.jmx:
 *
 *  JMX request #2 (POST save-draft module=all)  → group 'submit_save_draft_all'
 *  JMX request #5 (GET  counts)                 → group 'submit_counts_pre_finalize'
 *  JMX request #6 (POST finalize)               → group 'submit_finalize'
 *  JMX request #8 (GET  counts)                 → group 'submit_counts_post_finalize'
 *
 * JMX requests #1, #3, #4, #7 were OPTIONS CORS preflights — skipped.
 */
export default function ({ token }) {
  if (!token) {
    console.error(`[VU ${__VU}] No token — aborting iteration`);
    submitFailureRate.add(1);
    return;
  }

  // ── Per-iteration unique data ────────────────────────────────────────────
  const verificationNumber = generateVerificationNumber();
  const dateOfBirth        = generateDateOfBirth();
  const age                = String(calculateAge(dateOfBirth));
  const applicant          = generateName();
  const father             = generateName();
  const mother             = generateName();
  const nomineeName        = generateName();
  const nomineeVN          = generateVerificationNumber();
  const nomineeDob         = generateNomineeDateOfBirth();

  const headers = authHeaders(token);

  let draftId    = null;
  let syncHashes = { allowance: null, cash_usage: null, pmt: null, family: null };

  // ══════════════════════════════════════════════════════════════════════════
  // JMX REQUEST #2 — POST save-draft (module=all)
  // The browser's "Submit Application" button — sends every field in one shot.
  // ══════════════════════════════════════════════════════════════════════════
  group('submit_save_draft_all', function () {
    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=en`,
      {
        // ── Core identifiers ────────────────────────────────────────────
        lang:                         'en',
        module:                       'all',
        program_id:                   PROGRAM_ID,
        sub_program_id:               SUB_PROGRAM_ID,
        verification_number:          verificationNumber,
        verification_type:            '2',
        is_declaration_consented:     '1',
        nationality:                  '105',

        // ── Personal info ────────────────────────────────────────────────
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
        profession:                   '181',

        // ── Present address ──────────────────────────────────────────────
        division_id:                  '2',
        district_id:                  '21',
        thana_id:                     '197',
        union_id:                     '2171',
        ward_id_union:                '15627',
        address:                      'C',
        post_code:                    '1234',
        location_type:                '2',
        sub_location_type:            '2',

        // ── Permanent address (same location as present) ─────────────────
        permanent_division_id:        '2',
        permanent_district_id:        '21',
        permanent_thana_id:           '197',
        permanent_union_id:           '2171',
        permanent_ward_id_union:      '15627',
        permanent_address:            'C',
        permanent_post_code:          '1234',
        permanent_location_type:      '2',
        permanent_sub_location_type:  '2',

        // ── Photos (server-side paths from prior media upload) ───────────
        image:        'ctm/stage/applications/2026-09-01/applicant_image/79b63d94-12cf-48e2-ad36-2f4948df618b.jpg',
        signature:    'ctm/stage/applications/2026-09-01/applicant_signature/fc8d40ce-d0c9-4cc1-bbfc-6cdb55e7a78c.jpg',
        house_image:  'ctm/stage/applications/2026-09-01/house_image/c864faab-f143-4891-b431-a05948a08bf6.jpg',

        // ── Bank account ─────────────────────────────────────────────────
        account_type:                 '1',
        account_owner:                '142',
        bank_name:                    '1',
        branch_name:                  '7393',

        // ── PMT (poverty proxy means test) ───────────────────────────────
        house_size:                   '1',
        no_of_room:                   '503',
        no_of_people_score:           '-0.778',
        per_room_score:               '-2.333',
        application_pmt:              APPLICATION_PMT,

        // ── Allowance program fields ─────────────────────────────────────
        application_allowance_values: APPLICATION_ALLOWANCE_VALUES,

        // ── Nominee ──────────────────────────────────────────────────────
        nominee_en:                        nomineeName.en,
        nominee_bn:                        nomineeName.bn,
        nominee_date_of_birth:             nomineeDob,
        nominee_verification_type:         '2',
        nominee_verification_number:       nomineeVN,
        nominee_relation_with_beneficiary: '159',
        nominee_nationality:               '105',
        nominee_address:                   'C,01,DARBARPUR,FULGAZI,FENI-1234, Chittagong',

        // ── Family members ───────────────────────────────────────────────
        family_members: JSON.stringify([{
          is_self:                              true,
          _lockedFields:                        ['name_bn','name_en','father_name_bn','mother_name_bn','gender_id','maritial_status_id','religion_id','dob','mobile_number','education_status_id','profession_id','verification_type','brn_id'],
          name_en:                              applicant.en,
          name_bn:                              applicant.bn,
          verification_type:                    2,
          nid:                                  '',
          brn_id:                               verificationNumber,
          dob:                                  dateOfBirth,
          relationship_id:                      260,
          father_name_bn:                       father.bn,
          mother_name_bn:                       mother.bn,
          facilities_ids:                       [],
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
          is_dss_training_or_financial_benefit: 0,
          estimate_annual_income:               '55',
          is_gov_job_holder:                    0,
          is_member_disabled:                   0,
          menu:                                 false,
          verification_number:                  verificationNumber,
          relationship:                         null,
        }]),

        // ── Cash usage ───────────────────────────────────────────────────
        cash_usages: CASH_USAGES,

        // ── External user info ───────────────────────────────────────────
        external_user_info: JSON.stringify({
          user_name_en: applicant.en,
          user_mobile:  '01744682915',
          form_number:  '',
        }),
      },
      {
        headers,
        timeout: '30s',
        tags: { name: 'submit_save_draft_all' },
      }
    );

    saveDraftAllDuration.add(res.timings.duration);

    const ok = check(res, {
      'save-draft all: status 2xx':        r => r.status >= 200 && r.status < 300,
      'save-draft all: response < 5000ms': r => r.timings.duration < 5000,
    });

    if (ok) {
      draftId    = extractDraftId(res);
      syncHashes = extractSyncHashes(res);
      if (!draftId) {
        console.warn(`[VU ${__VU}] save-draft all OK but no draftId in response: ${res.body.substring(0, 200)}`);
      } else {
        console.log(`[VU ${__VU}] save-draft all success — draftId=${draftId}`);
      }
    } else {
      submitFailureRate.add(1);
      console.error(`[save-draft all FAIL] VU ${__VU} | HTTP ${res.status} | body=${res.body}`);
    }
  });
  sleep(1);

  // ══════════════════════════════════════════════════════════════════════════
  // JMX REQUEST #5 — GET counts (pre-finalize check)
  // ══════════════════════════════════════════════════════════════════════════
  group('submit_counts_pre_finalize', function () {
    const res = http.get(
      `${BASE_URL}/api/v1/family-card/applications/counts?lang=en`,
      { headers, tags: { name: 'submit_counts_pre_finalize' } }
    );
    check(res, { 'counts pre-finalize: status 200': r => r.status === 200 });
  });
  sleep(1);

  // Finalize requires a valid draftId
  if (!draftId) {
    console.error(`[VU ${__VU}] No draftId after save-draft all — skipping finalize`);
    submitFailureRate.add(1);
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // JMX REQUEST #6 — POST finalize
  // Seals the application. Sync hashes come from the save-draft all response.
  // ══════════════════════════════════════════════════════════════════════════
  group('submit_finalize', function () {
    console.log(`[VU ${__VU}] Finalizing draftId=${draftId} | hashes: allowance=${syncHashes.allowance} cash=${syncHashes.cash_usage} pmt=${syncHashes.pmt} family=${syncHashes.family}`);

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/${draftId}/finalize?lang=en`,
      {
        lang:                 'en',
        allowance_sync_hash:  syncHashes.allowance  || '',
        cash_usage_sync_hash: syncHashes.cash_usage || '',
        pmt_sync_hash:        syncHashes.pmt        || '',
        family_sync_hash:     syncHashes.family     || '',
      },
      {
        headers: Object.assign({}, headers, { 'Application': 'application/json' }),
        timeout: '30s',
        tags: { name: 'submit_finalize' },
      }
    );

    finalizeDuration.add(res.timings.duration);

    const ok = check(res, {
      'finalize: status 2xx':        r => r.status >= 200 && r.status < 300,
      'finalize: response < 5000ms': r => r.timings.duration < 5000,
    });

    if (ok) {
      console.log(`[VU ${__VU}] Application ${draftId} finalized successfully`);
      submitFailureRate.add(0);
    } else {
      submitFailureRate.add(1);
      console.error(`[finalize FAIL] VU ${__VU} | draftId=${draftId} | HTTP ${res.status} | body=${res.body}`);
    }
  });
  sleep(1);

  // ══════════════════════════════════════════════════════════════════════════
  // JMX REQUEST #8 — GET counts (post-finalize refresh)
  // ══════════════════════════════════════════════════════════════════════════
  group('submit_counts_post_finalize', function () {
    const res = http.get(
      `${BASE_URL}/api/v1/family-card/applications/counts?lang=en`,
      { headers, tags: { name: 'submit_counts_post_finalize' } }
    );
    check(res, { 'counts post-finalize: status 200': r => r.status === 200 });
  });
  sleep(1);
}

// ─── REPORT ───────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const basePath  = `reports/family_card_submit_${timestamp}`;

  console.log(`[summary] Reports → ${basePath}.json | ${basePath}.html`);

  return {
    [`${basePath}.json`]: JSON.stringify(data, null, 2),
    [`${basePath}.html`]: htmlReport(data, { title: 'Family Card — SUBMIT Test' }),
    stdout:               textSummary(data, { indent: ' ', enableColors: true }),
  };
}
