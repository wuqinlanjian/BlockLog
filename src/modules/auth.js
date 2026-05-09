// modules/auth.js
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

function hashPassword(password) {
    return bcrypt.hashSync(password, 10);
}

function checkPassword(password, hash) {
    return bcrypt.compareSync(password, hash);
}

function generateToken() {
    return crypto.randomBytes(16).toString("hex");
}

module.exports = { hashPassword, checkPassword, generateToken };