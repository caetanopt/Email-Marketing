<?php

namespace App\Providers;

use App\Services\MjmlCompiler;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Singleton para partilhar cache de processos entre compilações
        $this->app->singleton(MjmlCompiler::class, function () {
            return new MjmlCompiler(
                binary:  config('mjml.binary', 'mjml'),
                timeout: (int) config('mjml.timeout', 30),
                minify:  (bool) config('mjml.minify', true),
            );
        });
    }

    public function boot(): void
    {
        //
    }
}
