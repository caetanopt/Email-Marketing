<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Binário MJML
    |--------------------------------------------------------------------------
    | Caminho para o executável mjml. No container Docker está em PATH,
    | em desenvolvimento local poderá ser necessário caminho absoluto.
    */
    'binary' => env('MJML_BINARY', 'mjml'),

    /*
    |--------------------------------------------------------------------------
    | Timeout de compilação (segundos)
    |--------------------------------------------------------------------------
    | Templates complexos podem demorar alguns segundos. 30s é seguro.
    */
    'timeout' => env('MJML_TIMEOUT', 30),

    /*
    |--------------------------------------------------------------------------
    | Minificação
    |--------------------------------------------------------------------------
    | Reduz o tamanho do HTML final. Recomendado true em produção.
    */
    'minify' => env('MJML_MINIFY', true),

    /*
    |--------------------------------------------------------------------------
    | Cache de compilação
    |--------------------------------------------------------------------------
    | Duração (minutos) do cache em Redis do HTML compilado. Chave = SHA-256
    | do MJML source, pelo que templates idênticos só compilam uma vez.
    */
    'cache_minutes' => env('MJML_CACHE_MINUTES', 60),
];
