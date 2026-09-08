import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'https://stage-api.bhata.gov.bd';
const PROGRAM_ID = '24';
const SUB_PROGRAM_ID = '24';
const DEFAULT_BEARER_TOKEN = '337484|HOksCwKj276SbhdUgehCjaE5NnFK3E1VU0a5E8ZJ434d4788';

// ─── CUSTOM METRICS ───────────────────────────────────────────────────────────

export const saveDraftDuration = new Trend('save_draft_duration', true);
export const finalizeDuration = new Trend('finalize_duration', true);
export const mediaUploadDuration = new Trend('media_upload_duration', true);
export const familyCardFailure = new Rate('family_card_failure_rate');

// ─── STATIC PAYLOADS ──────────────────────────────────────────────────────────

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

const FIRST_NAMES_EN = ['Rahim', 'Karim', 'Jamal', 'Hasan', 'Nabil', 'Faruk', 'Milon', 'Ratan', 'Sumon', 'Tariq', 'Monir', 'Habib'];
const LAST_NAMES_EN = ['Ahmed', 'Islam', 'Hossain', 'Khan', 'Miah', 'Sheikh', 'Sarker', 'Das', 'Paul', 'Biswas'];
const FIRST_NAMES_BN = ['রহিম', 'করিম', 'জামাল', 'হাসান', 'নাবিল', 'ফারুক', 'মিলন', 'রতন', 'সুমন', 'তারিক', 'মনির', 'হাবিব'];
const LAST_NAMES_BN = ['আহমেদ', 'ইসলাম', 'হোসেন', 'খান', 'মিয়া', 'শেখ', 'সরকার', 'দাস', 'পাল', 'বিশ্বাস'];

/**
 * Generate a random 17-digit verification number starting with '19'.
 */
function generateVerificationNumber() {
  let num = '19';
  for (let i = 0; i < 15; i++) {
    num += Math.floor(Math.random() * 10);
  }
  return num;
}

/**
 * Generate a random date of birth between 1950 and 2005 (YYYY-MM-DD).
 */
function generateDateOfBirth() {
  const year = 1950 + Math.floor(Math.random() * (2005 - 1950 + 1));
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Calculate age dynamically from date of birth (YYYY-MM-DD).
 */
function calculateAge(dob) {
  const [year, month, day] = dob.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();

  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }
  return age;
}

/**
 * Generate matching English and Bengali names.
 */
function generateName() {
  const firstIdx = Math.floor(Math.random() * FIRST_NAMES_EN.length);
  const lastIdx = Math.floor(Math.random() * LAST_NAMES_EN.length);
  return {
    en: `${FIRST_NAMES_EN[firstIdx]} ${LAST_NAMES_EN[lastIdx]}`,
    bn: `${FIRST_NAMES_BN[firstIdx]} ${LAST_NAMES_BN[lastIdx]}`,
  };
}

// ─── AUTHENTICATION & HEADERS ─────────────────────────────────────────────────

/**
 * Standard authentication headers for API requests.
 */
export function authHeaders(token) {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Authorization': `Bearer ${token}`,
    'X-App-Language': 'en',
    'Sec-GPC': '1',
  };
}

/**
 * k6 setup lifecycle function — resolves auth token from ENV or login endpoint.
 */
export function setup() {
  const envToken = __ENV.TOKEN || __ENV.BEARER_TOKEN;
  if (envToken) {
    console.log('[setup] Using BEARER TOKEN from environment variable.');
    return { token: envToken };
  }

  // Attempt login if credentials are provided
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

      if (res.status === 200 && res.body) {
        const body = JSON.parse(res.body);
        const token = body?.data?.token || body?.token || body?.access_token || null;
        if (token) {
          console.log('[setup] Authentication successful.');
          return { token };
        }
      }
      console.warn(`[setup] Login failed with status ${res.status}: ${res.body}`);
    } catch (err) {
      console.warn(`[setup] Login request error: ${err.message}`);
    }
  }

  // Fallback to recorded default token
  console.log('[setup] Using default recorded Bearer token.');
  return { token: DEFAULT_BEARER_TOKEN };
}

// ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * Extract draft ID and sync hashes from the save-draft response.
 */
function extractDraftData(res) {
  const defaultResult = {
    draftId: null,
    syncHashes: { allowance: '', cash_usage: '', pmt: '', family: '' },
  };

  if (!res || !res.body) {
    return defaultResult;
  }

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
  } catch (err) {
    return defaultResult;
  }
}

// ─── MAIN VU FLOW ─────────────────────────────────────────────────────────────

/**
 * Default iteration function executed by each VU.
 */
export function familyCardDefault({ token }) {
  if (!token) {
    console.error(`[VU ${__VU}] No token received — aborting iteration`);
    familyCardFailure.add(1);
    return;
  }

  const headers = authHeaders(token);

  // Dynamic values per VU iteration
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
  let isIterationOk = true;

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 1: POST save-draft (module=all)
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

      // Images
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
        _lockedFields: [
          'name_bn', 'name_en', 'father_name_bn', 'mother_name_bn',
          'gender_id', 'maritial_status_id', 'religion_id', 'dob',
          'mobile_number', 'education_status_id', 'profession_id',
          'verification_type', 'brn_id',
        ],
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
      isIterationOk = false;
      console.error(`[Save Draft Failed] VU ${__VU} HTTP ${res.status}: ${res.body}`);
    }
  });

  sleep(0.5);

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 2: GET counts (Pre-finalize count check)
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
  // STEP 3: POST finalize (Seals application with sync hashes)
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

      const res = http.post(
        `${BASE_URL}/api/v1/family-card/applications/${draftId}/finalize?lang=en`,
        finalizePayload,
        {
          headers,
          timeout: '30s',
          tags: { name: 'finalize_application' },
        }
      );

      finalizeDuration.add(res.timings.duration);

      const ok = check(res, {
        'Finalize status is 2xx': (r) => r.status >= 200 && r.status < 300,
      });

      if (!ok) {
        isIterationOk = false;
        console.error(`[Finalize Failed] VU ${__VU} Draft ${draftId} HTTP ${res.status}: ${res.body}`);
      }
    });

    sleep(0.5);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: GET counts (Post-finalize refresh)
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
    // STEP 5: GET applied applications list
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
    isIterationOk = false;
  }

  // Record failure metric for thresholds
  familyCardFailure.add(!isIterationOk);

  sleep(1);
}

// ─── REPORT GENERATOR ─────────────────────────────────────────────────────────

/**
 * Generates custom HTML, JSON, and stdout summaries for k6 test runs.
 */
export function makeHandleSummary(testName) {
  return function (data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const basePath = `reports/family_card_${testName}_${timestamp}`;

    console.log(`[summary] Reports → ${basePath}.json | ${basePath}.html`);

    return {
      [`${basePath}.json`]: JSON.stringify(data, null, 2),
      [`${basePath}.html`]: htmlReport(data, { title: `Family Card — ${testName.toUpperCase()} Test` }),
      stdout: textSummary(data, { indent: ' ', enableColors: true }),
    };
  };
}
