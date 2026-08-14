const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});


/*
    Log everything Postgres and Node give us about a failure.

    A bare error.message is frequently EMPTY, which is why "❌ Database
    error:" printed nothing useful. There are two different families of
    error here and they populate different fields:

      * Server-side Postgres faults (bad password, missing relation,
        constraint violation) fill message / code / detail / hint /
        severity.

      * Connection-level faults (ETIMEDOUT, ECONNREFUSED, ENOTFOUND,
        certificate problems) leave message blank and instead fill
        code / errno / syscall / address / port. When Node tries both
        IPv6 and IPv4 it wraps the real causes in an AggregateError
        whose own message is an empty string, and the actual reasons
        sit in error.errors.

    Printing both families means a connection failure can never show up
    blank again.
*/

const logDatabaseError = (label, error) => {

  if (!error) {
    console.error(`\n❌ ${label}: threw a null/undefined error\n`);
    return;
  }

  console.error(`\n❌ ${label}`);

  const fields = {
    name: error.name,
    message: error.message || "(empty)",
    code: error.code,
    detail: error.detail,
    hint: error.hint,
    severity: error.severity,

    // Postgres also sends these on server-side faults; they pinpoint
    // which constraint / column / table actually rejected the query.
    constraint: error.constraint,
    table: error.table,
    column: error.column,
    routine: error.routine,

    // Network-level detail. This is what is populated when message,
    // detail and hint are all empty.
    errno: error.errno,
    syscall: error.syscall,
    address: error.address,
    port: error.port,
  };

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      console.error(`   ${key.padEnd(10)}: ${value}`);
    }
  }

  // AggregateError from a dual-stack connect attempt: the outer error
  // is blank, the real reasons are nested one level down.
  if (Array.isArray(error.errors) && error.errors.length > 0) {
    console.error("   nested    : (AggregateError — real causes below)");
    error.errors.forEach((nested, index) => {
      const where = nested.address ? ` at ${nested.address}:${nested.port}` : "";
      const reason = nested.message || "(empty)";
      console.error(`     [${index}] ${nested.code || nested.name || "Error"}: ${reason}${where}`);
    });
  }

  console.error(`   stack     :\n${error.stack || "   (no stack available)"}\n`);

};


/*
    Startup connectivity probe.

    Differences from a bare pool.connect().catch(...):

      * The client is RELEASED. Previously it was acquired and held for
        the lifetime of the process, which leaked one connection and
        made pool teardown emit an unhandled 'error' event.

      * The failure is logged in full and then swallowed deliberately,
        so an unreachable database does not take the HTTP server down
        with it. Individual routes still fail per-request through their
        own try/catch and return 500, which is the existing behaviour.
*/

pool.connect()
  .then((client) => {
    client.release();
    console.log("✅ Neon PostgreSQL connected");
  })
  .catch((error) => {
    logDatabaseError("Database connection failed at startup", error);
    console.error(
      "   The API is still listening. Requests that touch the database " +
      "will return 500 until the connection recovers.\n"
    );
  });


/*
    An idle pooled client that dies emits 'error' on the pool.

    With no listener attached, Node treats that as an unhandled 'error'
    event and terminates the process — the server disappears with only
    a stack trace, which is the "silent crash" case. Logging it here
    keeps the process alive; pg discards the broken client and opens a
    fresh one on the next query.
*/

pool.on("error", (error) => {
  logDatabaseError("Idle PostgreSQL client error (pool recovered)", error);
});


module.exports = pool;
