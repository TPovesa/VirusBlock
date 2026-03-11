#!/bin/bash

set -e

if [[ "${EUID}" -ne 0 ]]; then
    echo "Run this script as root."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${APP_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
DB_NAME="${DB_NAME:-shield_auth}"
DB_USER="${DB_USER:-fatalerror}"
DB_PASS="${DB_PASS:-$(openssl rand -base64 24 | tr -d '\n')}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '\n')}"
PHPMYADMIN_VERSION="${PHPMYADMIN_VERSION:-5.2.2}"
SSL_SOURCE_DIR="${SSL_SOURCE_DIR:-/root/Heroku/modules/ssl}"
SSL_TARGET_DIR="${SSL_TARGET_DIR:-/etc/ssl/sosiskibot}"

echo "[1/8] Installing system packages..."
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    nginx mysql-server php-fpm php-mysql php-cli php-curl php-xml php-mbstring php-zip \
    unzip curl ca-certificates certbot python3-certbot-nginx ufw apache2-utils

echo "[2/8] Installing Node.js 20 and PM2..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2

echo "[3/8] Enabling MySQL..."
systemctl start mysql
systemctl enable mysql

echo "[4/8] Preparing database and restricted DB user..."
mysql -u root <<MYSQL_SCRIPT
CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
MYSQL_SCRIPT

sed "s/shield_auth/${DB_NAME}/g" "${APP_ROOT}/scripts/schema.sql" | mysql -u root

echo "[5/8] Writing backend env file..."
install -d -m 0755 "${APP_ROOT}"
cat > "${APP_ROOT}/.env" <<ENV_FILE
PORT=3001
DB_HOST=localhost
DB_PORT=3306
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
JWT_SECRET=${JWT_SECRET}
NODE_ENV=production
CORS_ORIGIN=https://sosiskibot.ru,https://www.sosiskibot.ru
TRUST_PROXY=1
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=30
MAX_LOGIN_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15
ENV_FILE

echo "[6/8] Installing phpMyAdmin..."
curl -fsSL "https://files.phpmyadmin.net/phpMyAdmin/${PHPMYADMIN_VERSION}/phpMyAdmin-${PHPMYADMIN_VERSION}-all-languages.tar.gz" \
    | tar xz -C /usr/share
ln -sfn "/usr/share/phpMyAdmin-${PHPMYADMIN_VERSION}-all-languages" /usr/share/phpmyadmin
mkdir -p /usr/share/phpmyadmin/tmp
chown -R www-data:www-data /usr/share/phpmyadmin/tmp

cat > /usr/share/phpmyadmin/config.inc.php <<PHP_CONFIG
<?php
\$cfg['blowfish_secret'] = '$(openssl rand -hex 16)';
\$i = 1;
\$cfg['Servers'][\$i]['auth_type'] = 'cookie';
\$cfg['Servers'][\$i]['host'] = 'localhost';
\$cfg['Servers'][\$i]['compress'] = false;
\$cfg['Servers'][\$i]['AllowNoPassword'] = false;
\$cfg['TempDir'] = '/usr/share/phpmyadmin/tmp';
PHP_CONFIG

echo "[7/8] Configuring nginx, PHP-FPM and firewall..."
if [[ ! -f "${SSL_SOURCE_DIR}/fullchain.crt" || ! -f "${SSL_SOURCE_DIR}/certificate.key" || ! -f "${SSL_SOURCE_DIR}/certificate_ca.crt" ]]; then
    echo "SSL files not found in ${SSL_SOURCE_DIR}"
    exit 1
fi

install -d -m 0700 "${SSL_TARGET_DIR}"
install -m 0644 "${SSL_SOURCE_DIR}/fullchain.crt" "${SSL_TARGET_DIR}/fullchain.crt"
install -m 0600 "${SSL_SOURCE_DIR}/certificate.key" "${SSL_TARGET_DIR}/certificate.key"
install -m 0644 "${SSL_SOURCE_DIR}/certificate_ca.crt" "${SSL_TARGET_DIR}/certificate_ca.crt"

PHP_FPM_SOCKET="$(find /run/php -maxdepth 1 -type s -name 'php*-fpm.sock' | head -n 1)"
if [[ -z "${PHP_FPM_SOCKET}" ]]; then
    echo "PHP-FPM socket not found."
    exit 1
fi

sed "s#__PHP_FPM_SOCKET__#${PHP_FPM_SOCKET}#g" \
    "${APP_ROOT}/deploy/nginx/shield-auth.conf.tpl" \
    > /etc/nginx/sites-available/shield-auth.conf

ln -sfn /etc/nginx/sites-available/shield-auth.conf /etc/nginx/sites-enabled/shield-auth.conf
rm -f /etc/nginx/sites-enabled/default
htpasswd -bc /etc/nginx/.htpasswd-basedata basedata_admin "${ADMIN_PASSWORD}"

nginx -t
systemctl enable nginx
systemctl restart nginx

ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

echo "[8/8] Ready for npm install and PM2 startup."

cat <<EOF
Setup complete.

Backend root: ${APP_ROOT}
DB name: ${DB_NAME}
DB user: ${DB_USER}
DB password: ${DB_PASS}
phpMyAdmin basic auth user: basedata_admin
phpMyAdmin basic auth password: ${ADMIN_PASSWORD}

Next commands:
  cd ${APP_ROOT}
  npm install
  npm run pm2:start
  pm2 save
  certbot renew --dry-run
EOF
