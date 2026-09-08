/**
 * submit.js
 *
 * Converted directly from SUBMIT.jmx (JMeter test plan).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SUMMARY OF JMETER CONVERSION:
 * ─────────────────────────────────────────────────────────────────────────────
 * JMeter Plan: SUBMIT.jmx
 * Host: https://stage-api.bhata.gov.bd
 *
 * Request Mapping:
 *   [1] OPTIONS /api/v1/family-card/applications/save-draft (CORS preflight - omitted in k6)
 *   [2] POST    /api/v1/family-card/applications/save-draft?lang=en (module=all, full multipart payload)
 *       -> Extracts draft_id and sync hashes (allowance, cash_usage, pmt, family)
 *   [3] OPTIONS /api/v1/family-card/applications/counts (CORS preflight - omitted)
 *   [4] OPTIONS /api/v1/family-card/applications/{draft_id}/finalize (CORS preflight - omitted)
 *   [5] GET     /api/v1/family-card/applications/counts?lang=en
 *   [6] POST    /api/v1/family-card/applications/{draft_id}/finalize?lang=en (submitting sync hashes)
 *   [7] OPTIONS /api/v1/family-card/applications/counts (CORS preflight - omitted)
 *   [8] GET     /api/v1/family-card/applications/counts?lang=en
 *   [9] OPTIONS /api/v1/family-card/applications/applied (CORS preflight - omitted)
 *  [10] GET     /api/v1/family-card/applications/applied?page=1&per_page=10&search=&lang=en
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RUN COMMANDS:
 *   k6 run submit.js
 *   k6 run --vus 5 --duration 1m submit.js
 *   k6 run -e ENVIRONMENT=staging -e TOKEN=your_token_here submit.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'https://stage-api.bhata.gov.bd';

const LOGIN_CREDENTIALS = {
  username: __ENV.USERNAME || 'enumghatail',
  password: __ENV.PASSWORD || 'Password#1',
};

const PROGRAM_ID = '24';
const SUB_PROGRAM_ID = '24';

// ─── K6 OPTIONS & THRESHOLDS ──────────────────────────────────────────────────

export const options = {
  scenarios: {
    submit_flow: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '1m', target: 1 },   // Ramp up
        // { duration: '1m',  target: 5 },   // Sustain
        // { duration: '20s', target: 0 },   // Ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<4000', 'p(99)<8000'],
    'http_req_failed': ['rate<0.05'], // Max 5% HTTP errors
    'submit_save_draft_duration': ['p(95)<3000'],
    'submit_finalize_duration': ['p(95)<3000'],
    'submission_success_rate': ['rate>0.95'], // Min 95% full workflow success
  },
};

// ─── CUSTOM METRICS ───────────────────────────────────────────────────────────

const saveDraftDuration = new Trend('submit_save_draft_duration', true);
const finalizeDuration = new Trend('submit_finalize_duration', true);
const fullFlowDuration = new Trend('submit_full_workflow_duration', true);
const submissionSuccessRate = new Rate('submission_success_rate');
const completedSubmissions = new Counter('completed_submissions_total');

// ─── PAYLOAD TEMPLATES (from SUBMIT.jmx) ───────────────────────────────────────

const APPLICATION_PMT = JSON.stringify([
  { variable_id: 576, sub_variables: 577 },
  { variable_id: 530, sub_variables: 531 },
  { variable_id: 571, sub_variables: 572 },
  { variable_id: 1, sub_variables: 442 },
  { variable_id: 7, sub_variables: 329 },
  { variable_id: 12, sub_variables: 440 },
  { variable_id: 14, sub_variables: 382 },
  { variable_id: 18, sub_variables: 409 },
  { variable_id: 36, sub_variables: 298 },
  { variable_id: 33, sub_variables: 291 },
  { variable_id: 536, sub_variables: [538] },
  { variable_id: 393, sub_variables: 396 },
  { variable_id: 30, sub_variables: 338 },
  { variable_id: 40, sub_variables: 400 },
  { variable_id: 548, sub_variables: 550 },
  { variable_id: 579, sub_variables: 590 },
  { variable_id: 41, sub_variables: 387 },
  { variable_id: 567, sub_variables: 568 },
  { variable_id: 25, sub_variables: 406 },
  { variable_id: 29, sub_variables: 276 },
  { variable_id: 22, sub_variables: 403 },
  { variable_id: 595, sub_variables: 599 },
  { variable_id: 47, sub_variables: [566] },
  { variable_id: 500, sub_variables: 503 },
]);

const APPLICATION_ALLOWANCE_VALUES = JSON.stringify([
  { allowance_program_additional_fields_id: 91, allowance_program_additional_field_values_id: 646, value: null },
  { allowance_program_additional_fields_id: 78, allowance_program_additional_field_values_id: 633, value: null },
  { allowance_program_additional_fields_id: 76, allowance_program_additional_field_values_id: null, value: '3' },
  { allowance_program_additional_fields_id: 75, allowance_program_additional_field_values_id: null, value: '4' },
  { allowance_program_additional_fields_id: 77, allowance_program_additional_field_values_id: null, value: '5' },
  { allowance_program_additional_fields_id: 93, allowance_program_additional_field_values_id: 641, value: null },
  { allowance_program_additional_fields_id: 85, allowance_program_additional_field_values_id: 637, value: null },
  { allowance_program_additional_fields_id: 96, allowance_program_additional_field_values_id: 651, value: null },
]);

const CASH_USAGES = JSON.stringify([
  { lookup_id: 267, amount: 199, other_detail: null },
  { lookup_id: 268, amount: 299, other_detail: null },
]);

// ─── DATA GENERATORS ──────────────────────────────────────────────────────────

function generateVerificationNumber() {
  let n = '19';
  for (let i = 0; i < 15; i++) {
    n += Math.floor(Math.random() * 10);
  }
  return n;
}

function generateDateOfBirth() {
  const year = 1950 + Math.floor(Math.random() * (2005 - 1950 + 1));
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function calculateAge(dob) {
  const [y, m, d] = dob.split('-').map(Number);
  let age = 2026 - y;
  if (m > 9 || (m === 9 && d > 1)) age -= 1;
  return age;
}

const FIRST_NAMES_EN = ['Rahim', 'Karim', 'Jamal', 'Hasan', 'Nabil', 'Faruk', 'Milon', 'Ratan', 'Sumon', 'Tariq', 'Monir', 'Habib'];
const LAST_NAMES_EN = ['Ahmed', 'Islam', 'Hossain', 'Khan', 'Miah', 'Sheikh', 'Sarker', 'Das', 'Paul', 'Biswas'];
const FIRST_NAMES_BN = ['রহিম', 'করিম', 'জামাল', 'হাসান', 'নাবিল', 'ফারুক', 'মিলন', 'রতন', 'সুমন', 'তারিক', 'মনির', 'হাবিব'];
const LAST_NAMES_BN = ['আহমেদ', 'ইসলাম', 'হোসেন', 'খান', 'মিয়া', 'শেখ', 'সরকার', 'দাস', 'পাল', 'বিশ্বাস'];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateName() {
  const idx1 = Math.floor(Math.random() * FIRST_NAMES_EN.length);
  const idx2 = Math.floor(Math.random() * LAST_NAMES_EN.length);
  return {
    en: `${FIRST_NAMES_EN[idx1]} ${LAST_NAMES_EN[idx2]}`,
    bn: `${FIRST_NAMES_BN[idx1]} ${LAST_NAMES_BN[idx2]}`,
  };
}

// ─── AUTHENTICATION / TOKEN SETUP ─────────────────────────────────────────────

export function setup() {
  const envToken = __ENV.TOKEN || __ENV.BEARER_TOKEN;
  if (envToken) {
    console.log('[setup] Using BEARER TOKEN from environment variable.');
    return { token: envToken };
  }

  // If specific username/password provided via env, attempt login
  if (__ENV.USERNAME && __ENV.PASSWORD) {
    const loginUrl = `${BASE_URL}/api/v1/family-card/login/dev`;
    console.log(`[setup] Authenticating ${__ENV.USERNAME} at ${loginUrl}...`);
    try {
      const res = http.post(
        loginUrl,
        JSON.stringify({ username: __ENV.USERNAME, password: __ENV.PASSWORD }),
        {
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'X-App-Language': 'en',
          },
          timeout: '15s',
          tags: { name: 'setup_auth' },
        }
      );

      const body = JSON.parse(res.body);
      const token = body?.data?.token || body?.token || body?.access_token || null;
      if (res.status === 200 && token) {
        console.log('[setup] Authentication successful.');
        return { token };
      }
    } catch (e) {
      console.warn(`[setup] Login failed: ${e.message}`);
    }
  }

  // Default token recorded from SUBMIT.jmx
  const recordedToken = '337484|HOksCwKj276SbhdUgehCjaE5NnFK3E1VU0a5E8ZJ434d4788';
  console.log('[setup] Using recorded Bearer token from SUBMIT.jmx.');
  return { token: recordedToken };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getHeaders(token) {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Authorization': `Bearer ${token}`,
    'X-App-Language': 'en',
    'Sec-GPC': '1',
  };
}

function extractDraftData(res) {
  try {
    const body = JSON.parse(res.body);
    const draftId = body?.draft_id || body?.data?.id || body?.data?.draft_id || body?.id || null;
    const sync = body?.sync_hashes || body?.data?.sync_hashes || body?.hashes || {};

    return {
      draftId,
      syncHashes: {
        allowance: sync.allowance || sync.allowance_sync_hash || '',
        cash_usage: sync.cash_usage || sync.cash_usage_sync_hash || '',
        pmt: sync.pmt || sync.pmt_sync_hash || '',
        family: sync.family || sync.family_sync_hash || '',
      },
    };
  } catch (e) {
    console.error(`[extractDraftData Error] ${e.message}`);
    return { draftId: null, syncHashes: { allowance: '', cash_usage: '', pmt: '', family: '' } };
  }
}

// ─── MAIN VU ITERATION ────────────────────────────────────────────────────────

export default function ({ token }) {
  const iterationStartTime = Date.now();
  const headers = getHeaders(token);

  // Dynamic values per VU execution
  const applicantVN = generateVerificationNumber();
  const applicantDob = generateDateOfBirth();
  const applicantAge = String(calculateAge(applicantDob));
  const applicantName = generateName();
  const fatherName = generateName();
  const motherName = generateName();

  const nomineeName = generateName();
  const nomineeVN = generateVerificationNumber();
  const nomineeDob = generateDateOfBirth();

  let draftId = null;
  let syncHashes = { allowance: '', cash_usage: '', pmt: '', family: '' };
  let isFlowSuccessful = true;

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 1: POST save-draft (module=all) [JMeter Request #2]
  // ───────────────────────────────────────────────────────────────────────────
  group('01_Submit_Save_Draft_All', function () {
    const payload = {
      lang: 'en',
      module: 'all',
      program_id: PROGRAM_ID,
      sub_program_id: SUB_PROGRAM_ID,
      verification_number: applicantVN,
      verification_type: '2',
      is_declaration_consented: '1',
      nationality: '105',

      // Personal Information
      name_en: applicantName.en,
      name_bn: applicantName.bn,
      father_name_en: fatherName.en,
      father_name_bn: fatherName.bn,
      mother_name_en: motherName.en,
      mother_name_bn: motherName.bn,
      date_of_birth: applicantDob,
      age: applicantAge,
      gender_id: '24',
      mobile: '01671816194',
      education_status: '88',
      religion: '96',
      marital_status: '101',
      profession: '181',

      // Present Address
      division_id: '2',
      district_id: '21',
      thana_id: '197',
      union_id: '2171',
      ward_id_union: '15627',
      address: 'C',
      post_code: '1234',
      location_type: '2',
      sub_location_type: '2',

      // Permanent Address
      permanent_division_id: '2',
      permanent_district_id: '21',
      permanent_thana_id: '197',
      permanent_union_id: '2171',
      permanent_ward_id_union: '15627',
      permanent_address: 'C',
      permanent_post_code: '1234',
      permanent_location_type: '2',
      permanent_sub_location_type: '2',

      // Images (Referenced IDs from JMX)
      image: 'ctm/stage/applications/2026-09-01/applicant_image/79b63d94-12cf-48e2-ad36-2f4948df618b.jpg',
      signature: 'ctm/stage/applications/2026-09-01/applicant_signature/fc8d40ce-d0c9-4cc1-bbfc-6cdb55e7a78c.jpg',
      house_image: 'ctm/stage/applications/2026-09-01/house_image/c864faab-f143-4891-b431-a05948a08bf6.jpg',

      // Banking
      account_type: '1',
      account_owner: '142',
      bank_name: '1',
      branch_name: '7393',

      // PMT & Scores
      house_size: '1',
      no_of_room: '503',
      no_of_people_score: '-0.778',
      per_room_score: '-2.333',
      application_pmt: APPLICATION_PMT,
      application_allowance_values: APPLICATION_ALLOWANCE_VALUES,

      // Nominee
      nominee_en: nomineeName.en,
      nominee_bn: nomineeName.bn,
      nominee_date_of_birth: nomineeDob,
      nominee_verification_type: '2',
      nominee_verification_number: nomineeVN,
      nominee_relation_with_beneficiary: '159',
      nominee_nationality: '105',
      nominee_address: 'C,01,DARBARPUR,FULGAZI,FENI-1234, Chittagong',

      // Family Members
      family_members: JSON.stringify([{
        is_self: true,
        _lockedFields: ['name_bn', 'name_en', 'father_name_bn', 'mother_name_bn', 'gender_id', 'maritial_status_id', 'religion_id', 'dob', 'mobile_number', 'education_status_id', 'profession_id', 'verification_type', 'brn_id'],
        name_en: applicantName.en,
        name_bn: applicantName.bn,
        verification_type: 2,
        nid: '',
        brn_id: applicantVN,
        dob: applicantDob,
        relationship_id: 260,
        father_name_bn: fatherName.bn,
        mother_name_bn: motherName.bn,
        facilities_ids: [],
        gender_id: 24,
        maritial_status_id: 101,
        religion_id: 96,
        profession_id: 181,
        mobile_number: '01671816194',
        literacy_id: 241,
        education_status_id: 88,
        health_condition_id: 203,
        livelihood_profession_id: 212,
        disability_type_id: '',
        is_currently_student: 0,
        is_ssnp_covered: 0,
        is_dss_training_or_financial_benefit: 0,
        estimate_annual_income: '55',
        is_gov_job_holder: 0,
        is_member_disabled: 0,
        menu: false,
        verification_number: applicantVN,
        relationship: null,
      }]),

      cash_usages: CASH_USAGES,

      external_user_info: JSON.stringify({
        user_name_en: applicantName.en,
        user_mobile: '01744682915',
        form_number: '',
      }),
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=en`,
      payload,
      {
        headers,
        timeout: '30s',
        tags: { name: 'save_draft_all' },
      }
    );

    saveDraftDuration.add(res.timings.duration);

    const ok = check(res, {
      'Save Draft status is 2xx': (r) => r.status >= 200 && r.status < 300,
    });

    if (ok) {
      const extracted = extractDraftData(res);
      draftId = extracted.draftId;
      syncHashes = extracted.syncHashes;
    } else {
      isFlowSuccessful = false;
      console.error(`[Save Draft Failed] VU ${__VU} HTTP ${res.status}: ${res.body}`);
    }
  });

  sleep(0.5);

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 2: GET counts (Pre-finalize count refresh) [JMeter Request #5]
  // ───────────────────────────────────────────────────────────────────────────
  group('02_Get_Counts_Pre_Finalize', function () {
    const res = http.get(
      `${BASE_URL}/api/v1/family-card/applications/counts?lang=en`,
      {
        headers,
        tags: { name: 'get_counts_pre' },
      }
    );

    check(res, {
      'Counts Pre-Finalize status is 200': (r) => r.status === 200,
    });
  });

  sleep(0.5);

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 3: POST finalize (Submitting sync hashes) [JMeter Request #6]
  // ───────────────────────────────────────────────────────────────────────────
  if (draftId) {
    group('03_Submit_Finalize', function () {
      const finalizePayload = {
        lang: 'en',
        allowance_sync_hash: syncHashes.allowance,
        cash_usage_sync_hash: syncHashes.cash_usage,
        pmt_sync_hash: syncHashes.pmt,
        family_sync_hash: syncHashes.family,
      };

      const finalizeHeaders = Object.assign({}, headers, {
        'Application': 'application/json',
      });

      const res = http.post(
        `${BASE_URL}/api/v1/family-card/applications/${draftId}/finalize?lang=en`,
        finalizePayload,
        {
          headers: finalizeHeaders,
          timeout: '30s',
          tags: { name: 'finalize_application' },
        }
      );

      finalizeDuration.add(res.timings.duration);

      const ok = check(res, {
        'Finalize status is 2xx': (r) => r.status >= 200 && r.status < 300,
      });

      if (!ok) {
        isFlowSuccessful = false;
        console.error(`[Finalize Failed] VU ${__VU} Draft ${draftId} HTTP ${res.status}: ${res.body}`);
      }
    });

    sleep(0.5);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: GET counts (Post-finalize refresh) [JMeter Request #8]
    // ─────────────────────────────────────────────────────────────────────────
    group('04_Get_Counts_Post_Finalize', function () {
      const res = http.get(
        `${BASE_URL}/api/v1/family-card/applications/counts?lang=en`,
        {
          headers,
          tags: { name: 'get_counts_post' },
        }
      );

      check(res, {
        'Counts Post-Finalize status is 200': (r) => r.status === 200,
      });
    });

    sleep(0.5);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: GET applied applications list [JMeter Request #10]
    // ─────────────────────────────────────────────────────────────────────────
    group('05_Get_Applied_List', function () {
      const res = http.get(
        `${BASE_URL}/api/v1/family-card/applications/applied?page=1&per_page=10&search=&lang=en`,
        {
          headers,
          tags: { name: 'get_applied_list' },
        }
      );

      check(res, {
        'Applied list status is 200': (r) => r.status === 200,
      });
    });
  } else {
    isFlowSuccessful = false;
  }

  // ── Flow outcome recording ──
  const iterationDuration = Date.now() - iterationStartTime;
  fullFlowDuration.add(iterationDuration);
  submissionSuccessRate.add(isFlowSuccessful);

  if (isFlowSuccessful) {
    completedSubmissions.add(1);
  }

  sleep(1);
}
