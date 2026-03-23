// Tarang 1.0.0.1 — routes/authRoutes.js

const express = require("express");
const { body } = require("express-validator");
const router  = express.Router();
const { protect } = require("../middleware/auth");
const {
  register, login, getMe, updatePassword,
} = require("../controllers/authController");

const validateRegister = [
  body("name").trim().notEmpty().withMessage("Name is required."),
  body("email").isEmail().withMessage("Valid email required."),
  body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters."),
];

const validateLogin = [
  body("email").isEmail().withMessage("Valid email required."),
  body("password").notEmpty().withMessage("Password is required."),
];

router.post("/register", validateRegister, register);
router.post("/login",    validateLogin,    login);
router.get( "/me",       protect,          getMe);
router.put( "/password",    protect, updatePassword);

module.exports = router;
