const mysql2 = require('mysql2/promise');
require('dotenv').config();

const pool = mysql2.createPool({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME || 'shield_antivirus',
    user:     process.env.DB_USER || 'shield_api',
    password: process.env.DB_PASS,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
});

module.exports = pool;
