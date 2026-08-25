import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const BASE_URL = 'https://stage-api.bhata.gov.bd';

// Test account used for the initial iteration of each Virtual User (VU)
const PRIMARY_USER = {
  username: 'ibcs-qa-super',
  password: 'Password#4'
};

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 VUs
    { duration: '1m', target: 10 },   // Hold at 10 VUs
    { duration: '30s', target: 50 },   // Ramp up to 50 VUs
    { duration: '2m', target: 50 },   // Hold at 50 VUs
    { duration: '30s', target: 100 },  // Spike to 100 VUs
    { duration: '1m', target: 100 },  // Hold at 100 VUs
    { duration: '30s', target: 0 },    // Ramp down to 0 VUs
  ],
  thresholds: {
    // 95% of requests must complete under 800ms, 99% under 1500ms
    'http_req_duration': ['p(95)<800', 'p(99)<1500'],
    // Overall request failure rate must be below 2%
    'http_req_failed': ['rate<0.02'],
    // Custom metrics thresholds
    'login_failure_rate': ['rate<0.02'],
    'login_duration': ['p(95)<800'],
  },
};

// ─── CUSTOM METRICS ──────────────────────────────────────────────────────────

const loginDuration = new Trend('login_duration', true);
const loginFailureRate = new Rate('login_failure_rate');

function hasAuthToken(res) {
  try {
    const data = JSON.parse(res.body);
    return !!(data && data.token);
  } catch {
    return false;
  }
}

function generateDynamicCredentials(vuId) {
  // Pad elements to guarantee consistent length in output
  const timestampSeed = String(Date.now() % 10000000).padStart(7, '0');
  const vuSuffix = String(vuId % 100).padStart(2, '0');
  const randomSeed = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

  const username = `user_${timestampSeed}${vuSuffix}${randomSeed}`;

  // Generate a random numeric string for the password
  const passRandom = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  const password = `Pass_${passRandom}@K6`;

  return { username, password };
}

// ─── MAIN FLOW ────────────────────────────────────────────────────────────────

export default function () {
  // Use the global k6 __VU and __ITER context variables.
  // The first iteration of each VU runs with the primary QA credentials to test the real account.
  // Subsequent iterations generate unique, random credentials to simulate register-and-login behaviors.
  const isFirstIteration = (__ITER === 0);
  const credentials = isFirstIteration ? PRIMARY_USER : generateDynamicCredentials(__VU);

  // ── Step 1: GET request to verify the API is reachable before attempting login ──
  const getParams = {
    headers: { 'Accept': 'application/json' },
    timeout: '10s',
    tags: { name: 'api_health_check' },
  };

  const getRes = http.get(`${BASE_URL}`, getParams);

  check(getRes, {
    'GET: HTTP status is 200': r => r.status === 200,
    'GET: Response time is under 1000ms': r => r.timings.duration < 1000,
  });

  sleep(0.5);

  // ── Step 2: POST login request ─────────────────────────────────────────────
  const payload = JSON.stringify({
    username: credentials.username,
    password: credentials.password,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
    tags: {
      name: 'login',
      type: isFirstIteration ? 'primary' : 'generated'
    },
  };

  // Perform POST request to the development login endpoint
  const res = http.post(`${BASE_URL}/api/v1/admin/login/dev`, payload, params);

  // Record duration of the login action
  loginDuration.add(res.timings.duration);

  // Validate the response
  const isSuccessful = check(res, {
    'HTTP status is 200': r => r.status === 200,
    'Response contains token': r => hasAuthToken(r),
    'Response time is under 800ms': r => r.timings.duration < 800,
  });

  // Track the custom rate of login failures
  loginFailureRate.add(!isSuccessful);

  // Log failures for debugging and real-time observability
  if (!isSuccessful) {
    console.error(
      `[login FAIL] VU ${__VU} ITER ${__ITER} | ` +
      `User: ${credentials.username} | ` +
      `HTTP ${res.status} | ` +
      `Duration: ${res.timings.duration}ms`
    );
  }

  // Pace the VUs by sleeping for 1 second between iterations
  sleep(1);
}
