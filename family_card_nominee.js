// ─── FAMILY CARD — NOMINEE TEST ───────────────────────────────────────────────
// Converted from Nominee.jmx
// Flow (OPTIONS preflights skipped — k6 does not need them):
//   Step 01 — POST save-draft  module=nominee  (with full nominee fields)
//   Step 02 — GET  applications/counts
//
// Login runs once in setup(); token shared across all VUs.
// Run: k6 run family_card_nominee.js

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const BASE_URL = 'https://stage-api.bhata.gov.bd';

// ─── TEST OPTIONS ─────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: '1m',  target: 1 },
    { duration: '1m',  target: 1 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration':        ['p(95)<3000', 'p(99)<5000'],
    'http_req_failed':          ['rate<0.05'],
    'nominee_failure_rate':     ['rate<0.05'],
    'nominee_draft_duration':   ['p(95)<3000'],
  },
};

// ─── CUSTOM METRICS ───────────────────────────────────────────────────────────

const nomineeDraftDuration = new Trend('nominee_draft_duration', true);
const nomineeFailureRate   = new Rate('nominee_failure_rate');

// ─── DATA GENERATORS ─────────────────────────────────────────────────────────

// Unique 17-digit verification number starting with '19'
function generateVerificationNumber() {
  let n = '19';
  for (let i = 0; i < 15; i++) n += Math.floor(Math.random() * 10);
  return n;
}

// Random date of birth — nominee must be at least 18 years old (born ≤ 2008)
function generateNomineeDateOfBirth() {
  const year  = 1950 + Math.floor(Math.random() * (2008 - 1950 + 1));
  const month = 1 + Math.floor(Math.random() * 12);
  const day   = 1 + Math.floor(Math.random() * 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const FIRST_EN = ['Rahim','Karim','Jamal','Hasan','Nabil','Faruk','Milon','Ratan','Sumon','Tariq','Belal','Imran','Shakil','Liton','Sajib','Arif','Rubel','Mamun','Jewel','Tuhin'];
const LAST_EN  = ['Ahmed','Islam','Hossain','Khan','Miah','Sheikh','Sarker','Mondol','Chowdhury','Bhuiyan','Alam','Rahman','Uddin','Ali','Akter'];
const FIRST_BN = ['রহিম','করিম','জামাল','হাসান','নাবিল','ফারুক','মিলন','রতন','সুমন','তারিক','বেলাল','ইমরান','শাকিল','লিটন','সাজিব','আরিফ','রুবেল','মামুন','জুয়েল','তুহিন'];
const LAST_BN  = ['আহমেদ','ইসলাম','হোসেন','খান','মিয়া','শেখ','সরকার','মন্ডল','চৌধুরী','ভূইয়া','আলম','রহমান','উদ্দিন','আলী','আক্তার'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function fakeName() {
  return { en: `${pick(FIRST_EN)} ${pick(LAST_EN)}`, bn: `${pick(FIRST_BN)} ${pick(LAST_BN)}` };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function extractToken(res) {
  try {
    const b = JSON.parse(res.body);
    return b?.data?.token || b?.token || b?.access_token || null;
  } catch { return null; }
}

function authHeaders(token) {
  return {
    'Accept':         'application/json, text/plain, */*',
    'X-App-Language': 'bn',
    'Authorization':  `Bearer ${token}`,
  };
}

// ─── SETUP — login runs once ──────────────────────────────────────────────────

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

  if (!token) throw new Error(`Setup login failed — HTTP ${res.status}: ${res.body}`);

  console.log('[setup] Login OK. Token obtained.');
  return { token };
}

// ─── MAIN FLOW ────────────────────────────────────────────────────────────────

export default function ({ token }) {

  if (!token) {
    console.error(`[VU ${__VU}] No token — aborting`);
    return;
  }

  // Per-iteration unique data
  const verificationNumber          = generateVerificationNumber(); // applicant's VN
  const nomineeVerificationNumber   = generateVerificationNumber(); // nominee's own VN
  const nomineeName                 = fakeName();
  const nomineeDateOfBirth          = generateNomineeDateOfBirth();

  // NOTE: draft_id must already exist (created by save-draft personal in a prior step).
  // For a standalone nominee test, either:
  //   a) Set a known draft_id here (replace '4098557' with a real one), OR
  //   b) Chain this after a personal save-draft to get a live draft_id.
  // The value below matches the JMX recording.
  const draftId = '4098557';

  const h = authHeaders(token);

  // ── Step 01: save-draft — module: nominee ─────────────────────────────────

  group('01_save_draft_nominee', function () {
    const form = {
      lang:                           'bn',
      module:                         'nominee',
      program_id:                     '24',
      sub_program_id:                 '24',
      verification_number:            verificationNumber,
      verification_type:              '2',
      draft_id:                       draftId,
      // ── Nominee fields (from Nominee.jmx) ───────────────────────────────
      nominee_en:                     nomineeName.en,
      nominee_bn:                     nomineeName.bn,
      nominee_date_of_birth:          nomineeDateOfBirth,
      nominee_verification_type:      '2',
      nominee_verification_number:    nomineeVerificationNumber,
      nominee_relation_with_beneficiary: '159',
      nominee_address:                'C,01,DARBARPUR,FULGAZI,FENI-1234, Chittagong',
    };

    const res = http.post(
      `${BASE_URL}/api/v1/family-card/applications/save-draft?lang=bn`,
      form,
      {
        headers: h,
        timeout: '20s',
        tags: { name: 'save_draft_nominee' },
      }
    );

    nomineeDraftDuration.add(res.timings.duration);

    const ok = check(res, {
      'Draft nominee: status 2xx':        r => r.status >= 200 && r.status < 300,
      'Draft nominee: response < 3000ms': r => r.timings.duration < 3000,
    });

    if (ok) {
      nomineeFailureRate.add(0);
      console.log(`[VU ${__VU}] Nominee draft OK | draftId=${draftId} | nomineeVN=${nomineeVerificationNumber}`);
    } else {
      nomineeFailureRate.add(1);
      console.error(`[nominee FAIL] VU ${__VU} | HTTP ${res.status} | body=${res.body}`);
    }
  });

  sleep(1);

  // ── Step 02: GET counts ───────────────────────────────────────────────────

  group('02_counts_after_nominee', function () {
    check(
      http.get(`${BASE_URL}/api/v1/family-card/applications/counts?lang=bn`, {
        headers: h,
        tags: { name: 'counts_after_nominee' },
      }),
      { 'Counts after nominee: status 200': r => r.status === 200 }
    );
  });

  sleep(1);
}
