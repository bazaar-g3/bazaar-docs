---
title: "ADR 0014: Resiliencia en la Comunicación entre Servicios"
parent: ADRs
nav_order: 14
---
# ADR 0014: Resiliencia en la Comunicación entre Servicios

## Estado
Aceptado

## Contexto

Los microservicios de Bazaar se comunican entre sí mediante llamadas HTTP sincrónicas y asincrónicas para coordinar operaciones de negocio. Las comunicaciones actuales son:

| Origen | Destino | Llamada | Tipo |
|--------|---------|---------|------|
| `user-api` | `catalog-api` | Bloqueo/desbloqueo de productos de un vendedor | Síncrona, admin |
| `orders-api` | `catalog-api` | Reserva de stock en checkout | Síncrona, usuario |
| `orders-api` | `catalog-api` | Restauración de stock, mark-sold, cupones | Síncrona, sistema |
| `orders-api` | `payments-api` | Crear preferencia de pago | Síncrona, usuario |
| `orders-api` | `payments-api` | Crear reembolso | Síncrona, sistema |
| `orders-api` | `notifications-api` | Push al cambiar estado de orden | Asíncrona, fire & forget |
| `catalog-api` | `notifications-api` | Push de alerta de stock bajo/sin stock | Asíncrona, fire & forget |

Todas estas llamadas están expuestas a fallos transitorios: un servicio puede estar reiniciándose tras un deploy, la red interna de Docker puede sufrir una microinterrupción, o un contenedor puede estar bajo carga y rechazar conexiones momentáneamente.

Sin ninguna estrategia de resiliencia, un fallo transitorio hace que la operación falle silenciosamente o que el usuario reciba un error que podría haberse evitado con un reintento inmediato.

Las alternativas evaluadas para cada tipo de comunicación fueron:

- **Fire-and-forget sin reintentos**: cero overhead, pero pérdida silenciosa ante cualquier fallo transitorio.
- **Retry con backoff exponencial**: reintenta con delays crecientes, tolerando fallos transitorios sin sobrecargar el destino.
- **Fail-fast con 503**: el primer fallo propaga inmediatamente un error al caller, que puede reintentar desde el cliente o la UI.
- **Circuit Breaker**: patrón que abre un "interruptor" tras N fallos consecutivos, cortando llamadas durante un período de cooldown.
- **Cola de mensajes (RabbitMQ / Kafka)**: desacopla completamente el envío del ciclo request-response, garantizando entrega eventual con persistencia.

## Decisión

Se adopta una estrategia diferenciada según el tipo de comunicación, reconociendo que el patrón óptimo de resiliencia depende de si la llamada bloquea al usuario o se ejecuta en background.

### Tipo 1: Llamadas fire-and-forget — Retry con backoff exponencial en thread daemon

Se aplica a las llamadas cuyo fallo no debe interrumpir el flujo principal del usuario: notificaciones push desde `orders-api` y `catalog-api` hacia `notifications-api`.

**Parámetros del retry:**
- Intentos máximos: 3
- Delay base: 1 segundo, duplicado en cada reintento (1 s → 2 s)
- Overhead máximo de espera en background: ~3 segundos
- La llamada corre en un thread daemon independiente: no bloquea el endpoint que la dispara

**Política de reintentos:**

| Condición | Comportamiento |
|-----------|---------------|
| Error de red (`ConnectionError`, `Timeout`) | Reintentar |
| Respuesta 5xx del destino | Reintentar |
| Respuesta 4xx del destino | No reintentar (error permanente de auth o payload) |
| Agotados los reintentos | Log de error y descarte silencioso |

**Implementaciones:**
- `orders-api/app/clients/notifications.py` — `_send_with_retry` + `send_order_status_push`
- `catalog-api/app/clients/notifications.py` — `_send_with_retry` + `send_stock_alert`

Ambas comparten la misma lógica de `_is_transient` y los mismos parámetros de configuración (`MAX_RETRIES=3`, `BASE_DELAY_S=1.0`, `BACKOFF_MULT=2.0`).

---

### Tipo 2: Llamadas síncronas en el path del usuario — Fail-fast con 503

Se aplica a las llamadas que forman parte del checkout o de la acción del usuario: reserva de stock en `catalog-api`, creación de preferencia de pago en `payments-api`, y creación de reembolso en `payments-api`.

En estas llamadas **no se implementa retry en el cliente** por las siguientes razones:

1. **UX**: un retry con backoff de 1 s → 2 s implica que el usuario espera 3-4 segundos adicionales en el peor caso antes de recibir el error. En un checkout esto degrada notablemente la experiencia.

2. **Idempotencia condicionada**: aunque `create_payment` y `create_refund` tienen `idempotency_key`, la operación de reserva de stock involucra decremento en MongoDB y no es seguro reintentar sin verificar el estado previo.

3. **El retry corresponde al cliente frontend**: si el checkout devuelve 503, la app mobile puede mostrar "Intentá nuevamente" y el usuario repite la acción completa de forma controlada.

4. **Fail-fast es más observable**: un 503 inmediato queda en los logs con correlación ID clara. Un retry silencioso que falla después de 3 intentos dificulta el diagnóstico.

**Comportamiento ante fallo:**

| Condición | Respuesta |
|-----------|-----------|
| Timeout o error de red | HTTP 503 con mensaje descriptivo |
| 4xx del destino | HTTP 503 o reenvío del código según semántica |
| 5xx del destino | HTTP 503 o 502 |

**Implementaciones:**
- `orders-api/app/clients/catalog.py` — `get_product`, `reserve_stock`, `preview_coupon`, `consume_coupon`
- `orders-api/app/clients/payment.py` — `create_payment`
- `orders-api/app/clients/refund.py` — `create_refund`

---

### Tipo 3: Llamadas síncronas best-effort — Retry rápido, degradación silenciosa

Se aplica a las llamadas que forman parte del ciclo de vida de la orden pero cuyo fallo no debe interrumpirlo: restauración de stock tras pago fallido, incremento de `sold_count`, restauración de cupón, y notificación de bloqueo de vendedor a catalog-api desde user-api.

En estas llamadas se permite que el fallo sea silencioso (se loguea con nivel `warning` o `error` pero no se propaga al caller). Para la notificación de bloqueo de vendedor (`user-api → catalog-api`) se aplica retry rápido con 3 intentos y delay base 200 ms, ya que la operación es administrativa y puede absorber la latencia adicional.

**Implementaciones:**
- `orders-api/app/clients/catalog.py` — `restore_stock`, `mark_sold`, `restore_coupon_safe` (fire-and-forget, sin retry)
- `user-api/src/app/core/http.ts` — `fetchWithRetry` (3 intentos, 200 ms base)

---

## Circuit Breaker: descartado

El patrón Circuit Breaker es valioso cuando el volumen de llamadas inter-servicio es alto y un destino caído puede generar cientos de conexiones abortadas por segundo, agotando el pool de conexiones del cliente.

En Bazaar, ninguna de las comunicaciones inter-servicio actuales tiene ese volumen: las notificaciones se emiten al cambiar el estado de una orden (evento discreto), y el checkout es una operación usuario-iniciada de baja frecuencia. El overhead de mantener estado de circuito (contador de fallos, ventana temporal, estado OPEN/HALF-OPEN/CLOSED) no justifica la complejidad adicional.

Si el volumen de llamadas inter-servicio aumentara significativamente, la vía preferida sería incorporar un API Gateway o service mesh con circuit breaker nativo (AWS App Mesh, Istio, Kong) en lugar de implementarlo en el código de cada servicio.

## Cola de mensajes: descartada

Una cola de mensajes (RabbitMQ, Kafka) garantizaría entrega eventual con persistencia total, independientemente de la disponibilidad del destino. Sin embargo, introduce infraestructura adicional (broker, consumidores, dead-letter queues, configuración de particiones) que excede el alcance del proyecto y la capacidad operativa del equipo. El retry con backoff cubre el 99% de los fallos transitorios —que son los más frecuentes— con una implementación de bajo costo y sin dependencias nuevas.

## Consecuencias

### Positivas

- **Tolerancia a fallos transitorios** en notificaciones (el caso más frecuente): reinicios de contenedor, microinterrupciones de red Docker.
- **UX preservada** en el checkout: el usuario recibe un 503 inmediato y puede reintentar, sin esperas adicionales por retries internos.
- **Sin dependencias nuevas**: la estrategia se implementa con `requests`, `httpx` y `threading` de la stdlib de Python y `fetch` nativo de Node.js.
- **Observabilidad clara**: cada intento de retry se loguea con `attempt`, `next_delay_s` y `correlation_id`, lo que permite rastrear fallos transitorios en Jaeger o en los logs estructurados.
- **Idempotencia explícita** en las llamadas críticas a payments-api: `idempotency_key` garantiza que un retry del cliente frontend no genera un segundo pago.

### Negativas y Riesgos

- **Inconsistencia eventual ante fallos persistentes**: si `notifications-api` está caído por más de ~3 segundos (duración total de los reintentos), la notificación push se pierde. No existe un job de reconciliación ni una bandeja de mensajes fallidos.
- **Tokens expirados en Firestore**: el fire & forget asume pérdida posible; esto es aceptable dado que las notificaciones push no son críticas para la consistencia del negocio.
- **Sin reconciliación automática** para el stock: si `restore_stock` falla en todos los reintentos, el stock de un producto puede quedar incorrectamente reservado hasta el próximo deploy o corrección manual.
- **Deuda técnica a largo plazo**: a medida que crezca el volumen de llamadas inter-servicio, la estrategia por servicio se volverá difícil de mantener. La migración a un broker de mensajes o un service mesh con resiliencia nativa será necesaria en ese momento.
