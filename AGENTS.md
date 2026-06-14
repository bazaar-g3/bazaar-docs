# AGENTS.md — Guía de uso de IA en Bazaar

Este archivo describe cómo el equipo 3 incorpora herramientas de IA en el flujo de desarrollo.

## Herramientas utilizadas

| Herramienta | Uso principal |
|---|---|
| **Claude Code** (CLI) | Refactors, debugging, generación de tests |
| **Claude.ai** (chat) | Consultas de diseño, refactors, debugging, generación de tests |
| **Gemini** | Consultas puntuales |

## Flujo de trabajo con IA

1. **El equipo define qué construir** (historia de usuario, criterios de aceptación, estrategia arquitectónica).
2. **El agente asiste en**:
   - Generación de tests automatizados (unit, integración) basados en criterios de aceptación.
   - Modularización de código existente aplicando patrones (separation of concerns, DRY).
   - Refactorización y restructuración de módulos para mejorar mantenibilidad.
3. **El equipo toma decisiones sobre**:
   - Qué se testea y cómo (estrategia de cobertura, fixtures, mocks).
   - Qué módulos extraer, cuál es el alcance óptimo de cada componente.
   - Trade-offs entre modularización y complejidad introducida.
4. **El equipo revisa** el código generado antes de commitear. Cada integrante debe poder explicar cualquier línea.
5. **Los commits son del equipo**: los mensajes describen el *qué* y el *por qué*, no la herramienta que lo generó.
6. **Las decisiones de arquitectura son del equipo**: si el agente propone una alternativa no trivial, se discute antes de aceptarla.
