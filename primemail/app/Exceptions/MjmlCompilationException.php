<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Lançada quando o MJML CLI falha a compilar uma fonte.
 * Contém a saída stderr do MJML para diagnóstico.
 */
class MjmlCompilationException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $mjmlSource = '',
        public readonly string $stderr = '',
    ) {
        parent::__construct($message);
    }
}
