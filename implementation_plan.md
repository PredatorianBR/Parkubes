# Plano de Implementação - Correção do Comportamento da IA (Esconde-Esconde)

Independentemente de ser o Caçador ou o Fugitivo, a IA está indo na direção do jogador. Isso ocorre porque o cálculo do caminho (`computeAIPath`) está fixado na posição do jogador.

## Mudanças em `src/components/VoxelSeek.tsx`:

1.  **Cálculo da Role**: Definir claramente `isAISeeker` com base no `match.playerRole`.
2.  **Ajuste do Destino (`targetPos`)**:
    -   Se a IA for a Caçadora (`isAISeeker`): O alvo é o jogador.
    -   Se a IA for a Fugitiva: O alvo é o canto do mapa mais distante do jogador.
3.  **Lógica de Fuga vs Esconderijo**:
    -   Adicionar lógica para que a fugitiva pare de correr se encontrar um esconderijo fora da linha de visão do caçador.
    -   Garantir que a fugitiva comece a se afastar imediatamente na fase `WAITING`.

## Passos:
1.  Atualizar a lógica de `targetPos` no `useFrame`.
2.  Refinar a condição de movimento da IA fugitiva.
3.  Validar se a linha de debug agora aponta para longe do jogador quando a IA foge.
