# ADR 0009: Aplicación de Cupones en Checkout — Bounded Context, Atomicidad y Compensación

## Estado
Aceptado

## Contexto
La HU #34 requiere que un comprador pueda ingresar un código de cupón durante el
checkout y obtener un descuento sobre el total de su orden. El dominio Cupón fue
implementado en la HU #33 y reside en **catalog-api** (MongoDB). El dominio Orden
vive en **orders-api** (PostgreSQL). Hay que decidir:

1. Dónde se valida y aplica el cupón (qué servicio es el dueño de esa lógica).
2. Cómo se garantiza que dos checkouts simultáneos no puedan "ganar" el mismo cupón
   con `usageLimit=1`.
3. Dónde y cuándo se persiste el desglose (subtotal, descuento, total).
4. Cómo se compensan los usos consumidos ante fallos posteriores en el checkout.

## Decisión

### 1. El dominio Cupón permanece en catalog-api
orders-api no tiene acceso directo a MongoDB. Duplicar la lógica de validación en
orders-api violaría el bounded context establecido en la HU #33. En cambio,
catalog-api expone tres endpoints internos protegidos con `X-Internal-Secret`
(`CATALOG_INTERNAL_SECRET`):

```
POST /coupons/internal/preview   — valida sin consumir usos
POST /coupons/internal/consume   — valida y reserva un uso atómicamente
POST /coupons/internal/restore   — revierte un uso (compensación)
```

Estos endpoints siempre devuelven 200 con `{ valid: bool, reason: str | null, ... }`.
Los 4xx quedan para errores reales (auth, payload mal formado). orders-api interpreta
`valid=false` y decide cómo respondérselo al comprador.

### 2. Concurrencia mediante findOneAndUpdate atómico en MongoDB
`consume` usa `findOneAndUpdate` con un filtro completo que exige `isActive=true`,
`expiresAt > now` y `usageCount < usageLimit` (si hay límite). Si dos checkouts
concurrentes llaman a `consume` simultáneamente sobre un cupón con `usageLimit=1`,
exactamente uno obtendrá el documento actualizado y el otro recibirá `None`, lo que
se traduce en `{ valid: false, reason: "limit_reached" }`. No se requieren locks
distribuidos externos.

### 3. Order persiste el desglose completo
Se agregan tres columnas a la tabla `orders`:
- `subtotal`: suma de `unit_price × quantity` de todos los ítems.
- `discount_amount`: monto absoluto del descuento aplicado.
- `coupon_code`: código del cupón usado (nullable).
- `total = subtotal - discount_amount`.

El cálculo del `discount_amount` lo hace catalog-api con `ROUND_HALF_UP` y clampea
a `subtotal` para garantizar que `total >= 0` (CA4 — cupón al 100%).

### 4. Orden de pasos en el checkout y compensación
El checkout de orders-api sigue este orden crítico:

```
1. Validar carrito no vacío.
2. Calcular subtotal.
3. consume_coupon()  → si invalid: HTTP 422, sin reserva de stock.
4. reserve_stock()   → si falla: restore_coupon_safe() + HTTP 409.
5. create_order()    → pending_payment, con desglose.
6. create_payment()  → si falla: restore_stock() + restore_coupon_safe().
```

Compensación tardía (webhook de pago rechazado/expirado):
`handle_payment_result` llama a `restore_coupon_safe(order.coupon_code)` antes de
marcar la orden como `payment_rejected`. Esta compensación es fire-and-forget:
loggea WARN si falla pero no propaga para no interrumpir el flujo de rechazo.

### 5. Preview no destructivo para la UX
Antes de confirmar el pago, el frontend llama a `POST /orders/cart/preview` con el
código del cupón. Ese endpoint llama a `/coupons/internal/preview` (sin consumir usos)
y devuelve el desglose. El comprador ve "−$XX.XX" antes de hacer clic en pagar.
El consume real ocurre solo en el `POST /orders/checkout`.

## Alternativas descartadas

**Mover el dominio Cupón a orders-api**: implicaría duplicar la lógica ya existente
en catalog-api (validación, gestión de estado, Mongo) y forzar a orders-api
(stack SQLAlchemy + PostgreSQL) a comunicarse con Mongo directamente. Viola el
bounded context establecido en la HU #33.

**Consumir el cupón solo en el webhook de pago aprobado**: deja una ventana de
tiempo entre el checkout y la confirmación del pago en la que dos compradores
podrían ambos "pasar" el filtro con un cupón de `usageLimit=1`. El consume en el
paso de checkout, antes de abrir MercadoPago, garantiza que solo uno llega al pago.

**Lock pesimista en SQL**: no aplica porque el cupón vive en Mongo. `findOneAndUpdate`
cumple el mismo rol con atomicidad garantizada por el motor de almacenamiento.

**Validar el cupón en preview y luego re-validar en consume como operaciones
separadas**: ya implementado, pero el punto clave es que el preview llama a
`/internal/preview` (sin efecto) y el checkout llama a `/internal/consume` (con
efecto). No hay un segundo "validate-then-set" que introduzca TOCTOU, porque
`consume` es atómico.

## Consecuencias

### Positivas
- El bounded context del dominio Cupón queda limpio: toda la lógica de validación
  y conteo vive en catalog-api.
- La atomicidad de MongoDB (`findOneAndUpdate`) garantiza corrección bajo alta
  concurrencia sin infraestructura adicional.
- El comprador ve el desglose antes de pagar (mejor UX) sin consumir usos.
- La cadena de compensación es simétrica: consume → reserve → create → pay, con
  restore en cascada inversa ante cualquier fallo.

### Negativas y Riesgos
- **Latencia adicional**: el checkout suma un round-trip a catalog-api para el
  consume del cupón. Con timeout de 5s y sin circuit breaker, si catalog-api está
  caído, el checkout falla con 503 aunque el carrito y el stock sean válidos.
- **Cupón "quemado" ante abandono**: si el usuario llega hasta el paso 3 (consume)
  y luego abandona el checkout (cierra la app antes de que MercadoPago procese el
  pago y el webhook llegue), el uso del cupón queda consumido hasta que el
  preference de MercadoPago expire y el webhook de rechazo lo restaure. Aceptable
  para el alcance del TP.
- **restore_coupon_safe es fire-and-forget**: si catalog-api no está disponible en
  el momento de compensar, el usageCount queda incrementado hasta que se restaure
  manualmente. No existe un job de reconciliación actualmente.
- **Sin Alembic en orders-api**: las tres columnas nuevas (`subtotal`,
  `discount_amount`, `coupon_code`) se agregan via `create_all`. En producción
  se requiere limpiar la DB o ejecutar una migración manual antes del deploy.
