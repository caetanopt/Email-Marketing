# Ícones das redes sociais

Servidos como ficheiros estáticos em `https://emkt.caetano.pt/social/<rede>.png`.

Nove redes: `facebook`, `instagram`, `x`, `youtube`, `linkedin`, `tiktok`,
`whatsapp`, `telegram`, `snapchat`.

Usados em três sítios, que têm de ficar sempre com a mesma lista de nomes:

| onde | o quê |
|---|---|
| `email.html` → `TE_SOCIAL_PROPRIOS` | o bloco "Redes Sociais" do editor |
| `lib/emailFooter.js` → `SOCIAL_ICON_PROPRIOS` | o rodapé legal |
| `lib/emailHtml.js` → `SOCIAL_PROPRIAS` | reescrita das campanhas já gravadas |

## Origem

Extraídos de um conjunto comprado, entregue em EPS
(`socialmedianetworkiconsset2026`). O EPS é um "DOS binary" com três secções:
PostScript vectorial, WMF e uma pré-visualização TIFF de 1612×1612 com a folha
inteira (3×3). Não há ghostscript nem biblioteca de imagem neste ambiente, por
isso o caminho foi a TIFF: descodificada à mão (paleta de 256 cores + canal
alfa, sem compressão), cada ícone recortado da sua célula pela caixa dos pixels
pintados, reduzido de 325 para 200px por média de caixa e escrito em PNG RGBA
com o `zlib` do Node.

**Licença:** o conjunto tem uma licença própria. Confirmar que cobre uso
comercial em email marketing antes de o usar em campanhas para fora — é uma
decisão de quem comprou o ficheiro, não do código.

Antes destes houve um conjunto desenhado à mão, nesta sessão, porque o TikTok
não existia em lado nenhum. Foi substituído por estes assim que o ficheiro
comprado apareceu.

## Porque é que não são uma rota de API

Foram-no durante um commit, e o deploy falhou: o projecto tinha 12 funções
serverless, que é o limite do plano, e a 13.ª rebentou o build. Como ficheiros
estáticos não contam para esse limite, são servidos pela CDN e não gastam
invocações — e cada abertura de email pede vários.

Se algum dia for preciso uma rota de API nova, o mesmo limite volta a aparecer:
ou se junta a uma rota existente por `?action=`, ou se sobe de plano. A sonda
`ícones das redes sociais existem` no `check-runtime.js` conta as funções e
avisa antes do deploy.

## Porque é que não vêm da MJML

O conjunto que a aplicação usava (`mailjet.com/images/theme/v1/icons/ico-social/`)
está datado — o X ainda é o passarinho do Twitter — e **não tem TikTok**: pedir
`tiktok.png` devolve 404, o que dentro de um email é um quadrado partido em
todos os destinatários, sem forma de corrigir depois de enviado.

As redes que faltam (pinterest, tumblr, github, vimeo, medium, soundcloud,
dribbble, xing, web) continuam a vir da MJML. Acrescentar uma é pôr o PNG nesta
pasta e o nome nas três listas da tabela acima.

## Especificação

200×200 PNG RGBA, cantos arredondados com transparência (o `border-radius:3px`
do HTML soma-se a isso). Verificados a 16, 20, 24, 32 e 48px sobre o cinzento do
rodapé (`#f1f1f1`) e sobre fundo escuro; 16px é o tamanho mínimo a que são
usados.

Os da MJML são claros, pensados para fundos escuros, e desapareciam no cinzento
do rodapé — era por isso que existia a opção de indicar uma imagem alternativa
por rede em Definições Globais. Estes vêem-se em qualquer fundo, e essa opção
deixou de ser necessária (continua a funcionar, e ganha ao ícone por omissão
quando está preenchida).
