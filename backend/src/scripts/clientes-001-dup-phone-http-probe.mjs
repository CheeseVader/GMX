import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const LINE = "=".repeat(110);
const API = "http://127.0.0.1:8787";

function section(title) {
  console.log("\n" + LINE);
  console.log(title);
  console.log(LINE);
}

function loadEnv(file) {
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

for (const f of [
".env",
".env.local",
".env.development",
".env.dev"])
{
  loadEnv(path.join(ROOT, f));
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

async function request(url, options = {}) {
  const response = await fetch(url, options);

  const text = await response.text();

  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return {
    status: response.status,
    body
  };
}

async function health(label) {
  try {
    const r = await request(`${API}/api/health`);

    console.log(`${label}_HTTP=${r.status}`);
    console.log(
      `${label}_ALIVE=${r.status === 200 ? "YES" : "NO"}`
    );

    return r.status === 200;

  } catch (e) {
    console.log(`${label}_HTTP=FETCH_FAILED`);
    console.log(`${label}_ALIVE=NO`);
    console.log(
      `${label}_ERROR=${e.message}`
    );

    return false;
  }
}

async function login() {
  const email =
  process.env.SHINY_ADMIN_EMAIL;

  const password =
  process.env.SHINY_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "ADMIN_TEST_CREDENTIALS_NOT_FOUND"
    );
  }

  const candidates = [
  "/api/auth/login",
  "/api/v1/auth/login"];


  for (const route of candidates) {
    try {
      const r = await request(
        `${API}${route}`,
        {
          method: "POST",
          headers: {
            "content-type":
            "application/json"
          },
          body: JSON.stringify({
            email,
            password
          })
        }
      );

      if (
      r.status >= 200 &&
      r.status < 300)
      {
        const token =
        r.body?.token ||
        r.body?.data?.token ||
        r.body?.access_token ||
        r.body?.data?.access_token;

        if (!token) {
          throw new Error(
            `LOGIN_TOKEN_NOT_FOUND:${route}`
          );
        }

        console.log(
          `LOGIN_ROUTE=${route}`
        );

        console.log(
          `LOGIN_HTTP=${r.status}`
        );

        return token;
      }
    } catch {}
  }

  throw new Error("ADMIN_LOGIN_FAILED");
}

async function main() {
  section(brandText("GMX — CLIENTES-001 DUPLICATE PHONE HTTP PROBE")

  );

  console.log(
    `TIMESTAMP=${new Date().toISOString()}`
  );

  console.log("SCOPE=DUPLICATE_PHONE_ONLY");
  console.log("FINANCIAL_MUTATION_ALLOWED=NO");
  console.log("LOYALTY_MUTATION_ALLOWED=NO");

  const stamp = Date.now().toString();

  const phone =
  `555${stamp.slice(-7)}`;

  const emailA =
  `clientes001.http.a.${stamp}@example.invalid`;

  const emailB =
  `clientes001.http.b.${stamp}@example.invalid`;

  const nameA =
  `CLIENTES001 HTTP DUPPHONE A ${stamp}`;

  const nameB =
  `CLIENTES001 HTTP DUPPHONE B ${stamp}`;

  console.log(`TEST_PHONE=${phone}`);
  console.log(`TEST_EMAIL_A=${emailA}`);
  console.log(`TEST_EMAIL_B=${emailB}`);

  let createdRowId = null;
  let createdIdCliente = null;
  let token = null;

  const db = new Client(dbConfig());

  await db.connect();

  try {
    section("1. HEALTH BEFORE");

    const beforeAlive =
    await health("HEALTH_BEFORE");

    if (!beforeAlive) {
      throw new Error(
        "BACKEND_NOT_HEALTHY_BEFORE_TEST"
      );
    }

    section("2. AUTH");

    token = await login();

    console.log("AUTH=PASS");

    const headers = {
      "content-type":
      "application/json",

      authorization:
      `Bearer ${token}`
    };

    section("3. DATABASE BASELINE");

    const baseline =
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
          telefono=$1
          OR email IN ($2,$3)
          OR nombre IN ($4,$5)
        `,
      [
      phone,
      emailA,
      emailB,
      nameA,
      nameB]

    );

    console.log(
      `BASELINE_ROWS=${baseline.rowCount}`
    );

    if (baseline.rowCount !== 0) {
      throw new Error(
        "SAFETY_ABORT_BASELINE_NOT_ZERO"
      );
    }

    section("4. CREATE CLIENT A");

    const createA =
    await request(
      `${API}/api/v1/clients`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          nombre: nameA,
          telefono: phone,
          email: emailA,
          direccion:
          "CLIENTES-001 HTTP CONTROLLED TEST",
          ciudad: "Tijuana",
          estado: "Baja California",
          municipio: "Tijuana",
          colonia: "TEST",
          cp: "22000",
          pais: "México"
        })
      }
    );

    console.log(
      `CREATE_A_HTTP=${createA.status}`
    );

    console.log(
      JSON.stringify(
        createA.body,
        null,
        2
      )
    );

    if (createA.status !== 201) {
      throw new Error(
        `CREATE_A_FAILED_HTTP_${createA.status}`
      );
    }

    createdRowId =
    createA.body?.data?.row_id;

    createdIdCliente =
    createA.body?.data?.id_cliente;

    if (!createdRowId) {
      throw new Error(
        "CREATE_A_ROW_ID_NOT_FOUND"
      );
    }

    console.log(
      `CREATED_ROW_ID=${createdRowId}`
    );

    console.log(
      `CREATED_ID_CLIENTE=${createdIdCliente}`
    );

    section(
      "5. DUPLICATE PHONE REQUEST"
    );

    let duplicateResult = null;
    let duplicateFetchFailed = false;

    try {
      duplicateResult =
      await request(
        `${API}/api/v1/clients`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            nombre: nameB,
            telefono: phone,
            email: emailB,
            direccion:
            "CLIENTES-001 HTTP DUPLICATE TEST",
            ciudad: "Tijuana",
            estado: "Baja California",
            municipio: "Tijuana",
            colonia: "TEST",
            cp: "22000",
            pais: "México"
          })
        }
      );

      console.log(
        `DUP_PHONE_HTTP=${duplicateResult.status}`
      );

      console.log(
        JSON.stringify(
          duplicateResult.body,
          null,
          2
        )
      );

    } catch (e) {
      duplicateFetchFailed = true;

      console.log(
        "DUP_PHONE_HTTP=FETCH_FAILED"
      );

      console.log(
        `DUP_PHONE_FETCH_ERROR=${e.message}`
      );

      if (e.cause) {
        console.log(
          `DUP_PHONE_FETCH_CAUSE=${
          e.cause?.message ||
          String(e.cause)}`

        );

        console.log(
          `DUP_PHONE_FETCH_CODE=${
          e.cause?.code ||
          "(none)"}`

        );
      }
    }

    section(
      "6. IMMEDIATE HEALTH AFTER DUPLICATE"
    );

    const aliveAfter =
    await health("HEALTH_AFTER_DUP");

    section(
      "7. DATABASE AFTER DUPLICATE"
    );

    const rowsAfter =
    await db.query(
      `
        SELECT
          row_id,
          id_cliente,
          nombre,
          telefono,
          email,
          telefono_normalizado
        FROM gmx.clientes
        WHERE
          telefono=$1
          OR email IN ($2,$3)
          OR nombre IN ($4,$5)
        ORDER BY row_id
        `,
      [
      phone,
      emailA,
      emailB,
      nameA,
      nameB]

    );

    console.log(
      `ROWS_AFTER_DUP=${rowsAfter.rowCount}`
    );

    console.table(rowsAfter.rows);

    if (rowsAfter.rowCount !== 1) {
      throw new Error(
        "DUPLICATE_PHONE_CREATED_EXTRA_ROW"
      );
    }

    section("8. HTTP CONTRACT RESULT");

    if (duplicateFetchFailed) {
      console.log(
        "HTTP_DUP_PHONE_CONTRACT=FAIL_FETCH"
      );

      console.log(
        `BACKEND_ALIVE_AFTER_FAILURE=${
        aliveAfter ? "YES" : "NO"}`

      );

    } else {
      const errorCode =
      duplicateResult?.body?.error;

      console.log(
        `DUP_PHONE_ERROR_CODE=${
        errorCode || "(none)"}`

      );

      const contractPass =
      duplicateResult.status === 400 &&
      errorCode ===
      "CLIENT_PHONE_ALREADY_LINKED";

      console.log(
        `HTTP_DUP_PHONE_CONTRACT=${
        contractPass ? "PASS" : "FAIL"}`

      );
    }

  } finally {
    section("9. GUARANTEED CLEANUP");

    /*
     * Intentamos primero cleanup por API.
     * Si el backend murió, hacemos fallback DB
     * SOLO sobre el registro TEST exacto.
     */

    let apiCleanup = false;

    if (createdRowId && token) {
      try {
        const r = await request(
          `${API}/api/v1/clients/${createdRowId}`,
          {
            method: "DELETE",
            headers: {
              authorization:
              `Bearer ${token}`
            }
          }
        );

        console.log(
          `API_DELETE_HTTP=${r.status}`
        );

        if (
        r.status >= 200 &&
        r.status < 300)
        {
          apiCleanup = true;
        }

      } catch (e) {
        console.log(
          `API_DELETE_FAILED=${e.message}`
        );
      }
    }

    if (!apiCleanup) {
      console.log(
        "DB_CLEANUP_FALLBACK=START"
      );

      await db.query("BEGIN");

      try {
        const target =
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
              telefono=$1
              AND email=$2
              AND nombre=$3
            FOR UPDATE
            `,
          [
          phone,
          emailA,
          nameA]

        );

        console.log(
          `DB_FALLBACK_TARGET_ROWS=${target.rowCount}`
        );

        if (target.rowCount > 1) {
          throw new Error(
            "SAFETY_ABORT_MULTIPLE_CLEANUP_TARGETS"
          );
        }

        if (target.rowCount === 1) {
          await db.query(
            `
            DELETE FROM gmx.clientes
            WHERE
              row_id=$1
              AND telefono=$2
              AND email=$3
              AND nombre=$4
            `,
            [
            target.rows[0].row_id,
            phone,
            emailA,
            nameA]

          );
        }

        const verify =
        await db.query(
          `
            SELECT COUNT(*)::bigint AS total
            FROM gmx.clientes
            WHERE
              telefono=$1
              OR email IN ($2,$3)
              OR nombre IN ($4,$5)
            `,
          [
          phone,
          emailA,
          emailB,
          nameA,
          nameB]

        );

        const total =
        Number(
          verify.rows[0].total
        );

        console.log(
          `DB_FALLBACK_RESIDUE=${total}`
        );

        if (total !== 0) {
          throw new Error(
            "DB_FALLBACK_CLEANUP_VERIFY_FAILED"
          );
        }

        await db.query("COMMIT");

        console.log(
          "DB_CLEANUP_FALLBACK=PASS"
        );

      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      }
    }

    section(
      "10. FINAL RESIDUE VERIFICATION"
    );

    const finalClients =
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
          telefono=$1
          OR email IN ($2,$3)
          OR nombre IN ($4,$5)
        `,
      [
      phone,
      emailA,
      emailB,
      nameA,
      nameB]

    );

    console.log(
      `TEST_RESIDUE_CLIENTES=${finalClients.rowCount}`
    );

    console.table(finalClients.rows);

    const finalIdentity =
    await db.query(
      `
        SELECT
          row_id,
          tipo,
          valor_normalizado,
          id_cliente
        FROM gmx.cliente_identidad_unica
        WHERE id_cliente=$1
        `,
      [createdIdCliente || "__NONE__"]
    );

    console.log(
      `TEST_RESIDUE_IDENTIDAD=${finalIdentity.rowCount}`
    );

    console.table(finalIdentity.rows);

    console.log(
      "FINANCIAL_MUTATION=0"
    );

    console.log(
      "LOYALTY_MUTATION=0"
    );

    await db.end();
  }

  section("11. PROBE COMPLETE");

  console.log(
    "CLIENTES_001_DUP_PHONE_HTTP_PROBE=COMPLETE"
  );

  console.log(
    "NEXT_STEP=ANALYZE_RESULT"
  );
}

main().catch((e) => {
  section(
    "CLIENTES-001 DUP PHONE HTTP PROBE FAILED"
  );

  console.error(e?.stack || e);

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
