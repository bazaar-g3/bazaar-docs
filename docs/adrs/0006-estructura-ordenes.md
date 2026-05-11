# ADR 0006: Estructura de Órdenes — Orden Única Consolidada por Checkout

## Estado
Aceptado

## Contexto
La consigna establece que el carrito puede contener productos de múltiples vendedores
y exige documentar en un ADR si el checkout genera una única orden consolidada o
una orden por vendedor.

Las dos opciones evaluadas fueron:

- **Orden única consolidada**: un checkout genera un solo registro `Order` que
  agrupa ítems de distintos vendedores. Cada `OrderItem` incluye `seller_id` para
  que el sistema pueda filtrar qué ítems corresponden a cada vendedor.
- **Orden por vendedor**: el checkout genera tantas órdenes como vendedores distintos
  haya en el carrito. Cada orden pertenece exclusivamente a un par comprador-vendedor.

## Decisión
Se adopta el modelo de **orden única consolidada por checkout**.

### Estructura implementada
La tabla `orders` registra una única orden por transacción de checkout, con los
campos `user_id`, `status`, `total` y `delivery_address` (almacenada como JSONB).
La tabla `order_items` vincula cada ítem a su orden y registra el `seller_id`,
`product_id`, `product_name` (denormalizado al momento de la compra), `quantity`
y `unit_price`.

El comprador opera siempre sobre la orden completa. El vendedor accede a sus
ventas mediante un endpoint que filtra los `order_items` por los `product_id` que
le pertenecen, recibiendo solo sus ítems y un `seller_subtotal` calculado sobre
ellos.

### Gestión de estados en un modelo consolidado
El ciclo de vida de la orden (`pending_payment → confirmed → in_preparation →
shipped → delivered`) aplica a la orden completa. El vendedor puede avanzar
los estados `confirmed → in_preparation → shipped` solo si la orden contiene al
menos un producto suyo. Las transiciones válidas están codificadas en tres
diccionarios separados: `VALID_TRANSITIONS` (flujo global), `SELLER_ALLOWED`
(subconjunto permitido al vendedor) y `BUYER_ALLOWED` (subconjunto permitido
al comprador).

### Denormalización de datos del producto
`product_name` y `unit_price` se copian al crear el `OrderItem` desde el carrito.
Esto desacopla el historial de compras de catalog-api: si un producto cambia de
nombre o precio después de la compra, el registro histórico permanece íntegro.

## Alternativas descartadas

**Orden por vendedor**: descartada porque introduce complejidad de coordinación
en flujos críticos. Con ítems de 3 vendedores, un único checkout generaría 3
órdenes, requiriendo una transacción distribuida para garantizar que las 3 se
creen o ninguna. Además, el comprador necesitaría rastrear múltiples órdenes por
lo que fue conceptualmente una sola compra, complicando el historial y el flujo
de reembolso.

## Consecuencias

### Positivas
- El checkout genera exactamente un `order_id` y un `init_point`, simplificando
  la experiencia del comprador y el flujo de pago.
- La reserva atómica de stock y la creación de la orden se hacen en una sola
  unidad de trabajo, reduciendo la superficie de inconsistencias.
- El comprador puede rastrear toda su compra bajo un único identificador.

### Negativas y Riesgos
- **Estado compartido entre vendedores**: si una orden tiene productos de dos
  vendedores y uno marca `in_preparation` pero el otro no ha actuado, el estado
  de la orden avanza igual. No existe un estado de preparación granular por
  vendedor.
- **Cancelación parcial no soportada**: cancelar una orden implica cancelar todos
  los ítems, incluso si solo hay un problema con los productos de uno de los
  vendedores.
- **`seller_subtotal` calculado en aplicación**: el total que recibe cada vendedor
  se calcula filtrando sus ítems en la capa de servicio, no existe un campo
  persisted de subtotal por vendedor en la base de datos.