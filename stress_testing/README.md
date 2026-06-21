# Pruebas de carga — Bazaar Checkout

Scripts k6 para pruebas de carga y estrés sobre el flujo de checkout de Bazaar.

## Prerrequisitos

- [k6](https://k6.io/docs/get-started/installation/) instalado (`k6 version` para verificar)
- Los siguientes servicios corriendo en local:
  - `bazaar-user-api` → `http://localhost:8001`
  - `bazaar-catalog-api` → `http://localhost:8002`
  - `bazaar-orders-api` → `http://localhost:8003`
- El usuario `techstore@bazaar.dev` (password: `BazaarDev1`) ya creado en la DB.  
  Si no existe, corré primero `python scripts/seed_dev.py` desde la raíz del monorepo.
- Una imagen `test_image.png` en esta misma carpeta (requerida por `seed.js`).

## Paso 1 — Crear el producto de prueba (una sola vez)

```bash
cd stress_testing
k6 run seed.js
```

Del output, copiá el `id` que aparece en `Producto creado: {...}` y actualizá la constante `PRODUCT_ID` en `checkout_load_test.js`.

## Paso 2 — Correr el load test

```bash
k6 run checkout_load_test.js
```

No se necesitan flags adicionales: `summaryTrendStats` ya está configurado en el script y el resumen final incluye avg, min, med, p(90), p(95), p(99) y max por endpoint.

## Escenarios

| Escenario | VUs máx | Duración | Qué simula |
|---|---|---|---|
| `carga_sostenida` | 5 | ~35s | Tráfico habitual, pocos compradores simultáneos |
| `estres` | 30 | ~60s (arranca a los 40s) | Pico de demanda tipo flash sale |

## Flujo por VU

1. `POST /cart/items`: agrega el producto al carrito
2. `GET /cart/`: consulta el carrito
3. `POST /orders/cart/preview`: previsualiza el total
4. `POST /orders/checkout`: confirma la orden con `idempotency_key` único
