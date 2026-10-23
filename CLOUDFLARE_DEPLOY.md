# Guia de Publicação no Cloudflare Pages ⚡

O projeto está **100% pronto, testado e otimizado** para publicação no **Cloudflare Pages**.

### Correções Recentes Aplicadas para o Cloudflare Pages:
1. **Remoção do `bun.lock`**: Corrigido o erro `Unknown lockfile version: failed to parse lockfile: 'bun.lock'`. O Cloudflare agora usa o gerenciador padrão `npm` com `package-lock.json` e Node.js 20/22.
2. **Remoção do `wrangler.toml` conflitante**: Corrigido o erro `Running configuration file validation for Pages: Configuration file for Pages projects does not support "build"`. O Cloudflare Pages compila diretamente com os parâmetros nativos do Vite sem conflito de arquivo wrangler.
3. **PWA 100% Offline**: Service Worker registrado para cache completo da aplicação, permitindo abrir e operar no celular mesmo sem qualquer sinal de internet.

---

## Como Fazer o Deploy no Cloudflare Pages (Passo a Passo)

### Método 1: Pelo Painel do Cloudflare com GitHub / GitLab (Recomendado)

1. Faça o commit e push do projeto para seu repositório no **GitHub** ou **GitLab**.
2. Acesse o painel da **[Cloudflare](https://dash.cloudflare.com/)**.
3. No menu lateral, clique em **Workers & Pages** (ou **Compute**) > **Create Application** > selecione a aba **Pages** > **Connect to Git**.
4. Selecione o repositório `SPDA-` (ou o nome do seu repositório).
5. Na tela de **Build settings** (Configurações de compilação):
   - **Framework preset**: Selecione `Vite` (ou deixe em `None`)
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/` (deixe em branco ou padrão)
6. Em **Environment variables (build)** (Variáveis de ambiente):
   - Adicione: `NODE_VERSION` = `20`
7. Clique no botão azul **Save and Deploy**.
8. O Cloudflare instalará com `npm install`, executará `npm run build` e em poucos segundos seu laudo estará no ar com link seguro `*.pages.dev` e certificado SSL gratuito!

---

### Método 2: Upload Direto dos Arquivos da Pasta `dist` (Sem Git)

Se preferir não usar Git:

1. No seu computador, gere a pasta de produção:
   ```bash
   npm run build
   ```
2. No painel da Cloudflare: vá em **Workers & Pages** > **Create Application** > **Pages** > **Upload assets**.
3. Dê um nome ao seu projeto (ex: `laudo-spda`).
4. Arraste a pasta `dist` inteira gerada para a tela do navegador e clique em **Deploy Site**.

---

### Método 3: Publicação via Terminal (Wrangler CLI)

1. No seu terminal:
   ```bash
   npx wrangler login
   npm run build
   npx wrangler pages deploy dist --project-name=laudo-spda
   ```
