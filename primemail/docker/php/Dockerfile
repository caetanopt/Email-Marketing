FROM php:8.3-fpm

# System dependencies
RUN apt-get update && apt-get install -y \
    git curl libpng-dev libonig-dev libxml2-dev libzip-dev \
    zip unzip libicu-dev libpq-dev redis-tools gnupg ca-certificates \
    && docker-php-ext-install \
        pdo_mysql mbstring exif pcntl bcmath zip intl \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Node.js 20.x + MJML CLI (compilação de templates de email)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g mjml@4 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# PHP config
COPY docker/php/php.ini /usr/local/etc/php/conf.d/primemail.ini

WORKDIR /var/www

USER www-data
