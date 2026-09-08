# Ícones das redes sociais

Servidos como ficheiros estáticos em `https://emkt.caetano.pt/social/<rede>.png`.
Usados pelo bloco "Redes Sociais" do editor (`teSocialIconUrl` em `email.html`)
e pelo rodapé legal (`SOCIAL_ICON_DEFAULT` em `lib/emailFooter.js`).

## Porque é que não são uma rota de API

Foram-no durante um commit, e o deploy falhou: o projecto tinha 12 funções
serverless, que é o limite do plano, e a 13.ª rebentou o build. Como ficheiros
estáticos não contam para esse limite, são servidos pela CDN e não gastam
invocações — e o endereço fica mais curto.

Se algum dia for preciso uma rota de API nova, o mesmo limite volta a aparecer:
ou se junta a uma rota existente por `?action=`, ou se sobe de plano.

## Porque é que não vêm da MJML

O conjunto que a aplicação usava (`mailjet.com/images/theme/v1/icons/ico-social/`)
está datado — o X ainda é o passarinho do Twitter, o Facebook e o Instagram são
de identidades anteriores — e **não tem TikTok**: pedir `tiktok.png` devolve 404,
o que dentro de um email é um quadrado partido em todos os destinatários, sem
forma de corrigir depois de enviado.

As redes que a empresa não usa (pinterest, tumblr, github, vimeo, medium,
soundcloud, dribbble, xing, snapchat, web) continuam a vir da MJML. Acrescentar
uma é pôr o PNG nesta pasta e o nome nas duas listas `SOCIAL_ICON_PROPRIOS` /
`TE_SOCIAL_PROPRIOS`.

## Especificação

200×200 PNG, cor da marca em fundo cheio (a sangrar — o arredondamento é dado
pelo CSS de quem os mostra, `border-radius:3px`), glifo branco a ocupar cerca de
60% do quadrado. Verificados a 16, 20, 24, 32 e 48px sobre o cinzento do rodapé
(`#f1f1f1`) e sobre fundo escuro. 16px é o tamanho mínimo a que são usados.

Os anteriores eram claros, pensados para fundos escuros, e desapareciam no
cinzento do rodapé — era por isso que existia a opção de indicar uma imagem
alternativa por rede em Definições Globais. Estes vêem-se em qualquer fundo.

Foram desenhados em SVG e rasterizados com o Chromium; o gerador está no
histórico desta sessão e não é preciso para os servir.
