# Escolher verificações seguras

**Não executar banco, migrations, seeds, Docker, VPS, providers ou envios reais por causa do setup Codex.** Os comandos abaixo têm escopos diferentes; nenhum libera publicação por si só.

## Sem aplicativo ou banco

Executar a partir de `C:\App Whats`:

```powershell
node --check scripts/check-codex-setup.cjs
node --test scripts/codex-setup-check.test.cjs
node scripts/check-codex-setup.cjs --check
node scripts/check-codex-setup.cjs --pure-tests
```

O check estático lê documentos, verifica links locais e compara hashes protegidos com o snapshot anterior à configuração. O snapshot fica em `backups/codex-toolkit-20261023/protected-before.json`; ele não contém conteúdo de credenciais, somente hashes e caminhos locais. Se for removido, a verificação informa a ausência, sem inventar uma nova referência.

Os testes puros são somente `identity-policy.test.cjs` e `identity-crypto.test.cjs`, previamente lidos: política de vínculo e criptografia, sem Prisma ou serviços. O executor remove variáveis herdadas de banco, provedores e opções Node dos processos filhos. Isso não substitui um sandbox nem valida fluxos HTTP/SQL.

## Exigem outro escopo de autorização

| Comando/ação existente | Efeito relevante |
| --- | --- |
| `local-validation.cjs unit` / `browser` | Pode alterar fixtures e usar PostgreSQL/servidores locais |
| `local-validation.cjs attendance` / `attendance-baseline` | Executa `prisma db push` e seed em schema descartável |
| `local-validation.cjs crm` | Executa toda a suíte CRM; não assumir ausência de I/O sem rever os testes |
| `start-local.cjs` | Inicia serviços de prévia e prepara dados sintéticos |
| `local-validation.cjs assets` / `build` | Grava artefatos; build não comprova ausência de chamadas em todas as rotas |
| `local-validation.cjs types` / `lint` | Usam a configuração e dependências do CRM; lint atual é apenas dos arquivos selecionados |
| Scripts de deploy, SSH, migrations, seed ou recuperação | Não usar como smoke test do ambiente |

## Evidência e limites

[O resumo de 21/10](../local-validation-summary.json) registra 318 testes CRM, 119 de integração e 58 cenários de navegador aprovados naquela revisão. A suíte legada tinha 153 falhas, iguais antes/depois. Esses resultados não foram reproduzidos pelo setup Codex de 23/10 e não significam homologação da base atual.

Não criar outro linter, impor teto de 350 linhas ou refatorar arquivos do app nesta etapa. Antes de regras novas: medir violações e custo, selecionar regras pertinentes e preservar a proteção existente. Prisma 6 não deve receber configuração de Prisma 7 por suposição.

Após mudança funcional autorizada, escolher regressões pelo risco: empresa/conta, permissões, concorrência, ordenação, nova mensagem, clique de botões, rolagem e troca de contato. Não inferir latência real de webhook a partir de mocks ou do tempo de lista.
