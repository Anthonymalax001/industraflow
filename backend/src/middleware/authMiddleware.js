const jwt = require("jsonwebtoken");


const authMiddleware = (req, res, next) => {

    try {

        // Get token from header

        const authHeader = req.headers.authorization;


        if (!authHeader) {
            return res.status(401).json({
                error: "No token provided"
            });
        }


        // Format: Bearer TOKEN

        const token = authHeader.split(" ")[1];


        if (!token) {
            return res.status(401).json({
                error: "Invalid token format"
            });
        }


        // Verify token

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );


        // Attach user data to request

        req.user = decoded;


        next();


    } catch(error) {

        console.error(error);

        return res.status(401).json({
            error: "Unauthorized access"
        });

    }

};


module.exports = authMiddleware;