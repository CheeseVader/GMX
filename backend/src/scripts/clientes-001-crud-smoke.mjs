import { brandText } from "../config/brand.js"; /**
 * Shiny — CLIENTES-001 CRUD SMOKE
 *
 * CONTROLLED TEST ONLY
 *
 * Flujo:
 *   PRECHECK
 *   LOGIN administrativo
 *   DB baseline
 *   CREATE
 *   READ
 *   UPDATE
 *   SEARCH
 *   duplicate email guard
 *   duplicate phone guard
 *   DELETE
 *   cleanup verification
 *
 * NO:
 *   - ventas
 *   - pagos
 *   - caja
 *   - movimientos financieros
 *   - fidelidad
 *
 * El script aborta ANTES de crear datos si:
 *   - API no responde
 *   - no puede autenticarse
 *   - no puede conectarse a DB
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const LINE = "=".repeat(110);

function section(title) {
  console.log("\n" + LINE);
  console.log(title);
  console.log(LINE);
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;

  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith("#")) continue;

    const m = line.match(/^([\w.-]+)\s*=\s*(.*)$/);

    if (!m) continue;

    let [, key, value] = m;

    value = value.trim();

    if (
    value.startsWith('"') && value.endsWith('"') ||
    value.startsWith("'") && value.endsWith("'"))
    {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

for (const name of [
".env",
".env.local",
".env.development",
".env.dev"])
{
  loadEnvFile(path.join(ROOT, name));
}

function dbConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL
    };
  }

  return {
    host:
    process.env.PGHOST ||
    process.env.DB_HOST ||
    "127.0.0.1",

    port: Number(
      process.env.PGPORT ||
      process.env.DB_PORT ||
      5432
    ),

    database:
    process.env.PGDATABASE ||
    process.env.DB_NAME ||
    process.env.DB_DATABASE,

    user:
    process.env.PGUSER ||
    process.env.DB_USER,

    password:
    process.env.PGPASSWORD ||
    process.env.DB_PASSWORD
  };
}

const API =
process.env.SHINY_API_BASE_URL ||
process.env.API_BASE_URL ||
"http://127.0.0.1:8787";

function testIdentity() {
  const stamp = Date.now().toString();

  const suffix = stamp.slice(-7);

  return {
    marker: `CLIENTES001-${stamp}`,

    create: {
      nombre: `CLIENTES001 TEST ${stamp}`,

      // 10 dígitos, solo numérico
      telefono: `555${suffix}`,

      email:
      `clientes001.${stamp}@example.invalid`,

      direccion:
      "CLIENTES-001 CONTROLLED TEST",

      ciudad: "Tijuana",
      estado: "Baja California",
      municipio: "Tijuana",
      colonia: "TEST",
      cp: "22000",
      pais: "México",

      rfc: "",
      razon_social: "",
      regimen_fiscal: "",
      cp_fiscal: "",
      uso_cfdi: ""
    },

    update: {
      nombre:
      `CLIENTES001 TEST UPDATED ${stamp}`,

      telefono: `556${suffix}`,

      email:
      `clientes001.updated.${stamp}@example.invalid`,

      direccion:
      "CLIENTES-001 CONTROLLED TEST UPDATED",

      ciudad: "Tijuana",
      estado: "Baja California",
      municipio: "Tijuana",
      colonia: "TEST UPDATED",
      cp: "22000",
      pais: "México",

      rfc: "",
      razon_social: "",
      regimen_fiscal: "",
      cp_fiscal: "",
      uso_cfdi: ""
    }
  };
}

async function request(
url,
{
  method = "GET",
  token = "",
  body = undefined
} = {})
{
  const headers = {
    Accept: "application/json"
  };

  if (body !== undefined) {
    headers["Content-Type"] =
    "application/json";
  }

  if (token) {
    headers.Authorization =
    `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body:
    body === undefined ?
    undefined :
    JSON.stringify(body)
  });

  const text = await response.text();

  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = {
      raw: text
    };
  }

  return {
    status: response.status,
    ok: response.ok,
    json
  };
}

function resolveCredentials() {
  /*
   * No imprimimos password.
   *
   * Revisamos aliases conocidos únicamente.
   */
  const email =
  process.env.SHINY_ADMIN_EMAIL ||
  process.env.ADMIN_EMAIL ||
  process.env.TEST_ADMIN_EMAIL ||
  "";

  const password =
  process.env.SHINY_ADMIN_PASSWORD ||
  process.env.ADMIN_PASSWORD ||
  process.env.TEST_ADMIN_PASSWORD ||
  "";

  return {
    email,
    password
  };
}

async function login() {
  const credentials =
  resolveCredentials();

  if (
  !credentials.email ||
  !credentials.password)
  {
    throw new Error(
      [
      "ADMIN_TEST_CREDENTIALS_NOT_FOUND.",
      "",
      "Define temporalmente en PowerShell:",
      '$env:SHINY_ADMIN_EMAIL="..."',
      '$env:SHINY_ADMIN_PASSWORD="..."',
      "",
      "y vuelve a ejecutar."].
      join("\n")
    );
  }

  const candidates = [
  "/api/auth/login",
  "/api/v1/auth/login"];


  for (const route of candidates) {
    const r = await request(
      API + route,
      {
        method: "POST",
        body: {
          email: credentials.email,
          password: credentials.password
        }
      }
    );

    if (!r.ok) continue;

    const token =
    r.json?.token ||
    r.json?.data?.token ||
    r.json?.access_token ||
    r.json?.data?.access_token;

    if (token) {
      return {
        token,
        route,
        status: r.status
      };
    }
  }

  throw new Error(
    "ADMIN_LOGIN_FAILED"
  );
}

async function dbCount(client, marker) {
  const r = await client.query(
    `
    SELECT
      COUNT(*)::bigint AS total
    FROM gmx.clientes
    WHERE
      COALESCE(nombre,'') LIKE $1
      OR COALESCE(email,'') LIKE $2
    `,
    [
    `%${marker}%`,
    `clientes001.%@example.invalid`]

  );

  return Number(r.rows[0].total);
}

async function dbFindByRowId(
client,
rowId)
{
  const r = await client.query(
    `
    SELECT
      row_id,
      id_cliente,
      nombre,
      telefono,
      email,
      email_normalizado,
      telefono_normalizado,
      fecha_registro,
      fecha_actualizacion
    FROM gmx.clientes
    WHERE row_id=$1
    `,
    [rowId]
  );

  return r.rows[0] || null;
}

async function identityRows(
client,
idCliente)
{
  if (!idCliente) return [];

  const r = await client.query(
    `
    SELECT
      row_id,
      tipo,
      valor_normalizado,
      id_cliente
    FROM gmx.cliente_identidad_unica
    WHERE id_cliente=$1
    ORDER BY row_id
    `,
    [idCliente]
  );

  return r.rows;
}

async function main() {
  section(brandText("GMX — CLIENTES-001 CONTROLLED CRUD SMOKE")

  );

  console.log(
    `TIMESTAMP=${new Date().toISOString()}`
  );

  console.log(`API=${API}`);

  console.log(
    "TEST_SCOPE=CLIENTES_ONLY"
  );

  console.log(
    "FINANCIAL_MUTATION_ALLOWED=NO"
  );

  const test = testIdentity();

  console.log(
    `TEST_MARKER=${test.marker}`
  );

  console.log(
    `TEST_PHONE_CREATE=${test.create.telefono}`
  );

  console.log(
    `TEST_EMAIL_CREATE=${test.create.email}`
  );

  /*
   * ---------------------------------
   * PRECHECK API
   * ---------------------------------
   */

  section("1. API PRECHECK");

  let health = null;

  for (const candidate of [
  "/api/health",
  "/health",
  "/api/v1/health"])
  {
    try {
      const r = await request(
        API + candidate
      );

      if (
      r.status > 0 &&
      r.status < 500)
      {
        health = {
          route: candidate,
          status: r.status
        };

        break;
      }
    } catch {}
  }

  /*
   * Aunque no exista /health, probamos login.
   */
  console.log(
    `HEALTH=${
    health ?
    `${health.route}:${health.status}` :
    "NO_HEALTH_ROUTE_DETECTED"}`

  );

  /*
   * ---------------------------------
   * AUTH
   * ---------------------------------
   */

  section("2. ADMIN AUTH PRECHECK");

  const auth = await login();

  console.log(
    `LOGIN_ROUTE=${auth.route}`
  );

  console.log(
    `LOGIN_STATUS=${auth.status}`
  );

  console.log("ADMIN_AUTH=PASS");

  /*
   * Verificar permiso CLIENTES
   * antes de cualquier mutación.
   */

  const readPermission =
  await request(
    `${API}/api/v1/clients?limit=1`,
    {
      token: auth.token
    }
  );

  console.log(
    `CLIENT_READ_PERMISSION_HTTP=${readPermission.status}`
  );

  if (!readPermission.ok) {
    throw new Error(
      `CLIENTES_PERMISSION_PRECHECK_FAILED HTTP=${readPermission.status}`
    );
  }

  /*
   * ---------------------------------
   * DB PRECHECK
   * ---------------------------------
   */

  section("3. DATABASE PRECHECK");

  const db = new Client(
    dbConfig()
  );

  await db.connect();

  let createdRowId = null;
  let createdIdCliente = null;

  try {
    const databaseIdentity =
    await db.query(`
        SELECT
          current_database() AS database,
          current_user AS db_user
      `);

    console.table(
      databaseIdentity.rows
    );

    const baseline =
    await dbCount(
      db,
      test.marker
    );

    console.log(
      `TEST_RESIDUE_BEFORE=${baseline}`
    );

    if (baseline !== 0) {
      throw new Error(
        "TEST_RESIDUE_BEFORE_NOT_ZERO"
      );
    }

    /*
     * ---------------------------------
     * CREATE
     * ---------------------------------
     */

    section("4. CREATE TEST CLIENT");

    const create =
    await request(
      `${API}/api/v1/clients`,
      {
        method: "POST",
        token: auth.token,
        body: test.create
      }
    );

    console.log(
      `CREATE_HTTP=${create.status}`
    );

    console.log(
      JSON.stringify(
        create.json,
        null,
        2
      )
    );

    if (
    create.status !== 201 ||
    !create.json?.success)
    {
      throw new Error(
        "CLIENT_CREATE_SMOKE_FAILED"
      );
    }

    createdRowId =
    Number(
      create.json?.data?.row_id
    );

    createdIdCliente =
    create.json?.data?.id_cliente;

    if (
    !Number.isFinite(createdRowId) ||
    createdRowId <= 0)
    {
      throw new Error(
        "CREATE_ROW_ID_INVALID"
      );
    }

    if (!createdIdCliente) {
      throw new Error(
        "CREATE_VISIBLE_ID_MISSING"
      );
    }

    console.log(
      `CREATED_ROW_ID=${createdRowId}`
    );

    console.log(
      `CREATED_ID_CLIENTE=${createdIdCliente}`
    );

    console.log("CREATE=PASS");

    /*
     * DB after CREATE
     */

    const createdDb =
    await dbFindByRowId(
      db,
      createdRowId
    );

    console.log(
      "DB_AFTER_CREATE="
    );

    console.table(
      createdDb ?
      [createdDb] :
      []
    );

    if (!createdDb) {
      throw new Error(
        "CREATE_DB_NOT_FOUND"
      );
    }

    /*
     * Trigger evidence
     */

    const identities =
    await identityRows(
      db,
      createdIdCliente
    );

    console.log(
      `IDENTITY_ROWS_AFTER_CREATE=${identities.length}`
    );

    console.table(identities);

    /*
     * ---------------------------------
     * READ
     * ---------------------------------
     */

    section("5. READ TEST CLIENT");

    const read =
    await request(
      `${API}/api/v1/clients/${createdRowId}`,
      {
        token: auth.token
      }
    );

    console.log(
      `READ_HTTP=${read.status}`
    );

    console.log(
      JSON.stringify(
        read.json,
        null,
        2
      )
    );

    if (
    read.status !== 200 ||
    !read.json?.success ||
    Number(
      read.json?.data?.row_id
    ) !== createdRowId)
    {
      throw new Error(
        "CLIENT_READ_SMOKE_FAILED"
      );
    }

    console.log("READ=PASS");

    /*
     * ---------------------------------
     * SEARCH
     * ---------------------------------
     */

    section("6. SEARCH TEST CLIENT");

    const search =
    await request(
      `${API}/api/v1/clients?search=${encodeURIComponent(
        createdIdCliente
      )}&limit=10`,
      {
        token: auth.token
      }
    );

    console.log(
      `SEARCH_HTTP=${search.status}`
    );

    const found =
    Array.isArray(
      search.json?.data
    ) &&
    search.json.data.some(
      (x) =>
      Number(x.row_id) ===
      createdRowId
    );

    console.log(
      `SEARCH_FOUND=${found ? "YES" : "NO"}`
    );

    if (!found) {
      throw new Error(
        "CLIENT_SEARCH_SMOKE_FAILED"
      );
    }

    console.log("SEARCH=PASS");

    /*
     * ---------------------------------
     * DUPLICATE EMAIL
     * ---------------------------------
     */

    section("7. DUPLICATE EMAIL GUARD");

    const dupEmailPayload = {
      ...test.create,

      nombre:
      `${test.create.nombre} DUP EMAIL`,

      telefono:
      `557${test.create.telefono.slice(3)}`
    };

    const dupEmail =
    await request(
      `${API}/api/v1/clients`,
      {
        method: "POST",
        token: auth.token,
        body: dupEmailPayload
      }
    );

    console.log(
      `DUP_EMAIL_HTTP=${dupEmail.status}`
    );

    console.log(
      `DUP_EMAIL_ERROR=${
      dupEmail.json?.error || ""}`

    );

    if (
    dupEmail.status !== 400 ||
    dupEmail.json?.error !==
    "CLIENT_EMAIL_ALREADY_LINKED")
    {
      throw new Error(
        "DUPLICATE_EMAIL_GUARD_FAILED"
      );
    }

    console.log(
      "DUPLICATE_EMAIL_GUARD=PASS"
    );

    /*
     * ---------------------------------
     * DUPLICATE PHONE
     * ---------------------------------
     */

    section("8. DUPLICATE PHONE GUARD");

    const dupPhonePayload = {
      ...test.create,

      nombre:
      `${test.create.nombre} DUP PHONE`,

      email:
      `other.${Date.now()}@example.invalid`
    };

    const dupPhone =
    await request(
      `${API}/api/v1/clients`,
      {
        method: "POST",
        token: auth.token,
        body: dupPhonePayload
      }
    );

    console.log(
      `DUP_PHONE_HTTP=${dupPhone.status}`
    );

    console.log(
      `DUP_PHONE_ERROR=${
      dupPhone.json?.error || ""}`

    );

    if (
    dupPhone.status !== 400 ||
    dupPhone.json?.error !==
    "CLIENT_PHONE_ALREADY_LINKED")
    {
      throw new Error(
        "DUPLICATE_PHONE_GUARD_FAILED"
      );
    }

    console.log(
      "DUPLICATE_PHONE_GUARD=PASS"
    );

    /*
     * ---------------------------------
     * UPDATE
     * ---------------------------------
     */

    section("9. UPDATE TEST CLIENT");

    const update =
    await request(
      `${API}/api/v1/clients/${createdRowId}`,
      {
        method: "PUT",
        token: auth.token,
        body: test.update
      }
    );

    console.log(
      `UPDATE_HTTP=${update.status}`
    );

    console.log(
      JSON.stringify(
        update.json,
        null,
        2
      )
    );

    if (
    update.status !== 200 ||
    !update.json?.success)
    {
      throw new Error(
        "CLIENT_UPDATE_SMOKE_FAILED"
      );
    }

    if (
    update.json?.data?.email !==
    test.update.email)
    {
      throw new Error(
        "CLIENT_UPDATE_EMAIL_NOT_APPLIED"
      );
    }

    if (
    update.json?.data?.telefono !==
    test.update.telefono)
    {
      throw new Error(
        "CLIENT_UPDATE_PHONE_NOT_APPLIED"
      );
    }

    console.log("UPDATE=PASS");

    /*
     * Trigger identity update evidence.
     */

    const identitiesAfterUpdate =
    await identityRows(
      db,
      createdIdCliente
    );

    console.log(
      `IDENTITY_ROWS_AFTER_UPDATE=${identitiesAfterUpdate.length}`
    );

    console.table(
      identitiesAfterUpdate
    );

    /*
     * ---------------------------------
     * DELETE / CLEANUP
     * ---------------------------------
     */

    section("10. DELETE / CLEANUP");

    const del =
    await request(
      `${API}/api/v1/clients/${createdRowId}`,
      {
        method: "DELETE",
        token: auth.token
      }
    );

    console.log(
      `DELETE_HTTP=${del.status}`
    );

    console.log(
      JSON.stringify(
        del.json,
        null,
        2
      )
    );

    if (
    del.status !== 200 ||
    !del.json?.success)
    {
      throw new Error(
        "CLIENT_DELETE_SMOKE_FAILED"
      );
    }

    console.log("DELETE=PASS");

    /*
     * Importantísimo:
     * anulamos referencia para evitar
     * cleanup duplicado en finally.
     */
    createdRowId = null;

    /*
     * ---------------------------------
     * POST CLEANUP
     * ---------------------------------
     */

    section("11. CLEANUP VERIFICATION");

    const residue =
    await db.query(
      `
        SELECT
          row_id,
          id_cliente,
          nombre,
          telefono,
          email
        FROM gmx.clientes
        WHERE
          COALESCE(nombre,'')
            LIKE 'CLIENTES001 TEST%'
          OR COALESCE(email,'')
            LIKE 'clientes001.%@example.invalid'
        ORDER BY row_id
        `
    );

    console.log(
      `TEST_RESIDUE_CLIENTES=${residue.rowCount}`
    );

    console.table(residue.rows);

    const identityResidue =
    await db.query(
      `
        SELECT
          row_id,
          tipo,
          valor_normalizado,
          id_cliente
        FROM gmx.cliente_identidad_unica
        WHERE id_cliente=$1
        ORDER BY row_id
        `,
      [createdIdCliente]
    );

    console.log(
      `TEST_RESIDUE_IDENTIDAD=${identityResidue.rowCount}`
    );

    console.table(
      identityResidue.rows
    );

    if (
    residue.rowCount !== 0 ||
    identityResidue.rowCount !== 0)
    {
      throw new Error(
        "CRUD_CLEANUP_NOT_ZERO"
      );
    }

    /*
     * ---------------------------------
     * FINAL
     * ---------------------------------
     */

    section("12. FINAL SUMMARY");

    console.log(
      "CLIENTES_001_CRUD_SMOKE=PASS"
    );

    console.log("CREATE=PASS");
    console.log("READ=PASS");
    console.log("SEARCH=PASS");
    console.log("UPDATE=PASS");

    console.log(
      "DUPLICATE_EMAIL_GUARD=PASS"
    );

    console.log(
      "DUPLICATE_PHONE_GUARD=PASS"
    );

    console.log("DELETE=PASS");

    console.log(
      "TEST_RESIDUE_CLIENTES=0"
    );

    console.log(
      "TEST_RESIDUE_IDENTIDAD=0"
    );

    console.log(
      "FINANCIAL_MUTATION=0"
    );

    console.log(
      "LOYALTY_MUTATION=0"
    );

    console.log(
      "NEXT_STEP=CLIENTES_LOYALTY_PRECHECK"
    );

  } finally {
    /*
     * Emergency cleanup:
     * solo si el cliente TEST todavía existe.
     */
    if (createdRowId) {
      section(
        "EMERGENCY CLEANUP"
      );

      console.log(
        `ROW_ID=${createdRowId}`
      );

      try {
        const auth =
        await login();

        const cleanup =
        await request(
          `${API}/api/v1/clients/${createdRowId}`,
          {
            method: "DELETE",
            token: auth.token
          }
        );

        console.log(
          `EMERGENCY_DELETE_HTTP=${cleanup.status}`
        );
      } catch (e) {
        console.error(
          "EMERGENCY_DELETE_FAILED=" +
          e.message
        );
      }
    }

    await db.end();
  }
}

main().catch((error) => {
  section(
    "CLIENTES-001 CRUD SMOKE FAILED"
  );

  console.error(
    error?.stack || error
  );

  console.error(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
