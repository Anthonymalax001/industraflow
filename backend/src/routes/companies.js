const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


router.get("/profile", authMiddleware, async (req, res) => {

    try {

        const company = await db.query(
            "SELECT * FROM companies WHERE id = $1",
            [req.user.company_id]
        );


        res.json(company.rows[0]);


    } catch(error){

        console.error(error);

        res.status(500).json({
            error:"Failed to get company profile"
        });

    }

});


module.exports = router;