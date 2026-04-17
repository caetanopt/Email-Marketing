<?php

namespace Database\Seeders;

use App\Models\Brand;
use App\Models\Template;
use Illuminate\Database\Seeder;

class TemplatesSeeder extends Seeder
{
    public function run(): void
    {
        // ── Template partilhado (acessível a todas as marcas) ─────────────
        Template::firstOrCreate(
            ['name' => 'Base — Newsletter Simples'],
            [
                'brand_id'     => null,
                'is_shared'    => true,
                'description'  => 'Template genérico multi-marca. Personaliza cores via variáveis.',
                'mjml_source'  => $this->newsletterMjml(),
                'content_text' => $this->newsletterPlainText(),
            ]
        );

        Template::firstOrCreate(
            ['name' => 'Base — Promoção de Produto'],
            [
                'brand_id'     => null,
                'is_shared'    => true,
                'description'  => 'Template de destaque de um produto/serviço com CTA forte.',
                'mjml_source'  => $this->promotionMjml(),
                'content_text' => 'Descubra a nossa nova promoção. Visite {{ site_url }} para saber mais.',
            ]
        );

        // ── Template específico por marca: Caetano Retail ──────────────────
        $caetano = Brand::where('slug', 'caetano')->first();
        if ($caetano) {
            Template::firstOrCreate(
                ['name' => 'Caetano — Convite para Evento'],
                [
                    'brand_id'     => $caetano->id,
                    'is_shared'    => false,
                    'description'  => 'Template corporativo para convites de eventos Caetano.',
                    'mjml_source'  => $this->eventInviteMjml(),
                    'content_text' => 'Está convidado para o nosso evento. Confirme a sua presença em {{ event_url }}.',
                ]
            );
        }

        $this->command->info('✅ Templates MJML criados.');
    }

    private function newsletterMjml(): string
    {
        return <<<'MJML'
<mjml>
  <mj-head>
    <mj-title>Newsletter</mj-title>
    <mj-preview>{{ preview_text }}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-text font-size="15px" line-height="1.6" color="#2c3e50" />
      <mj-button background-color="#1A1A2E" color="#ffffff" font-weight="600" border-radius="6px" />
    </mj-attributes>
    <mj-style>
      .footer a { color: #8b949e; text-decoration: none; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f7fa">
    <!-- Cabeçalho -->
    <mj-section background-color="#1A1A2E" padding="24px">
      <mj-column>
        <mj-image src="{{ brand_logo_url }}" alt="{{ brand_name }}" width="160px" />
      </mj-column>
    </mj-section>

    <!-- Hero -->
    <mj-section background-color="#ffffff" padding="40px 24px 16px">
      <mj-column>
        <mj-text font-size="26px" font-weight="700" color="#1A1A2E" align="center">
          {{ headline }}
        </mj-text>
        <mj-text align="center" color="#5f6c7b">
          {{ subheadline }}
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- Corpo -->
    <mj-section background-color="#ffffff" padding="0 24px 24px">
      <mj-column>
        <mj-text>
          Olá {{ first_name }},
        </mj-text>
        <mj-text>
          {{ body_paragraph_1 }}
        </mj-text>
        <mj-text>
          {{ body_paragraph_2 }}
        </mj-text>
        <mj-button href="{{ cta_url }}" padding-top="16px">
          {{ cta_label }}
        </mj-button>
      </mj-column>
    </mj-section>

    <!-- Rodapé -->
    <mj-section background-color="#1A1A2E" padding="24px" css-class="footer">
      <mj-column>
        <mj-text color="#8b949e" font-size="12px" align="center">
          © {{ year }} {{ brand_name }}. Todos os direitos reservados.
        </mj-text>
        <mj-text color="#8b949e" font-size="12px" align="center">
          <a href="{{ unsubscribe_url }}">Cancelar subscrição</a> &nbsp;|&nbsp;
          <a href="{{ preferences_url }}">Gerir preferências</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
MJML;
    }

    private function promotionMjml(): string
    {
        return <<<'MJML'
<mjml>
  <mj-head>
    <mj-title>Promoção Especial</mj-title>
    <mj-preview>{{ preview_text }}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-button background-color="#E63946" color="#ffffff" font-weight="700" border-radius="4px" font-size="16px" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#ffffff">
    <mj-section padding="16px">
      <mj-column>
        <mj-image src="{{ brand_logo_url }}" alt="{{ brand_name }}" width="140px" />
      </mj-column>
    </mj-section>

    <mj-section padding="0">
      <mj-column>
        <mj-image src="{{ hero_image_url }}" alt="Produto" />
      </mj-column>
    </mj-section>

    <mj-section padding="32px 24px">
      <mj-column>
        <mj-text font-size="30px" font-weight="800" align="center" color="#1A1A2E">
          {{ product_name }}
        </mj-text>
        <mj-text align="center" font-size="18px" color="#5f6c7b">
          {{ product_tagline }}
        </mj-text>
        <mj-text align="center" font-size="22px" font-weight="700" color="#E63946" padding-top="12px">
          {{ price_display }}
        </mj-text>
        <mj-button href="{{ cta_url }}" padding-top="16px">
          {{ cta_label }}
        </mj-button>
      </mj-column>
    </mj-section>

    <mj-section background-color="#f5f7fa" padding="16px">
      <mj-column>
        <mj-text font-size="11px" color="#8b949e" align="center">
          Esta promoção é válida até {{ valid_until }}. Sujeito a disponibilidade.<br>
          <a href="{{ unsubscribe_url }}" style="color:#8b949e">Cancelar subscrição</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
MJML;
    }

    private function eventInviteMjml(): string
    {
        return <<<'MJML'
<mjml>
  <mj-head>
    <mj-title>Convite Caetano</mj-title>
    <mj-preview>Tem um convite especial da Caetano</mj-preview>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-button background-color="#1A1A2E" color="#ffffff" border-radius="2px" font-weight="600" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f8f9fa">
    <mj-section background-color="#1A1A2E" padding="40px 24px">
      <mj-column>
        <mj-text font-size="28px" color="#ffffff" font-weight="300" align="center" letter-spacing="2px">
          C A E T A N O
        </mj-text>
        <mj-divider border-color="#ffffff" border-width="1px" width="60px" />
        <mj-text color="#ffffff" font-size="13px" align="center" letter-spacing="3px">
          {{ event_type }}
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="#ffffff" padding="40px 24px">
      <mj-column>
        <mj-text font-size="24px" font-weight="600" color="#1A1A2E" align="center">
          {{ event_title }}
        </mj-text>
        <mj-text color="#5f6c7b" align="center">
          {{ first_name }}, temos o prazer de o convidar para este evento exclusivo.
        </mj-text>

        <mj-divider border-color="#e1e4e8" padding-top="24px" padding-bottom="24px" />

        <mj-text font-size="14px" color="#2c3e50">
          <strong>📅 Data:</strong> {{ event_date }}<br>
          <strong>🕔 Hora:</strong> {{ event_time }}<br>
          <strong>📍 Local:</strong> {{ event_location }}
        </mj-text>

        <mj-button href="{{ rsvp_url }}" padding-top="24px">
          CONFIRMAR PRESENÇA
        </mj-button>
      </mj-column>
    </mj-section>

    <mj-section background-color="#1A1A2E" padding="16px">
      <mj-column>
        <mj-text color="#8b949e" font-size="11px" align="center">
          <a href="{{ unsubscribe_url }}" style="color:#8b949e">Cancelar subscrição</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
MJML;
    }

    private function newsletterPlainText(): string
    {
        return <<<'TXT'
{{ headline }}
{{ subheadline }}

Olá {{ first_name }},

{{ body_paragraph_1 }}

{{ body_paragraph_2 }}

{{ cta_label }}: {{ cta_url }}

---
© {{ year }} {{ brand_name }}. Todos os direitos reservados.
Cancelar subscrição: {{ unsubscribe_url }}
TXT;
    }
}
