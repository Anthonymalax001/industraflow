const express = require("express");

const bcrypt = require("bcryptjs");

const jwt = require("jsonwebtoken");

const db = require("../db");

const {
  authLimiter,
  registrationLimiter,
} = require("../middleware/rateLimit");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("❌ JWT_SECRET is missing from environment variables.");
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
=========================================================
REGISTER COMPANY + FIRST COMPANY ADMIN
=========================================================
*/

router.post("/register", registrationLimiter, async (req, res) => {
  const {
    companyName,
    industry,
    country,
    name,
    email,
    password,
  } = req.body;

  if (!companyName || !name || !email || !password) {
    return res.status(400).json({
      error: "Company name, name, email and password are required.",
    });
  }

  const normalizedCompanyName = String(companyName).trim();
  const normalizedName = String(name).trim();
  const normalizedEmail = String(email).trim().toLowerCase();

  if (!normalizedCompanyName) {
    return res.status(400).json({
      error: "Company name is required.",
    });
  }

  if (!normalizedName) {
    return res.status(400).json({
      error: "Name is required.",
    });
  }

  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({
      error: "Please provide a valid email address.",
    });
  }

  if (String(password).length < 8) {
    return res.status(400).json({
      error: "Password must be at least 8 characters.",
    });
  }

  if (!JWT_SECRET) {
    return res.status(500).json({
      error: "Server authentication configuration is missing.",
    });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    /*
    -------------------------------------------------------
    Check whether this email already exists
    -------------------------------------------------------
    */

    const existingUser = await client.query(
      `
      SELECT id
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "An account with this email already exists.",
      });
    }

    /*
    -------------------------------------------------------
    Create company
    -------------------------------------------------------
    */

    const companyResult = await client.query(
      `
      INSERT INTO companies (
        name,
        industry,
        country
      )
      VALUES ($1, $2, $3)
      RETURNING
        id,
        name,
        industry,
        country,
        created_at
      `,
      [
        normalizedCompanyName,
        industry ? String(industry).trim() : null,
        country ? String(country).trim() : null,
      ]
    );

    const company = companyResult.rows[0];

    /*
    -------------------------------------------------------
    Hash password
    -------------------------------------------------------
    */

    const passwordHash = await bcrypt.hash(String(password), 12);

    /*
    -------------------------------------------------------
    Create first company administrator
    -------------------------------------------------------
    */

    const userResult = await client.query(
      `
      INSERT INTO users (
        company_id,
        name,
        email,
        password,
        role
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        company_id,
        name,
        email,
        role
      `,
      [
        company.id,
        normalizedName,
        normalizedEmail,
        passwordHash,
        "COMPANY_ADMIN",
      ]
    );

    const user = userResult.rows[0];

    /*
    -------------------------------------------------------
    Commit both records
    -------------------------------------------------------
    */

    await client.query("COMMIT");

    /*
    -------------------------------------------------------
    CREATE LOGIN TOKEN
    -------------------------------------------------------
    */

    const token = jwt.sign(
      {
        user_id: user.id,
        company_id: user.company_id,
        role: user.role,
        email: user.email,
      },
      JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    /*
    -------------------------------------------------------
    Return everything frontend needs
    -------------------------------------------------------
    */

    return res.status(201).json({
      message: "Company registered successfully",
      token,

      company: {
        id: company.id,
        name: company.name,
        industry: company.industry,
        country: company.country,
        created_at: company.created_at,
      },

      user: {
        id: user.id,
        company_id: user.company_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "❌ Registration rollback failed:",
        rollbackError
      );
    }

    console.error("❌ Company registration failed:", error);

    /*
    -------------------------------------------------------
    Handle duplicate email safely in case the database
    catches a race condition.
    -------------------------------------------------------
    */

    if (error.code === "23505") {
      return res.status(409).json({
        error: "An account with this email already exists.",
      });
    }

    return res.status(500).json({
      error: "Company registration failed.",
    });
  } finally {
    client.release();
  }
});

/*
=========================================================
LOGIN
=========================================================
*/

router.post("/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: "Email and password are required.",
    });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({
      error: "Please provide a valid email address.",
    });
  }

  if (!JWT_SECRET) {
    return res.status(500).json({
      error: "Server authentication configuration is missing.",
    });
  }

  try {
    const result = await db.query(
      `
      SELECT
        id,
        company_id,
        name,
        email,
        password,
        role
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Invalid email or password.",
      });
    }

    const user = result.rows[0];

    const passwordMatches = await bcrypt.compare(
      String(password),
      user.password
    );

    if (!passwordMatches) {
      return res.status(401).json({
        error: "Invalid email or password.",
      });
    }

    const token = jwt.sign(
      {
        user_id: user.id,
        company_id: user.company_id,
        role: user.role,
        email: user.email,
      },
      JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    return res.status(200).json({
      message: "Login successful",
      token,

      user: {
        id: user.id,
        company_id: user.company_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("❌ Login failed:", error);

    return res.status(500).json({
      error: "Login failed.",
    });
  }
});

module.exports = router;
