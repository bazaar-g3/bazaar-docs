import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

const USER_API   = 'http://localhost:8001';
const ORDERS_API = 'http://localhost:8003';

// ID del producto de prueba creado por seed.js
const PRODUCT_ID = '6a372d5fd159c38c2c338d22';

export const options = {
  scenarios: {
    carga_sostenida: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 8  },
        { duration: '60s', target: 8  },
        { duration: '5s',  target: 0  },
      ],
    },
    estres_moderado: {
      executor: 'ramping-vus',
      startTime: '75s',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 },
        { duration: '15s', target: 30 },
        { duration: '20s', target: 30 },
        { duration: '10s', target: 0  },
      ],
    },
    estres_alto: {
      executor: 'ramping-vus',
      startTime: '135s',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 25 },
        { duration: '20s', target: 50 },
        { duration: '20s', target: 75 },
        { duration: '30s', target: 75 },
        { duration: '15s', target: 0  },
      ],
    },
  },

  thresholds: {
    http_req_duration: ['p(95)<1500'],
    http_req_failed:   ['rate<0.05'],

    'http_req_duration{scenario:carga_sostenida,endpoint:add_to_cart}': ['p(95)<1500'],
    'http_req_duration{scenario:carga_sostenida,endpoint:get_cart}':    ['p(95)<1500'],
    'http_req_duration{scenario:carga_sostenida,endpoint:preview}':     ['p(95)<1500'],
    'http_req_duration{scenario:carga_sostenida,endpoint:checkout}':    ['p(95)<1500'],

    'http_req_duration{scenario:estres_moderado,endpoint:add_to_cart}': ['p(95)<2000'],
    'http_req_duration{scenario:estres_moderado,endpoint:get_cart}':    ['p(95)<2000'],
    'http_req_duration{scenario:estres_moderado,endpoint:preview}':     ['p(95)<2000'],
    'http_req_duration{scenario:estres_moderado,endpoint:checkout}':    ['p(95)<2000'],

    'http_req_duration{scenario:estres_alto,endpoint:add_to_cart}': ['p(95)<3000'],
    'http_req_duration{scenario:estres_alto,endpoint:get_cart}':    ['p(95)<3000'],
    'http_req_duration{scenario:estres_alto,endpoint:preview}':     ['p(95)<3000'],
    'http_req_duration{scenario:estres_alto,endpoint:checkout}':    ['p(95)<3000'],

    'http_req_failed{scenario:carga_sostenida,endpoint:add_to_cart}': ['rate<1.0'],
    'http_req_failed{scenario:carga_sostenida,endpoint:get_cart}':    ['rate<1.0'],
    'http_req_failed{scenario:carga_sostenida,endpoint:preview}':     ['rate<1.0'],
    'http_req_failed{scenario:carga_sostenida,endpoint:checkout}':    ['rate<1.0'],
    'http_req_failed{scenario:estres_moderado,endpoint:add_to_cart}': ['rate<1.0'],
    'http_req_failed{scenario:estres_moderado,endpoint:get_cart}':    ['rate<1.0'],
    'http_req_failed{scenario:estres_moderado,endpoint:preview}':     ['rate<1.0'],
    'http_req_failed{scenario:estres_moderado,endpoint:checkout}':    ['rate<1.0'],
    'http_req_failed{scenario:estres_alto,endpoint:add_to_cart}': ['rate<1.0'],
    'http_req_failed{scenario:estres_alto,endpoint:get_cart}':    ['rate<1.0'],
    'http_req_failed{scenario:estres_alto,endpoint:preview}':     ['rate<1.0'],
    'http_req_failed{scenario:estres_alto,endpoint:checkout}':    ['rate<1.0'],
  },

  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const maxVUs = 75; // cubre el escenario más exigente (estres_alto)
  const tokens = [];

  for (let i = 1; i <= maxVUs; i++) {
    const email = `loadtest_${i}@bazaar.dev`;
    const password = 'LoadTest123';
    const fullName = `Load Test User ${i}`;

    const registerRes = http.post(
      `${USER_API}/auth/register`,
      JSON.stringify({ email, password, fullName }),
      { headers: { 'Content-Type': 'application/json' } },
    );

    let token;
    if (registerRes.status === 201) {
      token = registerRes.json('accessToken');
    } else {
      // Ya existe de una corrida anterior (409) -> login normal
      const loginRes = http.post(
        `${USER_API}/auth/login`,
        JSON.stringify({ email, password }),
        { headers: { 'Content-Type': 'application/json' } },
      );
      check(loginRes, { [`login ok VU${i}`]: (r) => r.status === 200 });
      token = loginRes.json('accessToken');
    }
    tokens.push(token);
  }

  return { tokens };
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  group('cart_items', function () {
    const res = http.post(
      `${ORDERS_API}/cart/items`,
      JSON.stringify({ product_id: PRODUCT_ID, quantity: 1 }),
      { headers, tags: { endpoint: 'add_to_cart' } },
    );
    check(res, { 'add to cart ok': (r) => r.status === 200 || r.status === 201 });
  });

  sleep(1);

  group('get_cart', function () {
    const res = http.get(`${ORDERS_API}/cart/`, { headers, tags: { endpoint: 'get_cart' } });
    check(res, { 'get cart ok': (r) => r.status === 200 });
  });

  sleep(1);

  group('preview', function () {
    const res = http.post(
      `${ORDERS_API}/orders/cart/preview`,
      JSON.stringify({}),
      { headers, tags: { endpoint: 'preview' } },
    );
    check(res, { 'preview ok': (r) => r.status === 200 });
  });

  sleep(1);

  group('checkout', function () {
    const res = http.post(
      `${ORDERS_API}/orders/checkout`,
      JSON.stringify({
        delivery_address: {
          calle: 'Av. Corrientes',
          altura: '1234',
          codigo_postal: '1043',
        },
        idempotency_key: `${__VU}-${__ITER}-${randomString(8)}`,
      }),
      { headers, tags: { endpoint: 'checkout' } },
    );
    check(res, { 'checkout ok': (r) => r.status === 201 });
  });
}

export function handleSummary(data) {
  const combos = [
    ['carga_sostenida', 'add_to_cart'],
    ['carga_sostenida', 'get_cart'],
    ['carga_sostenida', 'preview'],
    ['carga_sostenida', 'checkout'],
    ['estres_moderado', 'add_to_cart'],
    ['estres_moderado', 'get_cart'],
    ['estres_moderado', 'preview'],
    ['estres_moderado', 'checkout'],
    ['estres_alto', 'add_to_cart'],
    ['estres_alto', 'get_cart'],
    ['estres_alto', 'preview'],
    ['estres_alto', 'checkout'],
  ];

  function fmt(v) {
    return v !== undefined ? v.toFixed(1) : 'N/A';
  }

  let rows = '| Escenario | Endpoint | avg | p50 | p95 | p99 | max | Error % |\n';
  rows += '|---|---|---|---|---|---|---|---|\n';

  const jsonMetrics = {};

  for (const [scenario, endpoint] of combos) {
    const key = `http_req_duration{scenario:${scenario},endpoint:${endpoint}}`;
    const m = data.metrics[key];
    const failKey = `http_req_failed{scenario:${scenario},endpoint:${endpoint}}`;
    const f = data.metrics[failKey];
    const errPct = f?.values?.rate !== undefined ? (f.values.rate * 100).toFixed(1) : 'N/A';
    if (!m) {
      rows += `| ${scenario} | ${endpoint} | sin datos | - | - | - | - | ${errPct}% |\n`;
      continue;
    }
    const v = m.values;
    jsonMetrics[`${scenario}_${endpoint}`] = {
      avg: v.avg, p50: v.med, p90: v['p(90)'], p95: v['p(95)'], p99: v['p(99)'], max: v.max,
      error_pct: errPct,
    };
    rows += `| ${scenario} | ${endpoint} | ${fmt(v.avg)}ms | ${fmt(v.med)}ms | ${fmt(v['p(95)'])}ms | ${fmt(v['p(99)'])}ms | ${fmt(v.max)}ms | ${errPct}% |\n`;
  }

  const globalDurationVals = data.metrics['http_req_duration']?.values;
  const failedMetric = data.metrics['http_req_failed'];
  // Defensivo: el campo de tasa puede venir como .values.rate o .value
  const errorRate = failedMetric?.values?.rate ?? failedMetric?.value ?? null;
  const errorRatePct = errorRate !== null ? (errorRate * 100).toFixed(2) : 'N/A';
  const totalReqs = data.metrics['http_reqs']?.values?.count ?? 'N/A';

  const md = `# Resultados — Pruebas de Carga y Estrés

## Resumen Global

- p95 general: ${fmt(globalDurationVals?.['p(95)'])}ms
- Tasa de error global: ${errorRatePct}%
- Total de requests: ${totalReqs}

## Desglose por Escenario y Endpoint

${rows}
`;

  const cleanJson = {
    summary: {
      p95_global_ms: globalDurationVals?.['p(95)'],
      error_rate_pct: errorRatePct,
      total_requests: totalReqs,
    },
    by_scenario_endpoint: jsonMetrics,
  };

  return {
    'stdout': md,
    'resultados.md': md,
    'resultados.json': JSON.stringify(cleanJson, null, 2),
  };
}
