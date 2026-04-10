<?php

return [
    /*
     * Algoritmo de hashing para passwords.
     * Argon2id é a escolha moderna e segura (memory-hard, resistente a GPU attacks).
     */
    'driver' => 'argon2id',

    'bcrypt' => [
        'rounds' => env('BCRYPT_ROUNDS', 12),
    ],

    'argon' => [
        'memory'  => env('ARGON_MEMORY', 65536),   // 64MB
        'threads' => env('ARGON_THREADS', 2),
        'time'    => env('ARGON_TIME', 4),
    ],
];
