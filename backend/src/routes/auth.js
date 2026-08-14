const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../db");

const router = express.Router();


// REGISTER COMPANY + ADMIN USER

router.post("/register", async (req, res) => {

    try {

        const {
            companyName,
            industry,
            country,
            name,
            email,
            password
        } = req.body;


        // Create company

        const company = await db.query(
            `
            INSERT INTO companies
            (name, industry, country)
            VALUES ($1,$2,$3)
            RETURNING *
            `,
            [
                companyName,
                industry,
                country
            ]
        );


        const companyId = company.rows[0].id;


        // Encrypt password

        const hashedPassword = await bcrypt.hash(password, 10);


        // Create admin user

        const user = await db.query(
            `
            INSERT INTO users
            (company_id,name,email,password,role)
            VALUES ($1,$2,$3,$4,$5)
            RETURNING id,name,email,role
            `,
            [
                companyId,
                name,
                email,
                hashedPassword,
                "COMPANY_ADMIN"
            ]
        );


        res.json({
            message: "Company registered successfully",
            company: company.rows[0],
            user: user.rows[0]
        });


    } catch(error){

        console.error(error);

        res.status(500).json({
            error: "Registration failed"
        });

    }

});



// LOGIN USER

router.post("/login", async (req, res) => {

    try {

        const {
            email,
            password
        } = req.body;


        // Find user

        const result = await db.query(
            "SELECT * FROM users WHERE email = $1",
            [email]
        );


        if (result.rows.length === 0) {

            return res.status(400).json({
                error: "User not found"
            });

        }


        const user = result.rows[0];


        // Compare password

        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );


        if (!passwordMatch) {

            return res.status(400).json({
                error: "Invalid password"
            });

        }


        // Generate JWT token

        const token = jwt.sign(
            {
                id: user.id,
                company_id: user.company_id,
                role: user.role
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "24h"
            }
        );


        res.json({

            message: "Login successful",

            token,

            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }

        });


    } catch(error){

        console.error(error);

        res.status(500).json({
            error: "Login failed"
        });

    }

});


module.exports = router;