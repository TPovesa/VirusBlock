server {
    listen 80;
    listen [::]:80;
    server_name sosiskibot.ru www.sosiskibot.ru;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name sosiskibot.ru www.sosiskibot.ru;

    ssl_certificate /etc/ssl/sosiskibot/fullchain.crt;
    ssl_certificate_key /etc/ssl/sosiskibot/certificate.key;
    ssl_trusted_certificate /etc/ssl/sosiskibot/certificate_ca.crt;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "same-origin" always;

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
    }

    location = /health {
        proxy_pass http://127.0.0.1:3001/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /basedata/ {
        satisfy all;
        allow 127.0.0.1;
        allow ::1;
        deny all;

        auth_basic "Restricted";
        auth_basic_user_file /etc/nginx/.htpasswd-basedata;

        alias /usr/share/phpmyadmin/;
        index index.php index.html index.htm;
    }

    location ~ ^/basedata/(.+\.php)$ {
        satisfy all;
        allow 127.0.0.1;
        allow ::1;
        deny all;

        auth_basic "Restricted";
        auth_basic_user_file /etc/nginx/.htpasswd-basedata;

        alias /usr/share/phpmyadmin/$1;
        include snippets/fastcgi-php.conf;
        fastcgi_param SCRIPT_FILENAME /usr/share/phpmyadmin/$1;
        fastcgi_pass unix:__PHP_FPM_SOCKET__;
    }

    location ~* ^/basedata/(.+\.(css|js|png|jpg|jpeg|gif|ico|svg|ttf|woff|woff2))$ {
        satisfy all;
        allow 127.0.0.1;
        allow ::1;
        deny all;

        auth_basic "Restricted";
        auth_basic_user_file /etc/nginx/.htpasswd-basedata;

        alias /usr/share/phpmyadmin/$1;
        access_log off;
        expires 1h;
    }

    location / {
        return 404;
    }
}
