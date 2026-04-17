<?php

namespace Tests\Unit;

use App\Exceptions\MjmlCompilationException;
use App\Services\MjmlCompiler;
use Tests\TestCase;

class MjmlCompilerTest extends TestCase
{
    /**
     * Só corre se o binário mjml estiver disponível (presente em CI e Docker).
     */
    private function skipIfMjmlMissing(): void
    {
        if (!shell_exec('command -v mjml')) {
            $this->markTestSkipped('Binário mjml não instalado.');
        }
    }

    public function test_compiles_valid_mjml_to_html(): void
    {
        $this->skipIfMjmlMissing();

        $compiler = new MjmlCompiler();
        $html = $compiler->compile('<mjml><mj-body><mj-section><mj-column><mj-text>Olá</mj-text></mj-column></mj-section></mj-body></mjml>');

        $this->assertStringContainsString('<html', $html);
        $this->assertStringContainsString('Olá', $html);
    }

    public function test_throws_on_empty_input(): void
    {
        $this->expectException(MjmlCompilationException::class);
        (new MjmlCompiler())->compile('   ');
    }

    public function test_throws_on_invalid_mjml(): void
    {
        $this->skipIfMjmlMissing();

        $this->expectException(MjmlCompilationException::class);
        (new MjmlCompiler())->compile('<mjml><invalid-tag>broken</invalid-tag></mjml>', useCache: false);
    }

    public function test_validate_returns_true_for_valid_mjml(): void
    {
        $this->skipIfMjmlMissing();

        $compiler = new MjmlCompiler();
        $this->assertTrue($compiler->validate('<mjml><mj-body><mj-section><mj-column><mj-text>ok</mj-text></mj-column></mj-section></mj-body></mjml>'));
    }
}
