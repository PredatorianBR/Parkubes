---
name: testing_protocol
description: Diretrizes obrigatórias para testes e depuração no Parkubes
---

# Protocolo de Testes - Parkubes

Sempre que for solicitado a testar uma funcionalidade, siga rigorosamente estas etapas de configuração de ambiente.

## 1. Configurações Visuais Mandatórias
- **Ativar `debugMode`**: Garante acesso às ferramentas de inspeção.
- **Ativar `showGrid`**: Visibilidade da grade de voxels.
- **Ativar `showCollision`**: Se o teste envolver colisão, a grade de colisão deve estar visível.

## 2. Manipulação de Cenário e Variáveis
- **Liberdade de Edição**: Modifique livremente o `App.tsx` ou estados locais para facilitar o teste (ex: aumentar velocidade do player, mudar gravidade).
- **Isolamento de Elementos**: O mapa deve conter apenas o que é essencial para o teste.
- **Teste de Movimentação (Andar)**: Sempre que testar a movimentação básica de andar, remova **todos** os objetos do mapa, deixando-o completamente vazio para evitar interferências.

## 3. Fluxo de Trabalho de Teste
1. Identifique o componente/função a ser testado.
2. Aplique as configurações acima no `App.tsx` ou nos arquivos de utilitários (`levelGen.ts`).
3. Execute o comando de teste ou observe o ambiente local.
4. Documente os resultados.
5. Reverte as alterações de "ambiente de teste" antes de entregar a tarefa, exceto se o usuário pedir para mantê-las.
