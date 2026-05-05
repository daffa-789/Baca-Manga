require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { initDb } = require("./initDb");

async function resetDb() {
  const uploadsRoot = path.join(__dirname, "..", "..", "public", "uploads");

  fs.rmSync(uploadsRoot, { recursive: true, force: true });
  fs.mkdirSync(uploadsRoot, { recursive: true });

  await initDb({ dropDatabase: true });
  console.log("Database dan file upload berhasil direset.");
}

resetDb().catch((error) => {
  console.error("Gagal mereset database:", error.message);
  process.exit(1);
});
