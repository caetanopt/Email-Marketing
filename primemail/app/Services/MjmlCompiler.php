<?php

namespace App\Services;

use App\Exceptions\MjmlCompilationException;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\Process\Exception\ProcessFailedException;
use Symfony\Component\Process\Process;

/**
 * Compila código MJML para HTML cross-client responsivo via Node MJML CLI.
 *
 * O binário mjml está instalado no container PHP (ver docker/php/Dockerfile).
 * Para cenários de escala, pode ser movido para um microserviço dedicado
 * sem alterar este contrato público.
 */
class MjmlCompiler
{
    public function __construct(
        private readonly string $binary       = 'mjml',
        private readonly int    $timeout      = 30,
        private readonly bool   $validateOnly = false,
        private readonly bool   $minify       = true,
    ) {}

    /**
     * Compila MJML → HTML. Lança MjmlCompilationException em caso de erro.
     *
     * @param  string  $mjml    Código MJML fonte
     * @param  bool    $useCache  Se true, cacheia em Redis por 1h (hash do input)
     * @return string  HTML compilado
     */
    public function compile(string $mjml, bool $useCache = true): string
    {
        $trimmed = trim($mjml);
        if ($trimmed === '') {
            throw new MjmlCompilationException('Código MJML vazio.');
        }

        if ($useCache) {
            $cacheKey = 'mjml.compiled.' . hash('sha256', $trimmed);
            if ($cached = Cache::get($cacheKey)) {
                return $cached;
            }
        }

        $args = [$this->binary, '-i', '-s'];
        if ($this->validateOnly) $args[] = '--validate';
        if ($this->minify)       $args[] = '--config.minify=true';

        $process = new Process($args);
        $process->setTimeout($this->timeout);
        $process->setInput($trimmed);

        try {
            $process->mustRun();
        } catch (ProcessFailedException $e) {
            throw new MjmlCompilationException(
                message:    'Falha a compilar MJML: ' . trim($process->getErrorOutput()),
                mjmlSource: $trimmed,
                stderr:     $process->getErrorOutput(),
            );
        }

        $html = trim($process->getOutput());

        if ($html === '') {
            throw new MjmlCompilationException(
                message:    'MJML compilou mas retornou HTML vazio.',
                mjmlSource: $trimmed,
            );
        }

        if ($useCache) {
            Cache::put($cacheKey, $html, now()->addHour());
        }

        return $html;
    }

    /**
     * Valida sintaxe MJML sem devolver HTML. True = válido, false = inválido.
     */
    public function validate(string $mjml): bool
    {
        try {
            $this->compile($mjml, useCache: false);
            return true;
        } catch (MjmlCompilationException) {
            return false;
        }
    }
}
