const express = require("express");
const { z } = require("zod");
const { pool } = require("../config/db");
const {
  normalizeEmail,
  normalizeRole,
  hasMinimumRole,
  getUserById,
  resolveRequestUser,
  buildAuthUserPayload,
} = require("../utils/access");
const { logActivity } = require("../utils/activity");

const router = express.Router();

const MIN_PASSWORD_LENGTH = 6;
const BOOTSTRAP_SUPER_ADMIN_EMAILS = new Set(
  String(
    process.env.BOOTSTRAP_SUPER_ADMIN_EMAILS ||
      process.env.BOOTSTRAP_ADMIN_EMAILS ||
      process.env.ROLE_MANAGER_EMAILS ||
      "admin@otakushelf.local",
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

const credentialsSchema = z.object({
  email: z
    .string({ required_error: "Email wajib diisi." })
    .trim()
    .min(1, "Email wajib diisi.")
    .email("Format email tidak valid.")
    .transform((value) => value.toLowerCase()),
  password: z
    .string({ required_error: "Password wajib diisi." })
    .min(1, "Password wajib diisi.")
    .min(
      MIN_PASSWORD_LENGTH,
      `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`,
    ),
});

function parseCredentials(body = {}) {
  const result = credentialsSchema.safeParse(body);

  if (!result.success) {
    return {
      data: null,
      error: result.error.issues[0]?.message || "Data login tidak valid.",
    };
  }

  return {
    data: result.data,
    error: null,
  };
}

function parseRole(value) {
  const normalized = normalizeRole(value);
  return ["user", "admin", "super_admin"].includes(normalized)
    ? normalized
    : null;
}

async function requireMinimumRole(req, res, minimumRole) {
  try {
    const { user, error } = await resolveRequestUser(pool, req, {
      requireToken: true,
    });

    if (error) {
      res.status(error.status).json({
        status: "error",
        message: error.message,
      });
      return null;
    }

    if (!hasMinimumRole(user.role, minimumRole)) {
      res.status(403).json({
        status: "error",
        message:
          minimumRole === "super_admin"
            ? "Akses super admin diperlukan."
            : "Akses admin atau super admin diperlukan.",
      });
      return null;
    }

    return user;
  } catch (error) {
    console.error("Auth role check error:", error.message);
    res.status(500).json({
      status: "error",
      message: "Terjadi kesalahan pada server.",
    });
    return null;
  }
}

async function getRoleCounts() {
  const [rows] = await pool.query(
    `SELECT role, COUNT(*) AS total
     FROM users
     GROUP BY role`,
  );

  return rows.reduce(
    (accumulator, row) => ({
      ...accumulator,
      [normalizeRole(row.role)]: Number(row.total || 0),
    }),
    {
      super_admin: 0,
      admin: 0,
      user: 0,
    },
  );
}

function mapActivityLogRow(row = {}) {
  return {
    id: row.id,
    userId: row.userId === null ? null : Number(row.userId),
    userEmail: row.userEmail || "User dihapus",
    userRole: row.userRole || "unknown",
    action: row.action || "",
    description: row.description || "",
    targetType: row.targetType || null,
    targetId: row.targetId === null ? null : Number(row.targetId),
    createdAt: row.createdAt || null,
  };
}

router.get("/me", async (req, res) => {
  try {
    const { user, error } = await resolveRequestUser(pool, req);

    if (error) {
      return res.status(error.status).json({
        status: "error",
        message: error.message,
      });
    }

    return res.status(200).json({
      status: "success",
      data: buildAuthUserPayload(user),
    });
  } catch (error) {
    console.error("Get current user error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Terjadi kesalahan pada server.",
    });
  }
});

router.post("/register", async (req, res) => {
  const { data, error } = parseCredentials(req.body);

  if (error) {
    return res.status(400).json({
      status: "error",
      message: error,
    });
  }

  const { email, password } = data;
  const connection = await pool.getConnection();

  try {
    const [existingUsers] = await connection.query(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email],
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        status: "error",
        message: "Email sudah terdaftar.",
      });
    }

    const [superAdminCountRows] = await connection.query(
      "SELECT COUNT(*) AS superAdminCount FROM users WHERE role = 'super_admin'",
    );
    const shouldBootstrapSuperAdmin =
      Number(superAdminCountRows[0]?.superAdminCount || 0) === 0 &&
      BOOTSTRAP_SUPER_ADMIN_EMAILS.has(normalizeEmail(email));
    const role = shouldBootstrapSuperAdmin ? "super_admin" : "user";

    const [result] = await connection.query(
      "INSERT INTO users (email, password, role) VALUES (?, ?, ?)",
      [email, password, role],
    );

    const user = await getUserById(connection, result.insertId);

    await logActivity(
      connection,
      result.insertId,
      "register",
      `Akun ${email} berhasil dibuat sebagai ${role}.`,
      {
        targetType: "user",
        targetId: result.insertId,
      },
    );

    return res.status(201).json({
      status: "success",
      message: "Registrasi berhasil. Silakan login.",
      data: buildAuthUserPayload(user),
    });
  } catch (registerError) {
    if (registerError.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        status: "error",
        message: "Email sudah terdaftar.",
      });
    }

    console.error("Register error:", registerError.message);
    return res.status(500).json({
      status: "error",
      message: "Terjadi kesalahan pada server.",
    });
  } finally {
    connection.release();
  }
});

router.post("/login", async (req, res) => {
  const { data, error } = parseCredentials(req.body);

  if (error) {
    return res.status(400).json({
      status: "error",
      message: error,
    });
  }

  const { email, password } = data;

  try {
    const [users] = await pool.query(
      "SELECT id, email, password, role FROM users WHERE email = ? LIMIT 1",
      [email],
    );

    if (users.length === 0 || password !== users[0].password) {
      return res.status(401).json({
        status: "error",
        message: "Email atau password salah.",
      });
    }

    const user = {
      id: users[0].id,
      email: users[0].email,
      role: normalizeRole(users[0].role),
    };

    await logActivity(
      pool,
      user.id,
      "login",
      `${user.email} masuk ke sistem.`,
      {
        targetType: "user",
        targetId: user.id,
      },
    );

    return res.status(200).json({
      status: "success",
      message: "Login berhasil.",
      data: buildAuthUserPayload(user),
    });
  } catch (loginError) {
    console.error("Login error:", loginError.message);
    return res.status(500).json({
      status: "error",
      message: "Terjadi kesalahan pada server.",
    });
  }
});

router.get("/users", async (req, res) => {
  const superAdminUser = await requireMinimumRole(req, res, "super_admin");

  if (!superAdminUser) {
    return;
  }

  try {
    const [users] = await pool.query(
      `SELECT id,
              email,
              role,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM users
       ORDER BY CASE role
         WHEN 'super_admin' THEN 1
         WHEN 'admin' THEN 2
         ELSE 3
       END,
       email ASC`,
    );

    const roleCounts = await getRoleCounts();

    return res.status(200).json({
      status: "success",
      data: {
        items: users.map((user) => ({
          id: user.id,
          email: user.email,
          role: normalizeRole(user.role),
          createdAt: user.createdAt || null,
          updatedAt: user.updatedAt || null,
        })),
        roleCounts,
      },
    });
  } catch (error) {
    console.error("List users error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Terjadi kesalahan pada server.",
    });
  }
});

router.patch("/users/:id/role", async (req, res) => {
  const superAdminUser = await requireMinimumRole(req, res, "super_admin");

  if (!superAdminUser) {
    return;
  }

  const targetUserId = Number.parseInt(String(req.params.id || ""), 10);
  const nextRole = parseRole(req.body?.role);

  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({
      status: "error",
      message: "ID user tidak valid.",
    });
  }

  if (!nextRole) {
    return res.status(400).json({
      status: "error",
      message: "Role tidak valid.",
    });
  }

  if (targetUserId === superAdminUser.id) {
    return res.status(400).json({
      status: "error",
      message:
        "Role akun yang sedang dipakai tidak bisa diubah dari panel ini.",
    });
  }

  try {
    const [targetRows] = await pool.query(
      "SELECT id, email, role FROM users WHERE id = ? LIMIT 1",
      [targetUserId],
    );

    const targetUser = targetRows[0];

    if (!targetUser) {
      return res.status(404).json({
        status: "error",
        message: "User tidak ditemukan.",
      });
    }

    if (normalizeRole(targetUser.role) === nextRole) {
      return res.status(200).json({
        status: "success",
        message: "Role tidak berubah.",
        data: {
          id: targetUser.id,
          email: targetUser.email,
          role: normalizeRole(targetUser.role),
        },
      });
    }

    if (
      normalizeRole(targetUser.role) === "super_admin" &&
      nextRole !== "super_admin"
    ) {
      const [superAdminCountRows] = await pool.query(
        "SELECT COUNT(*) AS superAdminCount FROM users WHERE role = 'super_admin'",
      );

      if (Number(superAdminCountRows[0]?.superAdminCount || 0) <= 1) {
        return res.status(400).json({
          status: "error",
          message: "Tidak bisa mengubah super admin terakhir ke role lain.",
        });
      }
    }

    await pool.query("UPDATE users SET role = ? WHERE id = ?", [
      nextRole,
      targetUserId,
    ]);

    await logActivity(
      pool,
      superAdminUser.id,
      "update_role",
      `${superAdminUser.email} mengubah role ${targetUser.email} menjadi ${nextRole}.`,
      {
        targetType: "user",
        targetId: targetUserId,
      },
    );

    return res.status(200).json({
      status: "success",
      message: "Role berhasil diperbarui.",
      data: {
        id: targetUser.id,
        email: targetUser.email,
        role: nextRole,
      },
    });
  } catch (error) {
    console.error("Update user role error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Terjadi kesalahan pada server.",
    });
  }
});

router.delete("/users/:id", async (req, res) => {
  const superAdminUser = await requireMinimumRole(req, res, "super_admin");

  if (!superAdminUser) {
    return;
  }

  const targetUserId = Number.parseInt(String(req.params.id || ""), 10);

  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({
      status: "error",
      message: "ID user tidak valid.",
    });
  }

  if (targetUserId === superAdminUser.id) {
    return res.status(400).json({
      status: "error",
      message: "Tidak bisa menghapus akun yang sedang dipakai.",
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [targetRows] = await connection.query(
      "SELECT id, email, role FROM users WHERE id = ? LIMIT 1",
      [targetUserId],
    );
    const targetUser = targetRows[0];

    if (!targetUser) {
      await connection.rollback();
      return res.status(404).json({
        status: "error",
        message: "User tidak ditemukan.",
      });
    }

    if (normalizeRole(targetUser.role) === "super_admin") {
      const [superAdminCountRows] = await connection.query(
        "SELECT COUNT(*) AS superAdminCount FROM users WHERE role = 'super_admin'",
      );

      if (Number(superAdminCountRows[0]?.superAdminCount || 0) <= 1) {
        await connection.rollback();
        return res.status(400).json({
          status: "error",
          message: "Tidak bisa menghapus super admin terakhir.",
        });
      }
    }

    await logActivity(
      connection,
      superAdminUser.id,
      "delete_user",
      `${superAdminUser.email} menghapus akun ${targetUser.email}.`,
      {
        targetType: "user",
        targetId: targetUserId,
      },
    );

    await connection.query("DELETE FROM users WHERE id = ?", [targetUserId]);
    await connection.commit();

    return res.status(200).json({
      status: "success",
      message: "User berhasil dihapus.",
      data: {
        id: targetUser.id,
        email: targetUser.email,
        role: normalizeRole(targetUser.role),
      },
    });
  } catch (error) {
    await connection.rollback();
    console.error("Delete user error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Terjadi kesalahan pada server.",
    });
  } finally {
    connection.release();
  }
});

router.get("/logs", async (req, res) => {
  const managerUser = await requireMinimumRole(req, res, "admin");

  if (!managerUser) {
    return;
  }

  try {
    const [rows] = await pool.query(
      `SELECT l.id,
              l.actor_user_id AS userId,
              u.email AS userEmail,
              u.role AS userRole,
              l.action,
              l.description,
              l.target_type AS targetType,
              l.target_id AS targetId,
              l.created_at AS createdAt
       FROM activity_logs l
       LEFT JOIN users u ON u.id = l.actor_user_id
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT 250`,
    );

    return res.status(200).json({
      status: "success",
      data: rows.map(mapActivityLogRow),
    });
  } catch (error) {
    console.error("List logs error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Terjadi kesalahan pada server.",
    });
  }
});

module.exports = router;
