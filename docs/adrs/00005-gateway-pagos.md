# ADR 0005: Gateway de Pagos — MercadoPago Checkout Pro

## Estado
Aceptado

## Contexto
El flujo de checkout de Bazaar requiere integrar un procesador de pagos externo real.
La consigna prohíbe simular el pago internamente con un flag o mock hardcodeado:
la llamada al servicio externo debe existir, aunque no se procesen pagos reales.

Las alternativas evaluadas fueron:

- **Stripe** — Documentación excelente, SDKs maduros para Python y Node.js,
  sandbox con tarjetas de prueba predefinidas, soporte nativo de idempotency keys
  en la API. Recomendado por la cátedra para proyectos académicos.
- **MercadoPago Checkout Pro** — Relevante para el mercado local (Argentina).
  Cuenta con sandbox gratuito, credenciales de prueba y amplia adopción en el
  contexto donde operará Bazaar. Checkout Pro delega toda la UI de pago a MP,
  reduciendo la superficie de implementación en el frontend.
- **Mock externo propio** — Microservicio interno que simula comportamientos
  configurables (aprobar, rechazar, timeout). Válido según la consigna si se
  documenta en un ADR.

## Decisión
Se adopta **MercadoPago Checkout Pro** como gateway de pagos.

El flujo implementado es el siguiente:

1. El cliente envía un `POST /payments/` con `order_id`, `amount` e `idempotency_key`.
2. Payment API crea una preferencia en MP vía SDK y persiste el registro en estado
   `PENDING` antes de recibir confirmación del pago.
3. MP devuelve un `init_point` (URL de pago) al que el cliente redirige al usuario.
4. Cuando el usuario completa o abandona el pago, MP notifica el resultado vía webhook
   (`POST /webhooks/mercadopago`). El handler soporta los dos formatos que usa MP
   (webhook nuevo con JSON body e IPN legacy con query params).
5. El webhook actualiza el estado interno y notifica al Orders API de forma
   fire-and-forget.

### Idempotencia del pago
Antes de crear una nueva preferencia en MP, el servicio consulta la DB por
`idempotency_key`. Si existe un registro previo, lo retorna sin llamar a MP.
La `idempotency_key` tiene constraint `UNIQUE` en la tabla `payments`, por lo
que un insert duplicado falla a nivel base de datos como segunda línea de defensa.

### Correlación webhook → registro interno
El `external_reference` enviado a MP es el mismo UUID del pago (`payment.id`).
Cuando MP notifica, ese campo viene en el payload y permite resolver el registro
en la DB sin ambigüedad.

### Estados terminales
Una vez que un pago alcanza `SUCCEEDED`, `FAILED`, `CANCELLED`, `REFUNDED` o
`PARTIALLY_REFUNDED`, las notificaciones posteriores de MP se ignoran. Esto
previene regresiones de estado ante reintentos tardíos del webhook.

### Comportamiento ante fallo de MP
Si la creación de preferencia en MP falla (status ≠ 201), se lanza `RuntimeError`
que el router convierte en `502 Bad Gateway`. El registro en estado `PENDING`
queda huérfano (sin `mp_preference_id`); no se hace rollback del insert porque
la `idempotency_key` ya está consumida y futuros reintentos devolverán ese mismo
registro sin reintentare la llamada a MP — el cliente debe usar una nueva key
para un reintento limpio.

### Commit explícito antes del webhook
El servicio hace `db.commit()` después de guardar la preferencia y antes de
retornar el `init_point`. Esto garantiza que cuando MP llame al webhook (incluso
segundos después), el `external_reference` ya está persistido y el handler puede
resolverlo.

## Alternativas descartadas

**Stripe**: descartado por razones de contexto local. MercadoPago es la pasarela
dominante en Argentina y la integración con Checkout Pro reduce la responsabilidad
del frontend (MP provee la UI de pago). Stripe sería la elección preferida en un
contexto internacional.

**Mock externo propio**: descartado porque MercadoPago provee un sandbox completo
con pagos de prueba que ejercita el flujo real de webhooks. Usar un mock propio
eliminaría la cobertura de integración con el comportamiento real de MP, incluyendo
los dos formatos de notificación que se deben soportar.

## Consecuencias

### Positivas
- La integración cubre el flujo completo: preferencia → redirección → webhook →
  actualización de estado, sin simulación interna.
- La idempotencia está implementada en dos capas (lógica de servicio + constraint
  de DB), cumpliendo el requisito de la consigna de evitar cobros dobles.
- El soporte de ambos formatos de webhook (nuevo e IPN legacy) hace la integración
  robusta ante cambios de versión de la API de MP.
- Los estados terminales previenen regresiones de estado ante webhooks tardíos o
  duplicados.

### Negativas y Riesgos
- **Sandbox de MP es menos predecible que Stripe**: el comportamiento del sandbox
  de MercadoPago puede diferir del de producción en casos borde, y la documentación
  es menos exhaustiva que la de Stripe.
- **Registro huérfano ante fallo de MP**: si la creación de preferencia falla, el
  registro `PENDING` queda en la DB sin `init_point`. El cliente debe generar una
  nueva `idempotency_key` para reintentar, lo cual no es obvio. Se debería agregar
  una tarea de limpieza o un endpoint de reintento explícito.
- **`auto_return` deshabilitado en local**: MP rechaza la configuración de
  `auto_return` con URLs no-HTTPS o localhost, lo que obliga a manejar la
  redirección manualmente en desarrollo.
- **Notificación a Orders API es fire-and-forget**: si ese llamado falla, el estado
  de la orden no se actualiza aunque el pago esté confirmado. Se requiere un
  mecanismo de reconciliación o reintentos para cubrir este caso.