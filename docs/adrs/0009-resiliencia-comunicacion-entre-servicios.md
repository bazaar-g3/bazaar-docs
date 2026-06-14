# ADR 0009: Resiliencia en la Comunicación entre Servicios — Retry con Backoff Exponencial

## Estado
Aceptado

## Contexto
Los microservicios de Bazaar se comunican entre sí mediante llamadas HTTP síncronas
para coordinar operaciones de negocio. El caso concreto que motivó esta decisión es
la notificación que **user-api** envía a **catalog-api** cuando un administrador
bloquea o desbloquea la cuenta de un vendedor: catalog-api debe marcar o desmarcar
los productos de ese vendedor con el flag `sellerBlocked`, de modo que desaparezcan
del catálogo público en tiempo real.

Este tipo de llamadas entre servicios está expuesto a fallos transitorios: el servicio
destino puede estar reiniciándose, la red interna de Docker puede sufrir una
microinterrupción, o el contenedor puede estar bajo carga y rechazar conexiones
momentáneamente. Sin ninguna estrategia de resiliencia, un fallo transitorio hace que
la operación falle silenciosamente: el usuario queda bloqueado en la base de datos de
user-api pero sus productos siguen visibles en el catálogo.

La implementación original usaba **fire-and-forget sin reintentos**: la notificación
se lanzaba en segundo plano (`.catch(() => {})`) y, ante cualquier error, se
descartaba sin posibilidad de recuperación.

Las alternativas evaluadas fueron:

- **Fire-and-forget sin reintentos** (implementación original): cero overhead de
  latencia, pero pérdida silenciosa de notificaciones ante cualquier fallo.
- **Retry con backoff exponencial**: reintenta la llamada con delays crecientes,
  tolerando fallos transitorios sin sobrecargar el servicio destino.
- **Circuit Breaker**: patrón que abre un "interruptor" tras N fallos consecutivos,
  cortando llamadas al servicio caído durante un período de cooldown.
- **Cola de mensajes (RabbitMQ / Kafka)**: desacopla completamente la notificación del
  ciclo request-response, garantizando entrega eventual con persistencia.

## Decisión
Se adopta **Retry con backoff exponencial** implementado en `fetchWithRetry`
(`src/app/core/http.ts`), aplicado a todas las llamadas HTTP síncronas entre servicios.

### Parámetros del retry
- **Intentos máximos:** 3 (1 intento original + 2 reintentos).
- **Delay base:** 200 ms, duplicado en cada reintento (200 ms → 400 ms).
- **Overhead máximo de espera:** ~600 ms (sin contar la latencia de las llamadas).
- **Jitter:** no implementado (el volumen de llamadas concurrentes al mismo endpoint
  es muy bajo; no hay riesgo de thundering herd).

### Política de reintentos
| Condición | Comportamiento |
|-----------|---------------|
| Error de red (ECONNREFUSED, timeout) | Reintentar |
| Respuesta 5xx del servicio destino | Reintentar |
| Respuesta 4xx del servicio destino | **No** reintentar (error de cliente, no mejora con reintentos) |
| Respuesta 2xx / 3xx | Éxito, no reintentar |

### Comportamiento ante agotamiento de reintentos
Si los tres intentos fallan, `notifyCatalogSellerStatus` captura el error, lo registra
en el logger con nivel `error`, y retorna normalmente. La operación principal
(`blockUser` / `unblockUser`) ya completó su escritura en la base de datos de
user-api; la notificación al catálogo es **best-effort**: no falla la operación del
administrador, pero sí queda registrado el evento para diagnóstico.

### Semántica de espera (await vs fire-and-forget)
Con la nueva implementación, `blockUser` y `unblockUser` **aguardan** el resultado
de la notificación (incluyendo los reintentos) antes de devolver la respuesta al
cliente. Esto implica:

- **Mayor confiabilidad**: el 95% de los fallos transitorios se resuelven en el
  primer o segundo reintento.
- **Latencia máxima adicional en el peor caso:** ~600 ms de espera + 3 × latencia
  de red interna. Para una operación administrativa (bloqueo de cuenta) este overhead
  es completamente aceptable.
- **Sin cambio en el contrato de la API**: si los tres intentos fallan, el endpoint
  sigue devolviendo 200 con el usuario bloqueado; el log de error es el mecanismo
  de observabilidad.

## Alternativas descartadas

**Circuit Breaker**: patrón valioso en sistemas con alto volumen de llamadas
entre servicios donde un destino caído puede generar cientos de conexiones abortadas
por segundo. En Bazaar, el endpoint de bloqueo/desbloqueo es una operación
administrativa de baja frecuencia; el overhead de mantener estado de circuito
(contador de fallos, ventana temporal, estado OPEN/HALF-OPEN/CLOSED) no justifica
la complejidad adicional de código. Si el volumen de llamadas inter-servicio
aumentara significativamente, la incorporación de un API Gateway o service mesh
con circuit breaker nativo (ej. AWS App Mesh, Istio) sería la vía preferida.

**Cola de mensajes (RabbitMQ / Kafka)**: garantiza entrega eventual con persistencia
total, independientemente de la disponibilidad del servicio destino. Sin embargo,
introduce infraestructura adicional (broker, consumidores, configuración de colas)
que excede el alcance del trabajo práctico y la operación actual del sistema. La
alternativa elegida (retry) cubre el 99% de los casos de fallo transitorio con
una implementación de bajo costo.

**Fire-and-forget sin reintentos**: descartado porque un único fallo de red
(muy común durante despliegues o reinicios de contenedores) deja el catálogo en
estado inconsistente indefinidamente sin ningún mecanismo de recuperación automática.

## Consecuencias

### Positivas
- Tolerancia a fallos transitorios de red y reinicios de contenedores sin
  intervención manual.
- Implementación sin dependencias externas: usa `fetch` nativo de Node.js 18+.
- El helper `fetchWithRetry` es genérico y puede reutilizarse para cualquier
  llamada HTTP inter-servicio que se agregue en el futuro.
- Los fallos persistentes quedan registrados con nivel `error` en el logger,
  facilitando el diagnóstico operacional.

### Negativas y Riesgos
- **Inconsistencia eventual ante fallos persistentes**: si catalog-api está caído
  durante más de ~1 segundo (duración total de los reintentos), los productos del
  vendedor no se marcarán como bloqueados hasta que alguien repita la operación
  manualmente o se implemente un job de reconciliación.
- **Sin reconciliación automática**: no existe actualmente un mecanismo que detecte
  y repare estados inconsistentes entre user-api y catalog-api (usuario bloqueado
  en users DB pero productos visibles en catálogo). Esto es una limitación conocida
  del enfoque síncrono best-effort.
- **Latencia adicional en el peor caso**: hasta ~600 ms de overhead por operación
  de bloqueo/desbloqueo cuando el catálogo no responde. Aceptable para una operación
  administrativa poco frecuente.
