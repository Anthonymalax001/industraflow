const express = require("express");
const cors = require("cors");

require("dotenv").config();
require("./db");

const authRoutes = require("./routes/auth");
const companyRoutes = require("./routes/companies");
const projectRoutes = require("./routes/projects");
const contractorRoutes = require("./routes/contractors");
const workerRoutes = require("./routes/workers");
const workerAssignmentRoutes = require("./routes/workerAssignments");
const workerCertificationRoutes = require("./routes/workerCertifications");
const supplierRoutes = require("./routes/suppliers");

const app = express();


app.use(cors());

app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/contractors", contractorRoutes);
app.use("/api/workers", workerRoutes);
app.use("/api/worker-assignments", workerAssignmentRoutes);
app.use("/api/worker-certifications", workerCertificationRoutes);
app.use("/api/suppliers", supplierRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "IndustraFlow API running 🚀"
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`IndustraFlow server running on port ${PORT}`);
});