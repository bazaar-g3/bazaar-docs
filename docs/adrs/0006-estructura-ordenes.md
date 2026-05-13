# ADR 0006: Estructura de Órdenes —Estructura de Órdenes — Orden Única Consolidada con Fulfillments por Vendedor

## Estado
Aceptado

## Contexto
La consigna establece que el carrito puede contener productos de múltiples vendedores
y exige documentar en un ADR si el checkout genera una única orden consolidada o
una orden por vendedor.

Las dos opciones evaluadas fueron:

- **Orden única consolidada**: un checkout genera un solo registro `Order` que
  agrupa ítems de distintos vendedores. 
- **Orden por vendedor**: el checkout genera tantas órdenes como vendedores distintos
  haya en el carrito.

## Decisión
A medida que evolucionó el sistema, surgió la necesidad de manejar la logística (preparación y envío) de forma independiente para cada vendedor, sin perder la cohesión de una única compra para el usuario ni complicar el flujo de pago. Adoptamos entonces un modelo hibrido: **orden única consolidada por checkout, con seguimiento de estados fraccionado por vendedor (Fulfillments)**.

### Estructura implementada
La tabla `orders` registra una única orden por transacción de checkout, con los
campos `user_id`, `status` global, `total` y `delivery_address` (JSONB).
La tabla `order_items` vincula cada ítem a su orden y registra el `seller_id`,
`product_id`, `product_name`, `quantity` y `unit_price`.

Para resolver la independencia logística, se introduce la entidad `OrderFulfillment` (`order_fulfillments`), que agrupa lógicamente los ítems de un vendedor específico dentro de la orden. Cada *fulfillment* posee su propio `status` y `tracking_code`. 
Además, la tabla `order_status_history` incluye ahora una columna `seller_id` para auditar de forma exacta qué vendedor disparó cada transición logística (o si fue un cambio del flujo global de pago).

### Gestión de Estados: Lógica de Embudo
El sistema maneja dos capas de estados para el ciclo de vida de la compra:
1. **Estado de Fulfillment**: El vendedor avanza de forma aislada el estado de su paquete (`confirmed → in_preparation → shipped`). Al marcar como `shipped`, puede ingresar su código de seguimiento individual.
2. **Estado Global**: La orden avanza de estado mediante una "lógica de embudo". A cada estado se le asigna un peso numérico. El estado global de la orden solo avanza cuando **todos** los *fulfillments* activos han alcanzado o superado ese mismo estado.

El comprador opera sobre la orden completa, visualizando el estado global pero con un desglose detallado por paquetes y trackings individuales. El vendedor accede a sus ventas mediante un endpoint que filtra y le devuelve exclusivamente la vista y el estado de su *fulfillment*.

### Denormalización de datos del producto
`product_name` y `unit_price` se copian al crear el `OrderItem` desde el carrito.
Esto desacopla el historial de compras de catalog-api: si un producto cambia de
nombre o precio después de la compra, el registro histórico permanece íntegro.

## Alternativas descartadas

**Orden por vendedor**: descartada porque introduce complejidad de coordinación
en flujos críticos. Con ítems de 3 vendedores, un único checkout generaría 3
órdenes, requiriendo una transacción distribuida para garantizar que las 3 se
creen o ninguna. 

## Consecuencias

### Positivas
- El checkout genera exactamente un `order_id` y un `init_point`, simplificando
  la experiencia del comprador y el flujo de pago.
- Independencia logística: cada vendedor maneja sus tiempos de preparación y códigos de envío sin alterar o adelantar de forma ficticia el estado de los paquetes de otros vendedores.
- La reserva atómica de stock y la creación de la orden se hacen en una sola
  unidad de trabajo, reduciendo la superficie de inconsistencias.
- El comprador puede rastrear toda su compra bajo un único identificador.

### Negativas y Riesgos
- **Cancelación parcial no soportada**: cancelar una orden implica cancelar todos
  los ítems, incluso si solo hay un problema con los productos de uno de los
  vendedores.
- **`seller_subtotal` calculado en aplicación**: el total que recibe cada vendedor
  se calcula filtrando sus ítems en la capa de servicio, no existe un campo
  persisted de subtotal por vendedor en la base de datos.
