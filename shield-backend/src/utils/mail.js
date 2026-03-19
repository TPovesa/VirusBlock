const nodemailer = require('nodemailer');

let cachedTransporter = null;

function isMailConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
    if (!isMailConfigured()) {
        const error = new Error('Mail service is not configured');
        error.code = 'MAIL_NOT_CONFIGURED';
        throw error;
    }

    if (!cachedTransporter) {
        cachedTransporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: String(process.env.SMTP_SECURE || 'false') === 'true',
            connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT_MS || '15000', 10),
            greetingTimeout: parseInt(process.env.SMTP_GREETING_TIMEOUT_MS || '10000', 10),
            socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT_MS || '20000', 10),
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }

    return cachedTransporter;
}

async function sendMail({ to, subject, text, html }) {
    const transporter = getTransporter();
    await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to,
        subject,
        text,
        html
    });
}

function queueMailTask(label, task) {
    setImmediate(async () => {
        const startedAt = Date.now();
        try {
            await task();
            console.info(`[mail-task:${label}] delivered in ${Date.now() - startedAt}ms`);
        } catch (error) {
            console.error(`[mail-task:${label}] failed:`, error);
        }
    });
}

module.exports = {
    isMailConfigured,
    sendMail,
    queueMailTask
};
