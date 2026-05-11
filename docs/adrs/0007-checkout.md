# ADR 0007: Consistencia Distribuida en Checkout — Saga con Compensación Síncrona

## Estado
Aceptado

## Contexto
El flujo de checkout involucra tres servicios: **orders-api** (crea la orden y
gestiona el carrito), **catalog-api** (reserva y restaura stock) y **payments-api**
(genera el link de pago con MercadoPago). La consigna exige que si un paso falla,
los pasos anteriores no queden en un estado inconsistente, y que dos compradores
simultáneos con el último ítem disponible no puedan concretar ambas compras.

Las alternativas evaluadas fueron:

- **Saga con compensación síncrona**: el orquestador (checkout service en
  orders-api) ejecuta los pasos en secuencia y, ante un fallo, llama explícitamente
  a los servicios anteriores para revertir lo hecho.
- **Saga con coreografía por eventos**: cada servicio escucha eventos y reacciona
  de forma autónoma. Requiere un broker de mensajes y consumidores idempotentes.
- **Two-Phase Commit (2PC)**: coordinación atómica distribuida. Descartado por la
  complejidad operativa y la falta de soporte nativo en los drivers utilizados.

## Decisión
Se adopta **Saga con compensación síncrona**, orquestada desde `checkout_service`
en orders-api.

### Flujo implementado

1. Validar que el carrito no esté vacío.
2. Reservar stock en catalog-api (llamada atómica). Si falla (stock insuficiente) → 409, sin orden creada, sin cobro.
3. Crear la orden en estado pending_payment en la DB local.
4. Llamar a payments-api para obtener el init_point. Si falla → restore_stock en catalog-api + propagar error.
5. Devolver order_id e init_point al cliente.
6. Luego, de forma asíncrona vía webhook de MercadoPago:

   a. Pago aprobado → payments-api notifica a orders-api.
   - orders-api actualiza orden a confirmed.
   - catalog-api descuenta el sold_count.
   - Carrito se vacía.
   
   b. Pago rechazado → payments-api notifica a orders-api.
   - orders-api actualiza orden a payment_rejected.
   - catalog-api libera la reserva de stock.

### Mecanismo de reserva atómica de stock
El paso 2 llama a `catalog_client.reserve_stock(items)` con todos los ítems del
carrito en una única operación. catalog-api valida y reserva en una transacción
única: si cualquier ítem falla, no se reserva ninguno. Esto implementa el CA4
de la consigna (concurrencia con el último ítem): solo uno de los dos checkouts
simultáneos obtendrá la reserva; el otro recibirá un error de stock insuficiente.

### Compensación parcial ante fallo de reserva
Si la reserva falla parcialmente (algunos ítems sí, otros no), checkout_service
identifica los que se reservaron exitosamente y llama a `restore_stock` para
liberarlos antes de retornar el 409. Esto evita reservas colgadas ante errores
en lote.

### Transacción de pagos como punto de no-retorno
Una vez que payments-api devuelve el `init_point`, la orden existe en `pending_payment`
y el stock está reservado. La confirmación o rechazo del pago llega vía webhook
de MercadoPago; hasta ese momento, el sistema está en estado intermedio conocido y
recuperable.

### Limitaciones del enfoque síncrono
La compensación ante fallo de payments-api (paso 4) es síncrona: si `restore_stock`
también falla, el stock queda reservado indefinidamente. No existe actualmente
un job de reconciliación o TTL sobre las reservas.

## Alternativas descartadas

**Saga con coreografía por eventos**: descartada por la complejidad de introducir
un broker de mensajes (RabbitMQ, Kafka) para un flujo que en su mayor parte es
síncrono de todas formas. El checkout requiere devolver el `init_point` al
cliente en la misma request, lo que obliga a esperar la respuesta de payments-api
de forma síncrona independientemente del patrón elegido.

**Two-Phase Commit**: descartado por la falta de soporte nativo en los stacks
utilizados (FastAPI + SQLAlchemy + HTTP clients) y la fragilidad ante fallo del
coordinador.

## Consecuencias

### Positivas
- El flujo de compensación es explícito y trazable: cada paso de rollback está
  codificado en `checkout_service`, no distribuido en múltiples servicios.
- La reserva atómica en catalog-api garantiza la condición de carrera del CA4
  sin requerir locks distribuidos ni lógica de reintentos en orders-api.
- La implementación no requiere infraestructura adicional (broker, coordinador
  externo).

### Negativas y Riesgos
- **Sin reconciliación de reservas colgadas**: si `restore_stock` falla (ej.
  catalog-api no disponible en el momento de compensar), el stock queda reservado
  hasta que se intervenga manualmente. Se requiere un job de limpieza o un TTL
  sobre las reservas para cubrir este caso en producción.
- **Notificación de pago es fire-and-forget**: si payments-api falla al notificar
  el resultado del pago a orders-api, la orden puede quedar en `pending_payment`
  indefinidamente. MercadoPago reintenta sus webhooks, pero no existe un mecanismo
  propio de reconciliación para detectar órdenes huérfanas.
- **Acoplamiento temporal**: si catalog-api no está disponible durante el checkout,
  toda la operación falla. No hay fallback ni circuit breaker implementado sobre
  esta llamada.