// Tarang 1.0.0.1 — controllers/authController.js

const User            = require("../models/User");
const { generateToken } = require("../utils/jwt");

// ── POST /api/auth/register ───────────────────────────────────────────────────
const register = async (req, res) => {
  const { name, email, password } = req.body;

  const exists = await User.findOne({ email });
  if (exists) {
    return res.status(409).json({
      status: "error",
      error:  "An account with this email already exists.",
    });
  }

  const user  = await User.create({ name, email, password });
  const token = generateToken(user._id);

  res.status(201).json({
    status: "success",
    data: {
      token,
      user: {
        id:    user._id,
        name:  user.name,
        email: user.email,
        role:  user.role,
      },
    },
  });
};

// ── POST /api/auth/login ──────────────────────────────────────────────────────
const login = async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.matchPassword(password))) {
    return res.status(401).json({
      status: "error",
      error:  "Invalid email or password.",
    });
  }

  if (!user.isActive) {
    return res.status(401).json({
      status: "error",
      error:  "Account is deactivated. Contact support.",
    });
  }

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  const token = generateToken(user._id);

  res.json({
    status: "success",
    data: {
      token,
      user: {
        id:    user._id,
        name:  user.name,
        email: user.email,
        role:  user.role,
      },
    },
  });
};

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
const getMe = async (req, res) => {
  res.json({
    status: "success",
    data: { user: req.user },
  });
};

// ── PUT /api/auth/password ────────────────────────────────────────────────────
const updatePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select("+password");
  if (!(await user.matchPassword(currentPassword))) {
    return res.status(401).json({
      status: "error",
      error:  "Current password is incorrect.",
    });
  }

  user.password = newPassword;
  await user.save();

  const token = generateToken(user._id);
  res.json({
    status: "success",
    data:   { token, message: "Password updated successfully." },
  });
};

// ── PUT /api/auth/preferences ─────────────────────────────────────────────────
const updatePreferences = async (req, res) => {
  const { themePreference } = req.body;
  if (themePreference && !["dark", "light"].includes(themePreference)) {
    return res.status(400).json({ status: "error", error: "Invalid theme. Use 'dark' or 'light'." });
  }
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: { ...(themePreference && { themePreference }) } },
    { new: true }
  );
  res.json({ status: "success", data: { user } });
};

module.exports = { register, login, getMe, updatePassword };
