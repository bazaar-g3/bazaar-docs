---
title: "ADR 0007: Consistencia Distribuida en el Ciclo de Vida de la Orden — Saga con Compensación Síncrona"
parent: ADRs
nav_order: 7
---
# ADR 0007: Consistencia Distribuida en el Ciclo de Vida de la Orden — Saga con Compensación Síncrona

## Estado
Aceptado

## Contexto

El ciclo de vida de una orden en Bazaar involucra tres servicios: **orders-api** (crea y gestiona la orden), **catalog-api** (stock y cupones) y **payments-api** (pagos y reembolsos). Existen dos flujos principales que tocan múltiples servicios y donde un fallo en cualquier paso puede dejar el sistema en un estado inconsistente:

1. **Checkout**: reserva de stock, consumo de cupón, creación de la orden y solicitud de pago deben ocurrir como una unidad. Si el pago falla, el stock y el cupón deben liberarse.

2. **Cancelación y reembolso**: cancelar una orden implica restaurar el stock y, si el pago ya fue acreditado, iniciar un reembolso en MercadoPago.

La inconsistencia más crítica es el escenario mencionado en la consigna: el pago se confirma pero falla la actualización de la orden, o la orden se cancela pero el reembolso no se inicia. Sin una estrategia explícita, el usuario puede ser cobrado sin orden, o cancelar sin recibir su dinero.

Las alternativas evaluadas fueron:

- **Saga con compensación síncrona**: el orquestador (orders-api) ejecuta los pasos en secuencia y, ante un fallo, llama explícitamente a los servicios anteriores para revertir lo hecho. No requiere infraestructura adicional.
- **Saga con coreografía por eventos**: cada servicio escucha eventos y reacciona de forma autónoma. Requiere un broker de mensajes y consumidores idempotentes.
- **Two-Phase Commit (2PC)**: coordinación atómica distribuida. Requiere soporte explícito en todos los drivers y es frágil ante fallos del coordinador.

## Decisión

Se adopta **Saga con compensación síncrona**, orquestada desde orders-api. Cada flujo define pasos hacia adelante y pasos de compensación (CA) que se ejecutan ante fallos.

---

### Flujo 1: Checkout

Implementado en `app/services/checkout.py` → `initiate_checkout`.

#### Pasos y compensaciones

| Paso | Acción | Compensación ante fallo |
|------|--------|------------------------|
| 1 | Validar carrito no vacío | — |
| 2 | `consume_coupon` en catalog-api (si hay cupón) | — (fallo → 422, sin efectos) |
| 3 | `reserve_stock` en catalog-api | `restore_coupon_safe` (si paso 2 completó) |
| 4 | Crear orden en `pending_payment` en PostgreSQL | `restore_stock` + `restore_coupon_safe` |
| 5 | `create_payment` en payments-api → obtener `init_point` | `restore_stock` + `restore_coupon_safe` |
| 6 | Devolver `order_id` e `init_point` al cliente | — |

El orden es crítico: el cupón se consume **antes** de reservar el stock para evitar que una reserva exitosa quede huérfana si el cupón falla. El stock se reserva **antes** de crear la orden para no tener órdenes sin stock asegurado.

#### Mecanismo de reserva atómica

El paso 3 llama a `reserve_stock(items)` con todos los ítems en una única operación. catalog-api valida y reserva en una transacción atómica: si cualquier ítem falla, ninguno se reserva. Esto garantiza que dos compradores simultáneos compitiendo por el último ítem disponible no puedan completar ambas compras (condición de carrera CA4 de la consigna).

Si la reserva falla **parcialmente** (algunos ítems sí, otros no), `checkout_service` identifica los que se reservaron exitosamente y llama a `restore_stock` para liberarlos antes de retornar el 409. Esto evita reservas colgadas ante errores en lote.

#### Confirmación y rechazo del pago (callbacks de MercadoPago)

Implementado en `app/services/payment_callback.py` → `handle_payment_result`.

Cuando payments-api recibe el webhook de MercadoPago, notifica a orders-api mediante `POST /orders/internal/{order_id}/payment-result`. Este endpoint es **idempotente**: si la orden ya está en el estado esperado, retorna sin efectos secundarios.

**Pago aprobado (CA1):**
- La orden pasa a `confirmed`.
- El carrito del usuario se vacía en la misma transacción de PostgreSQL.
- Se llama a `mark_sold` en catalog-api (fire-and-forget) para incrementar `sold_count`. El stock físico ya fue decrementado en la reserva del checkout; `mark_sold` actualiza solo el contador de ventas.

**Pago rechazado (CA2):**
- La orden pasa a `payment_rejected`. El carrito **no** se vacía (el usuario puede reintentar).
- Se llama a `restore_stock` en catalog-api (fire-and-forget) para liberar la reserva.
- Si la orden tenía cupón, se llama a `restore_coupon_safe` para revertir el uso.

---

### Flujo 2: Cancelación y reembolso

Implementado en `app/services/cancellation.py` → `cancel_order` y `handle_refund_completed`.

#### Reglas de autorización

| Actor | Estados desde los que puede cancelar |
|-------|--------------------------------------|
| Comprador | `confirmed`, `in_preparation` |
| Vendedor (con ítems en la orden) | `confirmed` |
| Cualquiera | `shipped`, `delivered` → no permitido (409) |

#### Pasos y compensaciones

| Paso | Acción | Compensación ante fallo |
|------|--------|------------------------|
| 1 | Validar autorización y estado | — |
| 2 | Idempotencia: si ya está cancelada o en reembolso, retornar | — |
| 3 | Marcar orden como `cancelled` con `actor`, `cancelled_at` y `reason` en PostgreSQL | — |
| 4 | `restore_stock` en catalog-api, protegido por flag `stock_restored` | Log de error, la cancelación persiste |
| 5 | Si hay `payment_id` y `payment_status="approved"`: `create_refund` en payments-api → orden pasa a `refund_in_progress` | Log de error; la orden queda en `cancelled` para reembolso manual |

#### Idempotencia en la restauración de stock

El campo `stock_restored` (booleano en la tabla `orders`) actúa como flag de idempotencia para el paso 4. Si `cancel_order` se llama dos veces (reintento del cliente, bug, etc.), el stock no se restaura dos veces. El flag se setea atómicamente junto con el commit de cancelación.

#### Callback de reembolso completado

Cuando payments-api completa el reembolso en MercadoPago, notifica a orders-api mediante `POST /orders/internal/{order_id}/refund-completed`. Este endpoint es **idempotente**: si la orden ya está en `refund_processed`, retorna sin efectos. Si el reembolso falla (`status="failed"`), la orden queda en `refund_in_progress` y el evento queda logueado para intervención manual.

---

## Alternativas descartadas

**Saga con coreografía por eventos**: descartada porque ambos flujos (checkout y cancelación) requieren devolver una respuesta síncrona al cliente que inició la acción. Introducir un broker (RabbitMQ, Kafka) agrega infraestructura sin eliminar la necesidad de coordinación síncrona en el primer paso. La coreografía es más valiosa en flujos puramente en background.

**Two-Phase Commit**: descartado por la falta de soporte nativo en los stacks utilizados (FastAPI + SQLAlchemy + HTTP REST) y por la fragilidad ante caída del coordinador, que deja todos los participantes bloqueados indefinidamente.

## Consecuencias

### Positivas

- El flujo de compensación es **explícito y trazable**: cada paso de rollback está codificado en el servicio orquestador (orders-api), no distribuido en múltiples servicios.
- La reserva atómica en catalog-api garantiza la condición de carrera del CA4 sin locks distribuidos.
- La idempotencia en los callbacks de pago y reembolso evita doble procesamiento ante reintentos de MercadoPago.
- El flag `stock_restored` previene doble restauración de stock ante reintentos de cancelación.
- La implementación no requiere infraestructura adicional.

### Negativas y Riesgos

- **Sin reconciliación de reservas colgadas**: si `restore_stock` falla durante la compensación del checkout o de la cancelación, el stock queda reservado indefinidamente. No existe un job de limpieza ni un TTL sobre las reservas. Requiere intervención manual o un proceso periódico de reconciliación.
- **Reembolso manual ante fallo de payments-api**: si `create_refund` falla al cancelar (payments-api no disponible), la orden queda en `cancelled` sin reembolso iniciado. El campo `payment_id` persiste en la DB para permitir un reintento manual o automatizado.
- **Notificación de pago como webhook externo**: si MercadoPago falla al notificar el resultado del pago, la orden queda en `pending_payment` indefinidamente. MercadoPago reintenta sus webhooks automáticamente, pero no existe un mecanismo propio de reconciliación para detectar órdenes huérfanas.
- **Acoplamiento temporal con catalog-api**: si catalog-api no está disponible durante el checkout, toda la operación falla. No hay fallback implementado sobre esta llamada (ver ADR 0014).
