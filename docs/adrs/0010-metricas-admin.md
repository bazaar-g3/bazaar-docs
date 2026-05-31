# ADR 0010: Métricas de administración: arquitectura distribuida y visualización con Recharts

## Estado
Aceptado

## Contexto
El backoffice de Bazaar requiere un panel de métricas para administradores que exponga:
usuarios registrados por período, órdenes por estado y su evolución en el tiempo,
monto total transaccionado, productos más vendidos y métricas agrupadas por categoría.

Los datos relevantes viven en múltiples microservicios:

- **user-api**: registros de usuarios.
- **orders-api**: órdenes, estados y order_items (product_id, quantity, unit_price).
- **catalog-api**: información de productos, incluyendo la categoría a la que pertenecen.

El problema específico de las métricas por categoría es que la tabla `order_items`
no almacena la categoría del producto, solo el `product_id`. Para agrupar ventas
por categoría es necesario cruzar con catalog-api en algún punto del flujo.

Las alternativas de arquitectura evaluadas fueron:

- **Servicio de métricas centralizado**: un microservicio dedicado que consolida
  datos de los demás y expone agregados listos para consumir.
- **Endpoints /admin/metrics/ por servicio**: cada microservicio expone sus propias
  métricas; el frontend o un BFF las combina.
- **Snapshot de categoría en order_items**: guardar la categoría en el momento de
  crear el order_item, eliminando la necesidad de cruzar con catalog-api.

Para la visualización, las alternativas evaluadas fueron:

- **Recharts**: ya instalado en el proyecto.
- **chart.js**: no instalado.
- **@mui/x-charts**: no instalado.

## Decisión
Se adopta la arquitectura de **endpoints distribuidos por servicio** con cruce en
runtime contra catalog-api para las métricas por categoría, y **Recharts** como
biblioteca de visualización.

### Endpoints de métricas por servicio

Cada microservicio expone sus propias rutas bajo `/admin/metrics/`, protegidas
con JWT que contiene `role="admin"`. El API Gateway aplica el guard de rol antes
de enrutar la solicitud.

- `GET /admin/metrics/users` — user-api devuelve usuarios registrados agrupados
  por período (día, semana, mes) según query param.
- `GET /admin/metrics/orders` — orders-api devuelve órdenes por estado, evolución
  temporal del volumen y monto total transaccionado.
- `GET /admin/metrics/top-products` — orders-api devuelve los N productos más
  vendidos por unidades y por monto, con filtro de período.
- `GET /admin/metrics/by-category` — orders-api calcula los product_ids distintos
  del período, consulta catalog-api para resolver la categoría de cada uno y
  devuelve los agregados agrupados.

### Cruce con catalog-api para métricas por categoría

El endpoint `/admin/metrics/by-category` de orders-api realiza el cruce en runtime:

1. Obtiene los `product_id` distintos presentes en los order_items del período.
2. Por cada `product_id` consulta `GET /catalog/products/{id}` en catalog-api.
3. Agrupa los totales por la categoría devuelta.

Si catalog-api no responde para un producto, ese ítem se agrupa bajo la categoría
`"unknown"` para no bloquear la respuesta completa del endpoint.

### Visualización con Recharts

El frontend del backoffice utiliza Recharts para renderizar los gráficos:
`PieChart` para distribución de órdenes por estado,
`LineChart` para la evolución temporal de órdenes y montos, y `PieChart` para
la distribución por categoría.

## Alternativas descartadas

**Servicio de métricas centralizado**: descartado para este sprint. Requeriría
crear un nuevo microservicio con su propio despliegue, base de datos de
agregados y lógica de sincronización con las fuentes. El costo de implementación
no estaba justificado para el alcance actual del panel.

**Snapshot de categoría en order_items**: descartado por ser un cambio de modelo
invasivo. Agregar la columna `category` a `order_items` requería coordinar
migraciones entre múltiples branches activos durante el sprint y modificar el
flujo de creación de órdenes en checkout-api. El riesgo de conflictos y el
impacto en otros equipos superaba el beneficio para el período de desarrollo.

**chart.js y @mui/x-charts**: descartados por no estar instalados en el proyecto.
Incorporar una dependencia nueva para cubrir una funcionalidad ya disponible con
Recharts agrega superficie de mantenimiento sin ventaja técnica concreta.

## Consecuencias

### Positivas
- Cada servicio es dueño de sus propios datos de métricas; no hay acoplamiento
  de esquema entre microservicios para la funcionalidad de reporting.
- Sin dependencias nuevas de infraestructura: no hay base de datos de agregados
  ni servicios adicionales que desplegar.
- Recharts es liviano, ya estaba disponible en el proyecto y su API declarativa
  se integra de forma natural con el frontend en React.

### Negativas y Riesgos
- **Escalabilidad del cruce en runtime**: el endpoint `/admin/metrics/by-category`
  realiza N llamadas HTTP a catalog-api (una por product_id único en el período).
  Si el período consultado incluye un gran número de productos distintos, la
  latencia del endpoint crece linealmente y puede convertirse en un cuello de
  botella. Se debería migrar a un batch request o a un cache de categorías si el
  volumen lo justifica.
- **Dependencia de disponibilidad de catalog-api**: si catalog-api no responde,
  los productos afectados se agrupan bajo `"unknown"` en lugar de devolver un
  error. Esto permite mostrar métricas parciales sin fallo total, pero introduce
  silenciosamente datos incompletos. El panel no indica al administrador cuántos
  ítems quedaron sin categoría.
