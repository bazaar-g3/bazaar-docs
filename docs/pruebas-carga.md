---
title: Pruebas de Carga y Estrés
nav_order: 5
---
# Pruebas de Carga y Estrés

## Metodología

**Herramienta**: k6 v2.0.0

**Entorno**: pruebas ejecutadas localmente, con los 5 microservicios
de Bazaar y sus bases de datos corriendo en contenedores Docker (vía
Colima) en una MacBook Pro M2 Max (12 cores: 8 Performance + 4
Efficiency), 64GB RAM: VM de Colima asignada con 8 CPU / 16GB. El
generador de carga (k6) corre en la misma máquina que los servicios
bajo prueba, compitiendo por CPU/RAM; es una limitación esperada de
un entorno de testing local que puede hacer los resultados más
conservadores que en un entorno distribuido real.

**Escenarios**: tres escenarios secuenciales, dentro de una misma
corrida:

| Escenario | VUs máximos | Simula |
|---|---|---|
| `carga_sostenida` | 8 | Tráfico habitual de la plataforma |
| `estres_moderado` | 30 | Pico de demanda moderado |
| `estres_alto` | 75 | Pico de demanda extremo |

Cada VU representa un comprador **independiente**: 75 cuentas de
usuario se crean dinámicamente en la fase de `setup()`, cada una con
su propio carrito.

**Métricas**: avg, p50 (mediana), p95, p99 y max por endpoint y
escenario, más tasa de error, calculadas mediante thresholds
segmentados por tag de k6 y exportadas automáticamente a JSON y
Markdown vía una función `handleSummary` personalizada (sin datos
sensibles; el token de autenticación se excluye explícitamente del
export).

## Endpoints Evaluados

Las cuatro llamadas que conforman el flujo completo de checkout,
elegido por ser el camino crítico señalado por la cátedra:

| Endpoint | Método y ruta | Descripción |
|---|---|---|
| `add_to_cart` | `POST /cart/items` | Agregar producto al carrito |
| `get_cart` | `GET /cart/` | Consultar el carrito actual |
| `preview` | `POST /orders/cart/preview` | Previsualizar la orden antes de confirmar |
| `checkout` | `POST /orders/checkout` | Confirmar la compra (saga: reserva de stock → creación de orden → llamada a payments-api) |

## Resultados — Carga Sostenida (8 VUs)

| Endpoint | avg | p95 | p99 | max | Error % |
|---|---|---|---|---|---|
| add_to_cart | 48.7ms | 72.9ms | 79.9ms | 85.6ms | 0.0% |
| get_cart | 45.9ms | 67.4ms | 84.1ms | 86.4ms | 0.0% |
| preview | 34.4ms | 61.6ms | 93.8ms | 95.8ms | 0.0% |
| checkout | 669.1ms | 703.9ms | 764.0ms | 874.7ms | 0.0% |

## Resultados — Estrés Moderado (30 VUs)

| Endpoint | avg | p95 | p99 | max | Error % |
|---|---|---|---|---|---|
| add_to_cart | 49.7ms | 99.9ms | 123.5ms | 146.9ms | 0.0% |
| get_cart | 27.2ms | 58.3ms | 70.2ms | 95.3ms | 0.0% |
| preview | 19.9ms | 50.3ms | 64.6ms | 73.8ms | 0.0% |
| checkout | 616.2ms | 685.7ms | 730.9ms | 1498.6ms | 0.0% |

## Resultados — Estrés Alto (75 VUs)

| Endpoint | avg | p95 | p99 | max | Error % |
|---|---|---|---|---|---|
| add_to_cart | 89.3ms | 255.2ms | 412.3ms | 632.2ms | 0.0% |
| get_cart | 59.3ms | 202.3ms | 372.6ms | 793.3ms | 0.0% |
| preview | 45.8ms | 199.3ms | 364.0ms | 762.7ms | 0.0% |
| checkout | 646.7ms | 815.1ms | 1190.8ms | 1673.4ms | 0.0% |

**Tasa de error real: 0%** sobre los 12 combos escenario/endpoint.
El 1.02% reportado globalmente corresponde a llamadas de registro
durante el warm-up de `setup()` (cuentas ya existentes de corridas
anteriores, que devuelven 409 antes de caer a login), no forma
parte de los escenarios medidos.

## Análisis de Cuellos de Botella

El checkout muestra una latencia estructural alta (~650-670ms
promedio) **consistente en los tres escenarios**, independiente del
nivel de carga. Esto confirma que el costo no es de concurrencia
sino del diseño de la saga síncrona: reserva de stock en catalog-api,
creación de orden en orders-api, y llamada sincrónica a la API de
MercadoPago para procesar el pago. Esta última es la que domina la
latencia del endpoint, al ser una llamada a un servicio externo,
introduce una demora fija que no desaparece al escalar los servicios
internos. Tal como se documentó en el ADR de Checkout, es un trade-off
aceptado del diseño actual.

Bajo el escenario de mayor estrés (75 VUs) aparece degradación de
cola en **todos** los endpoints. Los percentiles altos (p95/p99/max)
suben notablemente mientras la mediana se mantiene estable, la firma
típica de contención de recursos compartidos (CPU, pool de
conexiones) bajo alta concurrencia, no un problema puntual de un
endpoint. `add_to_cart` es el que más se resiente proporcionalmente
(de ~100ms a 255ms p95).

Ningún endpoint falló funcionalmente bajo ningún nivel de carga
probado.

## Conclusiones

- El sistema es robusto bajo concurrencia real: 0% de error con hasta
  75 usuarios independientes operando simultáneamente sobre el flujo
  completo de checkout.
- La latencia del checkout (~650-815ms en el peor caso) es esperable
  dado su diseño de saga síncrona, y se mantiene muy por debajo de
  los thresholds definidos (3000ms) incluso en el escenario más
  exigente.
- La señal de atención es la degradación de cola a 75 VUs
  concurrentes — de escalar el tráfico real a ese nivel, convendría
  revisar el pool de conexiones de orders-api/catalog-api o evaluar
  escalado horizontal.
- **Nota metodológica**: la primera iteración de este test usaba una
  única cuenta compartida entre todas las VUs, lo que generaba
  contención artificial sobre un carrito compartido (hasta 100% de
  error en endpoints de escritura) no relacionada con el sistema
  real. Se corrigió usando cuentas y carritos independientes por VU,
  lo que permitió medir el comportamiento genuino del sistema bajo
  carga.
