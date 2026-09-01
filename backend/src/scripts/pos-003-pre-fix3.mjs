import { brandText } from "../config/brand.js";import fs from 'fs';
import path from 'path';

const ROOT = brandText("C:\\Users\\igarcia\\Videos\\GMX\\backend");


const ORDER_FILE =
path.join(
  ROOT,
  'src',
  'repositories',
  'ordersRepository.js'
);

const PAYMENT_FILE =
path.join(
  ROOT,
  'src',
  'paymentService.js'
);

function section(title) {
  console.log('');
  console.log('============================================================');
  console.log(title);
  console.log('============================================================');
}

function printRange(lines, start, end) {
  for (
  let i = Math.max(0, start);
  i <= Math.min(lines.length - 1, end);
  i++)
  {
    console.log(
      `${String(i + 1).padStart(4, '0')}: ${lines[i]}`
    );
  }
}

function findAll(lines, regex) {
  const hits = [];

  lines.forEach(
    (line, index) => {
      if (regex.test(line)) {
        hits.push(index);
      }

      /*
       * Reset global regex state if supplied.
       */
      regex.lastIndex = 0;
    }
  );

  return hits;
}

try {

  section(brandText("GMX POS-003-PRE-FIX3"));

  console.log(
    'TRAZABILIDAD EXACTA MP APPROVED -> PEDIDO'
  );

  console.log(
    'NO MUTATION'
  );

  console.log(
    'NO PROVIDER CALL'
  );

  const orders =
  fs.readFileSync(
    ORDER_FILE,
    'utf8'
  ).split(/\r?\n/);

  const payments =
  fs.readFileSync(
    PAYMENT_FILE,
    'utf8'
  ).split(/\r?\n/);

  /* ========================================================
     1. CREATE SALE POST COMMIT
     ======================================================== */

  section('1. CREATE SALE POST-COMMIT FLOW');

  const createStart =
  orders.findIndex(
    (line) =>
    line.includes(
      'export async function createSale('
    )
  );

  if (createStart < 0) {
    throw new Error(
      'CREATE_SALE_NOT_FOUND'
    );
  }

  let createEnd =
  orders.length - 1;

  for (
  let i = createStart + 1;
  i < orders.length;
  i++)
  {

    if (
    /^export\s+async\s+function\s+/.test(
      orders[i].trim()
    ))
    {
      createEnd = i - 1;
      break;
    }
  }

  console.log(
    `CREATE_SALE_START=${createStart + 1}`
  );

  console.log(
    `CREATE_SALE_END=${createEnd + 1}`
  );

  const mpCreateHits = [];

  for (
  let i = createStart;
  i <= createEnd;
  i++)
  {

    if (
    orders[i].includes(
      'createMercadoPagoPaymentForOrder'
    ) ||

    orders[i].includes(
      'markMercadoPagoPaid'
    ) ||

    orders[i].includes(
      'applyMercadoPagoPaymentState'
    ))
    {
      mpCreateHits.push(i);
    }
  }

  console.log(
    `CREATE_SALE_MP_HITS=${mpCreateHits.length}`
  );

  for (const hit of mpCreateHits) {

    console.log('');
    console.log(
      `--- CREATE SALE MP HIT @ ${hit + 1} ---`
    );

    printRange(
      orders,
      hit - 35,
      hit + 65
    );
  }

  /* ========================================================
     2. ALL PEDIDOS UPDATES IN PAYMENT SERVICE
     ======================================================== */

  section('2. PAYMENT SERVICE -> gmx.pedidos UPDATES');

  const paymentUpdateHits = [];

  for (
  let i = 0;
  i < payments.length;
  i++)
  {

    if (
    /UPDATE\s+shiny\.pedidos/i.
    test(
      payments[i]
    ))
    {
      paymentUpdateHits.push(i);
    }
  }

  console.log(
    `PAYMENT_PEDIDO_UPDATE_HITS=${paymentUpdateHits.length}`
  );

  for (const hit of paymentUpdateHits) {

    console.log('');
    console.log(
      `--- PAYMENT UPDATE @ ${hit + 1} ---`
    );

    printRange(
      payments,
      hit - 15,
      hit + 80
    );
  }

  /* ========================================================
     3. APPLY MP STATE FULL FUNCTION
     ======================================================== */

  section('3. applyMercadoPagoPaymentState FULL');

  const applyStart =
  payments.findIndex(
    (line) =>
    line.includes(
      'export async function applyMercadoPagoPaymentState('
    )
  );

  if (applyStart < 0) {
    throw new Error(
      'APPLY_MP_STATE_NOT_FOUND'
    );
  }

  let applyEnd =
  payments.length - 1;

  for (
  let i = applyStart + 1;
  i < payments.length;
  i++)
  {

    if (
    /^export\s+async\s+function\s+/.test(
      payments[i].trim()
    ))
    {
      applyEnd = i - 1;
      break;
    }
  }

  console.log(
    `APPLY_START=${applyStart + 1}`
  );

  console.log(
    `APPLY_END=${applyEnd + 1}`
  );

  printRange(
    payments,
    applyStart,
    applyEnd
  );

  /* ========================================================
     4. venta_confirmada REFERENCES
     ======================================================== */

  section('4. VENTA_CONFIRMADA REFERENCES');

  const orderVentaHits =
  findAll(
    orders,
    /venta_confirmada/
  );

  const paymentVentaHits =
  findAll(
    payments,
    /venta_confirmada/
  );

  console.log(
    `ORDERS_VENTA_CONFIRMADA_HITS=${orderVentaHits.length}`
  );

  for (const hit of orderVentaHits) {

    console.log('');
    console.log(
      `--- ordersRepository @ ${hit + 1} ---`
    );

    printRange(
      orders,
      hit - 12,
      hit + 28
    );
  }

  console.log('');
  console.log(
    `PAYMENT_VENTA_CONFIRMADA_HITS=${paymentVentaHits.length}`
  );

  for (const hit of paymentVentaHits) {

    console.log('');
    console.log(
      `--- paymentService @ ${hit + 1} ---`
    );

    printRange(
      payments,
      hit - 12,
      hit + 28
    );
  }

  /* ========================================================
     5. estado_pago=PAGADO REFERENCES
     ======================================================== */

  section('5. ESTADO_PAGO PAGADO REFERENCES');

  const estadoHits = [];

  for (
  let i = 0;
  i < payments.length;
  i++)
  {

    if (
    /estado_pago\s*=\s*'PAGADO'/i.
    test(
      payments[i]
    ))
    {
      estadoHits.push(i);
    }
  }

  console.log(
    `MP_ESTADO_PAGADO_HITS=${estadoHits.length}`
  );

  for (const hit of estadoHits) {

    console.log('');
    console.log(
      `--- estado_pago PAGADO @ ${hit + 1} ---`
    );

    printRange(
      payments,
      hit - 20,
      hit + 45
    );
  }

  /* ========================================================
     6. MARK PAID FUNCTION
     ======================================================== */

  section('6. markMercadoPagoPaid');

  const markStart =
  payments.findIndex(
    (line) =>
    line.includes(
      'export async function markMercadoPagoPaid('
    )
  );

  if (markStart >= 0) {

    let markEnd =
    payments.length - 1;

    for (
    let i = markStart + 1;
    i < payments.length;
    i++)
    {

      if (
      /^export\s+async\s+function\s+/.test(
        payments[i].trim()
      ))
      {
        markEnd = i - 1;
        break;
      }
    }

    console.log(
      `MARK_START=${markStart + 1}`
    );

    console.log(
      `MARK_END=${markEnd + 1}`
    );

    printRange(
      payments,
      markStart,
      markEnd
    );

  } else {

    console.log(
      'MARK_MP_PAID_NOT_FOUND'
    );
  }

  /* ========================================================
     7. STATIC CONTRACT CHECK
     ======================================================== */

  section('7. STATIC CONTRACT CHECK');

  const applyBlock =
  payments.
  slice(
    applyStart,
    applyEnd + 1
  ).
  join('\n');

  const hasPaid =
  /estado_pago\s*=\s*'PAGADO'/i.
  test(
    applyBlock
  );

  const hasConfirmed =
  /venta_confirmada\s*=\s*true/i.
  test(
    applyBlock
  );

  const hasProvider =
  /payment_provider\s*=\s*'MERCADOPAGO'/i.
  test(
    applyBlock
  );

  console.log(
    `APPLY_HAS_ESTADO_PAGADO=${hasPaid}`
  );

  console.log(
    `APPLY_HAS_VENTA_CONFIRMADA=${hasConfirmed}`
  );

  console.log(
    `APPLY_HAS_MP_PROVIDER=${hasProvider}`
  );

  /* ========================================================
     RESULT
     ======================================================== */

  section('POS-003-PRE-FIX3 RESULTADO');

  console.log(
    `CREATE_SALE_MP_HITS=${mpCreateHits.length}`
  );

  console.log(
    `PAYMENT_PEDIDO_UPDATE_HITS=${paymentUpdateHits.length}`
  );

  console.log(
    `ORDERS_VENTA_CONFIRMADA_HITS=${orderVentaHits.length}`
  );

  console.log(
    `PAYMENT_VENTA_CONFIRMADA_HITS=${paymentVentaHits.length}`
  );

  console.log(
    `MP_ESTADO_PAGADO_HITS=${estadoHits.length}`
  );

  console.log(
    `APPLY_HAS_ESTADO_PAGADO=${hasPaid}`
  );

  console.log(
    `APPLY_HAS_VENTA_CONFIRMADA=${hasConfirmed}`
  );

  console.log(
    `APPLY_HAS_MP_PROVIDER=${hasProvider}`
  );

  console.log('');

  console.log(
    'NO_MUTATION=TRUE'
  );

  console.log(
    'NO_PROVIDER_CALL=TRUE'
  );

  console.log('');

  console.log(
    'POS-003-PRE-FIX3=PASS'
  );

} catch (e) {

  section('POS-003-PRE-FIX3 FAIL');

  console.error(
    e.message
  );

  process.exitCode = 1;
}
