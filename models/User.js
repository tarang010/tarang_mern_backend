// Tarang 1.0.0.1 — models/User.js

const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String, required: true, trim: true, maxlength: 80,
    },
    email: {
      type: String, required: true, unique: true,
      lowercase: true, trim: true,
    },
    password: {
      type: String, required: true, minlength: 6, select: false,
    },
    role: {
      type: String, enum: ["user", "admin"], default: "user",
    },
    isActive: { type: Boolean, default: true },
    themePreference: { type: String, enum: ["dark", "light"], default: "dark" },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare plain password with hash
userSchema.methods.matchPassword = async function (plain) {
  return bcrypt.compare(plain, this.password);
};

// Never return password in JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
