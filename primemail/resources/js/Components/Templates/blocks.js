// ────────────────────────────────────────────────────────────────────────────
// Block definitions for the visual MJML builder.
// Each block has:
//   - label, icon (svg path d)
//   - defaultProps: returns initial properties for a new block
//   - schema:       array of editable fields → drives the property panel
//   - toMjml:       takes props, returns the inner MJML for this block
// The Builder wraps the whole thing in <mjml><mj-head>…<mj-body>…</mjml>.
// ────────────────────────────────────────────────────────────────────────────

export const blockTypes = {
    header: {
        label: 'Cabeçalho',
        icon:  'M4 4h16v6H4z M4 14h16v2H4z M4 18h10v2H4z',
        defaultProps: () => ({
            text:       '{{ brand_name }}',
            bgColor:    '#1A1A2E',
            textColor:  '#ffffff',
            fontSize:   20,
            fontWeight: 700,
            align:      'center',
            padding:    24,
        }),
        schema: [
            { key: 'text',       label: 'Texto',           type: 'text'   },
            { key: 'bgColor',    label: 'Cor de fundo',    type: 'color'  },
            { key: 'textColor',  label: 'Cor do texto',    type: 'color'  },
            { key: 'fontSize',   label: 'Tamanho (px)',    type: 'number' },
            { key: 'fontWeight', label: 'Espessura',       type: 'select', options: [400, 500, 600, 700, 800] },
            { key: 'align',      label: 'Alinhamento',     type: 'select', options: ['left', 'center', 'right'] },
            { key: 'padding',    label: 'Padding (px)',    type: 'number' },
        ],
        toMjml: (p) =>
`    <mj-section background-color="${p.bgColor}" padding="${p.padding}px">
      <mj-column>
        <mj-text color="${p.textColor}" font-size="${p.fontSize}px" font-weight="${p.fontWeight}" align="${p.align}">
          ${escapeMjml(p.text)}
        </mj-text>
      </mj-column>
    </mj-section>`,
    },

    heading: {
        label: 'Título',
        icon:  'M5 4v16 M19 4v16 M5 12h14',
        defaultProps: () => ({
            text:       'Olá {{ first_name }},',
            level:      'h2',
            color:      '#1A1A2E',
            bgColor:    '#ffffff',
            fontSize:   24,
            fontWeight: 700,
            align:      'left',
            padding:    '24px 24px 8px',
        }),
        schema: [
            { key: 'text',       label: 'Texto',         type: 'text'   },
            { key: 'level',      label: 'Nível',         type: 'select', options: ['h1', 'h2', 'h3'] },
            { key: 'color',      label: 'Cor',           type: 'color'  },
            { key: 'bgColor',    label: 'Cor de fundo',  type: 'color'  },
            { key: 'fontSize',   label: 'Tamanho (px)',  type: 'number' },
            { key: 'fontWeight', label: 'Espessura',     type: 'select', options: [400, 500, 600, 700, 800] },
            { key: 'align',      label: 'Alinhamento',   type: 'select', options: ['left', 'center', 'right'] },
            { key: 'padding',    label: 'Padding',       type: 'text'   },
        ],
        toMjml: (p) =>
`    <mj-section background-color="${p.bgColor}" padding="${p.padding}">
      <mj-column>
        <mj-text font-size="${p.fontSize}px" font-weight="${p.fontWeight}" color="${p.color}" align="${p.align}">
          ${escapeMjml(p.text)}
        </mj-text>
      </mj-column>
    </mj-section>`,
    },

    text: {
        label: 'Texto',
        icon:  'M4 6h16 M4 12h16 M4 18h10',
        defaultProps: () => ({
            text:       'Escreve aqui o teu conteúdo. Podes usar variáveis como {{ first_name }}.',
            color:      '#475569',
            bgColor:    '#ffffff',
            fontSize:   14,
            lineHeight: 24,
            align:      'left',
            padding:    '8px 24px',
        }),
        schema: [
            { key: 'text',       label: 'Texto',          type: 'textarea' },
            { key: 'color',      label: 'Cor',            type: 'color'    },
            { key: 'bgColor',    label: 'Cor de fundo',   type: 'color'    },
            { key: 'fontSize',   label: 'Tamanho (px)',   type: 'number'   },
            { key: 'lineHeight', label: 'Altura linha',   type: 'number'   },
            { key: 'align',      label: 'Alinhamento',    type: 'select', options: ['left', 'center', 'right', 'justify'] },
            { key: 'padding',    label: 'Padding',        type: 'text'     },
        ],
        toMjml: (p) =>
`    <mj-section background-color="${p.bgColor}" padding="${p.padding}">
      <mj-column>
        <mj-text font-size="${p.fontSize}px" line-height="${p.lineHeight}px" color="${p.color}" align="${p.align}">
          ${escapeMjml(p.text).replace(/\n/g, '<br/>')}
        </mj-text>
      </mj-column>
    </mj-section>`,
    },

    button: {
        label: 'Botão',
        icon:  'M3 10h18 M3 14h18 M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z',
        defaultProps: () => ({
            label:    'Saber mais',
            href:     '{{ cta_url }}',
            bgColor:  '#1A1A2E',
            color:    '#ffffff',
            sectionBg:'#ffffff',
            radius:   6,
            padding:  '16px 24px',
            align:    'center',
            fontSize: 14,
        }),
        schema: [
            { key: 'label',     label: 'Texto do botão',  type: 'text'   },
            { key: 'href',      label: 'URL (href)',      type: 'text'   },
            { key: 'bgColor',   label: 'Cor de fundo',    type: 'color'  },
            { key: 'color',     label: 'Cor do texto',    type: 'color'  },
            { key: 'sectionBg', label: 'Fundo da secção', type: 'color'  },
            { key: 'radius',    label: 'Raio (px)',       type: 'number' },
            { key: 'fontSize',  label: 'Tamanho (px)',    type: 'number' },
            { key: 'align',     label: 'Alinhamento',     type: 'select', options: ['left', 'center', 'right'] },
            { key: 'padding',   label: 'Padding secção',  type: 'text'   },
        ],
        toMjml: (p) =>
`    <mj-section background-color="${p.sectionBg}" padding="${p.padding}">
      <mj-column>
        <mj-button background-color="${p.bgColor}" color="${p.color}" border-radius="${p.radius}px" font-size="${p.fontSize}px" align="${p.align}" href="${p.href}">
          ${escapeMjml(p.label)}
        </mj-button>
      </mj-column>
    </mj-section>`,
    },

    image: {
        label: 'Imagem',
        icon:  'M4 4h16v16H4z M4 14l4-4 4 4 6-6 2 2 M9 9a1 1 0 100-2 1 1 0 000 2z',
        defaultProps: () => ({
            src:      'https://placehold.co/600x300/1A1A2E/ffffff?text=Imagem',
            alt:      'Imagem',
            href:     '',
            width:    600,
            bgColor:  '#ffffff',
            padding:  '0',
            align:    'center',
        }),
        schema: [
            { key: 'src',     label: 'URL da imagem',  type: 'text'   },
            { key: 'alt',     label: 'Texto alt.',     type: 'text'   },
            { key: 'href',    label: 'Link (opcional)',type: 'text'   },
            { key: 'width',   label: 'Largura máx.',   type: 'number' },
            { key: 'bgColor', label: 'Cor de fundo',   type: 'color'  },
            { key: 'padding', label: 'Padding',        type: 'text'   },
            { key: 'align',   label: 'Alinhamento',    type: 'select', options: ['left', 'center', 'right'] },
        ],
        toMjml: (p) => {
            const hrefAttr = p.href ? ` href="${p.href}"` : '';
            return `    <mj-section background-color="${p.bgColor}" padding="${p.padding}">
      <mj-column>
        <mj-image src="${p.src}" alt="${escapeMjml(p.alt)}"${hrefAttr} width="${p.width}px" align="${p.align}" />
      </mj-column>
    </mj-section>`;
        },
    },

    divider: {
        label: 'Separador',
        icon:  'M3 12h18',
        defaultProps: () => ({
            color:    '#e2e8f0',
            width:    1,
            bgColor:  '#ffffff',
            padding:  '0 24px',
        }),
        schema: [
            { key: 'color',   label: 'Cor da linha', type: 'color'  },
            { key: 'width',   label: 'Espessura',    type: 'number' },
            { key: 'bgColor', label: 'Cor de fundo', type: 'color'  },
            { key: 'padding', label: 'Padding',      type: 'text'   },
        ],
        toMjml: (p) =>
`    <mj-section background-color="${p.bgColor}" padding="${p.padding}">
      <mj-column>
        <mj-divider border-color="${p.color}" border-width="${p.width}px" />
      </mj-column>
    </mj-section>`,
    },

    spacer: {
        label: 'Espaço',
        icon:  'M12 4v16 M8 4h8 M8 20h8',
        defaultProps: () => ({
            height:  24,
            bgColor: '#ffffff',
        }),
        schema: [
            { key: 'height',  label: 'Altura (px)',  type: 'number' },
            { key: 'bgColor', label: 'Cor de fundo', type: 'color'  },
        ],
        toMjml: (p) =>
`    <mj-section background-color="${p.bgColor}" padding="0">
      <mj-column>
        <mj-spacer height="${p.height}px" />
      </mj-column>
    </mj-section>`,
    },

    footer: {
        label: 'Rodapé',
        icon:  'M4 4h16v12H4z M4 18h16v2H4z',
        defaultProps: () => ({
            text:    'Recebeste este email porque subscreveste a {{ brand_name }}.',
            unsubText: 'Cancelar subscrição',
            unsubUrl:  '{{ unsubscribe_url }}',
            bgColor:   '#1A1A2E',
            color:     '#8b949e',
            fontSize:  11,
            padding:   16,
        }),
        schema: [
            { key: 'text',      label: 'Texto',           type: 'textarea' },
            { key: 'unsubText', label: 'Texto unsub.',    type: 'text'     },
            { key: 'unsubUrl',  label: 'URL unsub.',      type: 'text'     },
            { key: 'bgColor',   label: 'Cor de fundo',    type: 'color'    },
            { key: 'color',     label: 'Cor do texto',    type: 'color'    },
            { key: 'fontSize',  label: 'Tamanho (px)',    type: 'number'   },
            { key: 'padding',   label: 'Padding (px)',    type: 'number'   },
        ],
        toMjml: (p) =>
`    <mj-section background-color="${p.bgColor}" padding="${p.padding}px">
      <mj-column>
        <mj-text color="${p.color}" font-size="${p.fontSize}px" align="center">
          ${escapeMjml(p.text)}<br/>
          <a href="${p.unsubUrl}" style="color:${p.color}">${escapeMjml(p.unsubText)}</a>
        </mj-text>
      </mj-column>
    </mj-section>`,
    },
};

// ── helpers ───────────────────────────────────────────────────────────────────

function escapeMjml(s = '') {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let nextId = 1;
export function newBlock(type) {
    return {
        id:    `${Date.now()}-${nextId++}`,
        type,
        props: blockTypes[type].defaultProps(),
    };
}

// Compose the full MJML document from the blocks list.
export function blocksToMjml(blocks, opts = {}) {
    const bg     = opts.bodyBg     ?? '#f5f7fa';
    const fontFamily = opts.fontFamily ?? 'Helvetica, Arial, sans-serif';
    const inner = blocks.map((b) => blockTypes[b.type].toMjml(b.props)).join('\n\n');

    return `<mjml>
  <mj-head>
    <mj-title>{{ subject }}</mj-title>
    <mj-preview>{{ preview_text }}</mj-preview>
    <mj-attributes>
      <mj-all font-family="${fontFamily}" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="${bg}">
${inner}
  </mj-body>
</mjml>`;
}

// Default starter blocks for new templates.
export function defaultBlocks() {
    return [
        newBlock('header'),
        newBlock('heading'),
        newBlock('text'),
        newBlock('button'),
        newBlock('footer'),
    ];
}
